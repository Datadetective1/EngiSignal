import { describe, expect, it } from 'vitest';
import { DEFAULT_ANALYSIS_OPTIONS } from '@/lib/domain/dataset';
import { buildPortfolio, buildRenewals } from '@/lib/analytics/portfolio';
import { computePortfolioTotals } from '@/lib/analytics/financial';
import { generateDemoDataset, DEMO_AS_OF } from '@/lib/synthetic/generate';
import { ALL_FEATURES, VENDOR_CATALOG } from '@/lib/synthetic/catalog';

const dataset = generateDemoDataset();
const portfolio = buildPortfolio(dataset, DEFAULT_ANALYSIS_OPTIONS);
const totals = computePortfolioTotals(portfolio);

function feature(code: string) {
  const row = portfolio.find((r) => r.featureCode === code);
  if (row === undefined) throw new Error(`No portfolio row for ${code}`);
  return row;
}

describe('demo organization shape', () => {
  it('matches the documented profile', () => {
    expect(dataset.organization.name).toBe('Aerospace Dynamics Corporation');
    expect(dataset.organization.isDemo).toBe(true);
    expect(dataset.employees).toHaveLength(3850);
    expect(dataset.vendors).toHaveLength(9);
    expect(dataset.features).toHaveLength(42);
    expect(ALL_FEATURES).toHaveLength(42);
    expect(VENDOR_CATALOG).toHaveLength(9);
  });

  it('has annual spend close to the stated $18.4M', () => {
    expect(totals.annualSpend).toBeGreaterThan(18_000_000);
    expect(totals.annualSpend).toBeLessThan(18_900_000);
  });

  it('generates two years of daily history and recent hourly detail', () => {
    const dates = new Set(dataset.dailyUsage.map((d) => d.date));
    expect(dates.size).toBe(730);
    const hourlyDates = new Set(dataset.hourlyUsage.map((h) => h.date));
    expect(hourlyDates.size).toBe(90);
  });

  it('is deterministic — a second generation is identical', () => {
    const second = generateDemoDataset();
    expect(second.dailyUsage.length).toBe(dataset.dailyUsage.length);
    expect(second.employees[100]?.fullName).toBe(dataset.employees[100]?.fullName);
    expect(
      buildPortfolio(second, DEFAULT_ANALYSIS_OPTIONS).map((r) => r.financial.optimizationOpportunity),
    ).toEqual(portfolio.map((r) => r.financial.optimizationOpportunity));
  });

  it('uses a fixed as-of date so every relative figure reproduces', () => {
    expect(dataset.asOf).toBe(DEMO_AS_OF);
  });
});

describe('SCENARIO A + D — the flagship over-provisioned renewal', () => {
  it('produces exactly the documented demand position', () => {
    const row = feature('MECH_ENT');
    expect(row.entitled).toBe(400);
    expect(row.metrics?.p95).toBe(275);
    expect(row.metrics?.max).toBe(314);
    expect(row.metrics?.observedDays).toBe(365);
  });

  it('recommends 318 licenses at +5% growth and a 10% safety buffer', () => {
    const withGrowth = buildPortfolio(dataset, {
      ...DEFAULT_ANALYSIS_OPTIONS,
      growthFactor: 1.05,
      safetyFactor: 1.1,
    });
    const row = withGrowth.find((r) => r.featureCode === 'MECH_ENT');

    expect(row?.rightSizing?.recommended).toBe(318);
    expect(row?.rightSizing?.surplus).toBe(82);
    expect(row?.financial.optimizationOpportunity).toBe(410_000);
  });

  it('renews in 58 days', () => {
    const renewals = buildRenewals(dataset, portfolio);
    const ansys = renewals.find((r) => r.vendorName === 'Ansys');
    expect(ansys?.daysRemaining).toBe(58);
    expect(ansys?.stage).toBe('negotiate');
  });
});

