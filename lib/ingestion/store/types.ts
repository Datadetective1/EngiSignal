/**
 * The ingestion storage boundary.
 *
 * Every method takes an explicit `orgId`, matching the DataProvider contract:
 * omitting it is a compile error, so no code path can read or write across
 * tenants even if a database policy were misconfigured.
 *
 * Commit is all-or-nothing from the caller's point of view. The Supabase
 * implementation writes canonical rows before marking the import complete, and
 * removes the import — which cascades to its rows — if any chunk fails. A
 * customer is never told an import succeeded while part of it is missing.
 */

import type {
  CanonicalContractRecord,
  CanonicalDataset,
  CanonicalEntitlementRecord,
  CanonicalPersonRecord,
  CanonicalUsageRecord,
  IngestionResult,
  IngestionWarning,
  QualityReport,
  RejectionSummary,
  SourceSystem,
} from '../canonical/types';
import type { ProjectionRecord } from '@/lib/analytics/projection';
import type { StoredRowCounts } from '@/lib/analytics/integrity';

export type { StoredRowCounts };

/**
 * Import lifecycle.
 *
 * These are real states, and the rule that made that sentence worth writing
 * still holds: nothing here is displayed that the implementation does not
 * actually occupy.
 *
 * `queued` was added when ingestion stopped being synchronous. A large import
 * cannot be persisted inside the request that uploads it, so between the file
 * being accepted and a worker picking it up there is a real moment when the
 * evidence is durable and nobody is working on it. That moment is `queued`;
 * `importing` now means a worker holds a lease and is writing rows.
 */
export type ImportLifecycle =
  | 'uploaded'
  | 'queued'
  | 'analyzed'
  | 'mapping_review'
  | 'validated'
  | 'importing'
  | 'complete'
  | 'failed';

export interface ImportSummary {
  id: string;
  organizationId: string;
  fileName: string;
  fileBytes: number;
  dataset: CanonicalDataset;
  sourceSystem: SourceSystem;
  detectionConfidence: number;
  detectionFellBack: boolean;
  status: ImportLifecycle;
  uploadedAt: string;
  importedAt: string | null;
  totalRows: number;
  acceptedRows: number;
  rejectedRows: number;
  duplicateRows: number;
  usageRecords: number;
  entitlementRecords: number;
  peopleRecords: number;
  contractRecords: number;
  failureReason: string | null;
  /**
   * Rows durably written so far.
   *
   * Equal to `acceptedRows` once the import is complete. While it is queued or
   * importing this is the honest answer to "is it moving", and it is the number
   * the worker resumes from -- so what the customer watches and what the system
   * relies on are the same value, not two that could disagree.
   */
  rowsPersisted: number;
  /** Attempts made. Above one means it is being retried, not stuck. */
  attempt: number;
}

export interface ImportDetail extends ImportSummary {
  /** Null for imports committed before fingerprinting existed. */
  contentFingerprint: string | null;
  detectionEvidence: string[];
  sourceSheets: string[];
  mappingUsed: Record<string, string>;
  warnings: IngestionWarning[];
  quality: QualityReport | null;
  /**
   * Per-rule totals with example values, exactly as produced at parse time.
   * Complete: every rejected row is counted here even though only a sample of
   * individual rows is retained below.
   */
  rejectionSummary: RejectionSummary[];
  /** Capped sample; `rejectedRows` remains the true count. */
  rejections: {
    sourceSheet: string | null;
    sourceRow: number;
    rule: string;
    field: string | null;
    value: string | null;
    message: string;
  }[];
}

