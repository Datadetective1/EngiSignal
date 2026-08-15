import { describe, expect, it } from 'vitest';
import { buildPortfolio } from '@/lib/analytics/portfolio';
import { computeNamedUserRightSizing } from '@/lib/analytics/named-user';
import { computePortfolioTotals, unusedCapacitySpend } from '@/lib/analytics/financial';
import { evidenceGapSignals, generateSignals } from '@/lib/analytics/signals';
import { buildDatasetFromCanonical } from '@/lib/ingestion/dataset';
import { DEFAULT_ANALYSIS_OPTIONS } from '@/lib/domain/dataset';
import type {
  CanonicalContractRecord,
  CanonicalUsageRecord,
  Provenance,
} from '@/lib/ingestion/canonical/types';
import type { Organization } from '@/lib/domain/types';

/**
 * THE EVIDENCE RULE, LOCKED DOWN.
 *
 * Every metrics function in this codebase returns a fully populated all-zeros
 * result when handed nothing to measure. Phase 2A caught one consequence — a
 * $1.08M recommendation to surrender a licence pool nobody had usage for — and
 * these tests assert the rule holds everywhere else it could reappear:
 * portfolio totals, unused-capacity spend, signals, and the row itself.
 *
 * The distinction under test is always the same one:
 *
 *   0   = we measured, and the answer was nothing
 *   null = we did not measure
 */

const ORG: Organization = {
  id: 'org-evidence',
  name: 'Evidence Test',
  slug: 'evidence-test',
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
    importId: 'import-evidence',
    importedAt: '2026-08-15T00:00:00.000Z',
    sourceFile: 'f.csv',
    sourceSystem: 'generic',
    sourceSheet: null,
    sourceRow: row,
  };
}

function usage(feature: string, date: string, concurrent: number, row: number): CanonicalUsageRecord {
  return {
    date,
    hour: 9,
    observedAt: null,
    user: `u${row}`,
    employeeCode: null,
    feature,
    product: null,
    vendor: null,
    quantity: null,
    concurrent,
    peak: null,
    available: null,
    durationHours: null,
    checkoutAt: null,
    checkinAt: null,
    denied: null,
    denialCount: null,
    licenseServer: null,
    pool: null,
    tokens: null,
    provenance: provenance(row),
  };
}

function contract(feature: string, quantity: number, unitPrice: number): CanonicalContractRecord {
  return {
    feature,
    product: null,
    vendor: 'Vendor',
    sku: null,
    contractNumber: null,
    agreementNumber: null,
    purchaseOrder: null,
    supplier: null,
    quantity,
    unitPrice,
    totalCost: null,
    annualCost: quantity * unitPrice,
    currency: 'USD',
    licenseModel: 'concurrent',
    pricingUnit: null,
    contractStartDate: null,
    contractEndDate: null,
    renewalDate: '2026-11-15',
    businessUnit: null,
    costCenter: null,
    owner: null,
    notes: null,
    unitPriceBasis: 'supplied_unit_price',
    annualCostBasis: 'quantity_x_unit',
    multiYearTotal: false,
    provenance: provenance(2),
  };
}

/** One feature with 20 days of demand, one priced feature with none at all. */
function mixedDataset() {
  const observed = Array.from({ length: 20 }, (_, index) =>
    usage('observed_feature', `2026-06-${String(index + 1).padStart(2, '0')}`, 275, index + 2),
  );

  return buildDatasetFromCanonical({
    organization: ORG,
    usage: observed,
    entitlements: [],
    people: [],
    contracts: [
      contract('observed_feature', 400, 5000),
      contract('unobserved_feature', 90, 12_000),
    ],
  });
}

