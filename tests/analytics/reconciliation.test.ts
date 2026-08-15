import { describe, expect, it } from 'vitest';
import { reconcile } from '@/lib/analytics/reconciliation';
import { buildReviewQueue, describeConfirmationEffect, similarity } from '@/lib/analytics/review-queue';
import { reconciliationSignals, unmatchedPositionSignals } from '@/lib/analytics/signals';
import type { PortfolioRow } from '@/lib/domain/types';
import type { ContractReviewItem } from '@/lib/ingestion/contract-match';

function row(overrides: Partial<PortfolioRow> & { featureId: string }): PortfolioRow {
  return {
    featureName: 'MECH_ENT',
    featureCode: 'MECH_ENT',
    productId: 'p1',
    productName: 'Ansys Mechanical',
    vendorId: 'v1',
    vendorName: 'Ansys',
    familyName: null,
    licenseModel: 'concurrent',
    entitled: 400,
    unitPrice: 5000,
    currentAnnualCost: 2_000_000,
    metrics: null,
    namedUser: null,
    tokens: null,
    denials: null,
    rightSizing: null,
    financial: {
      entitled: 400,
      recommended: 400,
      quantityDelta: 0,
      unitPrice: 5000,
      currentAnnualCost: 2_000_000,
      recommendedAnnualCost: 2_000_000,
      optimizationOpportunity: 0,
      incrementalSpend: 0,
      savingsPct: 0,
      priced: true,
    },
    confidence: { score: 50, level: 'Medium', reasons: [] },
    risk: 'Low',
    renewalDate: '2026-11-15',
    daysToRenewal: 90,
    contractId: 'c1',
    usageEvidence: 'not_supplied',
    ...overrides,
  };
}

describe('entitlement versus contract', () => {
  const portfolio = [
    row({ featureId: 'f:agree' }),
    row({ featureId: 'f:shelfware', featureName: 'FLUENT', productName: 'Ansys Fluent' }),
    row({ featureId: 'f:overdeployed', featureName: 'NX_CAD', productName: 'NX CAD' }),
    row({ featureId: 'f:contract_only', featureName: 'CATIA', productName: 'CATIA' }),
    row({ featureId: 'f:entitlement_only', featureName: 'MATLAB', productName: 'MATLAB' }),
  ];

  const summary = reconcile({
    portfolio,
    entitlementByFeature: new Map([
      ['f:agree', 400],
      ['f:shelfware', 350],
      ['f:overdeployed', 120],
      ['f:entitlement_only', 250],
    ]),
    contractByFeature: new Map([
      ['f:agree', 400],
      ['f:shelfware', 400],
      ['f:overdeployed', 100],
      ['f:contract_only', 90],
    ]),
  });

  const find = (id: string) => summary.rows.find((entry) => entry.featureId === id)!;

  it('classifies agreement', () => {
    expect(find('f:agree').state).toBe('agree');
    expect(find('f:agree').difference).toBe(0);
  });

  it('classifies more purchased than served', () => {
    const entry = find('f:shelfware');
    expect(entry.state).toBe('contract_exceeds_entitlement');
    expect(entry.difference).toBe(50);
    expect(entry.differenceValue).toBe(250_000);
  });

  it('classifies serving more than was purchased', () => {
    const entry = find('f:overdeployed');
    expect(entry.state).toBe('entitlement_exceeds_contract');
    expect(entry.difference).toBe(-20);
    // Value at stake is the magnitude; direction is carried by the state.
    expect(entry.differenceValue).toBe(100_000);
  });

  it('classifies single-source features without inventing the other side', () => {
    expect(find('f:contract_only').state).toBe('contract_only');
    expect(find('f:contract_only').entitlement.quantity).toBeNull();
    expect(find('f:contract_only').entitlement.provenance).toContain('Not supplied');

    expect(find('f:entitlement_only').state).toBe('entitlement_only');
    expect(find('f:entitlement_only').contract.quantity).toBeNull();
  });

  it('never labels a discrepancy as waste', () => {
    const entry = find('f:shelfware');
    const text = `${entry.interpretation} ${entry.possibleCauses.join(' ')}`.toLowerCase();

    // Shelfware is named as ONE possibility among several, never as the verdict.
    expect(entry.possibleCauses.length).toBeGreaterThan(1);
    expect(text).toContain('shelfware');
    expect(text).toContain('staged deployment');
    expect(entry.interpretation).not.toMatch(/^You are wasting/i);
  });

  it('offers causes that mean the DATA is incomplete, not the estate', () => {
    const causes = find('f:contract_only').possibleCauses.join(' ').toLowerCase();
    expect(causes).toContain('does not cover');
  });

  it('carries provenance on both numbers', () => {
    const entry = find('f:shelfware');
    expect(entry.entitlement.provenance).toContain('licence-server');
    expect(entry.contract.provenance).toContain('contract');
  });

  it('never reports a demand figure it did not measure', () => {
    // Every row here has usageEvidence 'not_supplied'.
    for (const entry of summary.rows) {
      expect(entry.p95).toBeNull();
      expect(entry.recommended).toBeNull();
    }
  });

  it('summarizes without mixing priced and unpriced', () => {
    expect(summary.agreeing).toBe(1);
    expect(summary.disagreeing).toBe(2);
    expect(summary.contractOnly).toBe(1);
    expect(summary.entitlementOnly).toBe(1);
    expect(summary.valueAtStake).toBe(350_000);
  });
});

