/**
 * ── DID WE ANALYZE EVERYTHING WE STORED? ─────────────────────────────────────
 *
 * Phase 2C found the application analysing 1,000 of 4,116 stored usage rows and
 * reporting the result as a finished analysis. PostgREST had capped the read at
 * `db-max-rows`; the query SUCCEEDED, returned a page, and nothing anywhere
 * said the rest existed. Three features with six months of usage were displayed
 * as "usage evidence not supplied", and a $240,000 recommendation was computed
 * from under a quarter of the evidence.
 *
 * The paging fix removed that specific cause. This module removes the CLASS of
 * failure, by refusing to take "the read succeeded" as evidence that the read
 * was complete.
 *
 * Three counts must agree, per canonical dataset:
 *
 *   ACCEPTED   what the importer told the customer it would store, summed over
 *              completed imports — the number on the import receipt
 *   STORED     what the database actually holds right now, counted server-side
 *              with an exact count that no row cap applies to
 *   ANALYZED   how many records the analytics pipeline actually consumed on
 *              this request
 *
 * ACCEPTED vs STORED catches a partial or half-rolled-back commit.
 * STORED vs ANALYZED catches a truncated read — the Phase 2C defect.
 *
 * When they disagree the product does NOT show a smaller number and carry on.
 * It reports the dataset as incomplete and withholds the analytics that depend
 * on it, because a confident recommendation computed from an unknown fraction
 * of the evidence is the single most damaging thing this product can produce.
 */

export type IntegrityDataset = 'usage' | 'people' | 'entitlements' | 'contracts';

export const INTEGRITY_DATASETS: readonly IntegrityDataset[] = [
  'usage',
  'people',
  'entitlements',
  'contracts',
] as const;

export interface DatasetCounts {
  accepted: number;
  stored: number;
  analyzed: number;
}

/** Counts of what the database actually holds, per canonical table. */
export type StoredRowCounts = Record<IntegrityDataset, number>;

/** Counts of what the analytics pipeline actually consumed. */
export type AnalyzedRowCounts = Record<IntegrityDataset, number>;

export interface DatasetIntegrity {
  dataset: IntegrityDataset;
  label: string;
  accepted: number;
  stored: number;
  analyzed: number;
  /** All three agree. */
  complete: boolean;
  /**
   * Rows the analytics never saw. Positive means analysis ran on less than the
   * estate; negative would mean it saw more than is stored, which should be
   * impossible and is reported rather than clamped.
   */
  missingFromAnalysis: number;
  /** Rows the importer promised that the database does not hold. */
  missingFromStorage: number;
  /** One plain sentence naming what is wrong, or confirming it is not. */
  statement: string;
}

/**
 * Why the analysis on this request may not describe the current evidence.
 *
 * Phase 2F made the build asynchronous, which introduced a state the product
 * had never had: evidence is durably stored and correct, and the analysis of it
 * does not exist yet. That is not an integrity failure — nothing disagrees —
 * but it is equally not something to render zeroes for.
 */
export type AnalysisState =
  /** The analysis describes exactly what is stored. */
  | 'current'
  /** A build is running. There may or may not be an older analysis to show. */
  | 'building'
  /** A complete analysis of an earlier evidence version is available. */
  | 'superseded'
  /** The last build failed. */
  | 'failed'
  /** Nothing has ever been built for this tenant. */
  | 'absent'
  /**
   * The stored row counts could not be read just now.
   *
   * Distinct from every state above, all of which describe the ANALYSIS. This
   * one says the comparison itself could not be made: counting a tenant's rows
   * degrades while a large import is being written, and a count that is
   * cancelled leaves us unable to say whether the analysis matches storage.
   *
   * It must not be reported as agreement. "We could not check" and "we checked
   * and it matched" are different answers, and only one of them is true here.
   */
  | 'unverified';

export interface IntegrityReport {
  datasets: DatasetIntegrity[];
  /** Every dataset agrees on all three counts. */
  complete: boolean;
  /** Datasets that do not reconcile. Empty when complete. */
  incomplete: IntegrityDataset[];
  totalAccepted: number;
  totalStored: number;
  totalAnalyzed: number;
  /**
   * True when usage specifically is incomplete. Demand analytics — utilization,
   * percentiles, right-sizing, opportunity — are unsafe to show, because each
   * is a statistic over a population we cannot confirm we fully read.
   */
  usageIncomplete: boolean;
  /** Headline sentence for the banner. */
  headline: string;

  /**
   * Whether the analysis on this request describes the evidence that exists now.
   *
   * Separate from `complete`, which is about whether the rows reconcile. Both
   * must hold before a figure may be shown: numbers computed from evidence that
   * has since changed are wrong in exactly the way numbers computed from a
   * truncated read are wrong.
   */
  analysisCurrent: boolean;
  analysisState: AnalysisState;
}

