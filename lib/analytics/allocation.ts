/**
 * Engineering cost allocation.
 *
 * NON-NEGOTIABLE RULE: one methodology per computation, always labeled.
 *
 * Silently mixing allocation bases — usage hours for one product, assigned
 * seats for another — is the classic chargeback failure mode. The resulting
 * total looks authoritative and cannot be defended when a department head
 * challenges it. Every result therefore carries the method that produced it,
 * and features that cannot be allocated under the chosen method are reported
 * as explicitly unallocated rather than quietly redistributed.
 */

import type { DimensionKey, Employee, LicenseModel, UserFeatureActivity } from '@/lib/domain/types';
import { round } from './stats';

export type AllocationMethod =
  | 'duration_weighted'
  | 'distinct_observed_users'
  | 'assigned_licenses'
  | 'token_consumption'
  | 'proportional_usage';

export const ALLOCATION_METHODS: Record<
  AllocationMethod,
  { label: string; methodology: string; appliesTo: LicenseModel[] }
> = {
  duration_weighted: {
    label: 'Licence hours',
    methodology:
      'Feature cost is distributed in proportion to license-hours actually consumed by each group. ' +
      'Groups that consumed nothing receive no allocation.',
    appliesTo: ['concurrent', 'subscription', 'hybrid', 'custom'],
  },
  /**
   * The method for exports that identify WHO but not FOR HOW LONG.
   *
   * A concurrency-counter export names the user holding each licence at each
   * observation and records no duration at all. Every other method here needs
   * that second fact, so on such an estate they all weigh nothing and the whole
   * allocation returns zero — which is honest and useless: a customer with
   * $2.8M of spend and four departments sees four zeroes and an explanation.
   *
   * Counting distinct users is the strongest statement the evidence supports.
   * It says "this many different people in this group were seen using it", and
   * it deliberately does NOT claim anything about how much time each spent —
   * which is why the basis is labelled on every figure it produces. A group of
   * ten occasional users and a group of ten constant users allocate equally
   * here, and that is a real limitation, not a rounding artefact.
   */
  distinct_observed_users: {
    label: 'Distinct observed users',
    methodology:
      'Feature cost is distributed by how many different people in each group were observed using it. ' +
      'Used when the export identifies users but records no session duration. It measures breadth of ' +
      'use, not time consumed: two groups with the same number of users allocate equally regardless ' +
      'of how much either actually ran the software.',
    appliesTo: ['concurrent', 'named_user', 'subscription', 'hybrid', 'custom'],
  },
  assigned_licenses: {
    label: 'Assigned licenses',
    methodology:
      'Feature cost is distributed in proportion to the number of named-user licenses assigned to each group, ' +
      'regardless of whether those licenses were used.',
    appliesTo: ['named_user', 'subscription'],
  },
  token_consumption: {
    label: 'Token consumption',
    methodology: 'Feature cost is distributed in proportion to token-hours drawn by each group.',
    appliesTo: ['token'],
  },
  proportional_usage: {
    label: 'Proportional sessions',
    methodology:
      'Feature cost is distributed in proportion to session counts. Useful where session duration is not recorded.',
    appliesTo: ['concurrent', 'named_user', 'subscription', 'hybrid', 'custom'],
  },
};

export interface AllocationFeature {
  featureId: string;
  licenseModel: LicenseModel;
  annualCost: number | null;
  /** Capacity above observed demand, valued at cost — the waste attributable. */
  wasteAmount: number;
}

export interface AllocationInput {
  method: AllocationMethod;
  dimension: DimensionKey;
  features: readonly AllocationFeature[];
  activities: readonly UserFeatureActivity[];
  employees: readonly Employee[];
}

export interface AllocationRow {
  key: string;
  allocatedSpend: number;
  sharePct: number;
  usageHours: number;
  sessions: number;
  assignedLicenses: number;
  activeUsers: number;
  headcount: number;
  potentialWaste: number;
  costPerEngineer: number | null;
  /** Distinct people in this group observed using the software at all. */
  observedUsers: number;
}

