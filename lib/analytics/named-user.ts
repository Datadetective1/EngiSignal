/**
 * Named-user license intelligence.
 *
 * Named-user waste has a different shape to concurrent waste: the question is
 * not "how much capacity do we need at peak" but "which specific assigned seats
 * are no longer earning their cost". That makes it person-level, and therefore
 * workflow — hence reclaim campaigns rather than just a number.
 */

import type {
  NamedUserMetrics,
  PeriodKey,
  ReclaimCandidate,
  RightSizingResult,
  UserFeatureActivity,
} from '@/lib/domain/types';
import { diffDays } from './dates';
import { ceilPrecise, round } from './stats';

/** Days without recorded activity before a seat becomes a reclaim candidate. */
export const DEFAULT_RECLAIM_THRESHOLD_DAYS = 90;

export interface NamedUserInput {
  featureId: string;
  /** Activity rows for this feature. Filtered internally. */
  activities: readonly UserFeatureActivity[];
  /** Analysis reference date — injected, never read from the clock. */
  asOf: string;
  /** Annual price per seat. Null when unpriced. */
  unitPrice: number | null;
  /** Inactivity threshold in days. Configurable per organization. */
  reclaimThresholdDays?: number;
  /** Entitled seat count from the contract, when it differs from assignments. */
  entitled?: number;
}

/** Days since a seat was last used. Null when never used. */
export function daysInactive(lastUsedDate: string | null, asOf: string): number | null {
  if (lastUsedDate === null) return null;
  return Math.max(0, diffDays(lastUsedDate, asOf));
}

/**
 * Whether a seat qualifies for reclaim.
 *
 * A seat that has NEVER been used is a candidate regardless of threshold — the
 * absence of any activity since assignment is stronger evidence than a lapse.
 */
export function isReclaimCandidate(
  activity: UserFeatureActivity,
  asOf: string,
  thresholdDays: number,
): boolean {
  if (!activity.assigned) return false;
  if (activity.lastUsedDate === null) return true;
  const inactive = daysInactive(activity.lastUsedDate, asOf);
  return inactive !== null && inactive >= thresholdDays;
}

export function computeNamedUserMetrics(input: NamedUserInput): NamedUserMetrics {
  const thresholdDays = input.reclaimThresholdDays ?? DEFAULT_RECLAIM_THRESHOLD_DAYS;
  const rows = input.activities.filter((a) => a.featureId === input.featureId && a.assigned);

  const assigned = input.entitled ?? rows.length;
  let neverUsed = 0;
  let active30 = 0;
  let active60 = 0;
  let active90 = 0;
  let active180 = 0;
  let reclaimCandidates = 0;

  for (const row of rows) {
    if (row.lastUsedDate === null) {
      neverUsed += 1;
    } else {
      const inactive = daysInactive(row.lastUsedDate, input.asOf) ?? Number.MAX_SAFE_INTEGER;
      if (inactive <= 30) active30 += 1;
      if (inactive <= 60) active60 += 1;
      if (inactive <= 90) active90 += 1;
      if (inactive <= 180) active180 += 1;
    }
    if (isReclaimCandidate(row, input.asOf, thresholdDays)) reclaimCandidates += 1;
  }

  // "Active" is defined against the same threshold used for reclaim, so the two
  // numbers always reconcile: active + inactive = assigned.
  const activeUsers = rows.length - reclaimCandidates;
  const inactiveUsers = reclaimCandidates;

  return {
    featureId: input.featureId,
    assigned,
    activeUsers,
    inactiveUsers,
    neverUsed,
    active30,
    active60,
    active90,
    active180,
    reclaimThresholdDays: thresholdDays,
    reclaimCandidates,
    reclaimValue: input.unitPrice === null ? null : round(reclaimCandidates * input.unitPrice, 2),
    utilizationPct: assigned > 0 ? round((activeUsers / assigned) * 100, 1) : 0,
    observedUsers: rows.length,
    seatsWithoutObservedUser: Math.max(0, assigned - rows.length),
  };
}

export interface ReclaimCandidateContext {
  organizationId: string;
  featureId: string;
  featureName: string;
  productName: string;
  vendorName: string;
  unitPrice: number | null;
  asOf: string;
  reclaimThresholdDays?: number;
  employees: ReadonlyMap<
    string,
    { fullName: string; managerName: string | null; department: string | null; program: string | null }
  >;
}

/** Turn named-user analysis into an assignable, reviewable work queue. */
export function buildReclaimCandidates(
  activities: readonly UserFeatureActivity[],
  context: ReclaimCandidateContext,
): ReclaimCandidate[] {
  const thresholdDays = context.reclaimThresholdDays ?? DEFAULT_RECLAIM_THRESHOLD_DAYS;
  const out: ReclaimCandidate[] = [];

  for (const activity of activities) {
    if (activity.featureId !== context.featureId) continue;
    if (!isReclaimCandidate(activity, context.asOf, thresholdDays)) continue;

    const employee = context.employees.get(activity.employeeId);
    const inactive = daysInactive(activity.lastUsedDate, context.asOf);

    out.push({
      id: `${context.featureId}:${activity.employeeId}`,
      organizationId: context.organizationId,
      featureId: context.featureId,
      featureName: context.featureName,
      productName: context.productName,
      vendorName: context.vendorName,
      employeeId: activity.employeeId,
      employeeName: employee?.fullName ?? activity.employeeId,
      managerName: employee?.managerName ?? null,
      department: employee?.department ?? null,
      program: employee?.program ?? null,
      lastUsedDate: activity.lastUsedDate,
      daysInactive: inactive,
      annualCost: context.unitPrice,
      recommendation:
        activity.lastUsedDate === null
          ? 'Never used since assignment — reclaim or reassign'
          : `No activity for ${inactive} days — confirm with manager, then reclaim`,
      owner: employee?.managerName ?? null,
      notes: null,
      status: 'pending_review',
    });
  }

  out.sort((a, b) => (b.daysInactive ?? Number.MAX_SAFE_INTEGER) - (a.daysInactive ?? Number.MAX_SAFE_INTEGER));
  return out;
}

