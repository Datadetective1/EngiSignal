import { describe, expect, it } from 'vitest';
import {
  allocateCost,
  allocateCostAutomatically,
  assessAllocationEvidence,
  selectAllocationMethod,
} from '@/lib/analytics/allocation';
import type { Employee, UserFeatureActivity } from '@/lib/domain/types';

/**
 * ALLOCATION WHEN THE EXPORT SAYS WHO BUT NOT FOR HOW LONG.
 *
 * A concurrency-counter export names the user holding each licence and records
 * no duration. Every duration-weighted method therefore weighs nothing, and the
 * Phase 2B production estate showed $2.8M of spend allocating to four
 * departments of $0 each — honest, and useless.
 *
 * These tests fix the behaviour in both directions: the weaker basis is used
 * only when the stronger is genuinely unavailable, and it is always labelled.
 */

function employee(id: string, department: string | null, overrides: Partial<Employee> = {}): Employee {
  return {
    id,
    organizationId: 'org1',
    employeeCode: id.toUpperCase(),
    username: id,
    fullName: `Person ${id}`,
    email: `${id}@example.com`,
    managerName: 'M. Okafor',
    managerKey: 'mgr-1',
    department,
    organization: 'Aero Division',
    businessUnit: 'Engineering',
    program: 'Halo',
    discipline: 'Mechanical',
    competency: 'Simulation',
    location: 'Bristol',
    region: 'EMEA',
    employeeType: 'employee',
    status: 'active',
    contractorCompany: null,
    ...overrides,
  };
}

function activity(
  employeeId: string,
  featureId: string,
  overrides: Partial<UserFeatureActivity> = {},
): UserFeatureActivity {
  return {
    organizationId: 'org1',
    featureId,
    employeeId,
    assigned: true,
    assignedOn: null,
    lastUsedDate: '2026-06-20',
    totalSessions: 0,
    totalHours: 0,
    sessions30: 0,
    sessions60: 0,
    sessions90: 0,
    sessions180: 0,
    ...overrides,
  };
}

const FEATURE = { featureId: 'f1', licenseModel: 'concurrent' as const, annualCost: 300_000, wasteAmount: 0 };

describe('choosing an allocation method from the evidence', () => {
  it('prefers duration when the export records it', () => {
    const evidence = assessAllocationEvidence(
      [FEATURE],
      [activity('a', 'f1', { totalHours: 12 })],
    );
    const selection = selectAllocationMethod(evidence);

    expect(selection.method).toBe('duration_weighted');
    expect(selection.reason).toContain('records session duration');
  });

  it('falls back to distinct observed users when duration is absent', () => {
    const evidence = assessAllocationEvidence([FEATURE], [activity('a', 'f1')]);
    const selection = selectAllocationMethod(evidence);

    expect(selection.method).toBe('distinct_observed_users');
    expect(selection.reason).toContain('no session duration');
  });

  it('falls back to seat assignments when nothing was observed at all', () => {
    const evidence = assessAllocationEvidence(
      [FEATURE],
      [activity('a', 'f1', { lastUsedDate: null })],
    );
    expect(selectAllocationMethod(evidence).method).toBe('assigned_licenses');
  });

  it('says it cannot allocate rather than returning zero', () => {
    const evidence = assessAllocationEvidence([FEATURE], []);
    const selection = selectAllocationMethod(evidence);

    expect(selection.method).toBeNull();
    expect(selection.reason).toContain('Cannot allocate from supplied evidence');
  });

  it('says there is nothing to allocate when no feature is priced', () => {
    const evidence = assessAllocationEvidence(
      [{ ...FEATURE, annualCost: null }],
      [activity('a', 'f1', { totalHours: 5 })],
    );
    expect(selectAllocationMethod(evidence).method).toBeNull();
  });
});

