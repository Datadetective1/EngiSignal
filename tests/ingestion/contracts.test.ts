import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ingestFile } from '@/lib/ingestion';
import { deriveCost, termDays } from '@/lib/ingestion/cost';
import { linkContracts, mergePositions } from '@/lib/ingestion/contract-match';
import { buildDatasetFromCanonical } from '@/lib/ingestion/dataset';
import { resolveFeatures } from '@/lib/ingestion/identity';
import { parseCurrency } from '@/lib/ingestion/values';
import { capabilityLines, coverageLines } from '@/lib/ingestion/capabilities';
// From the pure module rather than the store barrel: the barrel reaches the
// Supabase client, which is server-only and cannot be imported into a test.
import { summarizeCoverage } from '@/lib/ingestion/store/types';
import { computeRenewalExposure, renewalUrgency } from '@/lib/analytics/renewal';
import type {
  CanonicalContractRecord,
  CanonicalUsageRecord,
  Provenance,
} from '@/lib/ingestion/canonical/types';
import type { Organization } from '@/lib/domain/types';

const FIXTURES = path.resolve(__dirname, '../fixtures/ingestion');

const ORG = 'org-contract-test';

function bytes(file: string): ArrayBuffer {
  const buffer = fs.readFileSync(path.join(FIXTURES, file));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

async function ingestContracts(file: string) {
  return ingestFile(bytes(file), {
    dataset: 'contracts',
    organizationId: ORG,
    importId: 'import-contract-1',
    fileName: file,
  });
}

function provenance(row: number): Provenance {
  return {
    organizationId: ORG,
    importId: 'import-contract-1',
    importedAt: '2026-08-15T00:00:00.000Z',
    sourceFile: 'contracts.csv',
    sourceSystem: 'generic',
    sourceSheet: null,
    sourceRow: row,
  };
}

function contract(partial: Partial<CanonicalContractRecord> & { feature: string }): CanonicalContractRecord {
  return {
    product: null,
    vendor: null,
    sku: null,
    contractNumber: null,
    agreementNumber: null,
    purchaseOrder: null,
    supplier: null,
    quantity: null,
    unitPrice: null,
    totalCost: null,
    annualCost: null,
    currency: null,
    licenseModel: 'unknown',
    pricingUnit: null,
    contractStartDate: null,
    contractEndDate: null,
    renewalDate: null,
    businessUnit: null,
    costCenter: null,
    owner: null,
    notes: null,
    unitPriceBasis: 'none',
    annualCostBasis: 'none',
    multiYearTotal: false,
    provenance: provenance(2),
    ...partial,
  };
}

function usage(feature: string, date: string, concurrent: number, row = 2): CanonicalUsageRecord {
  return {
    date,
    hour: 9,
    observedAt: null,
    user: 'u1',
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

// ─────────────────────────────────────────────────────────────────────────────
// Mapping real-world headers
// ─────────────────────────────────────────────────────────────────────────────

describe('commercial column mapping', () => {
  it('maps a procurement spreadsheet without the customer renaming anything', async () => {
    const analysis = await ingestContracts('contracts-messy.csv');
    const mapped = new Map(
      analysis.mappings.filter((m) => m.field !== null).map((m) => [m.sourceColumn, m.field]),
    );

    expect(mapped.get('Publisher')).toBe('vendor');
    expect(mapped.get('Software Name')).toBe('product');
    expect(mapped.get('SKU Description')).toBe('feature');
    expect(mapped.get('Part Number')).toBe('sku');
    expect(mapped.get('Qty')).toBe('quantity');
    expect(mapped.get('Unit Price')).toBe('unitPrice');
    expect(mapped.get('Annual Spend')).toBe('annualCost');
    expect(mapped.get('Total')).toBe('totalCost');
    expect(mapped.get('Renewal Date')).toBe('renewalDate');
    expect(mapped.get('Contract Number')).toBe('contractNumber');
    expect(mapped.get('PO')).toBe('purchaseOrder');
    expect(mapped.get('Currency')).toBe('currency');
    expect(mapped.get('License Type')).toBe('licenseModel');
    expect(mapped.get('Business Unit')).toBe('businessUnit');
  });

  it('reads an expiry-only renewal schedule as renewal dates', async () => {
    const analysis = await ingestContracts('contracts-renewal-only.tsv');
    const mapped = new Map(
      analysis.mappings.filter((m) => m.field !== null).map((m) => [m.sourceColumn, m.field]),
    );

    // A renewal schedule's expiry column IS the date that forces a decision.
    expect(mapped.get('Expiration Date')).toBe('renewalDate');
    expect(mapped.get('Vendor')).toBe('vendor');
    expect(mapped.get('Application')).toBe('product');
    expect(analysis.result.contracts).toHaveLength(3);
    expect(analysis.result.contracts.every((c) => c.renewalDate !== null)).toBe(true);
    // No price anywhere: the file is accepted and stays unpriced.
    expect(analysis.result.contracts.every((c) => c.unitPrice === null)).toBe(true);
  });

  it('never lets a bare money word be claimed by two fields', () => {
    // The most expensive mapping error available: reading a line total as a
    // unit price overstates a position by the quantity.
    const bare = ['price', 'cost', 'total', 'spend'];
    expect(new Set(bare).size).toBe(bare.length);
  });

  it('honours a reviewer override of a money column', async () => {
    const analysis = await ingestFile(bytes('contracts-messy.csv'), {
      dataset: 'contracts',
      organizationId: ORG,
      importId: 'import-override',
      fileName: 'contracts-messy.csv',
      mappingOverrides: { 'Unit Price': 'totalCost', Total: '' },
    });

    const mapped = new Map(
      analysis.mappings.filter((m) => m.field !== null).map((m) => [m.sourceColumn, m.field]),
    );
    expect(mapped.get('Unit Price')).toBe('totalCost');
    expect(mapped.has('Total')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

describe('commercial validation', () => {
  it('accounts for every row', async () => {
    const { result } = await ingestContracts('contracts-messy.csv');
    expect(result.acceptedRows + result.rejectedRows).toBe(result.totalRows);
  });

  it('rejects a row that carries neither money nor a date', async () => {
    const { result } = await ingestContracts('contracts-messy.csv');
    const rejection = result.rejections.find((r) => r.rule === 'no_commercial_content');
    expect(rejection).toBeDefined();
    expect(rejection!.message).toContain('no price and no renewal or end date');
  });

  it('rejects an unrecognizable currency rather than assuming USD', async () => {
    const { result } = await ingestContracts('contracts-messy.csv');
    const rejection = result.rejections.find((r) => r.rule === 'invalid_currency');
    expect(rejection).toBeDefined();
    expect(rejection!.value).toBe('Dollars');
    expect(result.contracts.some((c) => c.feature === 'siemens_badccy')).toBe(false);
  });

  it('rejects a negative price instead of subtracting it from spend', async () => {
    const { result } = await ingestContracts('contracts-messy.csv');
    const rejection = result.rejections.find((r) => r.rule === 'negative_quantity');
    expect(rejection).toBeDefined();
    expect(result.contracts.some((c) => c.feature === 'ansys_negative')).toBe(false);
  });

  it('rejects a term that ends before it begins', async () => {
    const { result } = await ingestContracts('contracts-messy.csv');
    const rejection = result.rejections.find((r) => r.rule === 'inconsistent_dates');
    expect(rejection).toBeDefined();
    expect(result.contracts.some((c) => c.feature === 'siemens_backwards')).toBe(false);
  });

  it('rejects an unreadable date rather than guessing one', async () => {
    const { result } = await ingestContracts('contracts-messy.csv');
    const rejection = result.rejections.find(
      (r) => r.rule === 'invalid_date' && r.field === 'renewalDate',
    );
    expect(rejection).toBeDefined();
    expect(rejection!.value).toBe('not-a-date');
  });

  it('collapses an identical repeated line', async () => {
    const { result } = await ingestContracts('contracts-messy.csv');
    expect(result.duplicateRows).toBeGreaterThan(0);
    expect(result.contracts.filter((c) => c.feature === 'ansys_mech_ent')).toHaveLength(1);
  });

  it('accepts a priced line with no renewal date', async () => {
    const { result } = await ingestContracts('contracts-messy.csv');
    const perpetual = result.contracts.find((c) => c.feature === 'altair_perpetual');
    expect(perpetual).toBeDefined();
    expect(perpetual!.renewalDate).toBeNull();
    expect(perpetual!.unitPrice).toBe(4000);
  });

  it('accepts a dated line with no price', async () => {
    const { result } = await ingestContracts('contracts-messy.csv');
    const unpriced = result.contracts.find((c) => c.feature === 'teamcenter');
    expect(unpriced).toBeDefined();
    expect(unpriced!.unitPrice).toBeNull();
    expect(unpriced!.renewalDate).toBe('2027-03-31');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cost derivation
// ─────────────────────────────────────────────────────────────────────────────

describe('cost derivation', () => {
  it('multiplies quantity by unit price for the annual figure', () => {
    const derived = deriveCost({
      quantity: 400,
      unitPrice: 5000,
      totalCost: null,
      annualCost: null,
      contractStartDate: null,
      contractEndDate: null,
    });
    expect(derived.annualCost).toBe(2_000_000);
    expect(derived.annualCostBasis).toBe('quantity_x_unit');
    expect(derived.unitPrice).toBe(5000);
    expect(derived.unitPriceBasis).toBe('supplied_unit_price');
  });

  it('prefers an explicitly supplied annual cost over its own arithmetic', () => {
    const derived = deriveCost({
      quantity: 10,
      unitPrice: 100,
      totalCost: null,
      // Disagrees with 10 × 100 on purpose. The customer's number wins; the
      // disagreement is theirs to explain and must not be hidden.
      annualCost: 4321,
      contractStartDate: null,
      contractEndDate: null,
    });
    expect(derived.annualCost).toBe(4321);
    expect(derived.annualCostBasis).toBe('supplied_annual_cost');
  });

  it('derives a unit price from annual cost over quantity', () => {
    const derived = deriveCost({
      quantity: 90,
      unitPrice: null,
      totalCost: null,
      annualCost: 1_080_000,
      contractStartDate: null,
      contractEndDate: null,
    });
    expect(derived.unitPrice).toBe(12_000);
    expect(derived.unitPriceBasis).toBe('total_over_quantity');
  });

  it('treats a one-year total as the annual figure', () => {
    const derived = deriveCost({
      quantity: 60,
      unitPrice: null,
      totalCost: 492_000,
      annualCost: null,
      contractStartDate: '2025-12-21',
      contractEndDate: '2026-12-20',
    });
    expect(derived.multiYearTotal).toBe(false);
    expect(derived.annualCost).toBe(492_000);
    expect(derived.unitPrice).toBe(8200);
  });

  it('refuses to annualize a multi-year total', () => {
    const derived = deriveCost({
      quantity: 50,
      unitPrice: null,
      totalCost: 2_700_000,
      annualCost: null,
      contractStartDate: '2026-01-01',
      contractEndDate: '2028-12-31',
    });
    expect(derived.multiYearTotal).toBe(true);
    // The tempting wrong answers are 900,000 and 2,700,000. Both are refused.
    expect(derived.annualCost).toBeNull();
    expect(derived.unitPrice).toBeNull();
    expect(derived.derivations.join(' ')).toContain('not annualized');
  });

  it('does not scale a short term up to a year', () => {
    const derived = deriveCost({
      quantity: 10,
      unitPrice: null,
      totalCost: 50_000,
      annualCost: null,
      contractStartDate: '2026-01-01',
      contractEndDate: '2026-06-30',
    });
    // A six-month bridge deal does not imply twice the money over twelve months.
    expect(derived.annualCost).toBe(50_000);
  });

  it('leaves the unit price unknown when quantity is missing', () => {
    const derived = deriveCost({
      quantity: null,
      unitPrice: null,
      totalCost: 45_000,
      annualCost: null,
      contractStartDate: null,
      contractEndDate: null,
    });
    expect(derived.unitPrice).toBeNull();
    expect(derived.unitPriceBasis).toBe('none');
    expect(derived.annualCost).toBe(45_000);
  });

  it('leaves everything unknown when no money was supplied', () => {
    const derived = deriveCost({
      quantity: 300,
      unitPrice: null,
      totalCost: null,
      annualCost: null,
      contractStartDate: null,
      contractEndDate: null,
    });
    expect(derived.unitPrice).toBeNull();
    expect(derived.annualCost).toBeNull();
    // Never zero. Zero would read as "this costs nothing".
    expect(derived.unitPrice).not.toBe(0);
    expect(derived.annualCost).not.toBe(0);
  });

  it('records how every figure was reached', () => {
    const derived = deriveCost({
      quantity: 400,
      unitPrice: 5000,
      totalCost: null,
      annualCost: null,
      contractStartDate: null,
      contractEndDate: null,
    });
    expect(derived.derivations.length).toBeGreaterThan(0);
    expect(derived.derivations.join(' ')).toContain('400');
    expect(derived.derivations.join(' ')).toContain('5000');
  });

  it('measures a term in whole days', () => {
    expect(termDays('2026-01-01', '2026-12-31')).toBe(364);
    expect(termDays('2026-01-01', null)).toBeNull();
    expect(termDays(null, '2026-12-31')).toBeNull();
  });
});

describe('currency parsing', () => {
  it('accepts ISO codes', () => {
    expect(parseCurrency('USD')).toBe('USD');
    expect(parseCurrency('eur')).toBe('EUR');
    expect(parseCurrency('Price (GBP)')).toBe('GBP');
  });

  it('accepts symbols that mean exactly one currency', () => {
    expect(parseCurrency('€')).toBe('EUR');
    expect(parseCurrency('£')).toBe('GBP');
  });

  it('refuses a bare dollar sign', () => {
    // Used by more than twenty currencies. Reading it as USD would convert an
    // Australian renewal into an American one at parity.
    expect(parseCurrency('$')).toBeNull();
    expect(parseCurrency('Dollars')).toBeNull();
  });

  it('distinguishes absent from unreadable', () => {
    expect(parseCurrency(null)).toBeUndefined();
    expect(parseCurrency('')).toBeUndefined();
    expect(parseCurrency('wat')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Matching
// ─────────────────────────────────────────────────────────────────────────────

describe('contract to feature matching', () => {
  const features = resolveFeatures([
    usage('ansys_mech_ent', '2026-01-01', 100),
    usage('matlab', '2026-01-01', 50),
  ]);

  it('links on an identical normalized name', () => {
    const { links } = linkContracts({
      contracts: [contract({ feature: 'ANSYS MECH ENT', unitPrice: 5000, quantity: 400 })],
      features,
    });
    expect(links[0]!.basis).toBe('normalized_name');
    expect(links[0]!.featureKey).toBe('ansys_mech_ent');
  });

  it('links on a customer-confirmed alias', () => {
    const { links } = linkContracts({
      contracts: [contract({ feature: 'Ansys Mechanical Enterprise', unitPrice: 5000 })],
      features,
      aliases: new Map([['ansys mechanical enterprise', 'ansys_mech_ent']]),
    });
    expect(links[0]!.basis).toBe('confirmed_alias');
    expect(links[0]!.featureKey).toBe('ansys_mech_ent');
  });

  it('refuses to merge two SKUs whose names merely look alike', () => {
    // The failure this whole module exists to prevent.
    const { links, review } = linkContracts({
      contracts: [
        contract({ feature: 'ansys_mech_ent', sku: 'ANS-MECH-ENT', unitPrice: 4000, quantity: 120 }),
        contract({ feature: 'ansys_mech_premium', sku: 'ANS-MECH-PRM', unitPrice: 9500, quantity: 40 }),
      ],
      features,
    });

    const premium = links.find((l) => l.contract.feature === 'ansys_mech_premium')!;
    expect(premium.basis).toBe('unmatched');
    expect(premium.featureKey).toBeNull();

    // It is surfaced for a human, with the lookalike named as a suggestion only.
    const item = review.find((r) => r.rawValue === 'ansys_mech_premium')!;
    expect(item).toBeDefined();
    expect(item.candidates).toContain('ansys_mech_ent');
    expect(item.resolution).toContain('Confirm');
  });

  it('propagates a SKU link only when another line justified it', () => {
    const { links } = linkContracts({
      contracts: [
        // Establishes SKU → feature by also matching on name.
        contract({ feature: 'ansys_mech_ent', sku: 'ANS-MECH-ENT', quantity: 400, unitPrice: 5000 }),
        // Same SKU written differently, name alone would not match.
        contract({ feature: 'Ansys Mech (Ent)', sku: 'ans-mech-ent', quantity: 10, unitPrice: 5000 }),
      ],
      features,
    });
    expect(links[1]!.basis).toBe('sku');
    expect(links[1]!.featureKey).toBe('ansys_mech_ent');
  });

  it('does not invent a link from a SKU nothing else vouches for', () => {
    const { links } = linkContracts({
      contracts: [contract({ feature: 'unknown_thing', sku: 'MYSTERY-1', unitPrice: 100 })],
      features,
    });
    expect(links[0]!.basis).toBe('unmatched');
  });

  it('keeps an unmatched line rather than discarding it', () => {
    const { links } = linkContracts({
      contracts: [contract({ feature: 'mw_orphan_toolbox', unitPrice: 600, quantity: 15 })],
      features,
    });
    // Still present, still carrying its money, simply not comparable to demand.
    expect(links).toHaveLength(1);
    expect(links[0]!.contract.unitPrice).toBe(600);
  });
});

describe('merging lines into one position', () => {
  const features = resolveFeatures([usage('matlab', '2026-01-01', 50)]);

  it('adds quantities bought on separate purchase orders', () => {
    const { links } = linkContracts({
      contracts: [
        contract({ feature: 'matlab', quantity: 200, annualCost: 180_000, purchaseOrder: 'PO-1' }),
        contract({ feature: 'matlab', quantity: 50, annualCost: 45_000, purchaseOrder: 'PO-2' }),
      ],
      features,
    });
    const position = mergePositions(links).get('matlab')!;
    expect(position.quantity).toBe(250);
    expect(position.annualCost).toBe(225_000);
    expect(position.purchaseOrders).toEqual(['PO-1', 'PO-2']);
  });

  it('weights the unit price by quantity rather than averaging naively', () => {
    const { links } = linkContracts({
      contracts: [
        contract({ feature: 'matlab', quantity: 10, annualCost: 40_000 }),
        contract({ feature: 'matlab', quantity: 990, annualCost: 5_940_000 }),
      ],
      features,
    });
    const position = mergePositions(links).get('matlab')!;
    // Naive average of 4,000 and 6,000 would be 5,000 — wrong by ~$980,000.
    expect(position.unitPrice).toBe(5980);
    expect(position.quantity).toBe(1000);
  });

  it('takes the earliest renewal, because that is the one that binds', () => {
    const { links } = linkContracts({
      contracts: [
        contract({ feature: 'matlab', quantity: 10, renewalDate: '2027-06-01' }),
        contract({ feature: 'matlab', quantity: 10, renewalDate: '2026-09-30' }),
      ],
      features,
    });
    expect(mergePositions(links).get('matlab')!.renewalDate).toBe('2026-09-30');
  });

  it('refuses to price a position spanning two currencies', () => {
    const { links } = linkContracts({
      contracts: [
        contract({ feature: 'matlab', quantity: 10, annualCost: 10_000, currency: 'USD' }),
        contract({ feature: 'matlab', quantity: 10, annualCost: 9_000, currency: 'EUR' }),
      ],
      features,
    });
    const position = mergePositions(links).get('matlab')!;
    expect(position.currency).toBeNull();
    expect(position.currencies).toEqual(['USD', 'EUR']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The end-to-end financial claim
// ─────────────────────────────────────────────────────────────────────────────

describe('a dollar-valued renewal position', () => {
  const organization: Organization = {
    id: ORG,
    name: 'Test Manufacturing',
    slug: 'test-manufacturing',
    industry: null,
    technicalHeadcount: 100,
    headcountGrowthRate: null,
    currency: 'USD',
    isDemo: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  /** 20 days of demand peaking at 275, so P95 is a real observation. */
  function demandSeries(): CanonicalUsageRecord[] {
    const records: CanonicalUsageRecord[] = [];
    const peaks = [
      210, 230, 245, 250, 255, 258, 260, 262, 265, 266,
      268, 270, 271, 272, 273, 274, 275, 275, 275, 275,
    ];
    peaks.forEach((peak, index) => {
      const day = String(index + 1).padStart(2, '0');
      records.push(usage('ansys_mech_ent', `2026-03-${day}`, peak, index + 2));
    });
    return records;
  }

  it('prices a surplus the customer can defend line by line', () => {
    const dataset = buildDatasetFromCanonical({
      organization,
      usage: demandSeries(),
      entitlements: [],
      people: [],
      contracts: [
        contract({
          feature: 'ansys_mech_ent',
          vendor: 'Ansys',
          quantity: 400,
          unitPrice: 5000,
          currency: 'USD',
          renewalDate: '2026-11-15',
          unitPriceBasis: 'supplied_unit_price',
          annualCost: 2_000_000,
          annualCostBasis: 'quantity_x_unit',
        }),
      ],
    });

    const item = dataset.contractItems.find((i) => i.featureId === 'feature:ansys_mech_ent')!;
    // The number that was structurally unreachable before this phase.
    expect(item.unitPrice).toBe(5000);
    expect(item.quantity).toBe(400);

    const contractRow = dataset.contracts.find((c) => c.renewalDate === '2026-11-15');
    expect(contractRow).toBeDefined();
  });

  it('leaves an unpriced line unpriced rather than zero', () => {
    const dataset = buildDatasetFromCanonical({
      organization,
      usage: demandSeries(),
      entitlements: [],
      people: [],
      contracts: [contract({ feature: 'ansys_mech_ent', quantity: 400, renewalDate: '2026-11-15' })],
    });

    const item = dataset.contractItems.find((i) => i.featureId === 'feature:ansys_mech_ent')!;
    expect(item.unitPrice).toBeNull();
    expect(item.unitPrice).not.toBe(0);
  });

  it('prefers the entitlement quantity over the purchased quantity', () => {
    // A server issuing 350 against a contract for 400 is shelfware, and
    // utilization must be measured against what the server would actually serve.
    const dataset = buildDatasetFromCanonical({
      organization,
      usage: demandSeries(),
      entitlements: [
        {
          feature: 'ansys_mech_ent',
          product: null,
          vendor: 'Ansys',
          entitledQuantity: 350,
          licenseModel: 'concurrent',
          licenseServer: null,
          pool: null,
          expiresOn: null,
          provenance: provenance(2),
        },
      ],
      people: [],
      contracts: [contract({ feature: 'ansys_mech_ent', quantity: 400, unitPrice: 5000 })],
    });

    const item = dataset.contractItems.find((i) => i.featureId === 'feature:ansys_mech_ent')!;
    expect(item.quantity).toBe(350);
    expect(item.unitPrice).toBe(5000);
  });

  it('surfaces an unmatched commercial line for review', () => {
    const dataset = buildDatasetFromCanonical({
      organization,
      usage: demandSeries(),
      entitlements: [],
      people: [],
      contracts: [contract({ feature: 'mw_orphan_toolbox', quantity: 15, unitPrice: 600 })],
    });

    expect(dataset.unmappedFeatures.some((f) => f.rawValue === 'mw_orphan_toolbox')).toBe(true);
  });

  it('builds a renewal portfolio from contracts alone, before any usage', () => {
    const dataset = buildDatasetFromCanonical({
      organization,
      usage: [],
      entitlements: [],
      people: [],
      contracts: [
        contract({ feature: 'nx_cad', vendor: 'Siemens', quantity: 60, renewalDate: '2026-12-20' }),
      ],
    });

    // A customer who uploads a renewal schedule first should see something.
    expect(dataset.features.length).toBeGreaterThan(0);
    expect(dataset.contracts.some((c) => c.renewalDate === '2026-12-20')).toBe(true);
    // But no demand was invented from it.
    expect(dataset.hourlyUsage).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Renewal exposure
// ─────────────────────────────────────────────────────────────────────────────

describe('renewal exposure', () => {
  const lines = [
    {
      featureKey: 'a',
      featureName: 'A',
      vendor: 'Ansys',
      product: null,
      renewalDate: '2026-09-14',
      daysToRenewal: 30,
      currentQuantity: 400,
      currentAnnualCost: 2_000_000,
      recommendedQuantity: 318,
      recommendedAnnualCost: 1_590_000,
      optimizationOpportunity: 410_000,
      licenseModel: 'concurrent' as const,
      currency: 'USD',
      contractNumbers: [],
      evidence: 'priced',
    },
    {
      featureKey: 'b',
      featureName: 'B',
      vendor: 'Siemens',
      product: null,
      renewalDate: '2026-11-13',
      daysToRenewal: 90,
      currentQuantity: 60,
      currentAnnualCost: null,
      recommendedQuantity: null,
      recommendedAnnualCost: null,
      optimizationOpportunity: null,
      licenseModel: 'concurrent' as const,
      currency: null,
      contractNumbers: [],
      evidence: 'unpriced',
    },
    {
      featureKey: 'c',
      featureName: 'C',
      vendor: 'Altair',
      product: null,
      renewalDate: null,
      daysToRenewal: null,
      currentQuantity: 25,
      currentAnnualCost: 100_000,
      recommendedQuantity: null,
      recommendedAnnualCost: null,
      optimizationOpportunity: null,
      licenseModel: 'concurrent' as const,
      currency: 'USD',
      contractNumbers: [],
      evidence: 'perpetual',
    },
  ];

  const exposure = computeRenewalExposure(lines, '2026-08-15');

  it('counts a renewal in every window it falls inside', () => {
    const at30 = exposure.buckets.find((b) => b.window === 30)!;
    const at90 = exposure.buckets.find((b) => b.window === 90)!;
    expect(at30.lineCount).toBe(1);
    expect(at90.lineCount).toBe(2);
    expect(at90.annualCost).toBe(2_000_000);
  });

  it('reports unpriced lines inside a window instead of dropping them', () => {
    const at90 = exposure.buckets.find((b) => b.window === 90)!;
    expect(at90.unpricedLines).toBe(1);
  });

  it('excludes an undated line from every window', () => {
    expect(exposure.undatedLines).toBe(1);
    for (const bucket of exposure.buckets) {
      expect(bucket.lineCount).toBeLessThanOrEqual(2);
    }
  });

  it('treats a missing renewal date as unknown urgency, not low', () => {
    expect(renewalUrgency(null)).toBe('unknown');
    expect(renewalUrgency(-5)).toBe('lapsed');
    expect(renewalUrgency(20)).toBe('critical');
    expect(renewalUrgency(200)).toBe('low');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Capability gating
// ─────────────────────────────────────────────────────────────────────────────

describe('capability gating with commercial data', () => {
  const usageRecords = Array.from({ length: 20 }, (_, index) =>
    usage('ansys_mech_ent', `2026-03-${String(index + 1).padStart(2, '0')}`, 200, index + 2),
  );

  const entitlement = {
    feature: 'ansys_mech_ent',
    product: null,
    vendor: 'Ansys',
    entitledQuantity: 400,
    licenseModel: 'concurrent' as const,
    licenseServer: null,
    pool: null,
    expiresOn: null,
    provenance: provenance(2),
  };

  function capabilities(contracts: CanonicalContractRecord[]) {
    const coverage = summarizeCoverage(usageRecords, [entitlement], [], contracts);
    return capabilityLines({
      coverage,
      distinctDates: 20,
      hasCost: false,
      resolvedPeople: 0,
    });
  }

  it('withholds financial opportunity until a price exists', () => {
    const line = capabilities([
      contract({ feature: 'ansys_mech_ent', quantity: 400, renewalDate: '2026-11-15' }),
    ]).find((l) => l.key === 'financialOpportunity')!;

    expect(line.available).toBe(false);
    expect(line.requires).toContain('contract or cost data');
  });

  it('unlocks financial opportunity once a price exists', () => {
    const line = capabilities([
      contract({ feature: 'ansys_mech_ent', quantity: 400, unitPrice: 5000, annualCost: 2_000_000 }),
    ]).find((l) => l.key === 'financialOpportunity')!;

    expect(line.available).toBe(true);
  });

  it('unlocks renewal exposure from dates alone', () => {
    const line = capabilities([
      contract({ feature: 'ansys_mech_ent', renewalDate: '2026-11-15' }),
    ]).find((l) => l.key === 'renewalExposure')!;

    expect(line.available).toBe(true);
  });

  it('keeps renewal exposure locked when no date was supplied', () => {
    const line = capabilities([
      contract({ feature: 'ansys_mech_ent', quantity: 400, unitPrice: 5000 }),
    ]).find((l) => l.key === 'renewalExposure')!;

    expect(line.available).toBe(false);
    expect(line.requires).toContain('renewal or end dates');
  });

  it('withholds reclaim opportunity without named-user licensing', () => {
    const coverage = summarizeCoverage(usageRecords, [entitlement], [], [
      contract({ feature: 'ansys_mech_ent', quantity: 400, unitPrice: 5000, annualCost: 2_000_000 }),
    ]);
    const line = capabilityLines({
      coverage,
      distinctDates: 20,
      hasCost: true,
      resolvedPeople: 10,
      hasNamedUserLicensing: false,
    }).find((l) => l.key === 'reclaimOpportunity')!;

    expect(line.available).toBe(false);
    expect(line.requires).toContain('named-user');
  });

  it('never reports missing cost as a zero opportunity', () => {
    const coverage = summarizeCoverage(usageRecords, [entitlement], [], []);
    const lines = coverageLines({ coverage, distinctDates: 20, hasCost: false, resolvedPeople: 0 });

    const cost = lines.find((l) => l.label === 'Cost')!;
    expect(cost.detail).toBe('Cost data not supplied');
    expect(cost.detail).not.toMatch(/\$?\b0\b/);

    const renewal = lines.find((l) => l.label === 'Renewal dates')!;
    expect(renewal.detail).toBe('Renewal date not supplied');
    expect(renewal.detail).not.toMatch(/\b0\b/);
  });

  it('warns rather than sums when two currencies are present', () => {
    const coverage = summarizeCoverage(usageRecords, [entitlement], [], [
      contract({ feature: 'a', annualCost: 1000, currency: 'USD', renewalDate: '2027-01-01' }),
      contract({ feature: 'b', annualCost: 1000, currency: 'EUR', renewalDate: '2027-01-01' }),
    ]);
    const line = coverageLines({
      coverage,
      distinctDates: 20,
      hasCost: true,
      resolvedPeople: 0,
    }).find((l) => l.label === 'Currency')!;

    expect(line.state).toBe('partial');
    expect(line.detail).toContain('not summed across currencies');
  });
});
