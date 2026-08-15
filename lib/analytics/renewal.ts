/**
 * Renewal exposure.
 *
 * Answers "what has to be decided, when, and how much is riding on it" from
 * contract dates the customer supplied. No date is inferred: a line without a
 * renewal date is reported as undated, never bucketed into "12 months" on the
 * assumption that everything renews annually. Plenty of engineering software is
 * perpetual, and putting a perpetual licence on a renewal calendar would send
 * someone to negotiate a contract that does not exist.
 *
 * Windows are cumulative on purpose. A renewal 45 days out appears in the 60,
 * 90, 180 and 365-day figures because it is genuinely exposure inside all of
 * them — a procurement lead asking "what is in the next quarter" wants that
 * line counted, not filed under an earlier bucket and omitted.
 */

import type { LicenseModel, PortfolioRow } from '@/lib/domain/types';
import { round } from './stats';

/** The horizons a renewal conversation actually uses. */
export const RENEWAL_WINDOWS = [30, 60, 90, 180, 365] as const;

export type RenewalWindow = (typeof RENEWAL_WINDOWS)[number];

export interface RenewalLine {
  featureKey: string;
  featureName: string;
  vendor: string | null;
  product: string | null;
  /** ISO date, or null when the source did not state one. */
  renewalDate: string | null;
  /** Whole days from `asOf` to the renewal. Negative when already lapsed. */
  daysToRenewal: number | null;
  currentQuantity: number;
  /** Null when the line is unpriced — never zero. */
  currentAnnualCost: number | null;
  recommendedQuantity: number | null;
  recommendedAnnualCost: number | null;
  optimizationOpportunity: number | null;
  licenseModel: LicenseModel;
  currency: string | null;
  contractNumbers: string[];
  /** Why the figures can or cannot be trusted, in one phrase. */
  evidence: string;
}

export interface RenewalBucket {
  window: RenewalWindow;
  lineCount: number;
  /** Sum of priced lines only. */
  annualCost: number;
  /** Lines inside the window with no price. Reported, not silently dropped. */
  unpricedLines: number;
  optimizationOpportunity: number;
}

export interface RenewalExposure {
  asOf: string;
  buckets: RenewalBucket[];
  /** Renewal dates already in the past. Usually a stale export, sometimes not. */
  lapsedLines: number;
  lapsedAnnualCost: number;
  /** Lines with no renewal date at all. */
  undatedLines: number;
  undatedAnnualCost: number;
  totalDatedLines: number;
}

/** Whole days between two ISO dates. Negative when `date` is in the past. */
export function daysBetween(asOf: string, date: string): number | null {
  const from = Date.parse(asOf);
  const to = Date.parse(date);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / 86_400_000);
}

export function computeRenewalExposure(lines: readonly RenewalLine[], asOf: string): RenewalExposure {
  const buckets: RenewalBucket[] = RENEWAL_WINDOWS.map((window) => ({
    window,
    lineCount: 0,
    annualCost: 0,
    unpricedLines: 0,
    optimizationOpportunity: 0,
  }));

  let lapsedLines = 0;
  let lapsedAnnualCost = 0;
  let undatedLines = 0;
  let undatedAnnualCost = 0;
  let totalDatedLines = 0;

  for (const line of lines) {
    if (line.renewalDate === null || line.daysToRenewal === null) {
      undatedLines += 1;
      undatedAnnualCost += line.currentAnnualCost ?? 0;
      continue;
    }

    totalDatedLines += 1;

    if (line.daysToRenewal < 0) {
      lapsedLines += 1;
      lapsedAnnualCost += line.currentAnnualCost ?? 0;
      continue;
    }

    for (const bucket of buckets) {
      if (line.daysToRenewal > bucket.window) continue;
      bucket.lineCount += 1;
      if (line.currentAnnualCost === null) {
        bucket.unpricedLines += 1;
      } else {
        bucket.annualCost += line.currentAnnualCost;
      }
      bucket.optimizationOpportunity += line.optimizationOpportunity ?? 0;
    }
  }

  return {
    asOf,
    buckets: buckets.map((bucket) => ({
      ...bucket,
      annualCost: round(bucket.annualCost, 2),
      optimizationOpportunity: round(bucket.optimizationOpportunity, 2),
    })),
    lapsedLines,
    lapsedAnnualCost: round(lapsedAnnualCost, 2),
    undatedLines,
    undatedAnnualCost: round(undatedAnnualCost, 2),
    totalDatedLines,
  };
}

