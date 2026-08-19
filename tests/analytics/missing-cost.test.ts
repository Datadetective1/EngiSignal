import { describe, expect, it } from 'vitest';
import {
  COST_NOT_PROVIDED,
  computePortfolioTotals,
  costFigure,
  describeSpendHeadline,
  formatCurrency,
  hasCostEvidence,
} from '@/lib/analytics/financial';
import type { PortfolioRow } from '@/lib/domain/types';

/**
 * ── MISSING COST IS NOT ZERO ────────────────────────────────────────────────
 *
 * Every money total in this product is a sum. A portfolio where nothing carries
 * a price sums to 0, and 0 formats as "$0" — a figure that tells a customer
 * their engineering software is free.
 *
 * That is the state every pilot customer is in during their first days, before
 * contracts are uploaded, and the executive brief was reporting "Optimization
 * opportunity $0" as though it were a finding.
 *
 * The evidence check is the feature COUNT, never the amount: a genuinely zero
 * cost and an absent one are identical in the number alone. The distinction
 * these tests defend is that one of them is a measurement and the other is a
 * question nobody has answered yet.
 */

const row = (over: Partial<PortfolioRow['financial']> & { purchased?: number | null }): PortfolioRow =>
  ({
    featureId: Math.random().toString(36).slice(2),
    vendorId: 'v1',
    financial: {
      priced: false,
      currentAnnualCost: null,
      recommendedAnnualCost: null,
      optimizationOpportunity: null,
      incrementalSpend: null,
      ...over,
    },
    commitment: { purchasedAnnualCommitment: over.purchased ?? null },
  }) as unknown as PortfolioRow;

const unpriced = () => row({});
const priced = (cost: number, opportunity = 0) =>
  row({ priced: true, currentAnnualCost: cost, recommendedAnnualCost: cost, optimizationOpportunity: opportunity });

describe('a portfolio with no price evidence at all', () => {
  const totals = computePortfolioTotals([unpriced(), unpriced(), unpriced()]);

  it('is recognised as carrying no cost evidence', () => {
    expect(hasCostEvidence(totals)).toBe(false);
    expect(totals.pricedFeatures).toBe(0);
    expect(totals.purchasedPricedFeatures).toBe(0);
  });

  it('withholds every money figure rather than claiming zero', () => {
    expect(costFigure(totals.annualSpend, totals)).toBeNull();
    expect(costFigure(totals.optimizationOpportunity, totals)).toBeNull();
    expect(costFigure(totals.recommendedSpend, totals)).toBeNull();
  });

  it('renders as an em dash, never as $0', () => {
    expect(formatCurrency(costFigure(totals.annualSpend, totals))).toBe('—');
    expect(formatCurrency(costFigure(totals.annualSpend, totals))).not.toBe('$0');
  });

  it('gives the headline a null value and says what is missing', () => {
    const headline = describeSpendHeadline(totals);
    expect(headline.value).toBeNull();
    expect(formatCurrency(headline.value)).toBe('—');
    expect(headline.basis).toMatch(/no unit prices or contract costs/i);
  });

  it('has a neutral state that names the absence', () => {
    expect(COST_NOT_PROVIDED).toBe('Cost data not provided');
  });
});

describe('a portfolio that is genuinely priced at zero', () => {
  // A free or fully-discounted licence is a measurement. It must survive.
  const totals = computePortfolioTotals([priced(0), priced(0)]);

  it('counts as cost evidence', () => {
    expect(hasCostEvidence(totals)).toBe(true);
    expect(totals.pricedFeatures).toBe(2);
  });

  it('still shows $0, because the source establishes it', () => {
    expect(costFigure(totals.annualSpend, totals)).toBe(0);
    expect(formatCurrency(costFigure(totals.annualSpend, totals))).toBe('$0');
  });
});

describe('a normally priced portfolio is untouched', () => {
  const totals = computePortfolioTotals([priced(4_000_000, 300_000), priced(1_700_000, 259_000)]);

  it('reports the same figures it always did', () => {
    expect(totals.annualSpend).toBe(5_700_000);
    expect(costFigure(totals.annualSpend, totals)).toBe(5_700_000);
    expect(formatCurrency(costFigure(totals.annualSpend, totals))).toBe('$5.7M');
    expect(costFigure(totals.optimizationOpportunity, totals)).toBe(559_000);
  });

  it('keeps its headline value', () => {
    expect(describeSpendHeadline(totals).value).toBe(5_700_000);
  });
});

describe('every portfolio-wide money figure passes through the guard', () => {
  const unpricedTotals = computePortfolioTotals([unpriced(), unpriced(), unpriced()]);

  // Ask EngiSignal answered "Annual spend $0" and "Optimization opportunity $0"
  // in its fact list while its headline correctly said cost data was missing.
  // A fact list is read as measurement, so the two must agree.
  it.each([
    ['annual spend', (t: typeof unpricedTotals) => t.annualSpend],
    ['optimization opportunity', (t: typeof unpricedTotals) => t.optimizationOpportunity],
    ['recommended spend', (t: typeof unpricedTotals) => t.recommendedSpend],
    ['incremental spend', (t: typeof unpricedTotals) => t.incrementalSpend],
    ['purchased commitment', (t: typeof unpricedTotals) => t.purchasedCommitment],
  ])('%s is withheld rather than shown as $0', (_label, pick) => {
    expect(formatCurrency(costFigure(pick(unpricedTotals), unpricedTotals))).toBe('—');
  });
});

describe('a partially priced portfolio', () => {
  // One feature priced, two not. Evidence exists, so the sum is real -- it is
  // simply incomplete, which the unpriced-feature count already communicates.
  const totals = computePortfolioTotals([priced(120_000, 10_000), unpriced(), unpriced()]);

  it('still reports the figure it can compute', () => {
    expect(hasCostEvidence(totals)).toBe(true);
    expect(costFigure(totals.annualSpend, totals)).toBe(120_000);
  });

  it('names how many features remain unpriced', () => {
    expect(totals.unpricedFeatures).toBe(2);
    expect(totals.pricedFeatures).toBe(1);
  });
});