describe('reconciliation signal', () => {
  it('is silent when the sources agree', () => {
    const summary = reconcile({
      portfolio: [row({ featureId: 'f1' })],
      entitlementByFeature: new Map([['f1', 400]]),
      contractByFeature: new Map([['f1', 400]]),
    });
    expect(reconciliationSignals(summary)).toHaveLength(0);
  });

  it('raises a review, not a saving', () => {
    const summary = reconcile({
      portfolio: [row({ featureId: 'f1' })],
      entitlementByFeature: new Map([['f1', 350]]),
      contractByFeature: new Map([['f1', 400]]),
    });

    const [signal] = reconciliationSignals(summary);
    expect(signal).toBeDefined();
    expect(signal!.kind).toBe('reconciliation');
    expect(signal!.cta).toBe('Reconcile');
    // The wording must not promise money.
    expect(signal!.subtitle.toLowerCase()).not.toContain('saving');
    expect(signal!.facts.some((fact) => fact.label === 'Value at stake')).toBe(true);
  });

  it('treats serving more than purchased as higher risk', () => {
    const summary = reconcile({
      portfolio: [row({ featureId: 'f1' })],
      entitlementByFeature: new Map([['f1', 500]]),
      contractByFeature: new Map([['f1', 400]]),
    });
    expect(reconciliationSignals(summary)[0]!.risk).toBe('High');
  });
});

