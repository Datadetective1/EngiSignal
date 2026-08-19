import { describe, expect, it } from 'vitest';
import { buildDatasetFromCanonical } from '@/lib/ingestion/dataset';
import { buildPortfolio, buildRenewals, portfolioConfidence } from '@/lib/analytics/portfolio';
import {
  computePortfolioTotals,
  costPerEngineer,
  describeSpendHeadline,
  describeSpendShare,
  formatCurrency,
  formatNumber,
  formatPercent,
  shareOfSpend,
  unusedCapacitySpend,
} from '@/lib/analytics/financial';
import { forecastPortfolioSpend } from '@/lib/analytics/forecast';
import { checkIntegrity, analyticsAvailable } from '@/lib/analytics/integrity';
import { explainConfidence } from '@/lib/analytics/confidence-explanation';
import { DEFAULT_ANALYSIS_OPTIONS } from '@/lib/domain/dataset';
import type { Organization } from '@/lib/domain/types';

/**
 * THE FIRST SCREEN A NEW CUSTOMER EVER SEES.
 *
 * A workspace created seconds ago has no imports, so every total is zero. The
 * dashboard divided one zero by another and rendered the result directly:
 *
 *     Optimization  $0
 *     NaN% of current spend
 *
 * Not a crash, not a blank — a nonsense figure presented with exactly the same
 * confidence as a real one, on the very first screen. This suite renders every
 * dashboard figure against a genuinely empty dataset and asserts that none of
 * them can produce NaN, Infinity, undefined or a bare "null".
 */

const ORG: Organization = {
  id: 'org-empty',
  name: 'Brand New Co',
  slug: 'brand-new-co',
  industry: null,
  technicalHeadcount: null,
  headcountGrowthRate: null,
  currency: 'USD',
  isDemo: false,
  createdAt: '2026-08-16T00:00:00.000Z',
};

const dataset = buildDatasetFromCanonical({
  organization: ORG,
  usage: [],
  entitlements: [],
  people: [],
  contracts: [],
  asOf: '2026-08-16',
});

const portfolio = buildPortfolio({ ...dataset, asOf: '2026-08-16' }, DEFAULT_ANALYSIS_OPTIONS);
const totals = computePortfolioTotals(portfolio);

