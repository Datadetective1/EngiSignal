import { describe, expect, it } from 'vitest';
import { ALLOCATION_METHODS, allocateCost } from '@/lib/analytics/allocation';
import { generateSignals, scoreSignal } from '@/lib/analytics/signals';
import { computeFinancial } from '@/lib/analytics/financial';
import { buildWindow } from '@/lib/analytics/dates';
import type { Employee, PortfolioRow, RenewalSummary, UserFeatureActivity } from '@/lib/domain/types';

// ── Allocation ───────────────────────────────────────────────────────────────

function employee(id: string, department: string, program = 'Program Halo'): Employee {
  return {
    id,
    organizationId: 'org1',
    employeeCode: id.toUpperCase(),
    username: id,
    fullName: `Employee ${id}`,
    email: null,
    managerName: 'M. Okafor',
    department,
    businessUnit: 'Aerostructures',
    program,
    discipline: 'Structures',
    competency: 'Simulation',
    location: 'Seattle',
    region: 'NA',
    employeeType: 'employee',
    status: 'active',
    contractorCompany: null,
  };
}

function activity(employeeId: string, featureId: string, hours: number, assigned = true): UserFeatureActivity {
  return {
    organizationId: 'org1',
    featureId,
    employeeId,
    assigned,
    assignedOn: '2025-01-01',
    lastUsedDate: '2026-06-01',
    totalSessions: Math.round(hours / 4),
    totalHours: hours,
    sessions30: 1,
    sessions60: 2,
    sessions90: 3,
    sessions180: 4,
  };
}

