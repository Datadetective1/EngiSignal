/**
 * Financial translation of utilization.
 *
 * Every value returned here is traceable to a quantity and a unit price that
 * the customer supplied. Nothing is estimated, benchmarked, or inferred — if a
 * price is missing, the result is explicitly unpriced rather than guessed.
 */

import type { FinancialResult, PortfolioRow } from '@/lib/domain/types';
import { round, safeDivide } from './stats';

export interface FinancialInput {
  entitled: number;
  recommended: number;
  unitPrice: number | null;
}

export function computeFinancial(input: FinancialInput): FinancialResult {
  const { entitled, recommended, unitPrice } = input;
  const quantityDelta = recommended - entitled;
  const priced = unitPrice !== null && Number.isFinite(unitPrice);

  if (!priced || unitPrice === null) {
    return {
      entitled,
      recommended,
      quantityDelta,
      unitPrice: null,
      currentAnnualCost: null,
      recommendedAnnualCost: null,
      optimizationOpportunity: null,
      incrementalSpend: null,
      savingsPct: null,
      priced: false,
    };
  }

  const currentAnnualCost = round(entitled * unitPrice, 2);
  const recommendedAnnualCost = round(recommended * unitPrice, 2);
  const optimizationOpportunity = quantityDelta < 0 ? round(-quantityDelta * unitPrice, 2) : 0;
  const incrementalSpend = quantityDelta > 0 ? round(quantityDelta * unitPrice, 2) : 0;
  const savingsRatio = safeDivide(optimizationOpportunity, currentAnnualCost);

  return {
    entitled,
    recommended,
    quantityDelta,
    unitPrice,
    currentAnnualCost,
    recommendedAnnualCost,
    optimizationOpportunity,
    incrementalSpend,
    savingsPct: savingsRatio === null ? null : round(savingsRatio * 100, 1),
    priced: true,
  };
}

export interface PortfolioTotals {
  /**
   * Annual value of SERVED capacity: served quantity × unit price, summed.
   *
   * This is what the deployed estate is worth, not what the customer is
   * contractually committed to. Where a contract says 440 and the licence
   * server serves 350, this figure reflects 350 — which is correct for
   * utilization and wrong for the sentence "committed annually".
   */
  annualSpend: number;
  /**
   * Annual value of PURCHASED quantity: what procurement records as bought.
   *
   * The honest basis for a commitment headline. Null contributions are skipped
   * rather than defaulted, so a portfolio with no contract quantities reports
   * zero purchased commitment and says so, instead of quietly reusing the
   * served figure.
   */
  purchasedCommitment: number;
  /** Features whose purchased quantity and price were both supplied. */
  purchasedPricedFeatures: number;
  /** Purchased minus served. Positive means more bought than is being served. */
  commitmentGap: number;
  recommendedSpend: number;
  optimizationOpportunity: number;
  incrementalSpend: number;
  netChange: number;
  pricedFeatures: number;
  unpricedFeatures: number;
  featureCount: number;
  vendorCount: number;
  /** Share of spend held by the single largest vendor, 0–1. */
  vendorConcentration: number;
}

export function computePortfolioTotals(rows: readonly PortfolioRow[]): PortfolioTotals {
  let annualSpend = 0;
  let purchasedCommitment = 0;
  let purchasedPricedFeatures = 0;
  let recommendedSpend = 0;
  let optimizationOpportunity = 0;
  let incrementalSpend = 0;
  let pricedFeatures = 0;
  let unpricedFeatures = 0;

  const vendorSpend = new Map<string, number>();

  for (const row of rows) {
    const f = row.financial;
    if (f.priced && f.currentAnnualCost !== null) {
      annualSpend += f.currentAnnualCost;
      recommendedSpend += f.recommendedAnnualCost ?? f.currentAnnualCost;
      optimizationOpportunity += f.optimizationOpportunity ?? 0;
      incrementalSpend += f.incrementalSpend ?? 0;
      pricedFeatures += 1;
      vendorSpend.set(row.vendorId, (vendorSpend.get(row.vendorId) ?? 0) + f.currentAnnualCost);
    } else {
      unpricedFeatures += 1;
    }

    // Counted independently of the served figure above: a feature can have a
    // purchased commitment and no served capacity, or the reverse.
    if (row.commitment.purchasedAnnualCommitment !== null) {
      purchasedCommitment += row.commitment.purchasedAnnualCommitment;
      purchasedPricedFeatures += 1;
    }
  }

  let largestVendorSpend = 0;
  for (const spend of vendorSpend.values()) {
    if (spend > largestVendorSpend) largestVendorSpend = spend;
  }

  return {
    annualSpend: round(annualSpend, 2),
    purchasedCommitment: round(purchasedCommitment, 2),
    purchasedPricedFeatures,
    commitmentGap: round(purchasedCommitment - annualSpend, 2),
    recommendedSpend: round(recommendedSpend, 2),
    optimizationOpportunity: round(optimizationOpportunity, 2),
    incrementalSpend: round(incrementalSpend, 2),
    netChange: round(recommendedSpend - annualSpend, 2),
    pricedFeatures,
    unpricedFeatures,
    featureCount: rows.length,
    vendorCount: vendorSpend.size,
    vendorConcentration: annualSpend > 0 ? round(largestVendorSpend / annualSpend, 4) : 0,
  };
}

