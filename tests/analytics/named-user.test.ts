import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RECLAIM_THRESHOLD_DAYS,
  buildReclaimCandidates,
  computeNamedUserMetrics,
  computeNamedUserRightSizing,
  daysInactive,
  inactivityDistribution,
  isReclaimCandidate,
  reclaimValue,
} from '@/lib/analytics/named-user';
import type { UserFeatureActivity } from '@/lib/domain/types';

const AS_OF = '2026-06-30';

function activity(overrides: Partial<UserFeatureActivity> = {}): UserFeatureActivity {
  return {
    organizationId: 'org1',
    featureId: 'f1',
    employeeId: 'e1',
    assigned: true,
    assignedOn: '2025-01-01',
    lastUsedDate: '2026-06-01',
    totalSessions: 40,
    totalHours: 160,
    sessions30: 5,
    sessions60: 10,
    sessions90: 18,
    sessions180: 32,
    ...overrides,
  };
}

describe('daysInactive', () => {
  it('counts days since last use', () => {
    expect(daysInactive('2026-06-01', AS_OF)).toBe(29);
  });

  it('is null when a seat has never been used', () => {
    expect(daysInactive(null, AS_OF)).toBeNull();
  });

  it('never returns a negative value for a future-dated record', () => {
    expect(daysInactive('2026-07-15', AS_OF)).toBe(0);
  });
});

describe('isReclaimCandidate', () => {
  it('flags a seat inactive beyond the threshold', () => {
    expect(isReclaimCandidate(activity({ lastUsedDate: '2026-01-01' }), AS_OF, 90)).toBe(true);
  });

  it('does not flag a recently used seat', () => {
    expect(isReclaimCandidate(activity({ lastUsedDate: '2026-06-20' }), AS_OF, 90)).toBe(false);
  });

  it('flags a never-used seat regardless of threshold', () => {
    expect(isReclaimCandidate(activity({ lastUsedDate: null }), AS_OF, 9999)).toBe(true);
  });

  it('ignores seats that are not assigned', () => {
    expect(isReclaimCandidate(activity({ assigned: false, lastUsedDate: null }), AS_OF, 90)).toBe(false);
  });

  it('treats the threshold as inclusive', () => {
    // Exactly 90 days before 2026-06-30 is 2026-04-01.
    expect(daysInactive('2026-04-01', AS_OF)).toBe(90);
    expect(isReclaimCandidate(activity({ lastUsedDate: '2026-04-01' }), AS_OF, 90)).toBe(true);
  });
});

describe('computeNamedUserMetrics', () => {
  const activities: UserFeatureActivity[] = [
    activity({ employeeId: 'e1', lastUsedDate: '2026-06-25' }), // active
    activity({ employeeId: 'e2', lastUsedDate: '2026-06-10' }), // active
    activity({ employeeId: 'e3', lastUsedDate: '2026-01-05' }), // inactive 176d
    activity({ employeeId: 'e4', lastUsedDate: '2025-08-01' }), // inactive 333d
    activity({ employeeId: 'e5', lastUsedDate: null }), // never used
  ];

  it('splits assigned seats into active and inactive', () => {
    const metrics = computeNamedUserMetrics({
      featureId: 'f1',
      activities,
      asOf: AS_OF,
      unitPrice: 2000,
    });

    expect(metrics.assigned).toBe(5);
    expect(metrics.activeUsers).toBe(2);
    expect(metrics.inactiveUsers).toBe(3);
    expect(metrics.neverUsed).toBe(1);
  });

  it('reconciles: active + inactive always equals assigned', () => {
    const metrics = computeNamedUserMetrics({
      featureId: 'f1',
      activities,
      asOf: AS_OF,
      unitPrice: null,
    });
    expect(metrics.activeUsers + metrics.inactiveUsers).toBe(activities.length);
  });

  it('values reclaim candidates at the contract unit price', () => {
    const metrics = computeNamedUserMetrics({
      featureId: 'f1',
      activities,
      asOf: AS_OF,
      unitPrice: 2000,
    });
    expect(metrics.reclaimCandidates).toBe(3);
    expect(metrics.reclaimValue).toBe(6000);
  });

  it('reports no reclaim value when the feature is unpriced', () => {
    const metrics = computeNamedUserMetrics({
      featureId: 'f1',
      activities,
      asOf: AS_OF,
      unitPrice: null,
    });
    expect(metrics.reclaimValue).toBeNull();
  });

  it('honours a configured threshold', () => {
    const strict = computeNamedUserMetrics({
      featureId: 'f1',
      activities,
      asOf: AS_OF,
      unitPrice: 2000,
      reclaimThresholdDays: 15,
    });
    // e2 (20 days idle) also becomes a candidate at a 15-day threshold.
    expect(strict.reclaimCandidates).toBe(4);
    expect(strict.reclaimThresholdDays).toBe(15);
  });

  it('defaults to a 90-day threshold', () => {
    const metrics = computeNamedUserMetrics({ featureId: 'f1', activities, asOf: AS_OF, unitPrice: null });
    expect(metrics.reclaimThresholdDays).toBe(DEFAULT_RECLAIM_THRESHOLD_DAYS);
  });

  it('populates the activity recency buckets', () => {
    const metrics = computeNamedUserMetrics({ featureId: 'f1', activities, asOf: AS_OF, unitPrice: null });
    expect(metrics.active30).toBe(2);
    expect(metrics.active90).toBe(2);
    expect(metrics.active180).toBe(3);
  });

  it('ignores activity belonging to other features', () => {
    const mixed = [...activities, activity({ featureId: 'other', employeeId: 'zz', lastUsedDate: null })];
    const metrics = computeNamedUserMetrics({ featureId: 'f1', activities: mixed, asOf: AS_OF, unitPrice: null });
    expect(metrics.assigned).toBe(5);
  });

  it('handles a feature with no assignments', () => {
    const metrics = computeNamedUserMetrics({ featureId: 'empty', activities, asOf: AS_OF, unitPrice: 100 });
    expect(metrics.assigned).toBe(0);
    expect(metrics.utilizationPct).toBe(0);
    expect(metrics.reclaimValue).toBe(0);
  });
});

