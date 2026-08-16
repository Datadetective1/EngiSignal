import { describe, expect, it } from 'vitest';
import { buildPortfolio } from '@/lib/analytics/portfolio';
import { computePortfolioTotals, describeSpendHeadline } from '@/lib/analytics/financial';
import { reconcile } from '@/lib/analytics/reconciliation';
import { buildDatasetFromCanonical } from '@/lib/ingestion/dataset';
import { DEFAULT_ANALYSIS_OPTIONS } from '@/lib/domain/dataset';
import type { PortfolioTotals } from '@/lib/analytics/financial';
import type {
  CanonicalContractRecord,
  CanonicalEntitlementRecord,
  CanonicalUsageRecord,
  Provenance,
} from '@/lib/ingestion/canonical/types';
import type { Organization } from '@/lib/domain/types';

/**
 * THE CRITICAL FINANCIAL ACCEPTANCE TEST.
 *
 * Contract says 440. The licence server serves 350. Unit price $5,000.
 *
 * Those are two different facts and they answer two different questions:
 *
 *   "What are we committed to?"    440 × 5,000 = $2,200,000
 *   "What is deployed worth?"      350 × 5,000 = $1,750,000
 *
 * Phase 2B computed only the second and called it "committed annually", which
 * understated a customer's contractual obligation by $450,000 — a number they
 * would have taken into a renewal conversation.
 */