describe('allocateCost', () => {
  const employees = [employee('e1', 'Structures'), employee('e2', 'Structures'), employee('e3', 'Thermal')];

  it('distributes cost in proportion to usage hours', () => {
    const result = allocateCost({
      method: 'actual_usage',
      dimension: 'department',
      features: [{ featureId: 'f1', licenseModel: 'concurrent', annualCost: 100_000, wasteAmount: 0 }],
      activities: [activity('e1', 'f1', 60), activity('e2', 'f1', 20), activity('e3', 'f1', 20)],
      employees,
    });

    const structures = result.rows.find((r) => r.key === 'Structures');
    const thermal = result.rows.find((r) => r.key === 'Thermal');

    expect(structures?.allocatedSpend).toBe(80_000);
    expect(thermal?.allocatedSpend).toBe(20_000);
    expect(structures?.sharePct).toBe(80);
  });

  it('always labels the methodology that produced the numbers', () => {
    const result = allocateCost({
      method: 'assigned_licenses',
      dimension: 'department',
      features: [{ featureId: 'f1', licenseModel: 'named_user', annualCost: 90_000, wasteAmount: 0 }],
      activities: [activity('e1', 'f1', 0), activity('e2', 'f1', 0), activity('e3', 'f1', 0)],
      employees,
    });

    expect(result.method).toBe('assigned_licenses');
    expect(result.methodLabel).toBe('Assigned licenses');
    expect(result.methodology).toBe(ALLOCATION_METHODS.assigned_licenses.methodology);
  });

  it('allocates by seat count when the method is assigned licenses', () => {
    const result = allocateCost({
      method: 'assigned_licenses',
      dimension: 'department',
      features: [{ featureId: 'f1', licenseModel: 'named_user', annualCost: 90_000, wasteAmount: 0 }],
      // Usage hours differ wildly but must be ignored under this method.
      activities: [activity('e1', 'f1', 500), activity('e2', 'f1', 0), activity('e3', 'f1', 1)],
      employees,
    });

    expect(result.rows.find((r) => r.key === 'Structures')?.allocatedSpend).toBe(60_000);
    expect(result.rows.find((r) => r.key === 'Thermal')?.allocatedSpend).toBe(30_000);
  });

  it('reports unattributable spend rather than silently redistributing it', () => {
    const result = allocateCost({
      method: 'actual_usage',
      dimension: 'department',
      features: [
        { featureId: 'f1', licenseModel: 'concurrent', annualCost: 100_000, wasteAmount: 0 },
        { featureId: 'ghost', licenseModel: 'concurrent', annualCost: 50_000, wasteAmount: 0 },
      ],
      activities: [activity('e1', 'f1', 10)],
      employees,
    });

    expect(result.totalAllocated).toBe(100_000);
    expect(result.unallocated).toBe(50_000);
    expect(result.unallocatedReason).toContain('no attributable activity');
  });

  it('reports unpriced features as a distinct reason', () => {
    const result = allocateCost({
      method: 'actual_usage',
      dimension: 'department',
      features: [{ featureId: 'f1', licenseModel: 'concurrent', annualCost: null, wasteAmount: 0 }],
      activities: [activity('e1', 'f1', 10)],
      employees,
    });
    expect(result.unallocatedReason).toContain('no unit price');
    expect(result.totalAllocated).toBe(0);
  });

  it('attributes usage from unknown employees to an explicit Unattributed group', () => {
    const result = allocateCost({
      method: 'actual_usage',
      dimension: 'department',
      features: [{ featureId: 'f1', licenseModel: 'concurrent', annualCost: 100_000, wasteAmount: 0 }],
      activities: [activity('e1', 'f1', 50), activity('ghost-user', 'f1', 50)],
      employees,
    });

    expect(result.rows.find((r) => r.key === 'Unattributed')?.allocatedSpend).toBe(50_000);
  });

  it('computes cost per engineer from active headcount in each group', () => {
    const result = allocateCost({
      method: 'actual_usage',
      dimension: 'department',
      features: [{ featureId: 'f1', licenseModel: 'concurrent', annualCost: 100_000, wasteAmount: 0 }],
      activities: [activity('e1', 'f1', 50), activity('e2', 'f1', 50)],
      employees,
    });

    const structures = result.rows.find((r) => r.key === 'Structures');
    expect(structures?.headcount).toBe(2);
    expect(structures?.costPerEngineer).toBe(50_000);
  });

  it('distributes waste on the same basis as spend', () => {
    const result = allocateCost({
      method: 'actual_usage',
      dimension: 'department',
      features: [{ featureId: 'f1', licenseModel: 'concurrent', annualCost: 100_000, wasteAmount: 40_000 }],
      activities: [activity('e1', 'f1', 75), activity('e3', 'f1', 25)],
      employees,
    });

    expect(result.rows.find((r) => r.key === 'Structures')?.potentialWaste).toBe(30_000);
    expect(result.rows.find((r) => r.key === 'Thermal')?.potentialWaste).toBe(10_000);
  });

  it('groups by any organizational dimension', () => {
    const result = allocateCost({
      method: 'actual_usage',
      dimension: 'program',
      features: [{ featureId: 'f1', licenseModel: 'concurrent', annualCost: 100_000, wasteAmount: 0 }],
      activities: [activity('e1', 'f1', 100)],
      employees: [employee('e1', 'Structures', 'Program Vega')],
    });
    expect(result.rows[0]?.key).toBe('Program Vega');
  });
});

// ── Signal ranking ───────────────────────────────────────────────────────────

describe('scoreSignal', () => {
  it('ranks a larger opportunity above a smaller one, all else equal', () => {
    const big = scoreSignal({ financialImpact: 500_000, urgencyDays: 90, risk: 'Low', confidence: 'High' });
    const small = scoreSignal({ financialImpact: 20_000, urgencyDays: 90, risk: 'Low', confidence: 'High' });
    expect(big).toBeGreaterThan(small);
  });

  it('ranks an imminent decision above a distant one, all else equal', () => {
    const soon = scoreSignal({ financialImpact: 100_000, urgencyDays: 20, risk: 'Low', confidence: 'High' });
    const later = scoreSignal({ financialImpact: 100_000, urgencyDays: 170, risk: 'Low', confidence: 'High' });
    expect(soon).toBeGreaterThan(later);
  });

  it('treats confidence as a multiplier so weak data cannot top the queue', () => {
    const trusted = scoreSignal({ financialImpact: 300_000, urgencyDays: 60, risk: 'Low', confidence: 'High' });
    const doubtful = scoreSignal({ financialImpact: 300_000, urgencyDays: 60, risk: 'Low', confidence: 'Low' });
    // Scores are rounded to one decimal for display, so compare the ratio.
    expect(doubtful / trusted).toBeCloseTo(0.5, 2);
  });

  it('lets a high-confidence modest finding outrank a low-confidence large one', () => {
    const solid = scoreSignal({ financialImpact: 150_000, urgencyDays: 30, risk: 'Moderate', confidence: 'High' });
    const shaky = scoreSignal({ financialImpact: 400_000, urgencyDays: 150, risk: 'Low', confidence: 'Low' });
    expect(solid).toBeGreaterThan(shaky);
  });

  it('does not collapse to zero for an unpriced but risky finding', () => {
    const score = scoreSignal({ financialImpact: null, urgencyDays: null, risk: 'Critical', confidence: 'Medium' });
    expect(score).toBeGreaterThan(0);
  });

  it('never exceeds 100', () => {
    const score = scoreSignal({ financialImpact: 50_000_000, urgencyDays: 0, risk: 'Critical', confidence: 'High' });
    expect(score).toBeLessThanOrEqual(100);
  });
});

