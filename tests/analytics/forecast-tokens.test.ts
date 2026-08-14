import { describe, expect, it } from 'vitest';
import { buildWindow } from '@/lib/analytics/dates';
import { TREND_CLAMP, computeForecast, forecastPortfolioSpend, forecastSeries, trendClampNote } from '@/lib/analytics/forecast';
import { computeTokenMetrics, monthlyTokenSeries, peakTokenDraw, tokenRisk } from '@/lib/analytics/tokens';
import type { ConcurrentMetrics, TokenUsageDaily } from '@/lib/domain/types';

const window = buildWindow('2026-06-30', '12m');

function metrics(overrides: Partial<ConcurrentMetrics> = {}): ConcurrentMetrics {
  return {
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
    trendPctPerYear: 0,
    entitled: 400,
    utilizationPct: 68.8,
    saturationDays: 0,
    saturationPct: 0,
    availableCapacity: 125,
    ...overrides,
  };
}

describe('computeForecast', () => {
  it('compounds demand trend and headcount growth multiplicatively', () => {
    const result = computeForecast({
      metrics: metrics({ trendPctPerYear: 5 }),
      headcountGrowthRate: 0.1,
      safetyFactor: 1,
      unitPrice: 5000,
    });

    // (1 + 0.05) × (1 + 0.10) − 1 = 0.155
    expect(result.combinedGrowth).toBeCloseTo(0.155, 4);
    expect(result.forecastDemand).toBeCloseTo(275 * 1.155, 2);
  });

  it('applies the safety factor to the forecast recommendation', () => {
    const result = computeForecast({
      metrics: metrics({ trendPctPerYear: 0 }),
      headcountGrowthRate: 0,
      safetyFactor: 1.1,
      unitPrice: 5000,
    });
    expect(result.forecastDemand).toBe(275);
    expect(result.recommendedQuantity).toBe(303); // ceil(275 × 1.1)
  });

  it('reports surplus against current entitlement', () => {
    const result = computeForecast({
      metrics: metrics(),
      headcountGrowthRate: 0,
      safetyFactor: 1.1,
      unitPrice: 5000,
    });
    expect(result.surplus).toBe(97);
    expect(result.shortfall).toBe(0);
    expect(result.financialImpact).toBe(-485_000);
  });

  it('reports a shortfall when growth pushes demand past entitlement', () => {
    const result = computeForecast({
      metrics: metrics({ entitled: 280, p95: 275 }),
      headcountGrowthRate: 0.12,
      safetyFactor: 1.1,
      unitPrice: 1000,
    });
    expect(result.shortfall).toBeGreaterThan(0);
    expect(result.financialImpact).toBeGreaterThan(0);
  });

  it('clamps an implausible observed trend before extrapolating', () => {
    const wild = computeForecast({
      metrics: metrics({ trendPctPerYear: 400 }),
      headcountGrowthRate: 0,
      safetyFactor: 1,
      unitPrice: null,
    });
    // Trend capped at +50%/yr, not 400%.
    expect(wild.trendGrowth).toBeCloseTo(TREND_CLAMP.max / 100, 4);
  });

  it('floors an implausibly negative trend', () => {
    const collapsing = computeForecast({
      metrics: metrics({ trendPctPerYear: -95 }),
      headcountGrowthRate: 0,
      safetyFactor: 1,
      unitPrice: null,
    });
    expect(collapsing.trendGrowth).toBeCloseTo(TREND_CLAMP.min / 100, 4);
  });

  it('discloses the clamp rather than hiding it', () => {
    expect(trendClampNote(400)).toContain('capped at 50%');
    expect(trendClampNote(-95)).toContain('floored at -30%');
    expect(trendClampNote(12)).toBeNull();
  });

  it('scales growth by the forecast horizon', () => {
    const halfYear = computeForecast({
      metrics: metrics({ trendPctPerYear: 10 }),
      headcountGrowthRate: 0,
      safetyFactor: 1,
      horizonDays: 182.5,
      unitPrice: null,
    });
    expect(halfYear.trendGrowth).toBeCloseTo(0.05, 3);
  });

  it('returns no financial impact when the feature is unpriced', () => {
    const result = computeForecast({
      metrics: metrics(),
      headcountGrowthRate: 0.05,
      unitPrice: null,
    });
    expect(result.financialImpact).toBeNull();
  });

  it('selects the baseline percentile the caller asked for', () => {
    const atP90 = computeForecast({
      metrics: metrics(),
      headcountGrowthRate: 0,
      safetyFactor: 1,
      percentileValue: 0.9,
      unitPrice: null,
    });
    expect(atP90.forecastDemand).toBe(260);
  });
});

