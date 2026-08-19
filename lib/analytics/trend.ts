/**
 * ── WHEN AN ANNUALIZED TREND MAY BE SHOWN ───────────────────────────────────
 *
 * A pilot customer uploaded three days of usage and the executive brief told
 * them "Daily peak demand is trending down 24333.3% per year."
 *
 * The arithmetic was not wrong. Two observations three days apart really do
 * imply that slope, and extrapolating it over a year really does produce five
 * digits. The mistake was answering the question at all: three days does not
 * carry a year's worth of information, and no amount of precision in the
 * regression changes that.
 *
 * So this module decides one thing — whether there is enough observed history
 * for an annualized figure to mean anything — and every surface that shows a
 * trend asks it. The trend computation itself is untouched: where a feature has
 * real history, the number it produces today is the number it produced before.
 *
 * Thirty calendar days is the threshold. It is the shortest window that spans a
 * full monthly cycle of engineering work — sprint boundaries, month-end
 * crunches, a full payroll period of licence checkouts — so a slope measured
 * across it reflects a repeating rhythm rather than one unusual week. Below
 * that, the honest answer is that we do not know yet.
 */

export const MINIMUM_TREND_HISTORY_DAYS = 30;

/** What every surface shows in place of a trend it cannot support. */
export const INSUFFICIENT_TREND_LABEL = 'Not enough history to calculate trend';

/** The short form, for tables and inline figures where a sentence will not fit. */
export const INSUFFICIENT_TREND_SHORT = '—';

/** The subset of metrics this guard needs. Deliberately structural. */
export interface TrendEvidence {
  observedDays: number;
  trendPctPerYear: number;
}

/**
 * Whether an annualized trend derived from this history may be shown.
 *
 * Null metrics, absent history and non-finite day counts all answer "no" — a
 * missing observation window is not a short one, but neither supports a figure.
 */
export function hasEnoughTrendHistory(metrics: TrendEvidence | null | undefined): boolean {
  if (metrics === null || metrics === undefined) return false;
  if (!Number.isFinite(metrics.observedDays)) return false;
  return metrics.observedDays >= MINIMUM_TREND_HISTORY_DAYS;
}

/**
 * The annualized trend, or null when the history behind it is too short.
 *
 * This is the single place a caller should obtain a trend for display. Reading
 * `metrics.trendPctPerYear` directly is what produced the 24,333% figure.
 */
export function annualizedTrend(metrics: TrendEvidence | null | undefined): number | null {
  if (!hasEnoughTrendHistory(metrics)) return null;
  const value = (metrics as TrendEvidence).trendPctPerYear;
  return Number.isFinite(value) ? value : null;
}

/**
 * The trend to use as a growth input in a projection.
 *
 * Zero, not the raw slope, when history is too short: a projection has to
 * multiply by something, and "no observed growth" is the neutral assumption.
 * Feeding an unsupported slope into a forecast produces a confident number
 * built on three days of evidence, which is the same failure wearing different
 * clothes.
 */
export function trendForProjection(metrics: TrendEvidence | null | undefined): number {
  return annualizedTrend(metrics) ?? 0;
}
