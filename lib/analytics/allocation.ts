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
  | 'actual_usage'
  | 'assigned_licenses'
  | 'token_consumption'
  | 'proportional_usage';

export const ALLOCATION_METHODS: Record<
  AllocationMethod,
  { label: string; methodology: string; appliesTo: LicenseModel[] }
> = {
  actual_usage: {
    label: 'Actual usage',
    methodology:
      'Feature cost is distributed in proportion to license-hours actually consumed by each group. ' +
      'Groups that consumed nothing receive no allocation.',
    appliesTo: ['concurrent', 'subscription', 'hybrid', 'custom'],
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
}

const UNATTRIBUTED = 'Unattributed';

function dimensionValue(employee: Employee | undefined, dimension: DimensionKey): string {
  if (employee === undefined) return UNATTRIBUTED;
  const value = employee[dimension];
  if (value === null || value === undefined || value === '') return UNATTRIBUTED;
  return String(value);
}

/** The per-activity weight used by the selected allocation method. */
function weightFor(method: AllocationMethod, activity: UserFeatureActivity): number {
  switch (method) {
    case 'actual_usage':
    case 'token_consumption':
      return activity.totalHours;
    case 'assigned_licenses':
      return activity.assigned ? 1 : 0;
    case 'proportional_usage':
      return activity.totalSessions;
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
    };
    rows.set(key, created);
    return created;
  };

  let totalAllocated = 0;
  let unallocated = 0;
  let unpricedCount = 0;
  let unattributableCount = 0;

  for (const feature of input.features) {
    const activities = activitiesByFeature.get(feature.featureId) ?? [];

    // Accumulate descriptive stats regardless of whether cost can be allocated,
    // so the table still reports usage for unpriced features.
    for (const activity of activities) {
      const key = dimensionValue(employeeById.get(activity.employeeId), input.dimension);
      const row = ensureRow(key);
      row.usageHours += activity.totalHours;
      row.sessions += activity.totalSessions;
      if (activity.assigned) row.assignedLicenses += 1;
      if (activity.totalSessions > 0) row.activeUsers += 1;
    }

    if (feature.annualCost === null) {
      unpricedCount += 1;
      continue;
    }

    const weights = new Map<string, number>();
    let totalWeight = 0;
    for (const activity of activities) {
      const weight = weightFor(input.method, activity);
      if (weight <= 0) continue;
      const key = dimensionValue(employeeById.get(activity.employeeId), input.dimension);
      weights.set(key, (weights.get(key) ?? 0) + weight);
      totalWeight += weight;
    }

    if (totalWeight <= 0) {
      // No attributable activity under this method. Report, do not redistribute.
      unallocated += feature.annualCost;
      unattributableCount += 1;
      continue;
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

  return {
    method: input.method,
    methodLabel: spec.label,
    methodology: spec.methodology,
    dimension: input.dimension,
    rows: out,
    totalAllocated: round(totalAllocated, 2),
    unallocated: round(unallocated, 2),
    unallocatedReason: reasons.length > 0 ? reasons.join('; ') : null,
  };
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
