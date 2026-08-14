/**
 * Synthetic usage generation.
 *
 * The generator uses rank mapping rather than naive sampling: it constructs the
 * exact sorted distribution of daily peaks it wants, then assigns those values
 * to specific dates in order of a "demand propensity" score built from weekday
 * pattern, holidays, trend and noise.
 *
 * Two properties fall out of this that plain sampling cannot give:
 *   1. The P95 of daily peaks is EXACT, not approximate. The demo therefore
 *      states specific financial figures that reproduce precisely.
 *   2. The time series still looks real — weekends dip, holidays dip harder,
 *      and a trending product visibly trends.
 */

import type { DenialEvent, HourlyUsage, TokenUsageDaily } from '@/lib/domain/types';
import { isWeekend } from '@/lib/analytics/dates';
import type { Rng } from './prng';

/** Days in the demo window that behave like company holidays. */
export function isHoliday(iso: string): boolean {
  const monthDay = iso.slice(5);
  return (
    monthDay === '01-01' ||
    monthDay === '07-04' ||
    monthDay === '12-24' ||
    monthDay === '12-25' ||
    monthDay === '12-26' ||
    monthDay === '12-31' ||
    monthDay === '11-27' || // Thanksgiving-like
    monthDay === '11-28' ||
    monthDay === '05-26' // late-May holiday
  );
}

/**
 * Build the exact sorted multiset of daily peaks for a window.
 *
 * The values at the two ranks straddling the 95th percentile are both set to
 * the target, which makes the interpolated P95 exactly the target.
 */
export function buildSortedPeaks(
  n: number,
  target: number,
  maxPeak: number,
  minPeak: number,
  lowBandCount: number,
): number[] {
  const series = new Array<number>(n).fill(minPeak);
  const rank = 0.95 * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);

  const lowTop = Math.max(minPeak, Math.round(target * 0.35));
  const weekdayBottom = Math.max(lowTop, Math.round(target * 0.45));
  const weekdayTop = Math.max(weekdayBottom, target - 1);
  const lowCount = Math.max(1, Math.min(lowBandCount, lo));

  // Low band — weekends and holidays.
  for (let i = 0; i < lowCount; i++) {
    const t = lowCount === 1 ? 1 : i / (lowCount - 1);
    series[i] = Math.round(minPeak + (lowTop - minPeak) * t);
  }

  // Working-day band, curved so most days sit nearer the middle of the range.
  for (let i = lowCount; i < lo; i++) {
    const t = lo === lowCount ? 1 : (i - lowCount) / (lo - lowCount);
    series[i] = Math.round(weekdayBottom + (weekdayTop - weekdayBottom) * Math.pow(t, 0.85));
  }

  // The P95 anchor.
  series[lo] = target;
  if (hi !== lo) series[hi] = target;

  // Upper tail up to the observed maximum.
  const tailStart = hi + 1;
  for (let i = tailStart; i < n; i++) {
    const t = n - 1 === tailStart ? 1 : (i - tailStart) / Math.max(1, n - 1 - tailStart);
    series[i] = Math.round(target + (maxPeak - target) * Math.pow(t, 0.9));
  }

  return series;
}

export interface DailyPeakOptions {
  rng: Rng;
  dates: string[];
  targetP95: number;
  maxPeak: number;
  minPeak: number;
  /** Approximate percent change per year. */
  trend: number;
}

/**
 * Assign the constructed distribution onto real dates by propensity ranking.
 */
export function generateDailyPeaks(options: DailyPeakOptions): Map<string, number> {
  const { rng, dates, targetP95, maxPeak, minPeak, trend } = options;
  const n = dates.length;
  if (n === 0) return new Map();

  const lowBandCount = dates.filter((d) => isWeekend(d) || isHoliday(d)).length;
  const sorted = buildSortedPeaks(n, targetP95, maxPeak, minPeak, lowBandCount);

  // Trend strength is scaled so that a stated trend of ~22%/yr produces a
  // clearly visible slope without overwhelming the weekday structure.
  const trendStrength = trend / 22;

  const scored = dates.map((date, index) => {
    const progress = n === 1 ? 0 : index / (n - 1);
    let score = progress * trendStrength;

    if (isHoliday(date)) score -= 6;
    else if (isWeekend(date)) score -= 4;

    // Mild quarter-end intensity: analysis work clusters before milestones.
    const month = Number(date.slice(5, 7));
    if (month === 3 || month === 6 || month === 9 || month === 12) score += 0.12;

    score += rng.normal(0, 0.22);
    return { index, score };
  });

  scored.sort((a, b) => a.score - b.score);

  const peaks = new Map<string, number>();
  for (let rank = 0; rank < scored.length; rank++) {
    const entry = scored[rank];
    if (entry === undefined) continue;
    const date = dates[entry.index];
    if (date === undefined) continue;
    peaks.set(date, sorted[rank] ?? minPeak);
  }

  return peaks;
}

/**
 * A working-day concurrency profile.
 * Index 10 (10:00) is the daily maximum, so hourly max === the daily peak.
 */
const HOUR_SHAPE = [
  0.1, 0.08, 0.06, 0.05, 0.05, 0.09, 0.19, 0.39, 0.63, 0.86, 1.0, 0.95, 0.76, 0.91, 0.98, 0.89,
  0.71, 0.51, 0.35, 0.26, 0.2, 0.16, 0.13, 0.11,
];

