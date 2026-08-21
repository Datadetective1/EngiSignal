import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { retrieve } from '@/lib/ai/retrieval';
import { AI_SYSTEM_PROMPT, composePrompt, configuredProviderId } from '@/lib/ai/provider';
import { DEFAULT_OPENAI_MODEL } from '@/lib/ai/openai';
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
import { summarizeCoverage } from '@/lib/ingestion/store/types';
import type { Workspace } from '@/lib/workspace';

/**
 * ── HALLUCINATION RESISTANCE ────────────────────────────────────────────────
 *
 * These tests ask EngiSignal questions its data cannot answer, and assert it
 * says so.
 *
 * They test the RETRIEVAL layer rather than a language model, and that is the
 * point rather than a shortcut: the refusal is deterministic. When retrieval
 * grades the evidence as `none`, `app/api/ask/route.ts` does not call the model
 * at all, so there is no request in which a model could invent an answer. A
 * test that mocked a model and checked it behaved would be testing the mock.
 *
 * What a model could still get wrong — stating a number that is not in the
 * FACTS block — is constrained by the system prompt, and the prompt's own
 * clauses are asserted below so they cannot be quietly softened.
 */

const dataset = generateDemoDataset();
const portfolio = buildPortfolio(dataset, DEFAULT_ANALYSIS_OPTIONS);
const renewals = buildRenewals(dataset, portfolio);
const dataQuality = buildDataQualityIssues(dataset, portfolio);
const reconciliation = reconcile({
  portfolio,
  entitlementByFeature: new Map(),
  contractByFeature: new Map(),
});

const workspace = {
  session: { userId: 'u1', email: 'a@b.com', displayName: 'A', isEvaluation: true },
  organization: dataset.organization,
  dataset,
  options: DEFAULT_ANALYSIS_OPTIONS,
  portfolio,
  renewals,
  dataQuality,
  reconciliation,
  signals: generateSignals({ portfolio, renewals, dataQuality }),
  totals: computePortfolioTotals(portfolio),
  unusedCapacity: unusedCapacitySpend(portfolio),
  confidence: portfolioConfidence(portfolio),
  integrity: checkIntegrity({
    accepted: dataset.analyzedRows,
    stored: dataset.analyzedRows,
    analyzed: dataset.analyzedRows,
  }),
  coverage: summarizeCoverage([], [], [], []),
  userIdentities: [],
  projection: {
    source: 'current' as const,
    state: 'ready' as const,
    version: 1,
    computedAt: null,
    buildMs: null,
    buildPhases: null,
    payloadBytes: null,
    evidenceKey: 'test',
    currentEvidenceKey: 'test',
    stale: false,
    buildingEvidenceKey: null,
    buildLive: false,
    buildStartedAt: null,
    buildFinishedAt: null,
    buildAttempt: 0,
    buildError: null,
    startedBecause: null,
    analyticsCurrent: true,
  },
  usingMockData: true,
} satisfies Workspace;

const emptyWorkspace = { ...workspace, portfolio: [], renewals: [], signals: [] } as unknown as Workspace;

describe('refusing to answer what the data does not contain', () => {
  it('refuses a product this estate has never seen', () => {
    const answer = retrieve(workspace, 'How many SolidWorks Premium licences do we own?');
    expect(answer.evidence).toBe('none');
    expect(answer.intent).toBe('no-evidence');
    expect(answer.headline).toContain('SolidWorks');
    expect(answer.facts.every((fact) => !/\$\d/.test(fact.value))).toBe(true);
  });

  it('refuses a vendor this estate has never seen', () => {
    const answer = retrieve(workspace, 'What are we spending on Bentley MicroStation?');
    expect(answer.evidence).toBe('none');
    expect(answer.missing).toBeDefined();
  });

  it('names what would answer the question instead of guessing', () => {
    // Zemax is genuinely absent from this estate. Cadence Allegro is NOT — it
    // is in the catalogue — and using it here would have tested nothing, which
    // is how the first draft of this test passed for the wrong reason.
    const answer = retrieve(workspace, 'Tell me about Zemax OpticStudio utilisation');
    expect(answer.evidence).toBe('none');
    expect(answer.missing?.join(' ')).toContain('Zemax');
    expect(answer.links.some((link) => link.href.includes('unmapped-features'))).toBe(true);
  });

  it('recognises a product the estate genuinely has', () => {
    // The mirror of the test above, on a real catalogue entry, so a guard that
    // simply refused everything could not pass this file.
    expect(retrieve(workspace, 'Tell me about Cadence Allegro utilisation').evidence).not.toBe('none');
  });

  it('refuses everything when nothing has been imported', () => {
    for (const question of [
      'Which renewal should we prioritise?',
      'What are my largest savings opportunities?',
      'Explain this portfolio to an executive.',
      'What is driving our largest optimization opportunity?',
    ]) {
      const answer = retrieve(emptyWorkspace, question);
      expect(answer.evidence).toBe('none');
      expect(answer.facts).toHaveLength(0);
      expect(answer.narrative).toMatch(/does not estimate|no usage/i);
    }
  });

  it('does not mistake ordinary question words for unknown products', () => {
    // The refusal path is only useful if it stays out of the way. Each of these
    // starts with a capitalised word that is not a product.
    for (const question of [
      'What are my largest savings opportunities?',
      'Which renewal should we prioritise?',
      'Explain this portfolio to an executive.',
      'What evidence is missing?',
      'Who drives demand?',
      'Why is this recommendation being made?',
    ]) {
      expect(retrieve(workspace, question).evidence).not.toBe('none');
    }
  });

  it('still answers about a product it does know', () => {
    const known = portfolio[0]!;
    const answer = retrieve(workspace, `Why are we reducing ${known.productName}?`);
    expect(answer.evidence).not.toBe('none');
    expect(answer.intent).toBe('explain-recommendation');
  });
});

