import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GROWTH_FACTOR,
  DEFAULT_PERCENTILE,
  DEFAULT_SAFETY_FACTOR,
  computeRightSizing,
  describeMethodology,
  growthFactorFromRate,
  maximumModel,
  percentileLabel,
  percentileModel,
  sensitivity,
} from '@/lib/analytics/rightsizing';

/**
 * A synthetic daily-peak series whose P95 is exactly 275.
 *
 * 275 is chosen so the flagship product example resolves cleanly:
 *   275 × 1.05 growth × 1.10 safety = 317.625 → 318 recommended
 *   400 entitled − 318 recommended = 82 licenses
 *   82 × $5,000 = $410,000 annual opportunity
 *
 * See ANALYTICS_METHODOLOGY.md for why the multiplicative form is normative.
 */
function seriesWithP95(target: number): number[] {
  // 100 observations: ranks 0..99, P95 sits at rank 94.05.
  // Holding values 94 and 95 both at `target` makes the interpolation exact.
  const values: number[] = [];
  for (let i = 0; i < 94; i++) values.push(target - 40 + Math.floor(i / 4));
  values.push(target, target, target, target, target, target);
  return values;
}

describe('percentile right-sizing model', () => {
  const dailyPeaks = seriesWithP95(275);

  it('produces the flagship recommendation from the documented inputs', () => {
    const result = computeRightSizing({
      dailyPeaks,
      entitled: 400,
      percentile: 0.95,
      growthFactor: 1.05,
      safetyFactor: 1.1,
    });

    expect(result.basis).toBe(275);
    expect(result.rawRecommended).toBeCloseTo(317.625, 3);
    expect(result.recommended).toBe(318);
    expect(result.entitled).toBe(400);
    expect(result.quantityDelta).toBe(-82);
    expect(result.surplus).toBe(82);
    expect(result.shortfall).toBe(0);
  });

  it('applies the documented defaults when assumptions are omitted', () => {
    const result = computeRightSizing({ dailyPeaks, entitled: 400 });

    expect(result.assumptions.percentile).toBe(DEFAULT_PERCENTILE);
    expect(result.assumptions.growthFactor).toBe(DEFAULT_GROWTH_FACTOR);
    expect(result.assumptions.safetyFactor).toBe(DEFAULT_SAFETY_FACTOR);
    // 275 × 1.00 × 1.10 = 302.5 → 303
    expect(result.recommended).toBe(303);
  });

  it('is immune to floating-point drift in the multiplication chain', () => {
    // Basis 300 with no growth and a 10% buffer must be 330, never 331.
    const result = computeRightSizing({
      dailyPeaks: [300],
      entitled: 400,
      growthFactor: 1.0,
      safetyFactor: 1.1,
    });
    expect(result.recommended).toBe(330);
  });

  it('reports a shortfall when demand exceeds entitlement', () => {
    const result = computeRightSizing({
      dailyPeaks: seriesWithP95(96),
      entitled: 100,
      safetyFactor: 1.1,
    });
    // 96 × 1.10 = 105.6 → 106
    expect(result.recommended).toBe(106);
    expect(result.shortfall).toBe(6);
    expect(result.surplus).toBe(0);
    expect(result.quantityDelta).toBe(6);
  });

  it('responds to the percentile assumption', () => {
    const base = { dailyPeaks, entitled: 400, growthFactor: 1, safetyFactor: 1 };
    const p90 = computeRightSizing({ ...base, percentile: 0.9 });
    const p95 = computeRightSizing({ ...base, percentile: 0.95 });
    const p99 = computeRightSizing({ ...base, percentile: 0.99 });

    expect(p90.recommended).toBeLessThanOrEqual(p95.recommended);
    expect(p95.recommended).toBeLessThanOrEqual(p99.recommended);
  });

  it('scales monotonically with the safety buffer', () => {
    const base = { dailyPeaks, entitled: 400, percentile: 0.95, growthFactor: 1 };
    const none = computeRightSizing({ ...base, safetyFactor: 1.0 }).recommended;
    const ten = computeRightSizing({ ...base, safetyFactor: 1.1 }).recommended;
    const twenty = computeRightSizing({ ...base, safetyFactor: 1.2 }).recommended;

    expect(none).toBe(275);
    expect(ten).toBe(303);
    expect(twenty).toBe(330);
  });

  it('handles an empty demand series without producing NaN', () => {
    const result = computeRightSizing({ dailyPeaks: [], entitled: 50 });
    expect(result.basis).toBe(0);
    expect(result.recommended).toBe(0);
    expect(result.surplus).toBe(50);
  });

  it('exposes a methodology sentence describing the actual assumptions used', () => {
    const result = computeRightSizing({
      dailyPeaks,
      entitled: 400,
      percentile: 0.95,
      growthFactor: 1.05,
      safetyFactor: 1.1,
    });
    expect(result.methodology).toContain('P95');
    expect(result.methodology).toContain('+5%');
    expect(result.methodology).toContain('10% safety buffer');
  });
});

describe('maximum-observed model', () => {
  it('sizes to the highest observed peak rather than a percentile', () => {
    const result = maximumModel.compute({
      dailyPeaks: [100, 120, 400],
      entitled: 300,
      safetyFactor: 1.0,
      growthFactor: 1.0,
    });
    expect(result.basis).toBe(400);
    expect(result.recommended).toBe(400);
    expect(result.shortfall).toBe(100);
  });

  it('is registered as a selectable alternative to the default', () => {
    const viaRegistry = computeRightSizing({ dailyPeaks: [10, 20, 30], entitled: 10 }, maximumModel.id);
    expect(viaRegistry.basis).toBe(30);
  });

  it('falls back to the default model for an unknown method id', () => {
    const result = computeRightSizing({ dailyPeaks: [10, 20, 30], entitled: 10 }, 'does-not-exist');
    expect(result.assumptions.percentile).toBe(percentileModel.compute({ dailyPeaks: [1], entitled: 1 }).assumptions.percentile);
  });
});

describe('assumption labelling', () => {
  it('labels percentiles the way a license administrator writes them', () => {
    expect(percentileLabel(0.9)).toBe('P90');
    expect(percentileLabel(0.95)).toBe('P95');
    expect(percentileLabel(0.99)).toBe('P99');
    expect(percentileLabel(1)).toBe('Maximum');
  });

  it('states "no assumed growth" rather than "+0% growth"', () => {
    const text = describeMethodology({
      percentile: 0.95,
      growthFactor: 1,
      safetyFactor: 1.1,
      periodKey: '12m',
    });
    expect(text).toContain('no assumed growth');
  });

  it('converts a growth rate to a growth factor', () => {
    expect(growthFactorFromRate(0.05)).toBeCloseTo(1.05, 10);
    expect(growthFactorFromRate(-0.1)).toBeCloseTo(0.9, 10);
  });
});

describe('sensitivity', () => {
  it('reports how each assumption moves the recommendation', () => {
    const rows = sensitivity({
      dailyPeaks: seriesWithP95(275),
      entitled: 400,
      percentile: 0.95,
      growthFactor: 1,
      safetyFactor: 1.1,
    });

    const noBuffer = rows.find((r) => r.label === 'No safety buffer');
    expect(noBuffer?.recommended).toBe(275);
    expect(noBuffer?.delta).toBe(-28);

    const p99 = rows.find((r) => r.label === 'P99 instead of P95');
    expect(p99?.delta).toBeGreaterThanOrEqual(0);
  });
});
