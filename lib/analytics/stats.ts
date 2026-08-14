/**
 * Statistical primitives for EngiSignal.
 *
 * Every function here is pure and deterministic. These are the lowest layer of
 * the analytics engine — if a number reaches a customer, it passed through here.
 */

/**
 * Ceiling that is immune to binary floating-point drift.
 *
 * `300 * 1.0 * 1.1` evaluates to 330.00000000000006 in IEEE-754, which a naive
 * Math.ceil turns into 331 — a full extra license, recommended because of a
 * rounding artifact. Rounding to 9 decimals first removes the artifact while
 * preserving any genuine fractional remainder.
 */
export function ceilPrecise(value: number, decimals = 9): number {
  if (!Number.isFinite(value)) return 0;
  return Math.ceil(Number(value.toFixed(decimals)));
}

/** Round to a fixed number of decimals, returning a number. */
export function round(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function sum(values: readonly number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return sum(values) / values.length;
}

export function max(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let m = -Infinity;
  for (const v of values) if (v > m) m = v;
  return m;
}

export function min(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let m = Infinity;
  for (const v of values) if (v < m) m = v;
  return m;
}

/**
 * Percentile by linear interpolation between closest ranks.
 *
 * Equivalent to Excel PERCENTILE.INC and the NumPy default. Chosen deliberately:
 * a license administrator who re-derives the number in a spreadsheet must get
 * the same answer EngiSignal shows, or the recommendation loses credibility.
 *
 * @param values Unsorted observations. Not mutated.
 * @param p Percentile as a ratio in [0, 1]. 0.95 means P95.
 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const clamped = Math.min(1, Math.max(0, p));
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0] as number;

  const rank = clamped * (sorted.length - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  const lower = sorted[lowerIndex] as number;
  if (lowerIndex === upperIndex) return lower;
  const upper = sorted[upperIndex] as number;
  return lower + (upper - lower) * (rank - lowerIndex);
}

export function median(values: readonly number[]): number {
  return percentile(values, 0.5);
}

/**
 * Sample standard deviation (Bessel-corrected, n − 1).
 * Sample rather than population because observed daily peaks are a sample of
 * demand behaviour, not the complete population of all possible days.
 */
export function stdDev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  let acc = 0;
  for (const v of values) acc += (v - m) ** 2;
  return Math.sqrt(acc / (values.length - 1));
}

/**
 * Coefficient of variation — standard deviation relative to the mean.
 * Dimensionless, so volatility is comparable across features of any size.
 */
export function coefficientOfVariation(values: readonly number[]): number {
  const m = mean(values);
  if (m === 0) return 0;
  return stdDev(values) / m;
}

/** Ordinary-least-squares slope of values against their index position. */
export function linearSlope(values: readonly number[]): number {
  const n = values.length;
  if (n < 2) return 0;

  const meanX = (n - 1) / 2;
  const meanY = mean(values);

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - meanX;
    numerator += dx * ((values[i] as number) - meanY);
    denominator += dx * dx;
  }
  if (denominator === 0) return 0;
  return numerator / denominator;
}

/**
 * Demand trend expressed as percent change per year.
 *
 * Assumes each observation is one day apart, which holds for the daily-peak
 * series the concurrent engine produces. Returns 0 when the mean is 0, since a
 * percentage change against a zero baseline is undefined rather than infinite.
 */
export function trendPercentPerYear(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  if (m === 0) return 0;
  const slopePerDay = linearSlope(values);
  return (slopePerDay * 365) / m * 100;
}

/** Clamp a number into an inclusive range. */
export function clamp(value: number, lower: number, upper: number): number {
  return Math.min(upper, Math.max(lower, value));
}

/** Safe division that returns null rather than Infinity or NaN. */
export function safeDivide(numerator: number, denominator: number): number | null {
  if (denominator === 0 || !Number.isFinite(denominator)) return null;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : null;
}