describe('a feature with cost but no usage evidence', () => {
  const rows = buildPortfolio(mixedDataset(), DEFAULT_ANALYSIS_OPTIONS);
  const unobserved = rows.find((row) => row.featureId === 'feature:unobserved_feature')!;
  const observed = rows.find((row) => row.featureId === 'feature:observed_feature')!;

  it('is marked as lacking evidence rather than measured at zero', () => {
    expect(unobserved.usageEvidence).toBe('not_supplied');
    expect(observed.usageEvidence).toBe('observed');
  });

  it('carries no metrics object at all, so every null-check is an evidence check', () => {
    expect(unobserved.metrics).toBeNull();
    expect(unobserved.namedUser).toBeNull();
    expect(unobserved.tokens).toBeNull();
    expect(unobserved.rightSizing).toBeNull();
  });

  it('keeps its commercial facts, because those WERE supplied', () => {
    expect(unobserved.entitled).toBe(90);
    expect(unobserved.unitPrice).toBe(12_000);
    expect(unobserved.financial.currentAnnualCost).toBe(1_080_000);
    expect(unobserved.renewalDate).toBe('2026-11-15');
  });

  it('contributes to spend but never to opportunity', () => {
    const totals = computePortfolioTotals(rows);
    // Both features' money is committed and both count toward spend.
    expect(totals.annualSpend).toBe(3_080_000);
    // Only the evidenced feature can support a reduction.
    expect(totals.optimizationOpportunity).toBe(observed.financial.optimizationOpportunity ?? 0);
    expect(unobserved.financial.optimizationOpportunity ?? 0).toBe(0);
  });

  it('is excluded from unused-capacity spend', () => {
    // Previously this computed `entitled − p95` with p95 pinned at 0, valuing
    // the ENTIRE unmeasured entitlement as waste.
    const unused = unusedCapacitySpend(rows);
    const observedUnused = Math.max(0, observed.entitled - (observed.metrics?.p95 ?? 0));
    expect(unused.amount).toBe(observedUnused * 5000);
    expect(unused.featureCount).toBe(1);
  });

  it('raises no capacity, cost, usage or reclaim signal', () => {
    const signals = generateSignals({
      portfolio: rows,
      renewals: [],
      dataQuality: [],
    });

    const about = signals.filter((signal) => signal.id.includes('unobserved_feature'));
    expect(about).toHaveLength(0);
  });
});

describe('the same rule for a feature whose usage IS supplied', () => {
  it('still measures, sizes and prices it exactly as before', () => {
    const rows = buildPortfolio(mixedDataset(), DEFAULT_ANALYSIS_OPTIONS);
    const observed = rows.find((row) => row.featureId === 'feature:observed_feature')!;

    expect(observed.metrics).not.toBeNull();
    expect(observed.metrics!.p95).toBe(275);
    expect(observed.metrics!.observedDays).toBe(20);
    expect(observed.rightSizing).not.toBeNull();
    // 275 × 1.00 growth × 1.10 safety = 302.5 → 303.
    expect(observed.rightSizing!.recommended).toBe(303);
    expect(observed.financial.optimizationOpportunity).toBe((400 - 303) * 5000);
  });
});