export interface AllocationResult {
  method: AllocationMethod;
  methodLabel: string;
  methodology: string;
  dimension: DimensionKey;
  rows: AllocationRow[];
  totalAllocated: number;
  /** Spend that could not be attributed under this method. Never redistributed. */
  unallocated: number;
  unallocatedReason: string | null;
  /** Cost of priced features — what the allocation is dividing up. */
  allocatableCost: number;
  /** The portion of `unallocated` caused specifically by unplaceable identities. */
  unresolvedIdentityCost: number;
  /** Distinct usernames whose activity could not be placed in any group. */
  unresolvedIdentityCount: number;
  /**
   * True when rows + unallocated equals allocatable cost to within rounding.
   *
   * Asserted rather than assumed. An allocation that quietly loses spend looks
   * exactly like one that allocated it, and the person who finds out is a
   * department head reconciling against their own ledger.
   */
  reconciles: boolean;
  /** Short label for the evidence this allocation rests on. */
  basisLabel: string;
  /** Why this method was used, in the customer's terms. */
  selectionReason: string;
  /** False when the evidence supports no method at all. */
  available: boolean;
}

/**
 * A group the customer would recognise, or nothing.
 *
 * Returns null in two different situations that must NOT become a row:
 *
 *   - the activity belongs to a username that never resolved to a person, or
 *     resolved ambiguously, so no group can be claimed for it;
 *   - the person resolved but their record carries no value for this dimension.
 *
 * Both previously produced an "Unattributed" row, which sits in a table of
 * departments looking like a department and invites someone to ask who runs it.
 * Their spend now goes to the explicit unallocated total instead, with a reason.
 */