describe('the review queue', () => {
  const observedRow = (overrides: Partial<PortfolioRow> & { featureId: string }) =>
    row({ ...overrides, usageEvidence: 'observed' });

  const portfolio = [
    observedRow({ featureId: 'f:mech', featureCode: 'MECH_ENT', featureName: 'MECH_ENT', productName: 'Ansys Mechanical' }),
    observedRow({ featureId: 'f:fluent', featureCode: 'FLUENT', featureName: 'FLUENT', productName: 'Ansys Fluent' }),
    observedRow({ featureId: 'f:matlab', featureCode: 'MATLAB', featureName: 'MATLAB', productName: 'MATLAB', vendorName: 'MathWorks' }),
  ];

  const review: ContractReviewItem[] = [
    {
      rawValue: 'ANSYS Mechanical Enterprise',
      vendor: 'Ansys',
      sku: 'ANS-MECH-ENT',
      annualCost: 2_000_000,
      currency: 'USD',
      candidates: [],
      reason: 'no exact match',
      resolution: 'confirm',
      occurrences: 1,
    },
  ];

  it('suggests candidates without merging anything', () => {
    const queue = buildReviewQueue({ review, portfolio });
    const position = queue.positions[0]!;

    expect(position.status).toBe('unresolved');
    expect(position.candidates.length).toBeGreaterThan(0);
    // Ansys Mechanical should outrank MATLAB.
    expect(position.candidates[0]!.featureName).toBe('MECH_ENT');
  });

  it('explains why each candidate was suggested', () => {
    const queue = buildReviewQueue({ review, portfolio });
    const top = queue.positions[0]!.candidates[0]!;
    expect(top.rationale.toLowerCase()).toContain('mechanical');
    expect(top.rationale.toLowerCase()).toContain('vendor matches');
  });

  it('reports the value sitting outside demand comparison', () => {
    const queue = buildReviewQueue({ review, portfolio });
    expect(queue.totalExcludedValue).toBe(2_000_000);
  });

  it('stops counting a position once it has been decided', () => {
    const queue = buildReviewQueue({
      review,
      portfolio,
      decisions: new Map([['ansys mechanical enterprise', 'confirmed']]),
    });
    expect(queue.positions[0]!.status).toBe('confirmed');
    expect(queue.totalExcludedValue).toBe(0);
  });

  it('states the consequence before it happens', () => {
    const queue = buildReviewQueue({ review, portfolio });
    const position = queue.positions[0]!;
    const effects = describeConfirmationEffect(position, position.candidates[0]!).join(' ');

    expect(effects).toContain('same product');
    expect(effects).toContain('2,000,000');
    expect(effects).toContain('undone');
  });

  it('never offers an unmatched line its own shadow as a match', () => {
    // Commercial lines feed feature discovery, so an unmatched line also
    // appears as a portfolio row. Before this was filtered, the queue ranked
    // "ANSYS Mechanical Enterprise" as a 100% match for itself, ahead of the
    // real candidate.
    const withShadow = [
      ...portfolio,
      row({
        featureId: 'f:shadow',
        featureCode: 'ANSYS Mechanical Enterprise',
        featureName: 'ANSYS Mechanical Enterprise',
        productName: 'Ansys Mechanical Enterprise Suite',
        usageEvidence: 'not_supplied',
      }),
    ];

    const queue = buildReviewQueue({ review, portfolio: withShadow });
    const names = queue.positions[0]!.candidates.map((entry) => entry.featureName);

    expect(names).not.toContain('ANSYS Mechanical Enterprise');
    expect(names[0]).toBe('MECH_ENT');
  });

  it('offers only features with demand behind them', () => {
    const queue = buildReviewQueue({
      review,
      portfolio: portfolio.map((entry) => ({ ...entry, usageEvidence: 'not_supplied' as const })),
    });
    // Merging into a target with no demand still leaves the position
    // uncomparable, so there is nothing useful to offer.
    expect(queue.positions[0]!.candidates).toHaveLength(0);
  });

  it('scores similarity only on meaningful shared words', () => {
    // "License" and "Software" are structural and must not create a match.
    expect(similarity('Software License', 'License Software').score).toBe(0);
    expect(similarity('Ansys Mechanical', 'Mechanical Enterprise').shared).toContain('mechanical');
  });
});

describe('unmatched position signal', () => {
  it('is silent when nothing is outstanding', () => {
    expect(unmatchedPositionSignals({ count: 0, value: 0 })).toHaveLength(0);
    expect(unmatchedPositionSignals(undefined)).toHaveLength(0);
  });

  it('reports unpriced positions without implying a dollar figure', () => {
    const [signal] = unmatchedPositionSignals({ count: 3, value: 0 });
    expect(signal!.financialImpact).toBeNull();
    expect(signal!.facts.find((fact) => fact.label === 'Annual value')!.value).toBe('Not priced');
  });
});