// ── Signal generation ────────────────────────────────────────────────────────

const window = buildWindow('2026-06-30', '12m');

function portfolioRow(overrides: Partial<PortfolioRow> = {}): PortfolioRow {
  return {
    featureId: 'f1',
    featureName: 'Mechanical Enterprise',
    featureCode: 'MECH_ENT',
    productId: 'p1',
    productName: 'Mechanical',
    vendorId: 'v1',
    vendorName: 'Vendor A',
    familyName: 'Structures',
    licenseModel: 'concurrent',
    entitled: 400,
    unitPrice: 5000,
    currentAnnualCost: 2_000_000,
    metrics: {
      featureId: 'f1',
      window,
      observedDays: 365,
      missingDays: 0,
      mean: 200,
      median: 205,
      p90: 260,
      p95: 275,
      p99: 290,
      max: 300,
      min: 80,
      stdDev: 40,
      volatility: 0.2,
      trendPctPerYear: 3,
      entitled: 400,
      utilizationPct: 68.8,
      saturationDays: 0,
      saturationPct: 0,
      availableCapacity: 125,
    },
    namedUser: null,
    tokens: null,
    denials: null,
    rightSizing: null,
    financial: computeFinancial({ entitled: 400, recommended: 318, unitPrice: 5000 }),
    confidence: { level: 'High', score: 92, reasons: [] },
    risk: 'Low',
    renewalDate: '2026-08-27',
    daysToRenewal: 58,
    contractId: 'c1',
    ...overrides,
  };
}

function renewal(overrides: Partial<RenewalSummary> = {}): RenewalSummary {
  return {
    contractId: 'c1',
    vendorId: 'v1',
    vendorName: 'Vendor A',
    contractNumber: 'CT-1',
    agreementName: 'Enterprise Agreement',
    renewalDate: '2026-08-27',
    daysRemaining: 58,
    stage: 'negotiate',
    status: 'active',
    owner: 'Procurement',
    itemCount: 4,
    currentAnnualSpend: 2_000_000,
    recommendedAnnualSpend: 1_590_000,
    optimizationOpportunity: 410_000,
    incrementalSpend: 0,
    capacityExposure: 0,
    demandTrendPct: 3,
    headcountImpactPct: 5,
    confidence: { level: 'High', score: 92, reasons: [] },
    ...overrides,
  };
}

