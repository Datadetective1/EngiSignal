/**
 * In-memory ingestion store.
 *
 * EngiSignal's default, matching mockProvider: the product is fully functional
 * with no credentials so an evaluation never depends on a database being
 * provisioned. Data lives for the server process and resets on restart, which
 * the UI states plainly rather than implying durability it does not have.
 *
 * Tenant isolation is enforced the same way as the database: every read and
 * write is keyed by organization, and a record written under one organization
 * is unreachable from another.
 */

import type {
  CanonicalContractRecord,
  CanonicalEntitlementRecord,
  CanonicalPersonRecord,
  CanonicalUsageRecord,
} from '../canonical/types';
import type {
  CommitInput,
  CoverageSummary,
  ImportDetail,
  ImportSummary,
  IngestionStore,
  StoredRowCounts,
} from './types';
import { DuplicateImportError, summarizeCoverage } from './types';
import type { ProjectionRecord } from '@/lib/analytics/projection';

interface TenantBucket {
  imports: Map<string, ImportDetail>;
  usage: CanonicalUsageRecord[];
  entitlements: CanonicalEntitlementRecord[];
  people: CanonicalPersonRecord[];
  contracts: CanonicalContractRecord[];
}

const tenants = new Map<string, TenantBucket>();

function bucket(orgId: string): TenantBucket {
  const existing = tenants.get(orgId);
  if (existing !== undefined) return existing;
  const created: TenantBucket = { imports: new Map(), usage: [], entitlements: [], people: [], contracts: [] };
  tenants.set(orgId, created);
  return created;
}

/** Test seam. Never called by application code. */
export function __resetMemoryStore(): void {
  tenants.clear();
}