/** Total annual value of a set of reclaim candidates. */
export function reclaimValue(candidates: readonly ReclaimCandidate[]): number {
  return round(
    candidates.reduce((acc, c) => acc + (c.annualCost ?? 0), 0),
    2,
  );
}

/**
 * Right-sizing for named-user features.
 *
 * Named-user seats are not sized from a concurrent peak: every assigned seat is
 * consumed whether or not it is used, so the basis is people rather than
 * simultaneous demand.
 *
 * ── WHY THE BASIS IS NOT SIMPLY "ACTIVE USERS" ──────────────────────────────
 *
 * It was, and it produced a recommendation to cut a 250-seat MATLAB entitlement
 * to 6 because a 20-day export happened to name five people. That is the same
 * error as sizing a concurrent feature with no usage to zero, wearing a
 * different hat: it treats the absence of a person from one export as proof
 * that their seat is unnecessary.
 *
 * It also contradicted this module's own reclaim rule. `reclaimCandidates`
 * counts only holders EngiSignal watched sitting idle, and
 * `seatsWithoutObservedUser` is documented as explicitly not reclaimable —
 * because such a seat may be genuinely idle, or held by someone whose usage the
 * export did not cover, or not assigned to anyone at all. Two answers to the
 * same question, and the more aggressive one carried the dollar figure.
 *
 * So the measured population is sized with headroom, and the unmeasured seats
 * are carried through untouched:
 *
 *     recommended = ceil(activeUsers × growth × safety) + seatsWithoutObservedUser
 *
 * When the export covers everyone, that term is zero and the recommendation is
 * exactly the demand-backed one. When it covers a fraction, the recommendation
 * declines to claim anything about the rest — which is the honest answer, and
 * the reclaim queue still surfaces every holder actually observed idle.
 */
export function computeNamedUserRightSizing(
  metrics: NamedUserMetrics,
  options: { growthFactor?: number; safetyFactor?: number; periodKey?: PeriodKey } = {},
): RightSizingResult {
  const growthFactor = options.growthFactor ?? 1;
  const safetyFactor = options.safetyFactor ?? 1.1;
  const basis = metrics.activeUsers;
  const sizedActive = basis * growthFactor * safetyFactor;
  // Seats whose holder was never observed are carried through, not surrendered.
  const rawRecommended = sizedActive + metrics.seatsWithoutObservedUser;
  const recommended = ceilPrecise(rawRecommended);
  const entitled = metrics.assigned;

  const growthPct = round((growthFactor - 1) * 100, 1);
  const safetyPct = round((safetyFactor - 1) * 100, 1);

  return {
    basis,
    assumptions: {
      // Percentile is not meaningful for a headcount basis; recorded as 1 so
      // the field is never mistaken for a percentile of a demand distribution.
      percentile: 1,
      growthFactor,
      safetyFactor,
      periodKey: options.periodKey ?? '12m',
    },
    rawRecommended: round(rawRecommended, 4),
    recommended,
    entitled,
    quantityDelta: recommended - entitled,
    surplus: Math.max(0, entitled - recommended),
    shortfall: Math.max(0, recommended - entitled),
    methodology:
      `Users active within ${metrics.reclaimThresholdDays} days (${basis}), ` +
      `adjusted for ${growthPct === 0 ? 'no assumed growth' : `${growthPct > 0 ? '+' : ''}${growthPct}% growth`} ` +
      `and a ${safetyPct}% onboarding buffer` +
      (metrics.seatsWithoutObservedUser > 0
        ? `, plus ${metrics.seatsWithoutObservedUser} seats whose holder was not observed in this export and which are therefore not treated as surplus`
        : '') +
      `, rounded up to a whole seat.`,
  };
}

/** Distribution of inactivity, for the named-user histogram. */
export function inactivityDistribution(
  activities: readonly UserFeatureActivity[],
  asOf: string,
): { bucket: string; count: number }[] {
  const buckets = [
    { bucket: '0–30 days', count: 0 },
    { bucket: '31–60 days', count: 0 },
    { bucket: '61–90 days', count: 0 },
    { bucket: '91–180 days', count: 0 },
    { bucket: '180+ days', count: 0 },
    { bucket: 'Never used', count: 0 },
  ];

  for (const activity of activities) {
    if (!activity.assigned) continue;
    if (activity.lastUsedDate === null) {
      const b = buckets[5];
      if (b) b.count += 1;
      continue;
    }
    const inactive = daysInactive(activity.lastUsedDate, asOf) ?? 0;
    const index = inactive <= 30 ? 0 : inactive <= 60 ? 1 : inactive <= 90 ? 2 : inactive <= 180 ? 3 : 4;
    const b = buckets[index];
    if (b) b.count += 1;
  }

  return buckets;
}
