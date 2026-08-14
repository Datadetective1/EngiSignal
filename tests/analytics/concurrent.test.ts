import { describe, expect, it } from 'vitest';
import {
  aggregateHourlyToDaily,
  capacityRisk,
  computeConcurrentMetrics,
  dailySeriesForFeature,
  hourlyProfile,
  monthlyPeakSeries,
} from '@/lib/analytics/concurrent';
import { buildWindow } from '@/lib/analytics/dates';
import type { DailyUsage, HourlyUsage } from '@/lib/domain/types';

function hourly(featureId: string, date: string, values: number[]): HourlyUsage[] {
  return values.map((concurrent, hour) => ({ featureId, date, hour, concurrent }));
}

describe('aggregateHourlyToDaily', () => {
  it('takes the daily peak as the maximum hourly concurrent demand', () => {
    const rows = hourly('f1', '2026-03-02', [4, 9, 12, 7, 3]);
    const daily = aggregateHourlyToDaily(rows);

    expect(daily).toHaveLength(1);
    expect(daily[0]?.peak).toBe(12);
  });

  it('computes mean concurrency across observed hours only', () => {
    const daily = aggregateHourlyToDaily(hourly('f1', '2026-03-02', [4, 8]));
    expect(daily[0]?.meanConcurrent).toBe(6);
  });

  it('sums license-hours consumed', () => {
    const daily = aggregateHourlyToDaily(hourly('f1', '2026-03-02', [4, 8, 3]));
    expect(daily[0]?.usageHours).toBe(15);
  });

  it('separates features and dates into distinct rows', () => {
    const rows = [
      ...hourly('f1', '2026-03-02', [5]),
      ...hourly('f1', '2026-03-03', [9]),
      ...hourly('f2', '2026-03-02', [2]),
    ];
    const daily = aggregateHourlyToDaily(rows);
    expect(daily).toHaveLength(3);
    expect(daily.find((d) => d.featureId === 'f1' && d.date === '2026-03-03')?.peak).toBe(9);
    expect(daily.find((d) => d.featureId === 'f2')?.peak).toBe(2);
  });

  it('returns an empty result for empty input', () => {
    expect(aggregateHourlyToDaily([])).toEqual([]);
  });

  it('returns rows in a stable order', () => {
    const rows = [...hourly('f2', '2026-03-05', [1]), ...hourly('f1', '2026-03-01', [1])];
    const daily = aggregateHourlyToDaily(rows);
    expect(daily.map((d) => d.featureId)).toEqual(['f1', 'f2']);
  });
});

