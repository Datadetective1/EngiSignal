/**
 * Denial intelligence.
 *
 * IMPORTANT DESIGN CONSTRAINT
 * ---------------------------
 * Denials are the most abused metric in this category: they are noisy (a single
 * user retrying produces a burst) and they are every vendor's favourite upsell
 * argument. EngiSignal therefore treats denials as CONTEXTUAL RISK, never as an
 * input to a purchase recommendation. `computeRightSizing` does not accept
 * denial data, structurally, and that is intentional.
 *
 * What denials legitimately tell us is where unmet demand occurred, how
 * concentrated it was, and whether capacity was genuinely exhausted at the
 * moment of failure. That is a risk conversation for a human, not arithmetic.
 */

import type { AnalysisWindow, DenialEvent, DenialMetrics, RiskLevel } from '@/lib/domain/types';
import { mean, round } from './stats';

export interface DenialInput {
  featureId: string;
  denials: readonly DenialEvent[];
  window: AnalysisWindow;
  /** Days with observed usage data, used to normalize denial-day frequency. */
  observedDays: number;
  /** Entitled capacity, used to judge whether capacity was genuinely exhausted. */
  entitled: number;
}

export function computeDenialMetrics(input: DenialInput): DenialMetrics {
  const events = input.denials.filter(
    (d) => d.featureId === input.featureId && d.date >= input.window.start && d.date <= input.window.end,
  );

  if (events.length === 0) {
    return {
      featureId: input.featureId,
      totalDenials: 0,
      denialDays: 0,
      distinctUsers: 0,
      concentration: 0,
      peakHour: null,
      firstDenial: null,
      lastDenial: null,
      meanConcurrentAtDenial: null,
      risk: 'Low',
      riskRationale: 'No denials recorded in the analysis period.',
    };
  }

  const byDate = new Map<string, number>();
  const byHour = new Array<number>(24).fill(0);
  const users = new Set<string>();
  const concurrentSamples: number[] = [];
  let totalDenials = 0;

  for (const event of events) {
    totalDenials += event.count;
    byDate.set(event.date, (byDate.get(event.date) ?? 0) + event.count);
    if (event.hour >= 0 && event.hour <= 23) {
      byHour[event.hour] = (byHour[event.hour] ?? 0) + event.count;
    }
    if (event.employeeId !== null) users.add(event.employeeId);
    if (event.concurrentAtDenial !== null) concurrentSamples.push(event.concurrentAtDenial);
  }

  const dates = [...byDate.keys()].sort();
  const worstDayCount = Math.max(...byDate.values());
  const concentration = totalDenials > 0 ? worstDayCount / totalDenials : 0;

  let peakHour: number | null = null;
  let peakHourCount = 0;
  for (let h = 0; h < 24; h++) {
    const count = byHour[h] ?? 0;
    if (count > peakHourCount) {
      peakHourCount = count;
      peakHour = h;
    }
  }

  const denialDays = byDate.size;
  const denialDayRate = input.observedDays > 0 ? denialDays / input.observedDays : 0;
  const meanConcurrentAtDenial = concurrentSamples.length > 0 ? round(mean(concurrentSamples), 1) : null;

  const { risk, rationale } = classifyDenialRisk({
    denialDays,
    denialDayRate,
    concentration,
    distinctUsers: users.size,
    totalDenials,
    meanConcurrentAtDenial,
    entitled: input.entitled,
  });

  return {
    featureId: input.featureId,
    totalDenials,
    denialDays,
    distinctUsers: users.size,
    concentration: round(concentration, 3),
    peakHour,
    firstDenial: dates[0] ?? null,
    lastDenial: dates[dates.length - 1] ?? null,
    meanConcurrentAtDenial,
    risk,
    riskRationale: rationale,
  };
}

interface DenialRiskInput {
  denialDays: number;
  denialDayRate: number;
  concentration: number;
  distinctUsers: number;
  totalDenials: number;
  meanConcurrentAtDenial: number | null;
  entitled: number;
}

/**
 * Classify denial risk with context.
 *
 * Two guards keep this honest:
 *  - High concentration on a single day with few users is downgraded, because
 *    that shape is usually one user's retry loop rather than systemic shortage.
 *  - Denials recorded while capacity was NOT exhausted are downgraded, because
 *    the cause is likely licensing rules (options-file exclusions, borrow
 *    limits, authorization) rather than insufficient quantity. Buying more
 *    licenses would not have prevented them.
 */
export function classifyDenialRisk(input: DenialRiskInput): { risk: RiskLevel; rationale: string } {
  const { denialDays, denialDayRate, concentration, distinctUsers, totalDenials } = input;

  const capacityExhausted =
    input.meanConcurrentAtDenial === null || input.entitled <= 0
      ? null
      : input.meanConcurrentAtDenial >= input.entitled * 0.95;

  if (capacityExhausted === false) {
    return {
      risk: 'Low',
      rationale:
        `${totalDenials} denials recorded, but mean concurrent demand at denial ` +
        `(${input.meanConcurrentAtDenial}) was well below entitled capacity (${input.entitled}). ` +
        'Likely caused by licensing rules rather than insufficient quantity — additional licenses would not resolve these.',
    };
  }

  const isolatedBurst = concentration >= 0.7 && distinctUsers <= 2;
  if (isolatedBurst) {
    return {
      risk: 'Low',
      rationale:
        `${totalDenials} denials, but ${round(concentration * 100, 0)}% fell on a single day across ` +
        `${distinctUsers} user${distinctUsers === 1 ? '' : 's'}. This pattern is characteristic of a retry burst, not systemic shortage.`,
    };
  }

  const spread = `${denialDays} denial day${denialDays === 1 ? '' : 's'} affecting ${distinctUsers} user${distinctUsers === 1 ? '' : 's'}`;

  if (denialDayRate >= 0.15 && distinctUsers >= 5) {
    return {
      risk: 'Critical',
      rationale: `${spread}. Denials occurred on ${round(denialDayRate * 100, 0)}% of observed days — engineering work is being blocked regularly.`,
    };
  }
  if (denialDayRate >= 0.07 || (distinctUsers >= 8 && denialDays >= 5)) {
    return {
      risk: 'High',
      rationale: `${spread}. Denials are recurring rather than incidental and warrant review before renewal.`,
    };
  }
  if (denialDays >= 2) {
    return {
      risk: 'Moderate',
      rationale: `${spread}. Occasional unmet demand — worth monitoring, not yet a capacity failure.`,
    };
  }

  return {
    risk: 'Low',
    rationale: `${spread}. Isolated occurrence.`,
  };
}

/** Denial counts by hour of day, for the time-of-day pattern chart. */
export function denialsByHour(denials: readonly DenialEvent[], featureId: string): number[] {
  const hours = new Array<number>(24).fill(0);
  for (const d of denials) {
    if (d.featureId !== featureId) continue;
    if (d.hour < 0 || d.hour > 23) continue;
    hours[d.hour] = (hours[d.hour] ?? 0) + d.count;
  }
  return hours;
}

/** Denial counts grouped by an arbitrary key, e.g. department or program. */
export function denialsByGroup(
  denials: readonly DenialEvent[],
  featureId: string,
  groupOf: (employeeId: string | null) => string | null,
): { group: string; count: number }[] {
  const groups = new Map<string, number>();
  for (const d of denials) {
    if (d.featureId !== featureId) continue;
    const group = groupOf(d.employeeId) ?? 'Unattributed';
    groups.set(group, (groups.get(group) ?? 0) + d.count);
  }
  return [...groups.entries()]
    .map(([group, count]) => ({ group, count }))
    .sort((a, b) => b.count - a.count);
}