const ORG: Organization = {
  id: 'org-commitment',
  name: 'Commitment Test',
  slug: 'commitment-test',
  industry: null,
  technicalHeadcount: 100,
  headcountGrowthRate: null,
  currency: 'USD',
  isDemo: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function provenance(row: number): Provenance {
  return {
    organizationId: ORG.id,
    importId: 'import-commitment',
    importedAt: '2026-08-15T00:00:00.000Z',
    sourceFile: 'f.csv',
    sourceSystem: 'generic',
    sourceSheet: null,
    sourceRow: row,
  };
}

function usage(feature: string, date: string, concurrent: number, row: number): CanonicalUsageRecord {
  return {
    date, hour: 9, observedAt: null, user: `u${row}`, employeeCode: null,
    feature, product: null, vendor: null, quantity: null, concurrent,
    peak: null, available: null, durationHours: null, checkoutAt: null,
    checkinAt: null, denied: null, denialCount: null, licenseServer: null,
    pool: null, tokens: null, provenance: provenance(row),
  };
}

function entitlement(feature: string, quantity: number): CanonicalEntitlementRecord {
  return {
    feature, product: null, vendor: 'Ansys', entitledQuantity: quantity,
    licenseModel: 'concurrent', licenseServer: null, pool: null,
    expiresOn: null, provenance: provenance(2),
  };
}

function contract(feature: string, quantity: number, unitPrice: number): CanonicalContractRecord {
  return {
    feature, product: null, vendor: 'Ansys', sku: null,
    contractNumber: 'CTR-1', agreementNumber: null, purchaseOrder: null, supplier: null,
    quantity, unitPrice, totalCost: null, annualCost: quantity * unitPrice,
    currency: 'USD', licenseModel: 'concurrent', pricingUnit: null,
    contractStartDate: null, contractEndDate: null, renewalDate: '2026-11-15',
    businessUnit: null, costCenter: null, owner: null, notes: null,
    unitPriceBasis: 'supplied_unit_price', annualCostBasis: 'quantity_x_unit',
    multiYearTotal: false, provenance: provenance(2),
  };
}

/** Contract 440, entitlement 350, price $5,000, 20 days of demand peaking at 275. */
function estate() {
  const demand = Array.from({ length: 20 }, (_, index) =>
    usage('ansys_mech_ent', `2026-06-${String(index + 1).padStart(2, '0')}`, 275, index + 2),
  );

  return buildDatasetFromCanonical({
    organization: ORG,
    usage: demand,
    entitlements: [entitlement('ansys_mech_ent', 350)],
    people: [],
    contracts: [contract('ansys_mech_ent', 440, 5000)],
  });
}

describe('contract 440 against entitlement 350', () => {
  const dataset = estate();
  const rows = buildPortfolio(dataset, DEFAULT_ANALYSIS_OPTIONS);
  const row = rows.find((entry) => entry.featureId === 'feature:ansys_mech_ent')!;

  it('preserves both quantities without resolving them', () => {
    expect(row.commitment.purchasedQuantity).toBe(440);
    expect(row.commitment.servedQuantity).toBe(350);
    expect(row.commitment.quantityDifference).toBe(-90);
  });

  it('states purchased commitment from the contract quantity', () => {
    expect(row.commitment.purchasedAnnualCommitment).toBe(2_200_000);
  });

  it('states served capacity value from the entitlement quantity', () => {
    expect(row.commitment.servedCapacityValue).toBe(1_750_000);
  });

  it('never derives a commitment from served capacity', () => {
    // The exact conflation Phase 2B shipped: $1.75M reported as "committed".
    expect(row.commitment.purchasedAnnualCommitment).not.toBe(row.commitment.servedCapacityValue);
  });

  it('measures utilization against served capacity, which is correct', () => {
    // Demand was measured against what the server would actually issue, so the
    // denominator has to be the served quantity, not the purchased one.
    expect(row.entitled).toBe(350);
    expect(row.metrics!.p95).toBe(275);
  });

  it('carries a stated basis for every figure', () => {
    expect(row.commitment.basis).toContain('Purchased 440');
    expect(row.commitment.basis).toContain('served 350');
    expect(row.commitment.basis).toContain('unit price 5000');
  });

  it('reports the disagreement rather than reconciling it', () => {
    const entitlementByFeature = new Map<string, number>();
    const contractByFeature = new Map<string, number>();
    for (const source of dataset.quantitySources) {
      if (source.entitlementQuantity !== null) entitlementByFeature.set(source.featureId, source.entitlementQuantity);
      if (source.contractQuantity !== null) contractByFeature.set(source.featureId, source.contractQuantity);
    }

    const summary = reconcile({ portfolio: rows, entitlementByFeature, contractByFeature });
    const entry = summary.rows.find((r) => r.featureId === 'feature:ansys_mech_ent')!;

    expect(entry.state).toBe('contract_exceeds_entitlement');
    expect(entry.entitlement.quantity).toBe(350);
    expect(entry.contract.quantity).toBe(440);
    expect(entry.difference).toBe(90);
    expect(entry.differenceValue).toBe(450_000);
  });

  it('totals both bases separately', () => {
    const totals = computePortfolioTotals(rows);
    expect(totals.purchasedCommitment).toBe(2_200_000);
    expect(totals.annualSpend).toBe(1_750_000);
    expect(totals.commitmentGap).toBe(450_000);
    expect(totals.purchasedPricedFeatures).toBe(1);
  });
});

describe('when only one source exists', () => {
  it('states no purchased commitment when no contract quantity was imported', () => {
    const dataset = buildDatasetFromCanonical({
      organization: ORG,
      usage: [usage('entitlement_only', '2026-06-01', 100, 2)],
      entitlements: [entitlement('entitlement_only', 200)],
      people: [],
      contracts: [],
    });

    const row = buildPortfolio(dataset, DEFAULT_ANALYSIS_OPTIONS)[0]!;
    expect(row.commitment.purchasedQuantity).toBeNull();
    expect(row.commitment.purchasedAnnualCommitment).toBeNull();
    expect(row.commitment.quantityDifference).toBeNull();
    expect(row.commitment.basis).toContain('No contract quantity supplied');

    // And the total does not borrow the served figure to fill the gap.
    expect(computePortfolioTotals([row]).purchasedCommitment).toBe(0);
  });

  it('states a purchased commitment with no served capacity', () => {
    const dataset = buildDatasetFromCanonical({
      organization: ORG,
      usage: [],
      entitlements: [],
      people: [],
      contracts: [contract('contract_only', 60, 8200)],
    });

    const row = buildPortfolio(dataset, DEFAULT_ANALYSIS_OPTIONS)[0]!;
    expect(row.commitment.purchasedQuantity).toBe(60);
    expect(row.commitment.purchasedAnnualCommitment).toBe(492_000);
    // Falls back to the contract quantity for served, since that is what the
    // contract item carries when no entitlement export exists — and the basis
    // says so rather than implying a licence server confirmed it.
    expect(row.commitment.quantityDifference).toBe(0);
  });

  it('states no commitment when the line is unpriced', () => {
    const dataset = buildDatasetFromCanonical({
      organization: ORG,
      usage: [],
      entitlements: [],
      people: [],
      contracts: [{ ...contract('unpriced', 100, 0), unitPrice: null, annualCost: null }],
    });

    const row = buildPortfolio(dataset, DEFAULT_ANALYSIS_OPTIONS)[0]!;
    expect(row.commitment.purchasedAnnualCommitment).toBeNull();
    expect(row.commitment.servedCapacityValue).toBeNull();
    expect(row.commitment.basis).toContain('no unit price supplied');
  });
});

/**
 * The spend headline is a sentence, not just a number.
 *
 * On the Phase 2C acceptance estate the served valuation is $1,759,000 and the
 * signed commitment is $2,209,000. A dashboard reading "Annual spend $1.76M"
 * understates by $450,000 what the customer is bound to pay, and the executive
 * brief carrying that figure goes into a renewal negotiation.
 */
describe('describing the spend headline', () => {
  const totals = (over: Partial<PortfolioTotals>): PortfolioTotals =>
    ({
      annualSpend: 1_759_000,
      purchasedCommitment: 2_209_000,
      purchasedPricedFeatures: 2,
      commitmentGap: 450_000,
      ...over,
    }) as PortfolioTotals;

  it('leads with the commitment when procurement evidence exists', () => {
    const headline = describeSpendHeadline(totals({}));
    expect(headline.label).toBe('Committed annually');
    expect(headline.value).toBe(2_209_000);
  });

  it('shows the served figure alongside rather than hiding it', () => {
    const headline = describeSpendHeadline(totals({}));
    expect(headline.contrast).toEqual({ label: 'Served capacity value', value: 1_759_000 });
  });

  it('names the gap as undeployed capacity, never as a saving', () => {
    const headline = describeSpendHeadline(totals({}));
    expect(headline.basis).toContain('paid for and not deployed');
    expect(headline.basis.toLowerCase()).not.toContain('saving');
  });

  it('refuses to call an entitlement-derived figure a commitment', () => {
    const headline = describeSpendHeadline(
      totals({ purchasedCommitment: 0, purchasedPricedFeatures: 0, commitmentGap: 0 }),
    );
    expect(headline.label).toBe('Served capacity value');
    expect(headline.value).toBe(1_759_000);
    expect(headline.basis).toContain('not a purchased commitment');
  });

  it('drops the contrast when the two agree', () => {
    const headline = describeSpendHeadline(
      totals({ purchasedCommitment: 1_759_000, commitmentGap: 0 }),
    );
    expect(headline.label).toBe('Committed annually');
    expect(headline.contrast).toBeNull();
  });

  it('reports over-deployment in the other direction', () => {
    const headline = describeSpendHeadline(
      totals({ purchasedCommitment: 1_300_000, commitmentGap: -459_000 }),
    );
    expect(headline.basis).toContain('beyond the contract');
  });
});
