import { describe, expect, it } from 'vitest';
import { analyticsAvailable, checkIntegrity } from '@/lib/analytics/integrity';

/**
 * ── WHAT A CUSTOMER IS TOLD WHILE THEIR DATA IS BEING ANALYSED ──────────────
 *
 * Phase 2F introduced a state the product had never had: the evidence is
 * durably stored and complete, and the analysis of it does not exist yet.
 *
 * The first production run got this wrong in the most damaging way available.
 * A tenant with 317,936 rows safely imported and a build still running was
 * shown the truncation alarm:
 *
 *   "EngiSignal did not read all of your data"
 *   "317,936 of 317,936 stored usage rows were not read into this analysis"
 *
 * Both sentences were false. Every row had been read and stored; what had not
 * happened was the analysis. The alarm exists to mean "these numbers cannot be
 * trusted", and firing it on a healthy import is how an alarm stops being
 * believed — which then costs somebody the one time it is real.
 */

const counts = { usage: 317_936, people: 2_003, entitlements: 12, contracts: 11 };
const none = { usage: 0, people: 0, entitlements: 0, contracts: 0 };

describe('a tenant whose analysis is still building', () => {
  const report = checkIntegrity({
    accepted: counts,
    // The comparison is made against the stored counts, because the readable
    // analysis describes a different, earlier estate and comparing the two
    // would be comparing two different questions.
    stored: counts,
    analyzed: counts,
    analysis: 'building',
  });

  it('does not claim rows are missing', () => {
    expect(report.usageIncomplete).toBe(false);
    expect(report.complete).toBe(true);
  });

  it('still refuses to show figures', () => {
    // The rows reconcile; the analysis is not finished. Both have to hold.
    expect(report.analysisCurrent).toBe(false);
    expect(analyticsAvailable(report)).toBe(false);
  });

  it('says which of the two it is', () => {
    expect(report.analysisState).toBe('building');
  });
});

describe('a tenant shown an earlier analysis while the new one builds', () => {
  const report = checkIntegrity({
    accepted: counts,
    stored: counts,
    analyzed: counts,
    analysis: 'superseded',
  });

  it('withholds figures rather than presenting them as current', () => {
    expect(analyticsAvailable(report)).toBe(false);
    expect(report.analysisState).toBe('superseded');
  });

  it('does not raise the truncation alarm', () => {
    expect(report.usageIncomplete).toBe(false);
  });
});

describe('a tenant whose build failed', () => {
  const report = checkIntegrity({
    accepted: counts,
    stored: counts,
    analyzed: counts,
    analysis: 'failed',
  });

  it('withholds figures and names the state', () => {
    expect(analyticsAvailable(report)).toBe(false);
    expect(report.analysisState).toBe('failed');
  });
});

describe('the truncation alarm still works when it should', () => {
  it('fires when the analysis IS current and rows are genuinely short', () => {
    // The Phase 2C defect. Nothing about the build lifecycle may weaken this.
    const report = checkIntegrity({
      accepted: counts,
      stored: counts,
      analyzed: { ...counts, usage: 1_000 },
      analysis: 'current',
    });

    expect(report.usageIncomplete).toBe(true);
    expect(analyticsAvailable(report)).toBe(false);
    expect(report.datasets.find((d) => d.dataset === 'usage')?.statement).toContain(
      'were not read into this analysis',
    );
  });

  it('shows figures only when the rows reconcile AND the analysis is current', () => {
    const report = checkIntegrity({
      accepted: counts,
      stored: counts,
      analyzed: counts,
      analysis: 'current',
    });
    expect(analyticsAvailable(report)).toBe(true);
  });

  it('treats an absent analysis as not showable, not as an empty estate', () => {
    // A brand new tenant mid-first-build. Zero features and not-yet-counted
    // look identical on a page and only one of them is true.
    const report = checkIntegrity({
      accepted: counts,
      stored: counts,
      analyzed: none,
      analysis: 'absent',
    });
    expect(analyticsAvailable(report)).toBe(false);
    expect(report.analysisState).toBe('absent');
  });
});

describe('callers with no asynchronous build', () => {
  it('default to current, so nothing that existed before changed meaning', () => {
    const report = checkIntegrity({ accepted: counts, stored: counts, analyzed: counts });
    expect(report.analysisState).toBe('current');
    expect(analyticsAvailable(report)).toBe(true);
  });
});