describe('the question types the product promises to answer', () => {
  it('explains why a recommendation is being made', () => {
    const known = portfolio.find((row) => row.rightSizing !== null)!;
    const answer = retrieve(workspace, `Why is the ${known.productName} recommendation being made?`);
    expect(answer.intent).toBe('explain-recommendation');
    // The evidence a human would need to defend the number, not just the number.
    const labels = answer.facts.map((fact) => fact.label).join(' | ');
    expect(labels).toContain('P95');
    expect(labels).toContain('Recommended quantity');
    expect(labels).toContain('Confidence');
  });

  it('names what is driving the largest optimization opportunity', () => {
    const answer = retrieve(workspace, 'What is driving our largest optimization opportunity?');
    expect(answer.intent).toBe('savings');
    const labels = answer.facts.map((fact) => fact.label).join(' | ');
    expect(labels).toContain('Driver —');
    expect(labels).toContain('Driver — entitled quantity');
  });

  it('ranks renewals when asked which to prioritise', () => {
    const answer = retrieve(workspace, 'Which renewal should we prioritise?');
    expect(answer.intent).toBe('renewal-priority');
    if (answer.facts.length > 1) {
      expect(answer.facts[0]!.label.startsWith('1.')).toBe(true);
      expect(answer.facts[1]!.label.startsWith('2.')).toBe(true);
    }
  });

  it('summarises the portfolio for an executive', () => {
    const answer = retrieve(workspace, 'Explain this portfolio to an executive.');
    expect(answer.intent).toBe('executive-brief');
    const labels = answer.facts.map((fact) => fact.label).join(' | ');
    expect(labels).toContain('Purchased commitment');
    expect(labels).toContain('Portfolio confidence');
  });

  it('reports what evidence is missing', () => {
    const answer = retrieve(workspace, 'What evidence is missing?');
    expect(answer.intent).toBe('missing-evidence');
    const labels = answer.facts.map((fact) => fact.label).join(' | ');
    expect(labels).toContain('no price supplied');
    expect(labels).toContain('no usage observed');
  });

  it('answers a Scenario Lab assumption', () => {
    const answer = retrieve(workspace, 'What changes if headcount grows 12%?');
    expect(answer.intent).toBe('what-if');
    const labels = answer.facts.map((fact) => fact.label).join(' | ');
    expect(labels).toContain('Growth applied');
    expect(labels).toContain('Recommended quantity');
    expect(answer.facts.find((fact) => fact.label === 'Growth applied')?.value).toContain('12');
  });
});

describe('the grounding contract itself', () => {
  it('forbids the model from producing figures', () => {
    expect(AI_SYSTEM_PROMPT).toContain('must appear verbatim');
    expect(AI_SYSTEM_PROMPT).toContain('Never calculate');
    expect(AI_SYSTEM_PROMPT).toContain('say so plainly');
    expect(AI_SYSTEM_PROMPT).toContain('Never invent');
  });

  it('separates prior conversation from evidence in the prompt', () => {
    const prompt = composePrompt(
      'And the next one?',
      'Total annual spend: $1,000',
      [
        { role: 'user', content: 'Which renewal is first?' },
        { role: 'assistant', content: 'Ansys, in 51 days.' },
      ],
    );
    expect(prompt).toContain('PRIOR CONVERSATION (context only — not evidence)');
    expect(prompt).toContain('FACTS:');
    expect(prompt.indexOf('PRIOR CONVERSATION')).toBeLessThan(prompt.indexOf('FACTS:'));
    expect(prompt).toContain('QUESTION: And the next one?');
  });

  it('caps how much history reaches the model', () => {
    const history = Array.from({ length: 20 }, (_, index) => ({
      role: 'user' as const,
      content: `turn ${index}`,
    }));
    const prompt = composePrompt('Now what?', 'facts', history);
    expect(prompt).toContain('turn 19');
    expect(prompt).not.toContain('turn 13');
  });
});

describe('provider configuration', () => {
  const clear = () => {
    delete process.env.ENGISIGNAL_AI_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  };

  it('is deterministic with no credentials', () => {
    clear();
    expect(configuredProviderId()).toBe('none');
    clear();
  });

  it('activates on the key alone, without a second variable to remember', () => {
    clear();
    process.env.OPENAI_API_KEY = 'sk-test-not-a-real-key';
    expect(configuredProviderId()).toBe('openai');
    clear();
  });

  it('honours an explicit kill switch even with a key present', () => {
    clear();
    process.env.OPENAI_API_KEY = 'sk-test-not-a-real-key';
    process.env.ENGISIGNAL_AI_PROVIDER = 'none';
    expect(configuredProviderId()).toBe('none');
    clear();
  });

  it('does not claim a provider whose key is absent', () => {
    clear();
    process.env.ENGISIGNAL_AI_PROVIDER = 'openai';
    expect(configuredProviderId()).toBe('none');
    clear();
  });

  it('names the default model in exactly one place', () => {
    expect(DEFAULT_OPENAI_MODEL.length).toBeGreaterThan(0);
  });
});
