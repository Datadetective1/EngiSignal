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
  annualSpend: number;
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
  }

  let largestVendorSpend = 0;
  for (const spend of vendorSpend.values()) {
    if (spend > largestVendorSpend) largestVendorSpend = spend;
  }

  return {
    annualSpend: round(annualSpend, 2),
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
