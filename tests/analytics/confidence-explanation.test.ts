import { describe, expect, it } from 'vitest';
import { computeConfidence } from '@/lib/analytics/confidence';
import { explainConfidence } from '@/lib/analytics/confidence-explanation';

/**
 * A confidence badge that a customer cannot act on is decoration.
 *
 * The Phase 2C production estate reported Low confidence on a $245,000
 * recommendation because the export covered 130 of 365 days. Correct — and it
 * told the reader nothing about whether to trust the number, what would fix it,
 * or what the gap had already been assumed to mean.
 */

const FULL = {
  observedDays: 260,
  windowDays: 365,
  hasPrice: true,
  employeeMappingRate: 0.99,
  featureMappingRate: 1,
  hasDenialData: true,
  hasForecastInput: true,
};

describe('explaining a partial observation window', () => {
  const explanation = explainConfidence(
    computeConfidence({ ...FULL, observedDays: 130, hasDenialData: false, hasForecastInput: false }),
  );

  it('quotes the history in the customer\u2019s own units', () => {
    expect(explanation.observedHistory).toContain('130 of the requested 365 days');
    expect(explanation.observedHistory).toContain('36%');
  });

  it('refuses the reading that would under-provision them', () => {
    // The single most important sentence in the product.
    const text = explanation.notAssuming.join(' ');
    expect(text).toContain('NOT assumed the 235 unobserved days had zero demand');
    expect(text).toContain('understate what you need to buy');
  });

  it('says what would raise it, concretely', () => {
    expect(explanation.improve.join(' ')).toContain('remaining 235 days');
  });

  it('does not hide the recommendation behind the caveat', () => {
    expect(explanation.summary).toContain('Low confidence');
    expect(explanation.summary).toContain('before using this as a final renewal position');
  });

  it('names denial blindness as a floor, not a ceiling', () => {
    expect(explanation.notAssuming.join(' ')).toContain('floor on true demand, not a ceiling');
  });
});

describe('explaining a complete window', () => {
  const explanation = explainConfidence(computeConfidence(FULL));

  it('states that no demand was inferred', () => {
    expect(explanation.observedHistory).toContain('260 of the requested 365 days');
    expect(explanation.improve.join(' ')).toContain('remaining 105 days');
  });

  it('still says what is not being assumed', () => {
    // Never empty: the reader should not have to guess on a good day either.
    expect(explanation.notAssuming.length).toBeGreaterThan(0);
    expect(explanation.notAssuming.join(' ')).toContain('traces to a row in a file you supplied');
  });
});

describe('explaining an unpriced feature', () => {
  const explanation = explainConfidence(computeConfidence({ ...FULL, hasPrice: false }));

  it('refuses to substitute a benchmark price', () => {
    expect(explanation.notAssuming.join(' ')).toContain('no benchmark or list price has been substituted');
  });

  it('asks for the contract rather than guessing', () => {
    expect(explanation.improve.join(' ')).toContain('contract or price list');
  });
});

describe('a high-confidence result', () => {
  const explanation = explainConfidence(
    computeConfidence({ ...FULL, observedDays: 365 }),
  );

  it('never shows an empty reason list', () => {
    expect(explanation.why.length).toBeGreaterThan(0);
  });

  it('confirms the window is complete rather than staying silent', () => {
    expect(explanation.notAssuming.join(' ')).toContain('observation window is complete');
  });
});

describe('an aggregate with no single window', () => {
  it('explains without inventing an observation period', () => {
    const explanation = explainConfidence({
      level: 'Medium', score: 62, reasons: [], evidence: null,
    });
    expect(explanation.observedHistory).toBeNull();
    expect(explanation.notAssuming.length).toBeGreaterThan(0);
  });
});