describe('the evidence-gap signal', () => {
  it('names priced software that cannot be assessed, without calling it savings', () => {
    const rows = buildPortfolio(mixedDataset(), DEFAULT_ANALYSIS_OPTIONS);
    const signals = evidenceGapSignals(rows);

    expect(signals).toHaveLength(1);
    const [signal] = signals;
    expect(signal!.title).toContain('no usage evidence');
    // The one unevidenced feature costs 1.08M.
    expect(signal!.financialImpact).toBe(1_080_000);
    // It must read as something to resolve, never as money available.
    expect(signal!.subtitle.toLowerCase()).not.toContain('saving');
    expect(signal!.subtitle.toLowerCase()).not.toContain('opportunity');
    expect(signal!.subtitle).toContain('cannot be assessed');
  });

  it('is silent when every priced feature has usage behind it', () => {
    const rows = buildPortfolio(mixedDataset(), DEFAULT_ANALYSIS_OPTIONS).filter(
      (row) => row.usageEvidence === 'observed',
    );
    expect(evidenceGapSignals(rows)).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Named-user seats nobody was observed holding
// ─────────────────────────────────────────────────────────────────────────────

describe('named-user right-sizing against a partial export', () => {
  const base = {
    featureId: 'f1',
    reclaimThresholdDays: 90,
    neverUsed: 0,
    active30: 0,
    active60: 0,
    active90: 0,
    active180: 0,
    reclaimValue: null,
    utilizationPct: 0,
  };

  it('does not surrender seats whose holder was never observed', () => {
    // A 20-day export named five people against a 250-seat entitlement. The
    // previous basis recommended 6 seats and $220K of "opportunity".
    const result = computeNamedUserRightSizing(
      { ...base, assigned: 250, activeUsers: 5, inactiveUsers: 0, reclaimCandidates: 0, observedUsers: 5, seatsWithoutObservedUser: 245 },
      { growthFactor: 1, safetyFactor: 1.1 },
    );

    // ceil(5 × 1.1) = 6 for the measured population, plus 245 left alone.
    expect(result.recommended).toBe(251);
    expect(result.surplus).toBe(0);
    expect(result.methodology).toContain('not treated as surplus');
  });

  it('sizes normally when the export covers the whole population', () => {
    const result = computeNamedUserRightSizing(
      { ...base, assigned: 250, activeUsers: 150, inactiveUsers: 100, reclaimCandidates: 100, observedUsers: 250, seatsWithoutObservedUser: 0 },
      { growthFactor: 1, safetyFactor: 1.1 },
    );

    // Every seat accounted for, so the reduction is real and defensible.
    expect(result.recommended).toBe(165);
    expect(result.surplus).toBe(85);
    expect(result.methodology).not.toContain('not treated as surplus');
  });

  it('agrees with the reclaim rule rather than contradicting it', () => {
    // Reclaim counts only observed idle holders. Right-sizing must never
    // surrender more seats than reclaim is willing to name.
    const metrics = { ...base, assigned: 250, activeUsers: 5, inactiveUsers: 0, reclaimCandidates: 0, observedUsers: 5, seatsWithoutObservedUser: 245 };
    const result = computeNamedUserRightSizing(metrics, { growthFactor: 1, safetyFactor: 1.1 });
    expect(result.surplus).toBeLessThanOrEqual(metrics.reclaimCandidates);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A confirmed alias must move money, never lose it
// ─────────────────────────────────────────────────────────────────────────────

describe('confirming an alias', () => {
  const ORGANIZATION = ORG;

  function build(aliases: Map<string, string>) {
    const observed = Array.from({ length: 20 }, (_, index) =>
      usage('ansys_mech_ent', `2026-06-${String(index + 1).padStart(2, '0')}`, 275, index + 2),
    );

    return buildDatasetFromCanonical({
      organization: ORGANIZATION,
      usage: observed,
      entitlements: [],
      people: [],
      contracts: [
        contract('ansys_mech_ent', 400, 5000),
        // The line a reviewer would confirm as the same product.
        contract('ANSYS Mechanical Enterprise', 40, 9500),
      ],
      featureAliases: aliases,
    });
  }

  it('keeps the total unchanged when a line is merged', () => {
    const before = computePortfolioTotals(buildPortfolio(build(new Map()), DEFAULT_ANALYSIS_OPTIONS));

    // The alias target must be the NORMALIZED key. Storing the display code
    // produced a third key matching neither side, and $380,000 left the
    // portfolio total without any screen saying so.
    const after = computePortfolioTotals(
      buildPortfolio(
        build(new Map([['ansys mechanical enterprise', 'ansys_mech_ent']])),
        DEFAULT_ANALYSIS_OPTIONS,
      ),
    );

    expect(before.annualSpend).toBe(2_000_000 + 380_000);

    // Equal to within rounding, not exactly equal. Merging two lines at
    // different prices produces a blended unit price — 2,380,000 ÷ 440 =
    // 5,409.09 — and the portfolio recomputes cost as quantity × unit price by
    // design, so a sub-dollar residue is inherent to expressing one position as
    // a single rate. What must never happen is the $380,000 disappearing, which
    // is what an unnormalized alias target caused.
    expect(after.annualSpend).toBeCloseTo(before.annualSpend, 0);
    expect(Math.abs(after.annualSpend - before.annualSpend)).toBeLessThan(1);
  });

  it('folds the merged line into the target rather than leaving it standing', () => {
    const merged = buildPortfolio(
      build(new Map([['ansys mechanical enterprise', 'ansys_mech_ent']])),
      DEFAULT_ANALYSIS_OPTIONS,
    );

    expect(merged.filter((row) => row.featureId.includes('ansys'))).toHaveLength(1);
    const row = merged.find((r) => r.featureId === 'feature:ansys_mech_ent')!;
    // Quantities from both lines, and demand still measured.
    expect(row.entitled).toBe(440);
    expect(row.metrics!.p95).toBe(275);
  });
});
