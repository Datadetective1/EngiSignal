/**
 * Demand forecasting.
 *
 * Two independent growth inputs are combined:
 *   1. Observed demand trend — what the usage data itself is doing.
 *   2. Expected organizational growth — what the business plans to do.
 *
 * They are combined multiplicatively because they compound: 10% more engineers
 * doing 5% more simulation each is 15.5% more demand, not 15%.
 *
 * The observed trend is CLAMPED before extrapolation. An OLS slope fitted to a
 * noisy or short series can annualize to an absurd figure, and a forecast that
 * a customer can immediately see is wrong destroys trust in every other number
 * on the page. The clamp is disclosed in the evidence rather than hidden.
 */

import type { ConcurrentMetrics, ForecastResult } from '@/lib/domain/types';
import { ceilPrecise, clamp, round } from './stats';
import { MINIMUM_TREND_HISTORY_DAYS, hasEnoughTrendHistory, trendForProjection } from './trend';
import { DEFAULT_PERCENTILE, DEFAULT_SAFETY_FACTOR } from './rightsizing';

/** Bounds applied to the annualized observed trend before extrapolation. */
export const TREND_CLAMP = { min: -30, max: 50 } as const;

export interface ForecastInput {
  metrics: ConcurrentMetrics;
  /** Organization headcount growth as a ratio, e.g. 0.05 for +5%. */
  headcountGrowthRate: number;
  /** Safety buffer applied to the forecast recommendation. */
  safetyFactor?: number;
  /** Forecast horizon in days. Defaults to one year. */
  horizonDays?: number;
  unitPrice: number | null;
  /** Percentile of daily peaks used as the demand baseline. */
  percentileValue?: number;
}

export function computeForecast(input: ForecastInput): ForecastResult {
  const { metrics } = input;
  const horizonYears = (input.horizonDays ?? 365) / 365;
  const safetyFactor = input.safetyFactor ?? DEFAULT_SAFETY_FACTOR;

  const baseline = baselineFor(metrics, input.percentileValue ?? DEFAULT_PERCENTILE);

  // The clamp bounds a trend that exists. It cannot rescue one that does not:
  // three days of usage produced an observed -24,333%/yr, which the floor
  // turned into a confident -30%/yr contraction assumption. Below the minimum
  // history the growth input is zero -- no observed movement -- and the note
  // below says so instead of quoting the unsupported slope.
  const clampedTrendPct = clamp(trendForProjection(metrics), TREND_CLAMP.min, TREND_CLAMP.max);
  const trendGrowth = (clampedTrendPct / 100) * horizonYears;
  const headcountGrowth = input.headcountGrowthRate * horizonYears;

  const combinedGrowth = (1 + trendGrowth) * (1 + headcountGrowth) - 1;
  const forecastDemand = round(baseline * (1 + combinedGrowth), 2);
  const recommendedQuantity = ceilPrecise(forecastDemand * safetyFactor);

  const quantityDelta = recommendedQuantity - metrics.entitled;
  const financialImpact = input.unitPrice === null ? null : round(quantityDelta * input.unitPrice, 2);

  return {
    featureId: metrics.featureId,
    currentEntitled: metrics.entitled,
    currentP95: metrics.p95,
    trendGrowth: round(trendGrowth, 4),
    headcountGrowth: round(headcountGrowth, 4),
    combinedGrowth: round(combinedGrowth, 4),
    forecastDemand,
    recommendedQuantity,
    surplus: Math.max(0, metrics.entitled - recommendedQuantity),
    shortfall: Math.max(0, recommendedQuantity - metrics.entitled),
    financialImpact,
  };
}

function baselineFor(metrics: ConcurrentMetrics, percentileValue: number): number {
  if (percentileValue >= 0.99) return metrics.p99;
  if (percentileValue >= 0.95) return metrics.p95;
  if (percentileValue >= 0.9) return metrics.p90;
  return metrics.median;
}

/**
 * Human-readable note describing whether the trend was clamped.
 *
 * Takes the metrics rather than a bare number so it can tell "clamped" from
 * "unsupported". It used to print `Observed trend of -24333.3%/yr was floored
 * at -30%/yr`, which quoted the very figure the guard exists to suppress and
 * implied the forecast was working from a real contraction.
 */
export function trendClampNote(metrics: TrendNoteEvidence): string | null {
  if (!hasEnoughTrendHistory(metrics)) {
    return `Fewer than ${MINIMUM_TREND_HISTORY_DAYS} days of usage have been observed, so no demand trend is applied to this forecast. Headcount growth is the only growth assumption in use.`;
  }
  const rawTrendPct = metrics.trendPctPerYear;
  if (rawTrendPct > TREND_CLAMP.max) {
    return `Observed trend of ${round(rawTrendPct, 1)}%/yr was capped at ${TREND_CLAMP.max}%/yr for forecasting.`;
  }
  if (rawTrendPct < TREND_CLAMP.min) {
    return `Observed trend of ${round(rawTrendPct, 1)}%/yr was floored at ${TREND_CLAMP.min}%/yr for forecasting.`;
  }
  return null;
}

/** What the note needs to decide between "clamped" and "not supported". */
export interface TrendNoteEvidence {
  observedDays: number;
  trendPctPerYear: number;
}

/** Projected annual portfolio spend at the forecast position. */
export function forecastPortfolioSpend(
  forecasts: readonly { recommendedQuantity: number; unitPrice: number | null }[],
  priceEscalationPct = 0,
): number {
  const escalation = 1 + priceEscalationPct / 100;
  let total = 0;
  for (const f of forecasts) {
    if (f.unitPrice === null) continue;
    total += f.recommendedQuantity * f.unitPrice * escalation;
  }
  return round(total, 2);
}

/**
 * Project the demand curve forward for charting.
 * Returns monthly points from the end of the observation window.
 */
export function forecastSeries(
  baseline: number,
  combinedAnnualGrowth: number,
  months = 12,
): { monthOffset: number; demand: number }[] {
  const out: { monthOffset: number; demand: number }[] = [];
  for (let m = 0; m <= months; m++) {
    const factor = 1 + combinedAnnualGrowth * (m / 12);
    out.push({ monthOffset: m, demand: round(baseline * factor, 1) });
  }
  return out;
}