/** What a tenant's imported data can currently support. */
export interface CoverageSummary {
  usageRecords: number;
  entitlementRecords: number;
  peopleRecords: number;
  contractRecords: number;
  /**
   * Commercial lines carrying a determinable unit price or annual cost.
   *
   * Distinct from `contractRecords`: a renewal schedule with dates but no
   * pricing produces contract records and zero priced lines, which unlocks
   * renewal exposure while correctly leaving financial opportunity withheld.
   */
  pricedContractRecords: number;
  /** Commercial lines carrying a renewal or end date. */
  datedContractRecords: number;
  /** ISO 4217 codes observed. More than one means amounts are not summable. */
  currencies: string[];
  distinctFeatures: number;
  distinctUsers: number;
  /** ISO dates, null when no usage has been imported. */
  firstDate: string | null;
  lastDate: string | null;
  /** Whole days between first and last observation, inclusive. */
  historyDays: number;
  /** True when at least one usage record carries the field. */
  hasHourOrTimestamp: boolean;
  hasConcurrency: boolean;
  hasDenials: boolean;
  sources: SourceSystem[];
}

/** Raised when the same content has already been committed for this tenant. */
export class DuplicateImportError extends Error {
  constructor(public readonly existingImportId: string | null = null) {
    super('This file has already been imported with the same mapping.');
    this.name = 'DuplicateImportError';
  }
}

/** Why a resume did or did not happen. Named, so the UI need not guess. */
export type ResumeOutcome =
  | { status: 'requeued' }
  | { status: 'not-found' }
  | { status: 'not-resumable'; reason: string };

export interface CommitInput {
  organizationId: string;
  importId: string;
  fileName: string;
  fileBytes: number;
  dataset: CanonicalDataset;
  detectionEvidence: string[];
  sourceSheets: string[];
  mappingUsed: Record<string, string>;
  result: IngestionResult;
  detectionConfidence: number;
  detectionFellBack: boolean;
  /** SHA-256 over content + dataset + mapping. Enables duplicate detection. */
  contentFingerprint?: string;
  /**
   * The uploaded bytes.
   *
   * Stored as the canonical evidence so the worker can re-read exactly what the
   * customer sent. Optional so the in-memory store, which persists inline and
   * has no worker, is unaffected.
   */
  fileContent?: ArrayBuffer;
  /**
   * Exactly the options this file was parsed with, recorded so a worker
   * reproduces the customer's reviewed mapping rather than guessing at it.
   */
  parseOptions?: Record<string, unknown>;
  /**
   * Reports how long each stage of persistence took. Optional so the memory
   * store and every existing caller are unaffected; supplied in production so
   * the cost of an import is a measurement rather than an estimate.
   */
  onPhase?: (name: string, ms: number, detail?: Record<string, number>) => void;
}

export interface IngestionStore {
  readonly kind: 'memory' | 'supabase';

  /** Persist canonical records and the import that produced them. */
  commitImport(input: CommitInput): Promise<ImportSummary>;

  listImports(orgId: string): Promise<ImportSummary[]>;
  getImport(orgId: string, importId: string): Promise<ImportDetail | null>;

  /** Remove one import and everything it wrote. Returns false when not found. */
  deleteImport(orgId: string, importId: string): Promise<boolean>;

  /**
   * Return a stalled import to the queue, renewing the worker's access to its
   * file.
   *
   * The worker reads the uploaded file through a short-lived signed URL. If an
   * import sits failed for longer than that URL lives -- which only happens
   * when something already went wrong -- the file is still there and the
   * import is still recoverable; only the capability to read it has lapsed.
   * This mints a fresh one and requeues.
   *
   * Runs as the signed-in customer, so Row Level Security decides which
   * imports are reachable: an id belonging to another tenant is simply not
   * found.
   */
  resumeImport(orgId: string, importId: string): Promise<ResumeOutcome>;

  /** Canonical usage for a tenant, for projection into analytics shapes. */
  listUsage(orgId: string, options?: { importId?: string; limit?: number }): Promise<CanonicalUsageRecord[]>;
  listEntitlements(orgId: string, options?: { importId?: string }): Promise<CanonicalEntitlementRecord[]>;
  listPeople(orgId: string, options?: { importId?: string }): Promise<CanonicalPersonRecord[]>;
  listContracts(orgId: string, options?: { importId?: string }): Promise<CanonicalContractRecord[]>;

