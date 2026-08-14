import { describe, expect, it } from 'vitest';
import { RENEWAL_STAGES, maxRisk, stageForDaysRemaining } from '@/lib/analytics/portfolio';
import { buildRecommendationEvidence } from '@/lib/analytics/evidence';
import { buildPortfolio, buildDataQualityIssues } from '@/lib/analytics/portfolio';
import { DEFAULT_ANALYSIS_OPTIONS } from '@/lib/domain/dataset';
import { generateDemoDataset } from '@/lib/synthetic/generate';

describe('stageForDaysRemaining', () => {
  it('places a countdown inside the stage that has begun but not yet ended', () => {
    expect(stageForDaysRemaining(400)).toBe('analyze');
    expect(stageForDaysRemaining(181)).toBe('analyze');
    expect(stageForDaysRemaining(180)).toBe('analyze');
    expect(stageForDaysRemaining(121)).toBe('analyze');
    expect(stageForDaysRemaining(120)).toBe('validate');
    expect(stageForDaysRemaining(91)).toBe('validate');
    expect(stageForDaysRemaining(90)).toBe('recommend');
    expect(stageForDaysRemaining(61)).toBe('recommend');
    expect(stageForDaysRemaining(60)).toBe('negotiate');
    expect(stageForDaysRemaining(58)).toBe('negotiate');
    expect(stageForDaysRemaining(31)).toBe('negotiate');
    expect(stageForDaysRemaining(30)).toBe('finalize');
    expect(stageForDaysRemaining(1)).toBe('finalize');
    expect(stageForDaysRemaining(0)).toBe('renewed');
    expect(stageForDaysRemaining(-14)).toBe('renewed');
  });

  it('defines every stage in descending order of days remaining', () => {
    for (let i = 1; i < RENEWAL_STAGES.length; i++) {
      expect(RENEWAL_STAGES[i]!.startsAtDays).toBeLessThan(RENEWAL_STAGES[i - 1]!.startsAtDays);
    }
  });
});

describe('maxRisk', () => {
  it('returns the most severe risk present', () => {
    expect(maxRisk('Low', 'High', 'Moderate')).toBe('High');
    expect(maxRisk('Low', 'Critical')).toBe('Critical');
    expect(maxRisk('Low', 'Low')).toBe('Low');
  });

  it('ignores absent inputs rather than treating them as Low-and-final', () => {
    expect(maxRisk(null, 'High', undefined)).toBe('High');
    expect(maxRisk(null, undefined)).toBe('Low');
  });
});

// ── Integration against the demo dataset ─────────────────────────────────────

const dataset = generateDemoDataset();
const portfolio = buildPortfolio(dataset, DEFAULT_ANALYSIS_OPTIONS);

describe('buildPortfolio', () => {
  it('produces one row per catalogued feature', () => {
    expect(portfolio).toHaveLength(42);
  });

  it('sorts by annual cost so the biggest commitments lead', () => {
    for (let i = 1; i < portfolio.length; i++) {
      expect(portfolio[i - 1]!.financial.currentAnnualCost ?? 0).toBeGreaterThanOrEqual(
        portfolio[i]!.financial.currentAnnualCost ?? 0,
      );
    }
  });

  it('applies the concurrent model only to concurrent-family features', () => {
    for (const row of portfolio) {
      if (row.licenseModel === 'concurrent') {
        expect(row.metrics).not.toBeNull();
        expect(row.namedUser).toBeNull();
      }
      if (row.licenseModel === 'named_user') {
        expect(row.namedUser).not.toBeNull();
        expect(row.metrics).toBeNull();
      }
      if (row.licenseModel === 'token') {
        expect(row.tokens).not.toBeNull();
      }
    }
  });

  it('recalculates when assumptions change', () => {
    const aggressive = buildPortfolio(dataset, { ...DEFAULT_ANALYSIS_OPTIONS, safetyFactor: 1.0 });
    const conservative = buildPortfolio(dataset, { ...DEFAULT_ANALYSIS_OPTIONS, safetyFactor: 1.25 });

    const a = aggressive.find((r) => r.featureCode === 'MECH_ENT')?.rightSizing?.recommended ?? 0;
    const c = conservative.find((r) => r.featureCode === 'MECH_ENT')?.rightSizing?.recommended ?? 0;
    expect(c).toBeGreaterThan(a);
  });

  it('shortens the observation window when a shorter period is selected', () => {
    const short = buildPortfolio(dataset, { ...DEFAULT_ANALYSIS_OPTIONS, periodKey: '3m' });
    expect(short.find((r) => r.featureCode === 'MECH_ENT')?.metrics?.observedDays).toBe(90);
  });

  it('attaches contract and renewal context to every priced row', () => {
    const row = portfolio.find((r) => r.featureCode === 'MECH_ENT');
    expect(row?.contractId).not.toBeNull();
    expect(row?.renewalDate).toBe('2026-08-27');
    expect(row?.daysToRenewal).toBe(58);
  });
});

describe('buildDataQualityIssues', () => {
  const issues = buildDataQualityIssues(dataset, portfolio);

  it('reports unmatched users and unmapped features', () => {
    expect(issues.some((i) => i.id === 'unmatched-users')).toBe(true);
    expect(issues.some((i) => i.id === 'unmapped-features')).toBe(true);
  });

  it('does not report missing pricing when every feature is priced', () => {
    expect(issues.some((i) => i.id === 'missing-pricing')).toBe(false);
  });

  it('gives every issue a route to resolve it', () => {
    for (const issue of issues) {
      expect(issue.affectedCount).toBeGreaterThan(0);
      expect(issue.detail.length).toBeGreaterThan(10);
    }
  });
});

describe('buildRecommendationEvidence', () => {
  const row = portfolio.find((r) => r.featureCode === 'MECH_ENT');
  const evidence = buildRecommendationEvidence(row!);

  it('reconstructs the derivation in the order a human would follow', () => {
    const labels = evidence.derivation.map((d) => d.label);
    expect(labels[0]).toContain('P95');
    expect(labels).toContain('Growth factor');
    expect(labels).toContain('Safety factor');
    expect(labels).toContain('Recommended quantity');
  });

  it('shows the unrounded product so the ceiling is not a black box', () => {
    expect(evidence.derivation.some((d) => d.label === 'Unrounded result')).toBe(true);
  });

  it('surfaces the observations the recommendation rests on', () => {
    const labels = evidence.observations.map((o) => o.label);
    expect(labels).toContain('P95 daily peak');
    expect(labels).toContain('Maximum daily peak');
    expect(labels).toContain('Saturation days');
    expect(labels).toContain('Observed days');
  });

  it('states every assumption explicitly', () => {
    const labels = evidence.assumptions.map((a) => a.label);
    expect(labels).toContain('Percentile');
    expect(labels).toContain('Observation period');
    expect(labels).toContain('Growth');
    expect(labels).toContain('Safety buffer');
  });

  it('offers drill-through rather than trapping the user at summary level', () => {
    expect(evidence.drillThrough.length).toBeGreaterThanOrEqual(3);
  });

  it('carries the confidence result with its reasons', () => {
    expect(evidence.confidence.reasons.length).toBeGreaterThan(0);
  });
});
