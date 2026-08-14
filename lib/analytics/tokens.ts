/**
 * Token / consumption license analytics.
 *
 * Token models price a shared pool that features draw against at different
 * weights. The sizing question is therefore about consumption over time
 * (token-hours) rather than a count of simultaneous holders, so this module
 * deliberately does not reuse the concurrent right-sizing model.
 */

import type { AnalysisWindow, RiskLevel, TokenMetrics, TokenUsageDaily } from '@/lib/domain/types';
import { mean, max as arrayMax, percentile, round, trendPercentPerYear, clamp } from './stats';

export interface TokenInput {
  featureId: string;
  daily: readonly TokenUsageDaily[];
  window: AnalysisWindow;
  /** Entitled token pool size. Null when the pool size is unknown. */
  tokenPool: number | null;
  /** Forecast horizon in days. Defaults to one year. */
  horizonDays?: number;
}

export function computeTokenMetrics(input: TokenInput): TokenMetrics {
  const series = input.daily
    .filter((d) => d.featureId === input.featureId && d.date >= input.window.start && d.date <= input.window.end)
    .sort((a, b) => a.date.localeCompare(b.date));

  const values = series.map((d) => d.tokenHours);
  const observedDays = series.length;

  const meanTokenHours = round(mean(values), 2);
  const peakTokenHours = round(arrayMax(values), 2);
  const p95TokenHours = round(percentile(values, 0.95), 2);
  const trend = round(trendPercentPerYear(values), 2);

  // A token pool is continuously available, so capacity over the observed
  // period is pool size × 24 hours × observed days.
  const availableTokenHours =
    input.tokenPool === null || observedDays === 0 ? null : round(input.tokenPool * 24 * observedDays, 2);

  const consumedTokenHours = values.reduce((acc, v) => acc + v, 0);
  const capacityUtilizationPct =
    availableTokenHours === null || availableTokenHours === 0
      ? null
      : round((consumedTokenHours / availableTokenHours) * 100, 1);

  // Trend is clamped before extrapolation: a noisy short series can produce an
  // implausible annualized slope, and forecasting from it would be misleading.
  const boundedTrend = clamp(trend, -50, 100) / 100;
  const horizonYears = (input.horizonDays ?? 365) / 365;
  const forecastTokenHours = round(p95TokenHours * (1 + boundedTrend * horizonYears), 2);

  return {
    featureId: input.featureId,
    window: input.window,
    meanTokenHours,
    peakTokenHours,
    p95TokenHours,
    availableTokenHours,
    capacityUtilizationPct,
    trendPctPerYear: trend,
    forecastTokenHours,
    risk: tokenRisk(capacityUtilizationPct, trend),
  };
}

export function tokenRisk(capacityUtilizationPct: number | null, trendPctPerYear: number): RiskLevel {
  if (capacityUtilizationPct === null) return 'Low';
  if (capacityUtilizationPct >= 95) return 'Critical';
  if (capacityUtilizationPct >= 85) return 'High';
  if (capacityUtilizationPct >= 70 || (capacityUtilizationPct >= 60 && trendPctPerYear > 15)) return 'Moderate';
  return 'Low';
}

/** Peak simultaneous token draw, the input to a pool-size conversation. */
export function peakTokenDraw(daily: readonly TokenUsageDaily[], featureId: string): number {
  let peak = 0;
  for (const d of daily) {
    if (d.featureId !== featureId) continue;
    if (d.peakTokens > peak) peak = d.peakTokens;
  }
  return peak;
}

/** Monthly consumption series, for the token trend chart. */
export function monthlyTokenSeries(
  daily: readonly TokenUsageDaily[],
  featureId: string,
  window: AnalysisWindow,
): { month: string; tokenHours: number }[] {
  const buckets = new Map<string, number>();
  for (const d of daily) {
    if (d.featureId !== featureId) continue;
    if (d.date < window.start || d.date > window.end) continue;
    const month = d.date.slice(0, 7);
    buckets.set(month, (buckets.get(month) ?? 0) + d.tokenHours);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, tokenHours]) => ({ month, tokenHours: round(tokenHours, 1) }));
}