/** Annual spend per technical employee. Null when headcount is unknown. */
export function costPerEngineer(annualSpend: number, technicalHeadcount: number | null): number | null {
  if (technicalHeadcount === null || technicalHeadcount <= 0) return null;
  return round(annualSpend / technicalHeadcount, 2);
}

/** Annual spend per distinct active user. Null when no active users observed. */
export function costPerActiveUser(annualSpend: number, activeUsers: number): number | null {
  if (activeUsers <= 0) return null;
  return round(annualSpend / activeUsers, 2);
}

/**
 * Spend attributable to capacity that observed demand never used.
 *
 * Reported only for priced concurrent features, where "unused" has a defensible
 * meaning: entitled capacity above the P95 daily peak. Named-user and token
 * models use their own waste definitions and are excluded here rather than
 * folded in, because mixing the definitions would make the total unexplainable.
 */
export function unusedCapacitySpend(rows: readonly PortfolioRow[]): {
  amount: number;
  featureCount: number;
  methodology: string;
} {
  let amount = 0;
  let featureCount = 0;

  for (const row of rows) {
    if (row.licenseModel !== 'concurrent') continue;
    if (!row.financial.priced || row.unitPrice === null) continue;
    if (row.metrics === null) continue;
    const unused = Math.max(0, row.entitled - row.metrics.p95);
    if (unused <= 0) continue;
    amount += unused * row.unitPrice;
    featureCount += 1;
  }

  return {
    amount: round(amount, 2),
    featureCount,
    methodology:
      'Entitled concurrent capacity above the P95 daily peak, valued at contract unit price. ' +
      'Concurrent features only — named-user and token models use different waste definitions and are excluded.',
  };
}

/** Format a value as compact currency, e.g. $18.4M, $410K, $1,250. */
export function formatCurrency(value: number | null, currency = 'USD'): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const symbol = currency === 'USD' ? '$' : '';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  if (abs >= 1_000_000) return `${sign}${symbol}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${sign}${symbol}${Math.round(abs / 1000)}K`;
  if (abs >= 1_000) return `${sign}${symbol}${(abs / 1000).toFixed(1)}K`;
  return `${sign}${symbol}${Math.round(abs).toLocaleString('en-US')}`;
}

/** Format a value as exact currency, e.g. $18,412,940. */
export function formatCurrencyExact(value: number | null, currency = 'USD'): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const symbol = currency === 'USD' ? '$' : '';
  const sign = value < 0 ? '-' : '';
  return `${sign}${symbol}${Math.round(Math.abs(value)).toLocaleString('en-US')}`;
}

export function formatNumber(value: number | null, decimals = 0): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatPercent(value: number | null, decimals = 1): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(decimals)}%`;
}

export function formatSignedPercent(value: number | null, decimals = 1): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(decimals)}%`;
}

/**
 * ── WHAT THE SPEND HEADLINE IS ACTUALLY MEASURING ───────────────────────────
 *
 * `annualSpend` values SERVED capacity: entitled quantity × unit price. That is
 * the right basis for utilization, because demand was measured against what the
 * licence server would actually issue.
 *
 * It is the wrong headline for a customer who bought more than the server
 * serves. The Phase 2C acceptance estate has a contract for 440 seats against
 * an entitlement of 350, so the served valuation is $1,759,000 while the
 * signed commitment is $2,209,000 — and a dashboard reading "Annual spend
 * $1.76M" understates by $450,000 what they are contractually bound to pay.
 * On an executive brief carried into a renewal negotiation, that is a number
 * that loses money.
 *
 * So the headline is described, not just formatted. Where procurement evidence
 * exists it leads and is called a commitment; where only entitlement evidence
 * exists the figure is called what it is.
 */
export interface SpendHeadline {
  label: string;
  value: number;
  /** The other figure, when both exist and disagree. Null otherwise. */
  contrast: { label: string; value: number } | null;
  /** One plain sentence naming the basis. */
  basis: string;
}

export function describeSpendHeadline(totals: PortfolioTotals): SpendHeadline {
  const served = totals.annualSpend;
  const purchased = totals.purchasedCommitment;

  // `purchasedCommitment` is 0, not null, when nothing was priced from a
  // contract — so the feature COUNT is the evidence check, not the amount. A
  // zero commitment and an absent one look identical in the number alone.
  if (totals.purchasedPricedFeatures === 0) {
    return {
      label: 'Served capacity value',
      value: served,
      contrast: null,
      basis:
        'Entitled quantity × unit price. No contract quantities were supplied, so this is what the licence servers are configured to serve — not a purchased commitment.',
    };
  }

  if (Math.abs(totals.commitmentGap) < 1) {
    return {
      label: 'Committed annually',
      value: purchased,
      contrast: null,
      basis: 'Contract quantity × unit price. Served capacity matches what was purchased.',
    };
  }

  return {
    label: 'Committed annually',
    value: purchased,
    contrast: { label: 'Served capacity value', value: served },
    basis:
      totals.commitmentGap > 0
        ? `Contract quantity × unit price. The licence servers serve ${formatCurrency(Math.abs(totals.commitmentGap))} less than was purchased — capacity paid for and not deployed.`
        : `Contract quantity × unit price. The licence servers serve ${formatCurrency(Math.abs(totals.commitmentGap))} more than was purchased — deployed capacity beyond the contract.`,
  };
}