describe('computeNamedUserRightSizing', () => {
  it('sizes to active users plus an onboarding buffer', () => {
    const metrics = computeNamedUserMetrics({
      featureId: 'f1',
      activities: Array.from({ length: 100 }, (_, i) =>
        activity({ employeeId: `e${i}`, lastUsedDate: i < 60 ? '2026-06-20' : '2025-01-01' }),
      ),
      asOf: AS_OF,
      unitPrice: 1000,
    });

    expect(metrics.activeUsers).toBe(60);

    const sizing = computeNamedUserRightSizing(metrics, { growthFactor: 1, safetyFactor: 1.1 });
    expect(sizing.basis).toBe(60);
    expect(sizing.recommended).toBe(66);
    expect(sizing.entitled).toBe(100);
    expect(sizing.surplus).toBe(34);
  });

  it('describes its own basis honestly, not as a demand percentile', () => {
    const metrics = computeNamedUserMetrics({
      featureId: 'f1',
      activities: [activity()],
      asOf: AS_OF,
      unitPrice: null,
    });
    const sizing = computeNamedUserRightSizing(metrics);
    expect(sizing.methodology).toContain('Users active within');
    expect(sizing.methodology).not.toContain('daily peak');
  });
});

describe('buildReclaimCandidates', () => {
  const employees = new Map([
    ['e3', { fullName: 'Dana Reyes', managerName: 'M. Okafor', department: 'Structures', program: 'Program Halo' }],
    ['e5', { fullName: 'Sam Iqbal', managerName: 'M. Okafor', department: 'Thermal', program: 'Program Halo' }],
  ]);

  const activities = [
    activity({ employeeId: 'e1', lastUsedDate: '2026-06-25' }),
    activity({ employeeId: 'e3', lastUsedDate: '2026-01-05' }),
    activity({ employeeId: 'e5', lastUsedDate: null }),
  ];

  const context = {
    organizationId: 'org1',
    featureId: 'f1',
    featureName: 'Mechanical Enterprise',
    productName: 'Mechanical',
    vendorName: 'Vendor A',
    unitPrice: 2500,
    asOf: AS_OF,
    employees,
  };

  it('creates one candidate per inactive assigned seat', () => {
    const candidates = buildReclaimCandidates(activities, context);
    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.employeeId).sort()).toEqual(['e3', 'e5']);
  });

  it('orders the queue by longest inactivity first, never-used at the top', () => {
    const candidates = buildReclaimCandidates(activities, context);
    expect(candidates[0]?.employeeId).toBe('e5');
  });

  it('carries organizational context for manager review', () => {
    const candidates = buildReclaimCandidates(activities, context);
    const dana = candidates.find((c) => c.employeeId === 'e3');
    expect(dana?.employeeName).toBe('Dana Reyes');
    expect(dana?.managerName).toBe('M. Okafor');
    expect(dana?.department).toBe('Structures');
    expect(dana?.owner).toBe('M. Okafor');
  });

  it('starts every candidate in pending review rather than auto-reclaiming', () => {
    const candidates = buildReclaimCandidates(activities, context);
    expect(candidates.every((c) => c.status === 'pending_review')).toBe(true);
  });

  it('distinguishes never-used from lapsed in the recommendation text', () => {
    const candidates = buildReclaimCandidates(activities, context);
    expect(candidates.find((c) => c.employeeId === 'e5')?.recommendation).toContain('Never used');
    expect(candidates.find((c) => c.employeeId === 'e3')?.recommendation).toContain('No activity for');
  });

  it('falls back to the employee id when no employee record exists', () => {
    const candidates = buildReclaimCandidates(activities, { ...context, employees: new Map() });
    expect(candidates[0]?.employeeName).toBe('e5');
  });

  it('totals annual value across the queue', () => {
    const candidates = buildReclaimCandidates(activities, context);
    expect(reclaimValue(candidates)).toBe(5000);
  });
});

describe('inactivityDistribution', () => {
  it('buckets seats by how long they have been idle', () => {
    const rows = [
      activity({ lastUsedDate: '2026-06-25' }), // 5 days
      activity({ lastUsedDate: '2026-05-15' }), // 46 days
      activity({ lastUsedDate: '2026-04-20' }), // 71 days
      activity({ lastUsedDate: '2026-02-01' }), // 149 days
      activity({ lastUsedDate: '2025-01-01' }), // 545 days
      activity({ lastUsedDate: null }),
      activity({ assigned: false, lastUsedDate: null }), // excluded
    ];

    const distribution = inactivityDistribution(rows, AS_OF);
    expect(distribution.map((b) => b.count)).toEqual([1, 1, 1, 1, 1, 1]);
  });
});
