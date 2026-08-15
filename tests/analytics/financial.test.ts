import { describe, expect, it } from 'vitest';
import {
  computeFinancial,
  computePortfolioTotals,
  costPerActiveUser,
  costPerEngineer,
  formatCurrency,
  formatCurrencyExact,
  formatPercent,
  formatSignedPercent,
  unusedCapacitySpend,
} from '@/lib/analytics/financial';
import type { PortfolioRow } from '@/lib/domain/types';

describe('computeFinancial', () => {
  it('produces the flagship annual opportunity', () => {
    // 400 entitled − 318 recommended = 82 licenses × $5,000 = $410,000
    const result = computeFinancial({ entitled: 400, recommended: 318, unitPrice: 5000 });

    expect(result.currentAnnualCost).toBe(2_000_000);
    expect(result.recommendedAnnualCost).toBe(1_590_000);
    expect(result.optimizationOpportunity).toBe(410_000);
    expect(result.incrementalSpend).toBe(0);
    expect(result.savingsPct).toBe(20.5);
    expect(result.quantityDelta).toBe(-82);
  });

  it('reports incremental spend rather than savings when demand grows', () => {
    const result = computeFinancial({ entitled: 100, recommended: 130, unitPrice: 1000 });

    expect(result.incrementalSpend).toBe(30_000);
    expect(result.optimizationOpportunity).toBe(0);
    expect(result.quantityDelta).toBe(30);
  });

  it('reports zero on both sides when already right-sized', () => {
    const result = computeFinancial({ entitled: 50, recommended: 50, unitPrice: 900 });
    expect(result.optimizationOpportunity).toBe(0);
    expect(result.incrementalSpend).toBe(0);
    expect(result.savingsPct).toBe(0);
  });

  it('marks the result unpriced rather than assuming a price', () => {
    const result = computeFinancial({ entitled: 400, recommended: 318, unitPrice: null });

    expect(result.priced).toBe(false);
    expect(result.currentAnnualCost).toBeNull();
    expect(result.optimizationOpportunity).toBeNull();
    expect(result.savingsPct).toBeNull();
    // The quantity conclusion still stands without pricing.
    expect(result.quantityDelta).toBe(-82);
  });

  it('does not divide by zero when current cost is zero', () => {
    const result = computeFinancial({ entitled: 0, recommended: 0, unitPrice: 1000 });
    expect(result.savingsPct).toBeNull();
  });
});

function row(overrides: Partial<PortfolioRow>): PortfolioRow {
  return {
    featureId: 'f1',
    featureName: 'Feature',
    featureCode: 'FEAT',
    productId: 'p1',
    productName: 'Product',
    vendorId: 'v1',
    vendorName: 'Vendor',
    familyName: null,
    licenseModel: 'concurrent',
    entitled: 100,
    unitPrice: 1000,
    currentAnnualCost: 100_000,
    metrics: null,
    namedUser: null,
    tokens: null,
    denials: null,
    rightSizing: null,
    financial: computeFinancial({ entitled: 100, recommended: 80, unitPrice: 1000 }),
    confidence: { level: 'High', score: 90, reasons: [] },
    risk: 'Low',
    renewalDate: null,
    daysToRenewal: null,
    contractId: null,
    usageEvidence: 'observed' as const,
    commitment: {
      purchasedQuantity: null,
      servedQuantity: null,
      purchasedAnnualCommitment: null,
      servedCapacityValue: null,
      quantityDifference: null,
      basis: 'Test fixture.',
    },
    ...overrides,
  };
}