describe('distinct observed users', () => {
  const employees = [
    employee('a', 'Structures'),
    employee('b', 'Structures'),
    employee('c', 'Fluids'),
    employee('d', 'Controls'),
  ];

  // No duration anywhere — the shape a concurrency-counter export produces.
  const activities = [
    activity('a', 'f1'),
    activity('b', 'f1'),
    activity('c', 'f1'),
    activity('d', 'f1'),
  ];

  it('allocates a non-zero amount to every group that used the software', () => {
    const result = allocateCostAutomatically({
      dimension: 'department',
      features: [FEATURE],
      activities,
      employees,
    });

    expect(result.method).toBe('distinct_observed_users');
    expect(result.basisLabel).toBe('Distinct observed users');

    const byKey = new Map(result.rows.map((row) => [row.key, row.allocatedSpend]));
    // Structures has two of the four observed users, so half the cost.
    expect(byKey.get('Structures')).toBe(150_000);
    expect(byKey.get('Fluids')).toBe(75_000);
    expect(byKey.get('Controls')).toBe(75_000);
    for (const amount of byKey.values()) expect(amount).toBeGreaterThan(0);
  });

  it('reports shares that sum to the whole', () => {
    const result = allocateCostAutomatically({
      dimension: 'department',
      features: [FEATURE],
      activities,
      employees,
    });
    const totalShare = result.rows.reduce((sum, row) => sum + row.sharePct, 0);
    expect(Math.abs(totalShare - 100)).toBeLessThan(0.2);
  });

  it('reconciles: allocated plus unallocated equals the allocatable cost', () => {
    const result = allocateCostAutomatically({
      dimension: 'department',
      features: [FEATURE],
      activities,
      employees,
    });

    expect(result.allocatableCost).toBe(300_000);
    expect(result.totalAllocated + result.unallocated).toBeCloseTo(300_000, 2);
    expect(result.reconciles).toBe(true);
  });

  it('counts each person once per feature, not once per observation', () => {
    // One activity row IS one (feature, person) pair, so repeated observation
    // of the same person must not increase their group's weight.
    const heavy = allocateCostAutomatically({
      dimension: 'department',
      features: [FEATURE],
      activities: [
        activity('a', 'f1', { totalSessions: 500 }),
        activity('c', 'f1', { totalSessions: 1 }),
      ],
      employees,
    });

    const byKey = new Map(heavy.rows.map((row) => [row.key, row.allocatedSpend]));
    expect(byKey.get('Structures')).toBe(150_000);
    expect(byKey.get('Fluids')).toBe(150_000);
  });

  it('never claims the allocation represents time consumed', () => {
    const result = allocateCostAutomatically({
      dimension: 'department',
      features: [FEATURE],
      activities,
      employees,
    });

    expect(result.methodology).toContain('not time consumed');
    expect(result.methodology.toLowerCase()).not.toContain('hours consumed');
  });
});

describe('identities that cannot be placed', () => {
  const employees = [employee('a', 'Structures'), employee('b', null)];

  it('excludes an unresolved username from every named group', () => {
    const result = allocateCostAutomatically({
      dimension: 'department',
      features: [FEATURE],
      activities: [activity('a', 'f1'), activity('ghost', 'f1')],
      employees,
    });

    expect(result.rows.map((row) => row.key)).toEqual(['Structures']);
    expect(result.rows[0]!.allocatedSpend).toBe(150_000);
    expect(result.unallocated).toBe(150_000);
    expect(result.unresolvedIdentityCount).toBe(1);
    expect(result.reconciles).toBe(true);
  });

  it('excludes a resolved person whose record has no value for the dimension', () => {
    // Known person, blank department. Their spend is not Structures' spend.
    const result = allocateCostAutomatically({
      dimension: 'department',
      features: [FEATURE],
      activities: [activity('a', 'f1'), activity('b', 'f1')],
      employees,
    });

    expect(result.rows.map((row) => row.key)).toEqual(['Structures']);
    expect(result.unallocated).toBe(150_000);
    expect(result.reconciles).toBe(true);
  });

  it('names the unresolved cost separately so it can be acted on', () => {
    const result = allocateCostAutomatically({
      dimension: 'department',
      features: [FEATURE],
      activities: [activity('a', 'f1'), activity('ghost', 'f1')],
      employees,
    });

    expect(result.unresolvedIdentityCost).toBe(150_000);
    expect(result.unallocatedReason).toContain('could not be placed');
  });
});

describe('when nothing can be allocated', () => {
  it('says so rather than reporting zero spend', () => {
    const result = allocateCostAutomatically({
      dimension: 'department',
      features: [FEATURE],
      activities: [],
      employees: [employee('a', 'Structures')],
    });

    expect(result.available).toBe(false);
    expect(result.basisLabel).toBe('Cannot allocate from supplied evidence');
    expect(result.rows).toHaveLength(0);
    // The distinction the whole rule exists for.
    expect(result.selectionReason).toContain('Cannot allocate');
  });
});

describe('duration is still preferred when present', () => {
  it('weights by hours, not by headcount', () => {
    const employees = [employee('a', 'Structures'), employee('c', 'Fluids')];
    const result = allocateCostAutomatically({
      dimension: 'department',
      features: [FEATURE],
      activities: [
        activity('a', 'f1', { totalHours: 90 }),
        activity('c', 'f1', { totalHours: 10 }),
      ],
      employees,
    });

    expect(result.method).toBe('duration_weighted');
    const byKey = new Map(result.rows.map((row) => [row.key, row.allocatedSpend]));
    expect(byKey.get('Structures')).toBe(270_000);
    expect(byKey.get('Fluids')).toBe(30_000);
  });

  it('does not silently switch method when a caller asks explicitly', () => {
    const employees = [employee('a', 'Structures'), employee('c', 'Fluids')];
    const result = allocateCost({
      method: 'distinct_observed_users',
      dimension: 'department',
      features: [FEATURE],
      activities: [
        activity('a', 'f1', { totalHours: 90 }),
        activity('c', 'f1', { totalHours: 10 }),
      ],
      employees,
    });

    // Explicitly chosen, so the even split is what the customer asked for.
    const byKey = new Map(result.rows.map((row) => [row.key, row.allocatedSpend]));
    expect(byKey.get('Structures')).toBe(150_000);
    expect(byKey.get('Fluids')).toBe(150_000);
  });
});