export const memoryIngestionStore: IngestionStore = {
  kind: 'memory',

  async commitImport(input: CommitInput): Promise<ImportSummary> {
    const {
      organizationId,
      importId,
      fileName,
      fileBytes,
      dataset,
      result,
      detectionConfidence,
      detectionEvidence,
      detectionFellBack,
      sourceSheets,
      mappingUsed,
      contentFingerprint,
    } = input;

    const store = bucket(organizationId);

    // Same rule as the database: identical content, dataset and mapping cannot
    // be committed twice. Re-committing the SAME import id is still a retry
    // and is handled below.
    if (contentFingerprint !== undefined) {
      for (const existing of store.imports.values()) {
        if (existing.contentFingerprint === contentFingerprint && existing.id !== importId) {
          throw new DuplicateImportError(existing.id);
        }
      }
    }

    // Re-committing the same import replaces it rather than duplicating, so a
    // retry after a network failure cannot double-count demand.
    if (store.imports.has(importId)) {
      store.usage = store.usage.filter((row) => row.provenance.importId !== importId);
      store.entitlements = store.entitlements.filter((row) => row.provenance.importId !== importId);
      store.people = store.people.filter((row) => row.provenance.importId !== importId);
      store.contracts = store.contracts.filter((row) => row.provenance.importId !== importId);
    }

    const importedAt = new Date().toISOString();

    // Records are stamped with the caller's tenant on write. A record whose
    // provenance names another organization is a bug, not a routing hint, and
    // is rejected rather than silently rewritten.
    for (const record of [...result.usage, ...result.entitlements, ...result.people, ...result.contracts]) {
      if (record.provenance.organizationId !== organizationId) {
        throw new Error('Refusing to commit records belonging to another organization.');
      }
    }

    store.usage.push(...result.usage);
    store.entitlements.push(...result.entitlements);
    store.people.push(...result.people);
    store.contracts.push(...result.contracts);

    const detail: ImportDetail = {
      // The in-memory store has no worker and writes inline, so an import is
      // finished the moment it is accepted and every accepted row is persisted.
      rowsPersisted: result.acceptedRows,
      attempt: 1,
      id: importId,
      organizationId,
      fileName,
      fileBytes,
      dataset,
      sourceSystem: result.sourceSystem,
      detectionConfidence,
      detectionFellBack,
      status: 'complete',
      uploadedAt: importedAt,
      importedAt,
      totalRows: result.totalRows,
      acceptedRows: result.acceptedRows,
      rejectedRows: result.rejectedRows,
      duplicateRows: result.duplicateRows,
      usageRecords: result.usage.length,
      entitlementRecords: result.entitlements.length,
      peopleRecords: result.people.length,
      contractRecords: result.contracts.length,
      failureReason: null,
      contentFingerprint: contentFingerprint ?? null,
      detectionEvidence,
      sourceSheets,
      mappingUsed,
      warnings: result.warnings,
      quality: result.quality,
      rejections: result.rejections.slice(0, 200).map((rejection) => ({
        sourceSheet: rejection.sourceSheet,
        sourceRow: rejection.sourceRow,
        rule: rejection.rule,
        field: rejection.field,
        value: rejection.value,
        message: rejection.message,
      })),
    };

    store.imports.set(importId, detail);
    return toSummary(detail);
  },

  async listImports(orgId: string): Promise<ImportSummary[]> {
    return [...bucket(orgId).imports.values()]
      .map(toSummary)
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  },

  async getImport(orgId: string, importId: string): Promise<ImportDetail | null> {
    return bucket(orgId).imports.get(importId) ?? null;
  },

  async deleteImport(orgId: string, importId: string): Promise<boolean> {
    const store = bucket(orgId);
    if (!store.imports.has(importId)) return false;

    store.imports.delete(importId);
    store.usage = store.usage.filter((row) => row.provenance.importId !== importId);
    store.entitlements = store.entitlements.filter((row) => row.provenance.importId !== importId);
    store.people = store.people.filter((row) => row.provenance.importId !== importId);
    store.contracts = store.contracts.filter((row) => row.provenance.importId !== importId);
    return true;
  },

  async listUsage(orgId, options): Promise<CanonicalUsageRecord[]> {
    let rows = bucket(orgId).usage;
    if (options?.importId !== undefined) {
      rows = rows.filter((row) => row.provenance.importId === options.importId);
    }
    return options?.limit === undefined ? [...rows] : rows.slice(0, options.limit);
  },

  async listEntitlements(orgId, options): Promise<CanonicalEntitlementRecord[]> {
    const rows = bucket(orgId).entitlements;
    return options?.importId === undefined
      ? [...rows]
      : rows.filter((row) => row.provenance.importId === options.importId);
  },

  async listPeople(orgId, options): Promise<CanonicalPersonRecord[]> {
    const rows = bucket(orgId).people;
    return options?.importId === undefined
      ? [...rows]
      : rows.filter((row) => row.provenance.importId === options.importId);
  },

  async listContracts(orgId, options): Promise<CanonicalContractRecord[]> {
    const rows = bucket(orgId).contracts;
    return options?.importId === undefined
      ? [...rows]
      : rows.filter((row) => row.provenance.importId === options.importId);
  },

  async getCoverage(orgId: string): Promise<CoverageSummary> {
    const store = bucket(orgId);
    return summarizeCoverage(store.usage, store.entitlements, store.people, store.contracts);
  },

  async countStoredRows(orgId: string): Promise<StoredRowCounts> {
    // In memory there is no transport between the store and the reader, so the
    // array lengths ARE the authoritative counts.
    const store = bucket(orgId);
    return {
      usage: store.usage.length,
      people: store.people.length,
      entitlements: store.entitlements.length,
      contracts: store.contracts.length,
    };
  },

  // The local path has no transport to save and nothing to invalidate against,
  // so it always reports "computed". Pretending to cache here would hide the
  // projection's real behaviour behind a stub during development.
  async countConfirmations(): Promise<{ count: number; latest: string | null }> {
    return { count: 0, latest: null };
  },

  async readProjection(): Promise<ProjectionRecord | null> {
    return null;
  },

  async writeProjection(): Promise<void> {
    /* nothing to persist */
  },

  async clearProjection(): Promise<void> {
    /* nothing to clear */
  },
};

function toSummary(detail: ImportDetail): ImportSummary {
  const {
    detectionEvidence: _evidence,
    sourceSheets: _sheets,
    mappingUsed: _mapping,
    warnings: _warnings,
    quality: _quality,
    rejections: _rejections,
    ...summary
  } = detail;
  return summary;
}
