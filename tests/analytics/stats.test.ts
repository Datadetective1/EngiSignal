import { describe, expect, it } from 'vitest';
import {
  ceilPrecise,
  clamp,
  coefficientOfVariation,
  linearSlope,
  max,
  mean,
  median,
  min,
  percentile,
  round,
  safeDivide,
  stdDev,
  sum,
  trendPercentPerYear,
} from '@/lib/analytics/stats';

describe('ceilPrecise', () => {
  it('does not add a license because of floating-point drift', () => {
    // 100 * 1.0 * 1.1 === 110.00000000000001 in IEEE-754, so a naive Math.ceil
    // recommends 111 — one extra license, entirely a rounding artifact.
    expect(100 * 1.0 * 1.1).toBeGreaterThan(110);
    expect(Math.ceil(100 * 1.0 * 1.1)).toBe(111); // the bug this guards against
    expect(ceilPrecise(100 * 1.0 * 1.1)).toBe(110);
  });

  it('holds for every peak value that drifts under a 10% safety buffer', () => {
    // These are the P95 values in 1..500 where naive ceiling over-recommends.
    for (const peak of [50, 90, 100, 110, 170, 180, 190, 200, 210, 220]) {
      const product = peak * 1.0 * 1.1;
      const correct = Math.round(peak * 1.1);
      expect(Math.ceil(product)).toBe(correct + 1); // naive result over-recommends
      expect(ceilPrecise(product)).toBe(correct);
    }
  });

  it('still rounds up a genuine fractional remainder', () => {
    expect(ceilPrecise(330.0001)).toBe(331);
    expect(ceilPrecise(317.4)).toBe(318);
    expect(ceilPrecise(318.78)).toBe(319);
  });

  it('handles exact integers and zero', () => {
    expect(ceilPrecise(42)).toBe(42);
    expect(ceilPrecise(0)).toBe(0);
  });

  it('returns 0 for non-finite input rather than propagating NaN', () => {
    expect(ceilPrecise(Number.NaN)).toBe(0);
    expect(ceilPrecise(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('percentile', () => {
  // Reference values computed with Excel PERCENTILE.INC / NumPy default.
  const series = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it('matches PERCENTILE.INC on a known series', () => {
    expect(percentile(series, 0.5)).toBe(5.5);
    expect(percentile(series, 0.9)).toBeCloseTo(9.1, 10);
    expect(percentile(series, 0.95)).toBeCloseTo(9.55, 10);
    expect(percentile(series, 0.99)).toBeCloseTo(9.91, 10);
  });

  it('returns the extremes at p=0 and p=1', () => {
    expect(percentile(series, 0)).toBe(1);
    expect(percentile(series, 1)).toBe(10);
  });

  it('does not require sorted input and does not mutate the caller array', () => {
    const unsorted = [10, 3, 7, 1, 9];
    const copy = [...unsorted];
    expect(percentile(unsorted, 0.5)).toBe(7);
    expect(unsorted).toEqual(copy);
  });

  it('handles empty and single-element series', () => {
    expect(percentile([], 0.95)).toBe(0);
    expect(percentile([276], 0.95)).toBe(276);
    expect(percentile([276], 0.5)).toBe(276);
  });

  it('clamps out-of-range percentiles instead of producing garbage', () => {
    expect(percentile(series, -1)).toBe(1);
    expect(percentile(series, 5)).toBe(10);
  });

  it('interpolates between ranks rather than picking a nearest observation', () => {
    // With 4 values, P95 sits at rank 0.95 * 3 = 2.85, i.e. 85% of the way
    // from the third value (30) to the fourth (40).
    expect(percentile([10, 20, 30, 40], 0.95)).toBeCloseTo(38.5, 10);
  });
});

describe('median', () => {
  it('averages the middle pair for even-length series', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('returns the middle value for odd-length series', () => {
    expect(median([5, 1, 3])).toBe(3);
  });
});

describe('basic aggregates', () => {
  it('computes sum, mean, max and min', () => {
    expect(sum([1, 2, 3])).toBe(6);
    expect(mean([2, 4, 6])).toBe(4);
    expect(max([2, 9, 4])).toBe(9);
    expect(min([2, 9, 4])).toBe(2);
  });

  it('returns 0 rather than NaN or Infinity for empty input', () => {
    expect(mean([])).toBe(0);
    expect(max([])).toBe(0);
    expect(min([])).toBe(0);
  });
});

describe('stdDev', () => {
  it('uses the sample (n-1) denominator', () => {
    // Population sd of [2,4,4,4,5,5,7,9] is 2; sample sd is ~2.138.
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
  });

  it('is 0 for fewer than two observations', () => {
    expect(stdDev([])).toBe(0);
    expect(stdDev([5])).toBe(0);
  });

  it('is 0 for a constant series', () => {
    expect(stdDev([7, 7, 7, 7])).toBe(0);
  });
});

describe('coefficientOfVariation', () => {
  it('is dimensionless, so two differently scaled series compare equally', () => {
    const small = [10, 12, 14, 16];
    const large = small.map((v) => v * 100);
    expect(coefficientOfVariation(small)).toBeCloseTo(coefficientOfVariation(large), 10);
  });

  it('returns 0 when the mean is 0', () => {
    expect(coefficientOfVariation([0, 0, 0])).toBe(0);
  });
});

describe('linearSlope', () => {
  it('recovers the slope of a perfect line', () => {
    expect(linearSlope([0, 2, 4, 6, 8])).toBeCloseTo(2, 10);
  });

  it('is 0 for a flat series', () => {
    expect(linearSlope([5, 5, 5, 5])).toBe(0);
  });

  it('is negative for a declining series', () => {
    expect(linearSlope([10, 8, 6, 4])).toBeCloseTo(-2, 10);
  });
});

describe('trendPercentPerYear', () => {
  it('annualizes a daily slope against the series mean', () => {
    // 365 days rising 1 unit/day from 100: slope 1/day, mean ~282.
    const series = Array.from({ length: 365 }, (_, i) => 100 + i);
    expect(trendPercentPerYear(series)).toBeCloseTo((1 * 365) / mean(series) * 100, 6);
  });

  it('returns 0 when the mean is 0 rather than dividing by zero', () => {
    expect(trendPercentPerYear([0, 0, 0])).toBe(0);
  });

  it('returns 0 for series too short to fit a trend', () => {
    expect(trendPercentPerYear([5])).toBe(0);
  });
});

describe('helpers', () => {
  it('rounds to a fixed precision', () => {
    expect(round(1.23456, 2)).toBe(1.23);
    expect(round(1.005, 2)).toBe(1.0);
  });

  it('clamps into range', () => {
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('returns null from safeDivide instead of Infinity or NaN', () => {
    expect(safeDivide(10, 0)).toBeNull();
    expect(safeDivide(10, 2)).toBe(5);
  });
});