describe('SCENARIO B — the capacity-constrained application', () => {
  it('runs at 94% utilization with regular saturation', () => {
    const row = feature('STARCCM');
    expect(row.entitled).toBe(100);
    expect(row.metrics?.p95).toBe(94);
    expect(row.metrics?.utilizationPct).toBe(94);
    expect(row.metrics?.saturationDays).toBeGreaterThan(0);
    expect(row.risk === 'High' || row.risk === 'Critical').toBe(true);
  });
});

describe('SCENARIO C — the named-user reclaim opportunity', () => {
  it('finds 43 idle MATLAB seats worth $96,105', () => {
    const row = feature('MATLAB');
    expect(row.namedUser?.assigned).toBe(420);
    expect(row.namedUser?.reclaimCandidates).toBe(43);
    expect(row.namedUser?.reclaimValue).toBe(96_105);
    expect(row.namedUser?.neverUsed).toBe(9);
  });
});

describe('SCENARIO E/F — demand direction', () => {
  it('shows strongly rising demand where the catalog says so', () => {
    expect(feature('STARCCM').metrics?.trendPctPerYear).toBeGreaterThan(15);
    expect(feature('CATIA_3DX').metrics?.trendPctPerYear).toBeGreaterThan(15);
  });

  it('shows declining demand for the product being migrated away from', () => {
    expect(feature('CATIA_V5').metrics?.trendPctPerYear).toBeLessThan(-15);
  });
});

describe('SCENARIO J — denial patterns exercise the honesty guards', () => {
  it('classifies genuine capacity denials as a real risk', () => {
    const row = feature('STARCCM');
    expect(row.denials).not.toBeNull();
    expect(row.denials!.totalDenials).toBeGreaterThan(0);
    expect(row.denials!.risk === 'High' || row.denials!.risk === 'Critical').toBe(true);
  });

  it('classifies a single-user retry burst as Low despite the volume', () => {
    const row = feature('MECH_ENT');
    expect(row.denials!.totalDenials).toBeGreaterThan(50);
    expect(row.denials!.denialDays).toBe(2);
    expect(row.denials!.risk).toBe('Low');
    expect(row.denials!.riskRationale).toContain('retry burst');
  });

  it('classifies denials that occurred with spare capacity as a licensing-rule issue', () => {
    const row = feature('HFSS');
    expect(row.denials!.totalDenials).toBeGreaterThan(0);
    expect(row.denials!.risk).toBe('Low');
    expect(row.denials!.riskRationale).toContain('licensing rules');
  });
});

describe('SCENARIO G/H — organizational concentration', () => {
  it('concentrates headcount in Program Helios', () => {
    const counts = new Map<string, number>();
    for (const employee of dataset.employees) {
      const key = employee.program ?? 'none';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    expect(sorted[0]?.[0]).toBe('Program Helios');
  });

  it('concentrates headcount in the Structures department', () => {
    const counts = new Map<string, number>();
    for (const employee of dataset.employees) {
      const key = employee.department ?? 'none';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    expect(sorted[0]?.[0]).toBe('Structures');
  });
});

describe('SCENARIO I — headcount-driven forecast input', () => {
  it('carries an explicit growth rate', () => {
    expect(dataset.organization.headcountGrowthRate).toBe(0.05);
  });
});

describe('data-quality artefacts', () => {
  it('includes unmatched users and unmapped features to resolve', () => {
    expect(dataset.unmatchedUsers.length).toBeGreaterThan(10);
    expect(dataset.unmappedFeatures.length).toBeGreaterThan(5);
    expect(dataset.imports.length).toBeGreaterThan(3);
    expect(dataset.importMappings.length).toBe(3);
  });
});

describe('portfolio-wide outcomes', () => {
  it('surfaces a material optimization opportunity', () => {
    expect(totals.optimizationOpportunity).toBeGreaterThan(1_000_000);
  });

  it('keeps the opportunity within a defensible share of spend', () => {
    const share = totals.optimizationOpportunity / totals.annualSpend;
    expect(share).toBeGreaterThan(0.05);
    expect(share).toBeLessThan(0.35);
  });

  it('prices every feature, so no confidence is lost to missing cost data', () => {
    expect(totals.unpricedFeatures).toBe(0);
  });
});
