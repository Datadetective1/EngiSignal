import { describe, expect, it } from 'vitest';
import { classifyDenialRisk, computeDenialMetrics, denialsByGroup, denialsByHour } from '@/lib/analytics/denials';
import { buildWindow } from '@/lib/analytics/dates';
import type { DenialEvent } from '@/lib/domain/types';

const window = buildWindow('2026-06-30', '12m');

function denial(overrides: Partial<DenialEvent> = {}): DenialEvent {
  return {
    id: Math.random().toString(36).slice(2),
    organizationId: 'org1',
    featureId: 'f1',
    date: '2026-05-01',
    hour: 10,
    employeeId: 'e1',
    count: 1,
    concurrentAtDenial: 100,
    availableAtDenial: 0,
    ...overrides,
  };
}

describe('computeDenialMetrics', () => {
  it('reports a clean Low result when no denials occurred', () => {
    const metrics = computeDenialMetrics({
      featureId: 'f1',
      denials: [],
      window,
      observedDays: 365,
      entitled: 100,
    });

    expect(metrics.totalDenials).toBe(0);
    expect(metrics.risk).toBe('Low');
    expect(metrics.riskRationale).toContain('No denials recorded');
  });

  it('counts denial events, days and distinct users', () => {
    const metrics = computeDenialMetrics({
      featureId: 'f1',
      denials: [
        denial({ date: '2026-05-01', employeeId: 'e1', count: 2 }),
        denial({ date: '2026-05-01', employeeId: 'e2', count: 1 }),
        denial({ date: '2026-05-08', employeeId: 'e3', count: 4 }),
      ],
      window,
      observedDays: 365,
      entitled: 100,
    });

    expect(metrics.totalDenials).toBe(7);
    expect(metrics.denialDays).toBe(2);
    expect(metrics.distinctUsers).toBe(3);
    expect(metrics.firstDenial).toBe('2026-05-01');
    expect(metrics.lastDenial).toBe('2026-05-08');
  });

  it('excludes denials outside the window and for other features', () => {
    const metrics = computeDenialMetrics({
      featureId: 'f1',
      denials: [
        denial({ date: '2020-01-01' }),
        denial({ featureId: 'other', date: '2026-05-01' }),
        denial({ date: '2026-05-01' }),
      ],
      window,
      observedDays: 365,
      entitled: 100,
    });
    expect(metrics.totalDenials).toBe(1);
  });

  it('identifies the peak denial hour', () => {
    const metrics = computeDenialMetrics({
      featureId: 'f1',
      denials: [
        denial({ hour: 9, count: 1 }),
        denial({ hour: 14, count: 5, date: '2026-05-02' }),
        denial({ hour: 14, count: 3, date: '2026-05-03' }),
      ],
      window,
      observedDays: 365,
      entitled: 100,
    });
    expect(metrics.peakHour).toBe(14);
  });
});

describe('classifyDenialRisk — the guards that keep denials honest', () => {
  it('downgrades denials that occurred while capacity was NOT exhausted', () => {
    // 40 concurrent against 100 entitled: buying licenses would not have helped.
    const { risk, rationale } = classifyDenialRisk({
      denialDays: 30,
      denialDayRate: 0.3,
      concentration: 0.1,
      distinctUsers: 20,
      totalDenials: 200,
      meanConcurrentAtDenial: 40,
      entitled: 100,
    });

    expect(risk).toBe('Low');
    expect(rationale).toContain('licensing rules');
    expect(rationale).toContain('would not resolve');
  });

  it('downgrades a single-day burst from one or two users as a retry loop', () => {
    const { risk, rationale } = classifyDenialRisk({
      denialDays: 1,
      denialDayRate: 0.003,
      concentration: 0.95,
      distinctUsers: 1,
      totalDenials: 140,
      meanConcurrentAtDenial: 100,
      entitled: 100,
    });

    expect(risk).toBe('Low');
    expect(rationale).toContain('retry burst');
  });

  it('escalates to Critical for frequent denials across many users at capacity', () => {
    const { risk } = classifyDenialRisk({
      denialDays: 60,
      denialDayRate: 0.2,
      concentration: 0.05,
      distinctUsers: 25,
      totalDenials: 400,
      meanConcurrentAtDenial: 100,
      entitled: 100,
    });
    expect(risk).toBe('Critical');
  });

  it('rates recurring but less frequent denials as High', () => {
    const { risk } = classifyDenialRisk({
      denialDays: 30,
      denialDayRate: 0.08,
      concentration: 0.1,
      distinctUsers: 12,
      totalDenials: 90,
      meanConcurrentAtDenial: 99,
      entitled: 100,
    });
    expect(risk).toBe('High');
  });

  it('rates occasional denials as Moderate', () => {
    const { risk } = classifyDenialRisk({
      denialDays: 3,
      denialDayRate: 0.01,
      concentration: 0.4,
      distinctUsers: 4,
      totalDenials: 9,
      meanConcurrentAtDenial: 98,
      entitled: 100,
    });
    expect(risk).toBe('Moderate');
  });

  it('rates a truly isolated denial as Low', () => {
    const { risk } = classifyDenialRisk({
      denialDays: 1,
      denialDayRate: 0.003,
      concentration: 1,
      distinctUsers: 5,
      totalDenials: 5,
      meanConcurrentAtDenial: 100,
      entitled: 100,
    });
    expect(risk).toBe('Low');
  });

  it('does not downgrade when capacity context is unavailable', () => {
    const { risk } = classifyDenialRisk({
      denialDays: 40,
      denialDayRate: 0.2,
      concentration: 0.05,
      distinctUsers: 15,
      totalDenials: 300,
      meanConcurrentAtDenial: null,
      entitled: 100,
    });
    expect(risk).toBe('Critical');
  });
});

describe('denial breakdowns', () => {
  it('groups denial counts by hour of day', () => {
    const hours = denialsByHour(
      [denial({ hour: 9, count: 2 }), denial({ hour: 9, count: 1 }), denial({ hour: 16, count: 5 })],
      'f1',
    );
    expect(hours[9]).toBe(3);
    expect(hours[16]).toBe(5);
    expect(hours).toHaveLength(24);
  });

  it('groups denials by an organizational key, sorted by volume', () => {
    const groups = denialsByGroup(
      [
        denial({ employeeId: 'e1', count: 1 }),
        denial({ employeeId: 'e2', count: 5 }),
        denial({ employeeId: null, count: 2 }),
      ],
      'f1',
      (employeeId) => (employeeId === 'e1' ? 'Structures' : employeeId === 'e2' ? 'Thermal' : null),
    );

    expect(groups[0]).toEqual({ group: 'Thermal', count: 5 });
    expect(groups.find((g) => g.group === 'Unattributed')?.count).toBe(2);
  });
});