describe('computePortfolioTotals', () => {
  it('sums spend and opportunity across priced features', () => {
    const totals = computePortfolioTotals([
      row({ featureId: 'a', vendorId: 'v1' }),
      row({ featureId: 'b', vendorId: 'v2' }),
    ]);

    expect(totals.annualSpend).toBe(200_000);
    expect(totals.optimizationOpportunity).toBe(40_000);
    expect(totals.pricedFeatures).toBe(2);
    expect(totals.vendorCount).toBe(2);
  });

  it('counts unpriced features separately without corrupting the total', () => {
    const totals = computePortfolioTotals([
      row({ featureId: 'a' }),
      row({
        featureId: 'b',
        unitPrice: null,
        financial: computeFinancial({ entitled: 10, recommended: 5, unitPrice: null }),
      }),
    ]);

    expect(totals.annualSpend).toBe(100_000);
    expect(totals.pricedFeatures).toBe(1);
    expect(totals.unpricedFeatures).toBe(1);
  });

  it('measures vendor concentration as the largest vendor share', () => {
    const totals = computePortfolioTotals([
      row({ featureId: 'a', vendorId: 'v1' }),
      row({ featureId: 'b', vendorId: 'v1' }),
      row({ featureId: 'c', vendorId: 'v2' }),
    ]);
    expect(totals.vendorConcentration).toBeCloseTo(2 / 3, 3);
  });

  it('returns zeros for an empty portfolio', () => {
    const totals = computePortfolioTotals([]);
    expect(totals.annualSpend).toBe(0);
    expect(totals.vendorConcentration).toBe(0);
  });
});

describe('unusedCapacitySpend', () => {
  it('values concurrent capacity above P95 at contract price', () => {
    const result = unusedCapacitySpend([
      row({
        featureId: 'a',
        entitled: 400,
        unitPrice: 5000,
        licenseModel: 'concurrent',
        metrics: {
          featureId: 'a',
          window: { start: '2025-07-01', end: '2026-06-30', key: '12m', days: 365 },
          observedDays: 365,
          missingDays: 0,
          mean: 200,
          median: 200,
          p90: 260,
          p95: 275,
          p99: 290,
          max: 300,
          min: 50,
          stdDev: 30,
          volatility: 0.15,
          trendPctPerYear: 2,
          entitled: 400,
          utilizationPct: 68.8,
          saturationDays: 0,
          saturationPct: 0,
          availableCapacity: 125,
        },
      }),
    ]);

    expect(result.amount).toBe(625_000); // (400 − 275) × 5000
    expect(result.featureCount).toBe(1);
  });

  it('excludes named-user features so waste definitions are never mixed', () => {
    const result = unusedCapacitySpend([row({ licenseModel: 'named_user', entitled: 400, unitPrice: 5000 })]);
    expect(result.amount).toBe(0);
    expect(result.methodology).toContain('Concurrent features only');
  });
});

describe('per-capita metrics', () => {
  it('computes cost per engineer', () => {
    expect(costPerEngineer(18_400_000, 3850)).toBeCloseTo(4779.22, 2);
  });

  it('returns null when headcount is unknown or zero', () => {
    expect(costPerEngineer(100, null)).toBeNull();
    expect(costPerEngineer(100, 0)).toBeNull();
  });

  it('computes cost per active user', () => {
    expect(costPerActiveUser(50_000, 200)).toBe(250);
    expect(costPerActiveUser(50_000, 0)).toBeNull();
  });
});

describe('formatting', () => {
  it('formats compact currency at each magnitude', () => {
    expect(formatCurrency(18_400_000)).toBe('$18.4M');
    expect(formatCurrency(410_000)).toBe('$410K');
    expect(formatCurrency(1250)).toBe('$1.3K');
    expect(formatCurrency(940)).toBe('$940');
  });

  it('shows an em dash rather than $0 for missing values', () => {
    expect(formatCurrency(null)).toBe('—');
    expect(formatCurrencyExact(null)).toBe('—');
    expect(formatPercent(null)).toBe('—');
  });

  it('preserves the sign of negative amounts', () => {
    expect(formatCurrency(-410_000)).toBe('-$410K');
  });

  it('formats exact currency with thousands separators', () => {
    expect(formatCurrencyExact(18_412_940)).toBe('$18,412,940');
  });

  it('prefixes positive trends with a plus sign', () => {
    expect(formatSignedPercent(11.2)).toBe('+11.2%');
    expect(formatSignedPercent(-4)).toBe('-4.0%');
  });
});
