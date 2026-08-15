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
  CanonicalDataset,
  CanonicalEntitlementRecord,
  CanonicalPersonRecord,
  CanonicalUsageRecord,
  IngestionResult,
  IngestionWarning,
  QualityReport,
  SourceSystem,
} from '../canonical/types';

/**
 * Import lifecycle.
 *
 * These are real states. Ingestion is synchronous, so there is no queued or
 * processing state that the implementation does not actually occupy —
 * displaying one would be theatre.
 */
export type ImportLifecycle =
  | 'uploaded'
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
  failureReason: string | null;
}

export interface ImportDetail extends ImportSummary {
  detectionEvidence: string[];
  sourceSheets: string[];
  mappingUsed: Record<string, string>;
  warnings: IngestionWarning[];
  quality: QualityReport | null;
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
}

export interface IngestionStore {
  readonly kind: 'memory' | 'supabase';

  /** Persist canonical records and the import that produced them. */
  commitImport(input: CommitInput): Promise<ImportSummary>;

  listImports(orgId: string): Promise<ImportSummary[]>;
  getImport(orgId: string, importId: string): Promise<ImportDetail | null>;

  /** Remove one import and everything it wrote. Returns false when not found. */
  deleteImport(orgId: string, importId: string): Promise<boolean>;

  /** Canonical usage for a tenant, for projection into analytics shapes. */
  listUsage(orgId: string, options?: { importId?: string; limit?: number }): Promise<CanonicalUsageRecord[]>;
  listEntitlements(orgId: string, options?: { importId?: string }): Promise<CanonicalEntitlementRecord[]>;
  listPeople(orgId: string, options?: { importId?: string }): Promise<CanonicalPersonRecord[]>;

  getCoverage(orgId: string): Promise<CoverageSummary>;
}

/** Coverage from canonical records. Shared by both store implementations. */
export function summarizeCoverage(
  usage: readonly CanonicalUsageRecord[],
  entitlements: readonly CanonicalEntitlementRecord[],
  people: readonly CanonicalPersonRecord[],
): CoverageSummary {
  const features = new Set<string>();
  const users = new Set<string>();
  const sources = new Set<SourceSystem>();
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

  const historyDays =
    first === null || last === null
      ? 0
      : Math.round((Date.parse(last) - Date.parse(first)) / 86_400_000) + 1;

  return {
    usageRecords: usage.length,
    entitlementRecords: entitlements.length,
    peopleRecords: people.length,
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