describe('forecastPortfolioSpend', () => {
  it('totals recommended quantities at unit price', () => {
    const total = forecastPortfolioSpend([
      { recommendedQuantity: 100, unitPrice: 1000 },
      { recommendedQuantity: 50, unitPrice: 2000 },
    ]);
    expect(total).toBe(200_000);
  });

  it('applies price escalation', () => {
    const total = forecastPortfolioSpend([{ recommendedQuantity: 100, unitPrice: 1000 }], 5);
    expect(total).toBe(105_000);
  });

  it('skips unpriced items rather than treating them as free', () => {
    const total = forecastPortfolioSpend([
      { recommendedQuantity: 100, unitPrice: null },
      { recommendedQuantity: 10, unitPrice: 100 },
    ]);
    expect(total).toBe(1000);
  });
});

describe('forecastSeries', () => {
  it('projects a monthly demand curve from the baseline', () => {
    const series = forecastSeries(100, 0.12, 12);
    expect(series).toHaveLength(13);
    expect(series[0]?.demand).toBe(100);
    expect(series[12]?.demand).toBeCloseTo(112, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

function tokenDay(date: string, tokenHours: number, peakTokens = 0): TokenUsageDaily {
  return { featureId: 't1', date, tokenHours, peakTokens };
}

describe('computeTokenMetrics', () => {
  const daily = [
    tokenDay('2026-06-01', 1000, 60),
    tokenDay('2026-06-02', 1200, 70),
    tokenDay('2026-06-03', 800, 50),
    tokenDay('2026-06-04', 1400, 90),
  ];

  it('summarizes token-hour consumption', () => {
    const result = computeTokenMetrics({ featureId: 't1', daily, window, tokenPool: 100 });
    expect(result.meanTokenHours).toBe(1100);
    expect(result.peakTokenHours).toBe(1400);
  });

  it('derives available token-hours from pool size and observed days', () => {
    const result = computeTokenMetrics({ featureId: 't1', daily, window, tokenPool: 100 });
    expect(result.availableTokenHours).toBe(100 * 24 * 4);
    expect(result.capacityUtilizationPct).toBeCloseTo((4400 / 9600) * 100, 1);
  });

  it('reports no utilization when the pool size is unknown', () => {
    const result = computeTokenMetrics({ featureId: 't1', daily, window, tokenPool: null });
    expect(result.availableTokenHours).toBeNull();
    expect(result.capacityUtilizationPct).toBeNull();
    expect(result.risk).toBe('Low');
  });

  it('ignores other features and out-of-window dates', () => {
    const result = computeTokenMetrics({
      featureId: 't1',
      daily: [...daily, { featureId: 'other', date: '2026-06-01', tokenHours: 99999, peakTokens: 0 }],
      window,
      tokenPool: 100,
    });
    expect(result.meanTokenHours).toBe(1100);
  });

  it('handles a feature with no token usage', () => {
    const result = computeTokenMetrics({ featureId: 'none', daily, window, tokenPool: 100 });
    expect(result.meanTokenHours).toBe(0);
    expect(result.availableTokenHours).toBeNull();
  });
});

describe('tokenRisk', () => {
  it('escalates with pool utilization', () => {
    expect(tokenRisk(30, 0)).toBe('Low');
    expect(tokenRisk(75, 0)).toBe('Moderate');
    expect(tokenRisk(88, 0)).toBe('High');
    expect(tokenRisk(97, 0)).toBe('Critical');
  });

  it('escalates moderate utilization when demand is growing fast', () => {
    expect(tokenRisk(62, 5)).toBe('Low');
    expect(tokenRisk(62, 25)).toBe('Moderate');
  });

  it('is Low when utilization is unknown', () => {
    expect(tokenRisk(null, 100)).toBe('Low');
  });
});

describe('token helpers', () => {
  it('finds the peak simultaneous token draw', () => {
    expect(peakTokenDraw([tokenDay('2026-06-01', 1, 40), tokenDay('2026-06-02', 1, 95)], 't1')).toBe(95);
  });

  it('builds a monthly consumption series', () => {
    const series = monthlyTokenSeries(
      [tokenDay('2026-05-01', 100), tokenDay('2026-05-02', 150), tokenDay('2026-06-01', 300)],
      't1',
      window,
    );
    expect(series).toEqual([
      { month: '2026-05', tokenHours: 250 },
      { month: '2026-06', tokenHours: 300 },
    ]);
  });
});