/** Expand a daily peak into 24 hourly observations whose maximum is that peak. */
export function expandToHourly(
  rng: Rng,
  featureId: string,
  date: string,
  peak: number,
): HourlyUsage[] {
  const rows: HourlyUsage[] = [];
  const quiet = isWeekend(date) || isHoliday(date);

  for (let hour = 0; hour < 24; hour++) {
    const shape = HOUR_SHAPE[hour] ?? 0;
    if (hour === 10) {
      rows.push({ featureId, date, hour, concurrent: peak });
      continue;
    }
    const jitter = rng.float(0.92, 1.04);
    const damping = quiet ? 0.85 : 1;
    const value = Math.min(peak, Math.max(0, Math.round(peak * shape * jitter * damping)));
    rows.push({ featureId, date, hour, concurrent: value });
  }

  return rows;
}

/** Total license-hours implied by a daily peak, using the same hour profile. */
export function licenseHoursForPeak(peak: number): number {
  let total = 0;
  for (const shape of HOUR_SHAPE) total += peak * shape;
  return total;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tokens
// ─────────────────────────────────────────────────────────────────────────────

export function generateTokenUsage(
  rng: Rng,
  featureId: string,
  dates: string[],
  pool: number,
  utilization: number,
): TokenUsageDaily[] {
  return dates.map((date, index) => {
    const quiet = isWeekend(date) || isHoliday(date);
    const seasonal = 1 + 0.12 * Math.sin((index / 60) * Math.PI);
    const factor = (quiet ? rng.float(0.15, 0.3) : rng.float(0.86, 1.12)) * seasonal;
    const tokenHours = Math.max(0, Math.round(pool * 24 * utilization * factor));
    return {
      featureId,
      date,
      tokenHours,
      peakTokens: Math.min(pool, Math.round(pool * utilization * factor * 1.35)),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Denials
// ─────────────────────────────────────────────────────────────────────────────

export interface DenialOptions {
  rng: Rng;
  organizationId: string;
  featureId: string;
  /** Dates in the analysis window, most recent last. */
  dates: string[];
  peaks: Map<string, number>;
  entitled: number;
  profile: 'none' | 'genuine' | 'burst' | 'rule';
  /** Employee ids available to attribute denials to. */
  employeeIds: string[];
}

/**
 * Generate denial events matching a named pattern.
 *
 * The three non-empty patterns exist to exercise EngiSignal's denial guards:
 *  - `genuine` should classify as High or Critical
 *  - `burst`   should classify Low despite a large denial count
 *  - `rule`    should classify Low because capacity was not exhausted
 */
export function generateDenials(options: DenialOptions): DenialEvent[] {
  const { rng, organizationId, featureId, dates, peaks, entitled, profile, employeeIds } = options;
  if (profile === 'none' || employeeIds.length === 0) return [];

  const events: DenialEvent[] = [];
  const pushEvent = (date: string, hour: number, count: number, concurrent: number, employeeId: string | null) => {
    events.push({
      id: `den-${featureId}-${date}-${hour}-${events.length}`,
      organizationId,
      featureId,
      date,
      hour,
      employeeId,
      count,
      concurrentAtDenial: concurrent,
      availableAtDenial: Math.max(0, entitled - concurrent),
    });
  };

  if (profile === 'genuine') {
    // Denials on days when demand actually reached entitled capacity.
    const saturated = dates.filter((date) => (peaks.get(date) ?? 0) >= entitled * 0.97);
    for (const date of saturated) {
      if (!rng.chance(0.72)) continue;
      const attempts = rng.int(1, 3);
      for (let i = 0; i < attempts; i++) {
        pushEvent(
          date,
          rng.weighted([
            { value: 9, weight: 2 },
            { value: 10, weight: 5 },
            { value: 11, weight: 4 },
            { value: 13, weight: 3 },
            { value: 14, weight: 5 },
            { value: 15, weight: 3 },
          ]),
          rng.int(1, 4),
          peaks.get(date) ?? entitled,
          rng.pick(employeeIds),
        );
      }
    }
    return events;
  }

  if (profile === 'burst') {
    // One engineer, one afternoon, a retry loop. High count, no real shortage.
    const date = dates[Math.floor(dates.length * 0.62)] ?? (dates[0] as string);
    const employeeId = employeeIds[0] ?? null;
    for (let i = 0; i < 9; i++) {
      pushEvent(date, 14, rng.int(6, 14), entitled, employeeId);
    }
    // A single unrelated denial on another day, so denialDays === 2.
    const otherDate = dates[Math.floor(dates.length * 0.31)] ?? (dates[0] as string);
    pushEvent(otherDate, 11, 1, entitled, rng.pick(employeeIds));
    return events;
  }

  // profile === 'rule': denials while plenty of capacity remained. These are
  // caused by options-file exclusions or borrow limits, not by quantity.
  const candidates = rng.shuffle(dates).slice(0, 26);
  for (const date of candidates) {
    const concurrent = Math.round((peaks.get(date) ?? 0) * rng.float(0.35, 0.55));
    pushEvent(date, rng.int(8, 17), rng.int(1, 3), concurrent, rng.pick(employeeIds));
  }
  return events;
}
