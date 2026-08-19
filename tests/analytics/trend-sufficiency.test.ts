import { describe, expect, it } from 'vitest';
import {
  INSUFFICIENT_TREND_LABEL,
  MINIMUM_TREND_HISTORY_DAYS,
  annualizedTrend,
  hasEnoughTrendHistory,
  trendForProjection,
} from '@/lib/analytics/trend';
import { usageSignals } from '@/lib/analytics/signals';
import type { PortfolioRow } from '@/lib/domain/types';

/**
 * ── THE FIGURE THAT ENDED A MEETING ─────────────────────────────────────────
 *
 * A pilot customer imported three days of usage and the executive brief said:
 *
 *     "Daily peak demand is trending down 24333.3% per year."
 *
 * The regression was not wrong. Two observations three days apart really do
 * imply that slope. The mistake was answering at all — and then compounding it,
 * because the same raw slope also fed capacity projections and the
 * spend-weighted trend across a whole agreement.
 *
 * The threshold is thirty calendar days: the shortest window spanning a full
 * monthly cycle of engineering work, so a slope measured across it reflects a
 * repeating rhythm rather than one unusual week.
 *
 * These are the cases named in the hardening brief: 3, 7, 29, 30 and mature.
 */

const metrics = (observedDays: number, trendPctPerYear: number) => ({ observedDays, trendPctPerYear });

describe('the minimum history threshold', () => {
  it('is thirty calendar days', () => {
    expect(MINIMUM_TREND_HISTORY_DAYS).toBe(30);
  });

  it.each([
    ['3 days — the case found in production', 3, false],
    ['7 days', 7, false],
    ['29 days — one short', 29, false],
    ['30 days — exactly the threshold', 30, true],
    ['365 days — mature history', 365, true],
  ])('%s', (_label, days, sufficient) => {
    expect(hasEnoughTrendHistory(metrics(days, 24_333.3))).toBe(sufficient);
  });
});

describe('the annualized trend a surface may show', () => {
  it('is withheld at three days, however precise the arithmetic', () => {
    expect(annualizedTrend(metrics(3, -24_333.3))).toBeNull();
  });

  it('is withheld at twenty-nine days', () => {
    expect(annualizedTrend(metrics(29, 42))).toBeNull();
  });

  it('is reported unchanged at thirty days', () => {
    expect(annualizedTrend(metrics(30, 12.4))).toBe(12.4);
  });

  it('is reported unchanged on mature history — the algorithm is untouched', () => {
    // The guard decides whether to answer, never what the answer is.
    expect(annualizedTrend(metrics(365, -8.6))).toBe(-8.6);
    expect(annualizedTrend(metrics(365, 137.2))).toBe(137.2);
  });

  it('treats absent metrics as unanswerable rather than zero', () => {
    expect(annualizedTrend(null)).toBeNull();
    expect(annualizedTrend(undefined)).toBeNull();
  });

  it('refuses a non-finite slope even when history is long', () => {
    expect(annualizedTrend(metrics(365, Number.POSITIVE_INFINITY))).toBeNull();
    expect(annualizedTrend(metrics(365, NaN))).toBeNull();
  });
});

describe('what a projection multiplies by', () => {
  it('assumes no growth when history is too short', () => {
    // Not the raw slope: a projection has to multiply by something, and
    // compounding 24,333% produces a confident number built on three days.
    expect(trendForProjection(metrics(3, 24_333.3))).toBe(0);
    expect(trendForProjection(metrics(29, 500))).toBe(0);
  });

  it('uses the observed trend once history supports it', () => {
    expect(trendForProjection(metrics(30, 12.4))).toBe(12.4);
    expect(trendForProjection(metrics(365, -8.6))).toBe(-8.6);
  });
});

// ── The surface where it was found ──────────────────────────────────────────

const row = (observedDays: number, trendPctPerYear: number): PortfolioRow =>
  ({
    featureId: 'f1',
    featureName: 'ANSYS_CFD',
    productName: 'ANSYS CFD',
    daysToRenewal: 90,
    confidence: { level: 'Low', score: 10 },
    financial: { incrementalSpend: null, optimizationOpportunity: null, currentAnnualCost: 1000 },
    metrics: {
      observedDays,
      trendPctPerYear,
      p95: 3,
      entitled: 10,
      utilizationPct: 30,
      saturationDays: 0,
      max: 4,
      volatility: 0.2,
    },
  }) as unknown as PortfolioRow;

describe('the usage signal that reached the brief', () => {
  it('is not raised from three days of history', () => {
    expect(usageSignals([row(3, -24_333.3)])).toHaveLength(0);
  });

  it('is not raised at twenty-nine days', () => {
    expect(usageSignals([row(29, -80)])).toHaveLength(0);
  });

  it('is raised, with its real figure, once history supports it', () => {
    const signals = usageSignals([row(365, -42.5)]);
    expect(signals).toHaveLength(1);
    expect(signals[0]!.subtitle).toContain('42.5%');
    expect(signals[0]!.subtitle).toContain('down');
    // And never the unsupported figure that started this.
    expect(signals[0]!.subtitle).not.toContain('24333');
  });

  it('still ignores a movement too small to be worth raising', () => {
    // The pre-existing 25% materiality rule is unchanged.
    expect(usageSignals([row(365, 4)])).toHaveLength(0);
  });
});

describe('the neutral state', () => {
  it('says what is missing rather than implying flat demand', () => {
    expect(INSUFFICIENT_TREND_LABEL).toBe('Not enough history to calculate trend');
    expect(INSUFFICIENT_TREND_LABEL).not.toMatch(/0%|flat|stable/i);
  });
});
