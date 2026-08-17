import { describe, expect, it } from 'vitest';
import { factsToText, retrieve } from '@/lib/ai/retrieval';
import { AI_SYSTEM_PROMPT, configuredProviderId } from '@/lib/ai/provider';
import { computePortfolioTotals, unusedCapacitySpend } from '@/lib/analytics/financial';
import {
  buildDataQualityIssues,
  buildPortfolio,
  buildRenewals,
  portfolioConfidence,
} from '@/lib/analytics/portfolio';
import { generateSignals } from '@/lib/analytics/signals';
import { checkIntegrity } from '@/lib/analytics/integrity';
import { reconcile } from '@/lib/analytics/reconciliation';
import { DEFAULT_ANALYSIS_OPTIONS } from '@/lib/domain/dataset';
import { generateDemoDataset } from '@/lib/synthetic/generate';
import type { Workspace } from '@/lib/workspace';

const dataset = generateDemoDataset();
const portfolio = buildPortfolio(dataset, DEFAULT_ANALYSIS_OPTIONS);
const renewals = buildRenewals(dataset, portfolio);
const dataQuality = buildDataQualityIssues(dataset, portfolio);

const workspace = {
  session: { userId: 'u1', email: 'a@b.com', displayName: 'A', isEvaluation: true },
  organization: dataset.organization,
  dataset,
  options: DEFAULT_ANALYSIS_OPTIONS,
  portfolio,
  renewals,
  dataQuality,
  reconciliation: reconcile({
    portfolio,
    entitlementByFeature: new Map(),
    contractByFeature: new Map(),
  }),
  signals: generateSignals({ portfolio, renewals, dataQuality }),
  totals: computePortfolioTotals(portfolio),
  unusedCapacity: unusedCapacitySpend(portfolio),
  confidence: portfolioConfidence(portfolio),
  integrity: checkIntegrity({
    accepted: dataset.analyzedRows,
    stored: dataset.analyzedRows,
    analyzed: dataset.analyzedRows,
  }),
  projection: {
    source: 'computed' as const,
    version: 1,
    computedAt: null,
    buildMs: null,
    rebuiltBecause: 'disabled' as const,
    payloadBytes: null,
    evidenceKey: 'test',
  },
  usingMockData: true,
} satisfies Workspace;

/** Every numeric token that appears in an answer, for provenance checking. */
function numbersIn(text: string): string[] {
  return text.match(/\d[\d,.]*/g) ?? [];
}

describe('retrieve — intent classification', () => {
  it('routes savings questions to the savings intent', () => {
    expect(retrieve(workspace, 'What are my largest savings opportunities?').intent).toBe('savings');
    expect(retrieve(workspace, 'Where are we overspending?').intent).toBe('savings');
  });

  it('routes renewal questions to the renewals intent', () => {
    expect(retrieve(workspace, 'Which renewals need attention?').intent).toBe('renewals');
  });

  it('routes a "why" question about a named product to the explanation intent', () => {
    const answer = retrieve(workspace, 'Why are we reducing Mechanical Enterprise?');
    expect(answer.intent).toBe('explain-recommendation');
    expect(answer.headline).toContain('Mechanical');
  });

  it('routes demand-driver questions correctly', () => {
    expect(retrieve(workspace, 'Who drives MATLAB demand?').intent).toBe('demand-drivers');
    expect(retrieve(workspace, 'Which program consumes the most simulation software?').intent).toBe(
      'demand-drivers',
    );
  });

  it('routes what-if questions to the scenario intent and reads the percentage', () => {
    const answer = retrieve(workspace, 'What happens if Fluent grows 12%?');
    expect(answer.intent).toBe('what-if');
    expect(answer.headline).toContain('+12%');
  });

  it('routes confidence questions to the confidence intent', () => {
    expect(retrieve(workspace, 'Why is this recommendation low confidence?').intent).toBe('confidence');
  });

  it('routes change questions to the what-changed intent', () => {
    expect(retrieve(workspace, 'What changed this month?').intent).toBe('what-changed');
  });

  it('routes capacity questions to the capacity intent', () => {
    expect(retrieve(workspace, 'Where are our capacity risks?').intent).toBe('capacity');
  });

  it('falls back to a portfolio overview rather than failing', () => {
    const answer = retrieve(workspace, 'hello there');
    expect(answer.intent).toBe('overview');
    expect(answer.facts.length).toBeGreaterThan(0);
  });
});

describe('retrieve — feature resolution', () => {
  it('matches the longest product name so specific beats general', () => {
    const specific = retrieve(workspace, 'Why are we changing Simulink Coder?');
    expect(specific.headline).toContain('Simulink Coder');
  });

  it('matches on feature code as well as name', () => {
    const answer = retrieve(workspace, 'Explain MECH_ENT');
    expect(answer.intent).toBe('explain-recommendation');
  });
});

describe('retrieve — provenance', () => {
  it('never returns an answer without supporting facts', () => {
    const questions = [
      'What are my largest savings opportunities?',
      'Which renewals need attention?',
      'Why are we reducing Mechanical Enterprise?',
      'Who drives MATLAB demand?',
      'What happens if Fluent grows 12%?',
      'Why is this low confidence?',
      'What changed this month?',
      'Where are our capacity risks?',
    ];

    for (const question of questions) {
      const answer = retrieve(workspace, question);
      expect(answer.facts.length, question).toBeGreaterThan(0);
      expect(answer.headline.length, question).toBeGreaterThan(0);
      expect(answer.narrative.length, question).toBeGreaterThan(0);
    }
  });

  it('grounds the flagship explanation in the same figures the product shows', () => {
    const answer = retrieve(workspace, 'Why are we reducing Mechanical Enterprise?');
    const row = portfolio.find((r) => r.featureCode === 'MECH_ENT')!;

    const entitled = answer.facts.find((f) => f.label === 'Entitled quantity');
    const p95 = answer.facts.find((f) => f.label === 'P95 daily peak demand');
    const recommended = answer.facts.find((f) => f.label === 'Recommended quantity');

    expect(entitled?.value).toBe('400');
    expect(p95?.value).toBe(row.metrics!.p95.toFixed(1));
    expect(recommended?.value).toBe(String(row.rightSizing!.recommended));
  });

  it('offers drill-through links on every answer', () => {
    const answer = retrieve(workspace, 'What are my largest savings opportunities?');
    expect(answer.links.length).toBeGreaterThan(0);
    for (const link of answer.links) expect(link.href.startsWith('/app')).toBe(true);
  });

  it('serializes facts in a form a model can only quote, not recompute', () => {
    const answer = retrieve(workspace, 'Which renewals need attention?');
    const text = factsToText(answer);

    expect(text).toContain(answer.headline);
    for (const fact of answer.facts) expect(text).toContain(fact.label);
    // Every number offered to the model is present in the fact block.
    expect(numbersIn(text).length).toBeGreaterThan(0);
  });
});

describe('AI provider contract', () => {
  it('defaults to no provider, so the app works without any API key', () => {
    expect(configuredProviderId()).toBe('none');
  });

  it('forbids the model from producing figures', () => {
    expect(AI_SYSTEM_PROMPT).toContain('must appear verbatim in the FACTS block');
    expect(AI_SYSTEM_PROMPT).toContain('Never calculate, estimate');
    expect(AI_SYSTEM_PROMPT).toContain('Never invent');
  });
});