const LABELS: Record<IntegrityDataset, string> = {
  usage: 'Usage',
  people: 'People',
  entitlements: 'Entitlements',
  contracts: 'Contracts',
};

function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

function describe(dataset: IntegrityDataset, counts: DatasetCounts): string {
  const label = LABELS[dataset].toLowerCase();
  const missingFromAnalysis = counts.stored - counts.analyzed;
  const missingFromStorage = counts.accepted - counts.stored;

  if (missingFromAnalysis > 0) {
    return `${formatCount(missingFromAnalysis)} of ${formatCount(counts.stored)} stored ${label} rows were not read into this analysis. Figures derived from ${label} are withheld until this reconciles.`;
  }
  if (missingFromAnalysis < 0) {
    return `Analysis consumed ${formatCount(-missingFromAnalysis)} more ${label} rows than the database holds. This should be impossible and is reported rather than ignored.`;
  }
  if (missingFromStorage > 0) {
    return `${formatCount(missingFromStorage)} ${label} rows were accepted at import but are not in the database. The import may have partially failed.`;
  }
  if (missingFromStorage < 0) {
    return `The database holds ${formatCount(-missingFromStorage)} more ${label} rows than the import receipts account for.`;
  }
  if (counts.stored === 0) {
    return `No ${label} data imported.`;
  }
  return `${formatCount(counts.stored)} rows accepted, stored and analyzed.`;
}

export interface IntegrityInput {
  /** Sum of accepted rows over COMPLETED imports, per dataset. */
  accepted: StoredRowCounts;
  /** Exact server-side counts of what the database holds. */
  stored: StoredRowCounts;
  /** What the analytics pipeline consumed this request. */
  analyzed: AnalyzedRowCounts;
  /**
   * Where the analysis stands. Defaults to `current` so that callers with no
   * asynchronous build — the local provider, and every existing test — keep
   * meaning exactly what they meant before.
   */
  analysis?: AnalysisState;
}

export function checkIntegrity(input: IntegrityInput): IntegrityReport {
  const datasets: DatasetIntegrity[] = INTEGRITY_DATASETS.map((dataset) => {
    const counts: DatasetCounts = {
      accepted: input.accepted[dataset],
      stored: input.stored[dataset],
      analyzed: input.analyzed[dataset],
    };
    const missingFromAnalysis = counts.stored - counts.analyzed;
    const missingFromStorage = counts.accepted - counts.stored;

    return {
      dataset,
      label: LABELS[dataset],
      ...counts,
      complete: missingFromAnalysis === 0 && missingFromStorage === 0,
      missingFromAnalysis,
      missingFromStorage,
      statement: describe(dataset, counts),
    };
  });

  const incomplete = datasets.filter((entry) => !entry.complete).map((entry) => entry.dataset);
  const complete = incomplete.length === 0;
  const usageIncomplete = incomplete.includes('usage');

  const sum = (pick: (entry: DatasetIntegrity) => number) =>
    datasets.reduce((total, entry) => total + pick(entry), 0);

  const analysisState = input.analysis ?? 'current';

  return {
    datasets,
    complete,
    incomplete,
    analysisCurrent: analysisState === 'current',
    analysisState,
    totalAccepted: sum((entry) => entry.accepted),
    totalStored: sum((entry) => entry.stored),
    totalAnalyzed: sum((entry) => entry.analyzed),
    usageIncomplete,
    headline: complete
      ? `${formatCount(sum((entry) => entry.stored))} rows accepted, stored and analyzed.`
      : `${incomplete.map((dataset) => LABELS[dataset]).join(', ')} did not reconcile. Recommendations derived from ${incomplete.length === 1 ? 'it' : 'them'} are withheld.`,
  };
}

/**
 * Whether a given analytical surface can be trusted to show numbers.
 *
 * Deliberately coarse. A finer-grained rule — "this feature's rows are all
 * present even though that one's are not" — cannot be justified, because a
 * truncated read gives no way to know WHICH rows are missing. The only honest
 * position when usage is short is that no usage-derived figure is defensible.
 */
export function analyticsAvailable(report: IntegrityReport): boolean {
  // Two separate ways to be wrong, and both disqualify a figure.
  //
  //   usageIncomplete   the rows we read are not the rows that are stored
  //   analysisCurrent   the analysis we hold is not of the evidence that exists
  //
  // The second was introduced by Phase 2F, when the build stopped happening
  // inside the request. A page that rendered a superseded analysis as though it
  // were current would be the confident-wrong-answer failure arriving by a new
  // route.
  return !report.usageIncomplete && report.analysisCurrent;
}