  getCoverage(orgId: string): Promise<CoverageSummary>;

  /**
   * Exact row counts held for a tenant, counted BY THE DATABASE.
   *
   * Deliberately not `(await listUsage(orgId)).length`: that would count what
   * the read returned, which is precisely the number under suspicion. A read
   * capped at 1,000 rows would report 1,000 stored and 1,000 analyzed and
   * declare itself complete — the Phase 2C defect, reproduced inside its own
   * detector. This asks the server for a count instead.
   */
  countStoredRows(orgId: string): Promise<StoredRowCounts>;

  /**
   * Everything besides the canonical rows that can change a derived number.
   *
   * Confirming that two usernames are one person changes allocation, reclaim
   * and manager rollups without touching a single canonical row. A projection
   * keyed only on row counts would keep serving the pre-decision answer, which
   * is the stale-cache failure this product cannot afford.
   */
  countConfirmations(orgId: string): Promise<{ count: number; latest: string | null }>;

  /** The stored analytical projection, or null when there is none. */
  readProjection(orgId: string): Promise<ProjectionRecord | null>;

  /** Write (or replace) the stored analytical projection. */
  writeProjection(orgId: string, record: ProjectionRecord): Promise<void>;

  /** Drop the stored projection, so the next read rebuilds it. */
  clearProjection(orgId: string): Promise<void>;
}

/** Coverage from canonical records. Shared by both store implementations. */
export function summarizeCoverage(
  usage: readonly CanonicalUsageRecord[],
  entitlements: readonly CanonicalEntitlementRecord[],
  people: readonly CanonicalPersonRecord[],
  contracts: readonly CanonicalContractRecord[] = [],
): CoverageSummary {
  const features = new Set<string>();
  const users = new Set<string>();
  const sources = new Set<SourceSystem>();
  const currencies = new Set<string>();
  let first: string | null = null;
  let last: string | null = null;
  let hasTime = false;
  let hasConcurrency = false;
  let hasDenials = false;

  for (const record of usage) {
    features.add(record.feature.toLowerCase());
    if (record.user !== null) users.add(record.user.toLowerCase());
    sources.add(record.provenance.sourceSystem);
    if (first === null || record.date < first) first = record.date;
    if (last === null || record.date > last) last = record.date;
    if (record.hour !== null || record.observedAt !== null) hasTime = true;
    if (record.concurrent !== null || record.peak !== null) hasConcurrency = true;
    // A denial column that exists but is false still counts as denial
    // reporting: knowing demand was met is itself information. A null does not.
    if (record.denied !== null || record.denialCount !== null) hasDenials = true;
  }

  for (const record of entitlements) sources.add(record.provenance.sourceSystem);
  for (const record of people) {
    sources.add(record.provenance.sourceSystem);
    users.add(record.user.toLowerCase());
  }

  let pricedContracts = 0;
  let datedContracts = 0;
  for (const record of contracts) {
    sources.add(record.provenance.sourceSystem);
    features.add(record.feature.toLowerCase());
    if (record.unitPrice !== null || record.annualCost !== null) pricedContracts += 1;
    if (record.renewalDate !== null || record.contractEndDate !== null) datedContracts += 1;
    if (record.currency !== null) currencies.add(record.currency);
  }

  const historyDays =
    first === null || last === null
      ? 0
      : Math.round((Date.parse(last) - Date.parse(first)) / 86_400_000) + 1;

  return {
    usageRecords: usage.length,
    entitlementRecords: entitlements.length,
    peopleRecords: people.length,
    contractRecords: contracts.length,
    pricedContractRecords: pricedContracts,
    datedContractRecords: datedContracts,
    currencies: [...currencies].sort(),
    distinctFeatures: features.size,
    distinctUsers: users.size,
    firstDate: first,
    lastDate: last,
    historyDays,
    hasHourOrTimestamp: hasTime,
    hasConcurrency,
    hasDenials,
    sources: [...sources],
  };
}
