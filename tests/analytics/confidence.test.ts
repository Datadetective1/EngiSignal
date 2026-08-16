import { describe, expect, it } from 'vitest';
import {
  aggregateConfidence,
  computeConfidence,
  confidenceWeight,
  levelFromScore,
  type ConfidenceInput,
} from '@/lib/analytics/confidence';

const IDEAL: ConfidenceInput = {
  observedDays: 365,
  windowDays: 365,
  hasPrice: true,
  employeeMappingRate: 0.99,
  featureMappingRate: 1,
  hasDenialData: true,
  hasForecastInput: true,
};

describe('computeConfidence', () => {
  it('rates a complete dataset as high confidence', () => {
    const result = computeConfidence(IDEAL);
    expect(result.level).toBe('High');
    expect(result.score).toBe(100);
  });

  it('explains itself — every result carries reasons', () => {
    const result = computeConfidence(IDEAL);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons.every((r) => r.detail.length > 0)).toBe(true);
  });

  it('states the observation period in months', () => {
    const result = computeConfidence(IDEAL);
    const period = result.reasons.find((r) => r.label === 'Observation period');
    expect(period?.detail).toContain('months of usage history');
    expect(period?.impact).toBe('positive');
  });

  it('drops confidence sharply when history is short', () => {
    const result = computeConfidence({ ...IDEAL, observedDays: 40, windowDays: 365 });
    expect(result.level).toBe('Low');
    expect(result.reasons.some((r) => r.detail.includes('40 days'))).toBe(true);
  });

  it('penalizes missing pricing and says why it matters', () => {
    const result = computeConfidence({ ...IDEAL, hasPrice: false });
    expect(result.score).toBe(82);
    const pricing = result.reasons.find((r) => r.label === 'Pricing');
    expect(pricing?.impact).toBe('negative');
    expect(pricing?.detail).toContain('financial impact cannot be calculated');
  });

  it('penalizes poor employee mapping because attribution breaks', () => {
    const result = computeConfidence({ ...IDEAL, employeeMappingRate: 0.6 });
    const mapping = result.reasons.find((r) => r.label === 'Employee mapping');
    expect(mapping?.impact).toBe('negative');
    expect(mapping?.detail).toContain('60%');
  });

  it('penalizes unmapped features because demand may be understated', () => {
    const result = computeConfidence({ ...IDEAL, featureMappingRate: 0.7 });
    const mapping = result.reasons.find((r) => r.label === 'Feature mapping');
    expect(mapping?.detail).toContain('demand may be understated');
  });

  it('treats data gaps as a distinct problem from a short period', () => {
    const result = computeConfidence({ ...IDEAL, observedDays: 250, windowDays: 365 });
    const completeness = result.reasons.find((r) => r.label === 'Data completeness');
    expect(completeness?.detail).toContain('115 days missing');
  });

  it('accumulates deficiencies down to Low', () => {
    const result = computeConfidence({
      observedDays: 45,
      windowDays: 365,
      hasPrice: false,
      employeeMappingRate: 0.5,
      featureMappingRate: 0.6,
      hasDenialData: false,
      hasForecastInput: false,
    });
    expect(result.level).toBe('Low');
    expect(result.score).toBeLessThan(30);
  });

  it('never produces a score outside 0–100', () => {
    const worst = computeConfidence({
      observedDays: 0,
      windowDays: 730,
      hasPrice: false,
      employeeMappingRate: 0,
      featureMappingRate: 0,
      hasDenialData: false,
      hasForecastInput: false,
    });
    expect(worst.score).toBeGreaterThanOrEqual(0);
    expect(worst.score).toBeLessThanOrEqual(100);
  });

  it('skips mapping reasons when the rate is unknown rather than assuming the worst', () => {
    const result = computeConfidence({ ...IDEAL, employeeMappingRate: null, featureMappingRate: null });
    expect(result.reasons.some((r) => r.label === 'Employee mapping')).toBe(false);
    expect(result.level).toBe('High');
  });
});

describe('levelFromScore', () => {
  it('applies the documented thresholds', () => {
    expect(levelFromScore(100)).toBe('High');
    expect(levelFromScore(80)).toBe('High');
    expect(levelFromScore(79)).toBe('Medium');
    expect(levelFromScore(55)).toBe('Medium');
    expect(levelFromScore(54)).toBe('Low');
    expect(levelFromScore(0)).toBe('Low');
  });
});

describe('confidenceWeight', () => {
  it('discounts rather than eliminates low-confidence findings', () => {
    expect(confidenceWeight('High')).toBe(1);
    expect(confidenceWeight('Medium')).toBe(0.75);
    expect(confidenceWeight('Low')).toBe(0.5);
  });
});

describe('aggregateConfidence', () => {
  it('averages component scores', () => {
    const result = aggregateConfidence([
      { level: 'High', score: 100, reasons: [], evidence: null },
      { level: 'Medium', score: 60, reasons: [], evidence: null },
    ]);
    expect(result.score).toBe(80);
    expect(result.level).toBe('High');
  });

  it('calls out low-confidence members explicitly', () => {
    const result = aggregateConfidence([
      { level: 'High', score: 90, reasons: [], evidence: null },
      { level: 'Low', score: 30, reasons: [], evidence: null },
    ]);
    expect(result.reasons.some((r) => r.label === 'Low-confidence features')).toBe(true);
  });

  it('returns Low with an explanation for an empty set', () => {
    const result = aggregateConfidence([]);
    expect(result.level).toBe('Low');
    expect(result.reasons[0]?.label).toBe('No data');
  });
});