function dimensionValue(employee: Employee | undefined, dimension: DimensionKey): string | null {
  if (employee === undefined) return null;
  const value = employee[dimension];
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

/**
 * The per-activity weight used by the selected allocation method.
 *
 * One activity row is one (feature, person) pair, so a weight of 1 under
 * `distinct_observed_users` counts that person exactly once for that feature —
 * which is the grain the spec calls for without any extra de-duplication.
 */
function weightFor(method: AllocationMethod, activity: UserFeatureActivity): number {
  switch (method) {
    case 'duration_weighted':
    case 'token_consumption':
      return activity.totalHours;
    case 'assigned_licenses':
      return activity.assigned ? 1 : 0;
    case 'proportional_usage':
      return activity.totalSessions;
    case 'distinct_observed_users':
      // Observed at all, by any measure the export happened to carry.
      return activity.totalSessions > 0 ||
        activity.totalHours > 0 ||
        activity.lastUsedDate !== null
        ? 1
        : 0;
  }
}

export function allocateCost(input: AllocationInput): AllocationResult {
  const spec = ALLOCATION_METHODS[input.method];
  const employeeById = new Map(input.employees.map((e) => [e.id, e]));

  // Headcount per dimension value, independent of software activity.
  const headcount = new Map<string, number>();
  for (const employee of input.employees) {
    if (employee.status !== 'active') continue;
    const key = dimensionValue(employee, input.dimension);
    if (key === null) continue;
    headcount.set(key, (headcount.get(key) ?? 0) + 1);
  }

  const activitiesByFeature = new Map<string, UserFeatureActivity[]>();
  for (const activity of input.activities) {
    const bucket = activitiesByFeature.get(activity.featureId);
    if (bucket === undefined) activitiesByFeature.set(activity.featureId, [activity]);
    else bucket.push(activity);
  }

  const rows = new Map<string, AllocationRow>();
  const ensureRow = (key: string): AllocationRow => {
    const existing = rows.get(key);
    if (existing !== undefined) return existing;
    const created: AllocationRow = {
      key,
      allocatedSpend: 0,
      sharePct: 0,
      usageHours: 0,
      sessions: 0,
      assignedLicenses: 0,
      activeUsers: 0,
      headcount: headcount.get(key) ?? 0,
      potentialWaste: 0,
      costPerEngineer: null,
      observedUsers: 0,
    };
    rows.set(key, created);
    return created;
  };

  let totalAllocated = 0;
  let unallocated = 0;
  let unpricedCount = 0;
  let unattributableCount = 0;
  /** Cost of priced features — the denominator the allocation must reconcile to. */
  let allocatableCost = 0;
  /** Portion of that lost specifically to identities that could not be placed. */
  let unresolvedCost = 0;
  const unattributableUsers = new Set<string>();

  for (const feature of input.features) {
    const activities = activitiesByFeature.get(feature.featureId) ?? [];

    // Accumulate descriptive stats regardless of whether cost can be allocated,
    // so the table still reports usage for unpriced features.
    for (const activity of activities) {
      const key = dimensionValue(employeeById.get(activity.employeeId), input.dimension);
      if (key === null) {
        unattributableUsers.add(activity.employeeId);
        continue;
      }
      const row = ensureRow(key);
      row.usageHours += activity.totalHours;
      row.sessions += activity.totalSessions;
      if (activity.assigned) row.assignedLicenses += 1;
      if (activity.totalSessions > 0) row.activeUsers += 1;
      row.observedUsers += weightFor('distinct_observed_users', activity) > 0 ? 1 : 0;
    }

    if (feature.annualCost === null) {
      unpricedCount += 1;
      continue;
    }

    allocatableCost += feature.annualCost;

    // Weight is accumulated for named groups AND, separately, for activity that
    // cannot be attributed to one. The unattributable share is a real share of
    // a real cost: it must leave the allocation without being redistributed
    // across the groups that happen to be identifiable, which would inflate
    // every one of them by the size of the gap.
    const weights = new Map<string, number>();
    let namedWeight = 0;
    let unattributableWeight = 0;

    for (const activity of activities) {
      const weight = weightFor(input.method, activity);
      if (weight <= 0) continue;
      const key = dimensionValue(employeeById.get(activity.employeeId), input.dimension);
      if (key === null) {
        unattributableWeight += weight;
        continue;
      }
      weights.set(key, (weights.get(key) ?? 0) + weight);
      namedWeight += weight;
    }

    const totalWeight = namedWeight + unattributableWeight;

    if (totalWeight <= 0) {
      // No attributable activity under this method. Report, do not redistribute.
      unallocated += feature.annualCost;
      unattributableCount += 1;
      continue;
    }

    if (unattributableWeight > 0) {
      const share = unattributableWeight / totalWeight;
      unallocated += feature.annualCost * share;
      unresolvedCost += feature.annualCost * share;
    }

    for (const [key, weight] of weights) {
      const share = weight / totalWeight;
      const row = ensureRow(key);
      row.allocatedSpend += feature.annualCost * share;
      row.potentialWaste += feature.wasteAmount * share;
      totalAllocated += feature.annualCost * share;
    }
  }

  const out = [...rows.values()].map((row) => ({
    ...row,
    allocatedSpend: round(row.allocatedSpend, 2),
    potentialWaste: round(row.potentialWaste, 2),
    usageHours: round(row.usageHours, 1),
    sharePct: totalAllocated > 0 ? round((row.allocatedSpend / totalAllocated) * 100, 1) : 0,
    costPerEngineer: row.headcount > 0 ? round(row.allocatedSpend / row.headcount, 2) : null,
  }));

  out.sort((a, b) => b.allocatedSpend - a.allocatedSpend);

  const reasons: string[] = [];
  if (unpricedCount > 0) reasons.push(`${unpricedCount} feature(s) have no unit price`);
  if (unattributableCount > 0) {
    reasons.push(`${unattributableCount} feature(s) have no attributable activity under the ${spec.label.toLowerCase()} method`);
  }

  if (unattributableUsers.size > 0) {
    reasons.push(
      `${unattributableUsers.size} username(s) could not be placed in a ${DIMENSION_LABELS[input.dimension].toLowerCase()}`,
    );
  }

  const roundedAllocated = round(totalAllocated, 2);
  const roundedUnallocated = round(unallocated, 2);
  const roundedAllocatable = round(allocatableCost, 2);

  return {
    method: input.method,
    methodLabel: spec.label,
    methodology: spec.methodology,
    dimension: input.dimension,
    rows: out,
    totalAllocated: roundedAllocated,
    unallocated: roundedUnallocated,
    unallocatedReason: reasons.length > 0 ? reasons.join('; ') : null,
    allocatableCost: roundedAllocatable,
    unresolvedIdentityCost: round(unresolvedCost, 2),
    unresolvedIdentityCount: unattributableUsers.size,
    // A cent per row absorbs float accumulation; anything larger is a leak.
    reconciles:
      Math.abs(roundedAllocated + roundedUnallocated - roundedAllocatable) <=
      Math.max(0.01, out.length * 0.01),
    basisLabel: spec.label,
    selectionReason: `Chosen explicitly: ${spec.label.toLowerCase()}.`,
    available: roundedAllocatable > 0,
  };
}

/**
 * What each allocation method needs, and what this estate actually has.
 *
 * Returned rather than acted on silently, so the interface can say WHY it is
 * allocating the way it is. A customer looking at "distinct observed users"
 * should learn in one glance that it is because their export carried no session
 * duration — not because somebody chose it for them.
 */
export interface AllocationEvidence {
  hasDurationHours: boolean;
  hasSessionCounts: boolean;
  hasObservedUsers: boolean;
  hasAssignments: boolean;
  hasPricedFeatures: boolean;
}

export function assessAllocationEvidence(
  features: readonly AllocationFeature[],
  activities: readonly UserFeatureActivity[],
): AllocationEvidence {
  return {
    hasDurationHours: activities.some((activity) => activity.totalHours > 0),
    hasSessionCounts: activities.some((activity) => activity.totalSessions > 0),
    hasObservedUsers: activities.some(
      (activity) => weightFor('distinct_observed_users', activity) > 0,
    ),
    hasAssignments: activities.some((activity) => activity.assigned),
    hasPricedFeatures: features.some((feature) => feature.annualCost !== null),
  };
}

export interface MethodSelection {
  method: AllocationMethod | null;
  reason: string;
}

/**
 * The strongest method the supplied evidence supports.
 *
 * Ordered by how much each method actually claims. Duration says how long the
 * software ran; distinct users says only how many people touched it. Choosing
 * the weaker claim when the stronger is available understates what EngiSignal
 * knows; choosing the stronger when it is unsupported fabricates it — and
 * returning a column of zeroes for a duration-free export, which is what
 * happened before, does neither: it just withholds an answer the data supports.
 */
export function selectAllocationMethod(evidence: AllocationEvidence): MethodSelection {
  if (!evidence.hasPricedFeatures) {
    return { method: null, reason: 'No feature carries a price, so there is no cost to allocate.' };
  }
  if (evidence.hasDurationHours) {
    return {
      method: 'duration_weighted',
      reason: 'Your usage export records session duration, so cost is allocated by licence hours.',
    };
  }
  if (evidence.hasObservedUsers) {
    return {
      method: 'distinct_observed_users',
      reason:
        'Your usage export identifies who used each feature but records no session duration, so cost is allocated by how many different people in each group were observed using it.',
    };
  }
  if (evidence.hasAssignments) {
    return {
      method: 'assigned_licenses',
      reason:
        'No usage activity was observed, so cost is allocated by how many named-user seats each group holds.',
    };
  }
  return {
    method: null,
    reason:
      'Cannot allocate from supplied evidence: the imported data records no session duration, no observed users and no seat assignments.',
  };
}

/** Allocate using the strongest supported method, reporting which and why. */
export function allocateCostAutomatically(input: Omit<AllocationInput, 'method'>): AllocationResult {
  const evidence = assessAllocationEvidence(input.features, input.activities);
  const selection = selectAllocationMethod(evidence);

  if (selection.method === null) {
    return {
      method: 'distinct_observed_users',
      methodLabel: 'Unavailable',
      methodology: 'No allocation method is supported by the evidence supplied.',
      dimension: input.dimension,
      rows: [],
      totalAllocated: 0,
      unallocated: 0,
      unallocatedReason: null,
      allocatableCost: 0,
      unresolvedIdentityCost: 0,
      unresolvedIdentityCount: 0,
      reconciles: true,
      // Never "$0". The cost exists; the means of dividing it does not.
      basisLabel: 'Cannot allocate from supplied evidence',
      selectionReason: selection.reason,
      available: false,
    };
  }

  return { ...allocateCost({ ...input, method: selection.method }), selectionReason: selection.reason };
}

export const DIMENSION_LABELS: Record<DimensionKey, string> = {
  organization: 'Organization',
  region: 'Region',
  businessUnit: 'Business Unit',
  program: 'Program',
  department: 'Department',
  discipline: 'Discipline',
  competency: 'Competency',
  location: 'Location',
  managerName: 'Manager',
  employeeType: 'Employee Type',
};

/** The drill-through path through the organization. */
export const DRILL_PATH: DimensionKey[] = ['businessUnit', 'program', 'department', 'discipline'];