describe('generateSignals', () => {
  it('returns signals sorted by score, highest first', () => {
    const signals = generateSignals({
      portfolio: [portfolioRow()],
      renewals: [renewal()],
      dataQuality: [],
    });

    expect(signals.length).toBeGreaterThan(0);
    for (let i = 1; i < signals.length; i++) {
      expect(signals[i - 1]!.score).toBeGreaterThanOrEqual(signals[i]!.score);
    }
  });

  it('raises a renewal signal carrying the opportunity and countdown', () => {
    const signals = generateSignals({ portfolio: [], renewals: [renewal()], dataQuality: [] });
    const signal = signals.find((s) => s.kind === 'renewal');

    expect(signal?.title).toContain('Vendor A');
    expect(signal?.financialImpact).toBe(410_000);
    expect(signal?.urgencyDays).toBe(58);
    expect(signal?.facts.some((f) => f.value === '58 days')).toBe(true);
  });

  it('raises a cost signal for an over-provisioned feature', () => {
    const signals = generateSignals({ portfolio: [portfolioRow()], renewals: [], dataQuality: [] });
    const signal = signals.find((s) => s.kind === 'cost');
    expect(signal?.financialImpact).toBe(410_000);
    expect(signal?.href).toBe('/app/portfolio/f1');
  });

  it('suppresses cost signals below the materiality threshold', () => {
    const signals = generateSignals({
      portfolio: [
        portfolioRow({
          financial: computeFinancial({ entitled: 101, recommended: 100, unitPrice: 100 }),
        }),
      ],
      renewals: [],
      dataQuality: [],
      costThreshold: 25_000,
    });
    expect(signals.some((s) => s.kind === 'cost')).toBe(false);
  });

  it('raises a capacity signal only for High or Critical risk', () => {
    const low = generateSignals({ portfolio: [portfolioRow({ risk: 'Moderate' })], renewals: [], dataQuality: [] });
    expect(low.some((s) => s.kind === 'capacity')).toBe(false);

    const high = generateSignals({ portfolio: [portfolioRow({ risk: 'High' })], renewals: [], dataQuality: [] });
    expect(high.some((s) => s.kind === 'capacity')).toBe(true);
  });

  it('raises a reclaim signal when enough seats are idle', () => {
    const signals = generateSignals({
      portfolio: [
        portfolioRow({
          licenseModel: 'named_user',
          namedUser: {
            featureId: 'f1',
            assigned: 420,
            activeUsers: 377,
            inactiveUsers: 43,
            neverUsed: 5,
            active30: 300,
            active60: 350,
            active90: 377,
            active180: 400,
            reclaimThresholdDays: 90,
            reclaimCandidates: 43,
            reclaimValue: 96_000,
            utilizationPct: 89.8,
          },
        }),
      ],
      renewals: [],
      dataQuality: [],
    });

    const signal = signals.find((s) => s.kind === 'reclaim');
    expect(signal?.financialImpact).toBe(96_000);
    expect(signal?.subtitle).toContain('43 assigned licenses');
  });

  it('raises a usage signal for a strong demand trend in either direction', () => {
    const rising = generateSignals({
      portfolio: [portfolioRow({ metrics: { ...portfolioRow().metrics!, trendPctPerYear: 30 } })],
      renewals: [],
      dataQuality: [],
    });
    expect(rising.find((s) => s.kind === 'usage')?.title).toContain('rising');

    const falling = generateSignals({
      portfolio: [portfolioRow({ metrics: { ...portfolioRow().metrics!, trendPctPerYear: -30 } })],
      renewals: [],
      dataQuality: [],
    });
    expect(falling.find((s) => s.kind === 'usage')?.title).toContain('declining');
  });

  it('raises a data signal for warnings but not for informational notes', () => {
    const signals = generateSignals({
      portfolio: [],
      renewals: [],
      dataQuality: [
        {
          id: 'i1',
          organizationId: 'org1',
          severity: 'info',
          category: 'Usage history',
          title: 'Minor gaps',
          detail: 'x',
          affectedCount: 1,
          href: null,
        },
        {
          id: 'i2',
          organizationId: 'org1',
          severity: 'critical',
          category: 'Identity resolution',
          title: '40 usernames unmatched',
          detail: 'y',
          affectedCount: 40,
          href: '/app/data',
        },
      ],
    });

    const dataSignals = signals.filter((s) => s.kind === 'data');
    expect(dataSignals).toHaveLength(1);
    expect(dataSignals[0]?.title).toBe('40 usernames unmatched');
  });

  it('excludes renewals that are far away or already passed', () => {
    const signals = generateSignals({
      portfolio: [],
      renewals: [renewal({ daysRemaining: 400 }), renewal({ contractId: 'c2', daysRemaining: -10 })],
      dataQuality: [],
    });
    expect(signals.filter((s) => s.kind === 'renewal')).toHaveLength(0);
  });

  it('produces no signals for an empty, healthy portfolio', () => {
    expect(generateSignals({ portfolio: [], renewals: [], dataQuality: [] })).toEqual([]);
  });
});