/** Anything a human would recognise as a rendering failure. */
const BROKEN = /NaN|Infinity|undefined|\[object|^null$/;

describe('a workspace with nothing imported', () => {
  it('builds without throwing', () => {
    expect(portfolio).toHaveLength(0);
    expect(dataset.features).toHaveLength(0);
  });

  it('reports zero totals rather than absent ones', () => {
    expect(totals.annualSpend).toBe(0);
    expect(totals.featureCount).toBe(0);
    expect(Number.isFinite(totals.optimizationOpportunity)).toBe(true);
  });
});

describe('the Optimization card', () => {
  it('does not divide zero by zero', () => {
    // The reported bug, stated as the assertion that catches it.
    expect(shareOfSpend(0, 0)).toBeNull();
    expect(describeSpendShare(0, 0)).toBe('No spend data yet');
    expect(describeSpendShare(0, 0)).not.toMatch(BROKEN);
  });

  it('says so in the customer’s words, not with a dash', () => {
    expect(describeSpendShare(totals.optimizationOpportunity, totals.annualSpend)).toBe(
      'No spend data yet',
    );
  });

  it('still computes a real share once there is spend', () => {
    expect(shareOfSpend(245_000, 1_759_000)).toBeCloseTo(13.9, 1);
    expect(describeSpendShare(245_000, 1_759_000)).toBe('13.9% of current spend');
  });

  it('refuses a negative or non-finite basis', () => {
    expect(shareOfSpend(10, -5)).toBeNull();
    expect(shareOfSpend(10, Number.NaN)).toBeNull();
    expect(shareOfSpend(Number.POSITIVE_INFINITY, 100)).toBeNull();
  });
});

describe('every dashboard card on an empty workspace', () => {
  const confidence = portfolioConfidence(portfolio);
  const renewals = buildRenewals(dataset, portfolio);
  const headline = describeSpendHeadline(totals);
  const perEngineer = costPerEngineer(totals.annualSpend, ORG.technicalHeadcount);
  const unusedCapacity = unusedCapacitySpend(portfolio);
  // Mirrors the dashboard: an empty portfolio maps to an empty forecast input.
  const forecastSpend = forecastPortfolioSpend(
    portfolio.map((row) => ({ recommendedQuantity: row.entitled, unitPrice: row.unitPrice })),
    DEFAULT_ANALYSIS_OPTIONS.priceEscalationPct,
  );

  const capacityRisks = portfolio.filter((row) => row.risk === 'High' || row.risk === 'Critical').length;
  const reclaimCandidates = portfolio.reduce(
    (total, row) => total + (row.namedUser?.reclaimCandidates ?? 0),
    0,
  );
  const actionable = renewals.filter((r) => r.daysRemaining >= 0 && r.daysRemaining <= 120);

  // Exactly what the page renders, card by card.
  const rendered: Record<string, string> = {
    'headline label': headline.label,
    'headline value': formatCurrency(headline.value),
    'headline basis': headline.basis,
    'per engineer': perEngineer === null ? 'not shown' : formatCurrency(perEngineer),
    'optimization value': formatCurrency(totals.optimizationOpportunity),
    'optimization detail': describeSpendShare(totals.optimizationOpportunity, totals.annualSpend),
    'renewals value': formatNumber(actionable.length),
    'renewals detail': actionable[0] === undefined ? 'None within 120 days' : 'has renewal',
    'capacity risks value': formatNumber(capacityRisks),
    'reclaim value': formatNumber(reclaimCandidates),
    'forecast value': formatCurrency(forecastSpend),
    'forecast detail': `At ${((ORG.headcountGrowthRate ?? 0) * 100).toFixed(0)}% headcount growth`,
    'unused capacity': formatCurrency(unusedCapacity.amount),
    'unused feature count': formatNumber(unusedCapacity.featureCount),
    'confidence level': confidence.level,
    'confidence score': formatNumber(confidence.score),
    'vendor concentration': formatPercent(totals.vendorConcentration * 100, 0),
  };

  for (const [card, value] of Object.entries(rendered)) {
    it(`renders "${card}" as something a human can read`, () => {
      expect(value).not.toMatch(BROKEN);
      expect(value.trim().length).toBeGreaterThan(0);
    });
  }

  it('refuses to value an estate in which nothing has a price', () => {
    // This workspace has no contracts AND no entitlements, so both the served
    // and purchased sums are zero because there is nothing to add up -- not
    // because the software is free. It used to be labelled "Served capacity
    // value $0", which states a valuation nobody computed.
    expect(headline.value).toBeNull();
    expect(formatCurrency(headline.value)).toBe('—');
    expect(headline.basis).toMatch(/no unit prices or contract costs/i);
  });

  it('does not invent a cost per engineer without headcount', () => {
    expect(perEngineer).toBeNull();
  });

  it('reports low confidence with a readable reason rather than an empty list', () => {
    const explanation = explainConfidence(confidence);
    expect(explanation.summary).not.toMatch(BROKEN);
    expect(explanation.why.length).toBeGreaterThan(0);
    expect(explanation.notAssuming.length).toBeGreaterThan(0);
  });
});

describe('the integrity check on an empty workspace', () => {
  it('treats nothing imported as complete, not as broken', () => {
    // An empty workspace must not trip the truncation banner — that would greet
    // every new customer with a data-integrity alarm on an empty account.
    const zero = { usage: 0, people: 0, entitlements: 0, contracts: 0 };
    const report = checkIntegrity({ accepted: zero, stored: zero, analyzed: zero });

    expect(report.complete).toBe(true);
    expect(analyticsAvailable(report)).toBe(true);
    expect(report.headline).not.toMatch(BROKEN);
  });
});