describe('computeConcurrentMetrics', () => {
  const window = buildWindow('2026-03-31', '3m'); // 90 days ending 2026-03-31

  function dailyRun(peaks: number[], startDate = '2026-03-01'): DailyUsage[] {
    return peaks.map((peak, index) => {
      const day = String(index + 1).padStart(2, '0');
      void startDate;
      return {
        featureId: 'f1',
        date: `2026-03-${day}`,
        peak,
        meanConcurrent: peak / 2,
        usageHours: peak * 8,
        uniqueUsers: peak,
      };
    });
  }

  it('summarizes the distribution of daily peaks', () => {
    const daily = dailyRun([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    const metrics = computeConcurrentMetrics({ featureId: 'f1', daily, window, entitled: 120 });

    expect(metrics.observedDays).toBe(10);
    expect(metrics.mean).toBe(55);
    expect(metrics.median).toBe(55);
    expect(metrics.max).toBe(100);
    expect(metrics.min).toBe(10);
    expect(metrics.p95).toBeCloseTo(95.5, 6);
  });

  it('counts days where demand met or exceeded entitlement as saturated', () => {
    const daily = dailyRun([90, 100, 100, 101, 50]);
    const metrics = computeConcurrentMetrics({ featureId: 'f1', daily, window, entitled: 100 });

    expect(metrics.saturationDays).toBe(3);
    expect(metrics.saturationPct).toBe(60);
  });

  it('derives utilization from P95 against entitlement', () => {
    const daily = dailyRun([50, 50, 50, 50, 50]);
    const metrics = computeConcurrentMetrics({ featureId: 'f1', daily, window, entitled: 100 });

    expect(metrics.p95).toBe(50);
    expect(metrics.utilizationPct).toBe(50);
    expect(metrics.availableCapacity).toBe(50);
  });

  it('reports negative available capacity when structurally short', () => {
    const daily = dailyRun([120, 120, 120]);
    const metrics = computeConcurrentMetrics({ featureId: 'f1', daily, window, entitled: 100 });
    expect(metrics.availableCapacity).toBe(-20);
  });

  it('counts calendar days with no observation as missing', () => {
    const daily = dailyRun([10, 20, 30]);
    const metrics = computeConcurrentMetrics({ featureId: 'f1', daily, window, entitled: 50 });
    expect(metrics.observedDays).toBe(3);
    expect(metrics.missingDays).toBe(87);
  });

  it('excludes dates outside the analysis window', () => {
    const daily: DailyUsage[] = [
      { featureId: 'f1', date: '2025-01-01', peak: 999, meanConcurrent: 0, usageHours: 0, uniqueUsers: 0 },
      { featureId: 'f1', date: '2026-03-15', peak: 10, meanConcurrent: 0, usageHours: 0, uniqueUsers: 0 },
    ];
    const metrics = computeConcurrentMetrics({ featureId: 'f1', daily, window, entitled: 50 });
    expect(metrics.observedDays).toBe(1);
    expect(metrics.max).toBe(10);
  });

  it('ignores rows belonging to other features', () => {
    const daily: DailyUsage[] = [
      { featureId: 'other', date: '2026-03-15', peak: 999, meanConcurrent: 0, usageHours: 0, uniqueUsers: 0 },
      { featureId: 'f1', date: '2026-03-15', peak: 10, meanConcurrent: 0, usageHours: 0, uniqueUsers: 0 },
    ];
    const metrics = computeConcurrentMetrics({ featureId: 'f1', daily, window, entitled: 50 });
    expect(metrics.observedDays).toBe(1);
  });

  it('produces zeroed metrics rather than NaN when no data exists', () => {
    const metrics = computeConcurrentMetrics({ featureId: 'f1', daily: [], window, entitled: 0 });
    expect(metrics.p95).toBe(0);
    expect(metrics.utilizationPct).toBe(0);
    expect(metrics.saturationPct).toBe(0);
    expect(Number.isNaN(metrics.mean)).toBe(false);
  });

  it('does not divide by zero when entitlement is unknown', () => {
    const metrics = computeConcurrentMetrics({ featureId: 'f1', daily: dailyRun([10, 20]), window, entitled: 0 });
    expect(metrics.utilizationPct).toBe(0);
    expect(metrics.saturationDays).toBe(0);
  });
});

describe('capacityRisk', () => {
  const window = buildWindow('2026-03-31', '12m');
  function metricsWith(overrides: Partial<ReturnType<typeof computeConcurrentMetrics>>) {
    return {
      featureId: 'f1',
      window,
      observedDays: 365,
      missingDays: 0,
      mean: 50,
      median: 50,
      p90: 60,
      p95: 70,
      p99: 80,
      max: 85,
      min: 10,
      stdDev: 5,
      volatility: 0.1,
      trendPctPerYear: 0,
      entitled: 100,
      utilizationPct: 70,
      saturationDays: 0,
      saturationPct: 0,
      availableCapacity: 30,
      ...overrides,
    };
  }

  it('is Low for comfortable headroom', () => {
    expect(capacityRisk(metricsWith({ utilizationPct: 55, max: 70 }))).toBe('Low');
  });

  it('escalates to Moderate when the observed maximum touches entitlement', () => {
    expect(capacityRisk(metricsWith({ utilizationPct: 70, max: 100 }))).toBe('Moderate');
  });

  it('escalates to High at heavy utilization', () => {
    expect(capacityRisk(metricsWith({ utilizationPct: 94, max: 99 }))).toBe('High');
  });

  it('escalates to Critical when demand regularly saturates capacity', () => {
    expect(capacityRisk(metricsWith({ utilizationPct: 99, saturationPct: 12 }))).toBe('Critical');
  });

  it('is Low when entitlement is unknown, rather than falsely alarming', () => {
    expect(capacityRisk(metricsWith({ entitled: 0, utilizationPct: 0 }))).toBe('Low');
  });
});

describe('series helpers', () => {
  const window = buildWindow('2026-03-31', '12m');

  it('filters and sorts a feature series by date', () => {
    const daily: DailyUsage[] = [
      { featureId: 'f1', date: '2026-03-10', peak: 2, meanConcurrent: 0, usageHours: 0, uniqueUsers: 0 },
      { featureId: 'f1', date: '2026-03-01', peak: 1, meanConcurrent: 0, usageHours: 0, uniqueUsers: 0 },
    ];
    const series = dailySeriesForFeature(daily, 'f1', window);
    expect(series.map((d) => d.date)).toEqual(['2026-03-01', '2026-03-10']);
  });

  it('builds a monthly peak series', () => {
    const daily: DailyUsage[] = [
      { featureId: 'f1', date: '2026-02-01', peak: 10, meanConcurrent: 0, usageHours: 0, uniqueUsers: 0 },
      { featureId: 'f1', date: '2026-02-02', peak: 20, meanConcurrent: 0, usageHours: 0, uniqueUsers: 0 },
      { featureId: 'f1', date: '2026-03-01', peak: 40, meanConcurrent: 0, usageHours: 0, uniqueUsers: 0 },
    ];
    const series = monthlyPeakSeries(daily, 'f1', window);
    expect(series).toEqual([
      { month: '2026-02', meanPeak: 15, maxPeak: 20 },
      { month: '2026-03', meanPeak: 40, maxPeak: 40 },
    ]);
  });

  it('averages concurrency by hour of day', () => {
    const rows = [
      ...hourly('f1', '2026-03-01', [10, 20]),
      ...hourly('f1', '2026-03-02', [30, 40]),
    ];
    const profile = hourlyProfile(rows, 'f1');
    expect(profile[0]).toBe(20);
    expect(profile[1]).toBe(30);
    expect(profile[5]).toBe(0);
    expect(profile).toHaveLength(24);
  });
});