/**
 * Urgency band for a renewal, used for ordering and emphasis.
 *
 * `unknown` is a real band, not a fallback to "low". A line whose renewal date
 * was never supplied is not low-urgency — its urgency is unmeasured, and
 * showing it as calm would be the wrong reassurance.
 */
export type RenewalUrgency = 'lapsed' | 'critical' | 'high' | 'medium' | 'low' | 'unknown';

export function renewalUrgency(daysToRenewal: number | null): RenewalUrgency {
  if (daysToRenewal === null) return 'unknown';
  if (daysToRenewal < 0) return 'lapsed';
  if (daysToRenewal <= 30) return 'critical';
  if (daysToRenewal <= 60) return 'high';
  if (daysToRenewal <= 90) return 'medium';
  return 'low';
}

/**
 * Portfolio rows → renewal lines.
 *
 * A pure reshaping. Every figure below was already computed by the existing
 * engine — right-sizing in rightsizing.ts, money in financial.ts — and is
 * copied, not recalculated. A second implementation of "recommended quantity"
 * living in a renewal module would eventually disagree with the one on the
 * portfolio screen, and the customer would have two different answers to the
 * same question with no way to tell which was used in their negotiation.
 */
export function buildRenewalLines(rows: readonly PortfolioRow[]): RenewalLine[] {
  return rows.map((row) => {
    const financial = row.financial;
    const recommended = row.rightSizing?.recommended ?? null;

    return {
      featureKey: row.featureId,
      featureName: row.featureName,
      vendor: row.vendorName,
      product: row.productName,
      renewalDate: row.renewalDate,
      daysToRenewal: row.daysToRenewal,
      currentQuantity: row.entitled,
      currentAnnualCost: financial.currentAnnualCost,
      recommendedQuantity: recommended,
      recommendedAnnualCost: financial.recommendedAnnualCost,
      // Zero opportunity and unknown opportunity are different answers. An
      // unpriced line has no opportunity figure at all, and rendering it as $0
      // would report "nothing to save here" about a line nobody has priced.
      optimizationOpportunity: financial.priced ? financial.optimizationOpportunity : null,
      licenseModel: row.licenseModel,
      currency: null,
      contractNumbers: row.contractId === null ? [] : [row.contractId],
      evidence: describeEvidence(row),
    };
  });
}

function describeEvidence(row: PortfolioRow): string {
  if (!row.financial.priced) return 'Unpriced — no contract cost supplied for this feature';
  // A metrics object exists even when nothing was observed, so observedDays is
  // the honest test. Reporting "demand observed" for a feature with none would
  // put a confident-sounding label on the emptiest row on the page.
  const observedDays = row.metrics?.observedDays ?? 0;
  if (observedDays === 0) return 'Priced, but no usage was imported for this feature';
  if (row.rightSizing === null) return `Priced, but ${observedDays} days is not enough history to right-size`;
  return `Priced, sized from ${observedDays} days of observed demand`;
}

export function describeRenewalTiming(daysToRenewal: number | null): string {
  if (daysToRenewal === null) return 'Renewal date not supplied';
  if (daysToRenewal < 0) return `Lapsed ${Math.abs(daysToRenewal)} days ago`;
  if (daysToRenewal === 0) return 'Renews today';
  if (daysToRenewal === 1) return 'Renews tomorrow';
  return `Renews in ${daysToRenewal} days`;
}
