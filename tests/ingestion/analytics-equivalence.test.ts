import { describe, expect, it } from 'vitest';
import { aggregateHourlyToDaily, computeConcurrentMetrics, dailySeriesForFeature } from '@/lib/analytics/concurrent';
import { computeRightSizing } from '@/lib/analytics/rightsizing';
import { percentile } from '@/lib/analytics/stats';
import type { HourlyUsage } from '@/lib/domain/types';
import { ingestParsedFile } from '@/lib/ingestion';
import { parseDelimited } from '@/lib/ingestion/parse';
import { buildDatasetFromCanonical } from '@/lib/ingestion/dataset';
import { projectUsage } from '@/lib/ingestion/project';

/**
 * THE CRITICAL REGRESSION TEST.
 *
 * Phase 1 introduced a second route into the analytics engine: instead of a
 * dataset handed straight to it, records now arrive as a file, are normalized,
 * persisted, and projected back into the same shapes.
 *
 * That route must not change a single number. If it does, every recommendation
 * built on imported data silently disagrees with the same data supplied
 * directly — and nobody would notice until a customer challenged a renewal
 * position in a negotiation.
 *
 * So these tests construct a known dataset, feed it to the analytics engine
 * BOTH ways, and require identical results: hourly concurrency, daily peak,
 * P90/P95/P99, and the right-sizing recommendation that depends on them.
 */

/** One window, matching the generated series exactly. */
const WINDOW = { start: '2026-01-01', end: '2026-03-01', key: 'custom' as const, days: 60 };

const ORG = {
  id: 'org-equivalence',
  name: 'Equivalence Test Org',
  slug: 'equivalence-test',
  industry: null,
  technicalHeadcount: 100,
  headcountGrowthRate: 0.05,
  currency: 'USD',
  isDemo: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

/**
 * A deterministic hourly series with a known shape.
 *
 * 60 days × 3 working hours, with a repeating pattern plus a monthly spike, so
 * the peak is not the same as the mean and P95 is genuinely sensitive to the
 * aggregation choice.
 */
function buildKnownHourly(featureCode: string): HourlyUsage[] {
  const rows: HourlyUsage[] = [];
  const start = Date.UTC(2026, 0, 1);

  for (let day = 0; day < 60; day++) {
    const date = new Date(start + day * 86_400_000).toISOString().slice(0, 10);
    for (const hour of [9, 13, 16]) {
      // Deterministic, non-trivial, and different per hour so the daily peak is
      // a real maximum rather than a constant.
      const base = 40 + ((day * 7 + hour * 3) % 25);
      const spike = day % 30 === 0 && hour === 13 ? 35 : 0;
      rows.push({ featureId: featureCode, date, hour, concurrent: base + spike });
    }
  }
  return rows;
}

/** The same series expressed as a FlexNet-shaped CSV export. */
function toFlexNetCsv(rows: readonly HourlyUsage[], featureCode: string): string {
  const lines = ['DATE,TIME,FEATURE,VENDOR_DAEMON,USER,SERVER_HOST,LICENSES_ISSUED,LICENSES_IN_USE'];
  for (const row of rows) {
    lines.push(
      [
        row.date,
        `${String(row.hour).padStart(2, '0')}:00`,
        featureCode,
        'ansyslmd',
        `user${row.hour}`,
        'lic-prod-01',
        '400',
        String(row.concurrent),
      ].join(','),
    );
  }
  return lines.join('\n');
}

/** Run the file all the way through ingestion into an analytics dataset. */
function ingestToDataset(csv: string, fileName = 'equivalence.csv') {
  const parsed = parseDelimited(csv);
  const analysis = ingestParsedFile(parsed, {
    dataset: 'usage',
    organizationId: ORG.id,
    importId: 'import-equivalence',
    fileName,
    importedAt: '2026-08-15T00:00:00.000Z',
  });

  expect(analysis.result.rejectedRows).toBe(0);

  return {
    analysis,
    dataset: buildDatasetFromCanonical({
      organization: ORG,
      usage: analysis.result.usage,
      entitlements: analysis.result.entitlements,
      people: analysis.result.people,
    }),
  };
}

describe('ingested data produces identical analytics to direct data', () => {
  const FEATURE = 'MECH_ENT';
  const direct = buildKnownHourly(FEATURE);
  const csv = toFlexNetCsv(direct, FEATURE);

  it('reproduces every hourly concurrency value exactly', () => {
    const { dataset } = ingestToDataset(csv);

    expect(dataset.hourlyUsage).toHaveLength(direct.length);

    const ingestedByKey = new Map(
      dataset.hourlyUsage.map((row) => [`${row.date}|${row.hour}`, row.concurrent]),
    );

    for (const row of direct) {
      expect(ingestedByKey.get(`${row.date}|${row.hour}`)).toBe(row.concurrent);
    }
  });

  it('reproduces the daily peak series exactly', () => {
    const { dataset } = ingestToDataset(csv);

    const expected = aggregateHourlyToDaily(direct);
    const actualFeatureId = dataset.features[0]!.id;
    const actual = aggregateHourlyToDaily(dataset.hourlyUsage);

    expect(actual).toHaveLength(expected.length);

    const actualByDate = new Map(actual.map((row) => [row.date, row.peak]));
    for (const row of expected) {
      expect(actualByDate.get(row.date)).toBe(row.peak);
    }

    // And the engine's own windowed accessor agrees.
    const series = dailySeriesForFeature(actual, actualFeatureId, WINDOW);
    expect(series.length).toBe(expected.length);
  });

  it('reproduces P90, P95 and P99 exactly', () => {
    const { dataset } = ingestToDataset(csv);

    const expectedPeaks = aggregateHourlyToDaily(direct).map((row) => row.peak);
    const actualPeaks = aggregateHourlyToDaily(dataset.hourlyUsage).map((row) => row.peak);

    for (const p of [0.9, 0.95, 0.99]) {
      expect(percentile(actualPeaks, p)).toBe(percentile(expectedPeaks, p));
    }
  });

  it('reproduces the right-sizing recommendation exactly', () => {
    const { dataset } = ingestToDataset(csv);

    const expectedPeaks = aggregateHourlyToDaily(direct).map((row) => row.peak);
    const actualPeaks = aggregateHourlyToDaily(dataset.hourlyUsage).map((row) => row.peak);

    const options = { entitled: 400, percentile: 0.95, growthFactor: 1.05, safetyFactor: 1.1 };
    const expected = computeRightSizing({ dailyPeaks: expectedPeaks, ...options });
    const actual = computeRightSizing({ dailyPeaks: actualPeaks, ...options });

    expect(actual.recommended).toBe(expected.recommended);
    expect(actual.basis).toBe(expected.basis);
    expect(actual.rawRecommended).toBe(expected.rawRecommended);
    expect(actual.surplus).toBe(expected.surplus);
  });

  it('reproduces concurrent metrics exactly', () => {
    const { dataset } = ingestToDataset(csv);
    const featureId = dataset.features[0]!.id;

    const directDaily = aggregateHourlyToDaily(
      direct.map((row) => ({ ...row, featureId })),
    );
    const ingestedDaily = aggregateHourlyToDaily(dataset.hourlyUsage);

    const expected = computeConcurrentMetrics({
      daily: directDaily,
      featureId,
      entitled: 400,
      window: WINDOW,
    });
    const actual = computeConcurrentMetrics({
      daily: ingestedDaily,
      featureId,
      entitled: 400,
      window: WINDOW,
    });

    expect(actual.p90).toBe(expected.p90);
    expect(actual.p95).toBe(expected.p95);
    expect(actual.p99).toBe(expected.p99);
    expect(actual.max).toBe(expected.max);
    expect(actual.mean).toBe(expected.mean);
    expect(actual.utilizationPct).toBe(expected.utilizationPct);
    expect(actual.observedDays).toBe(expected.observedDays);
  });
});

describe('the documented aggregation choice', () => {
  it('takes the hourly maximum, and that choice is what preserves P95', () => {
    // Two observations in the same hour. Mean would give 20, max gives 31.
    // Only max reproduces the true high-water mark, and P95 follows from it.
    const csv = [
      'DATE,TIME,FEATURE,USER,LICENSES_IN_USE',
      '2026-02-02,09:00,F1,a,9',
      '2026-02-02,09:00,F1,b,31',
    ].join('\n');

    const parsed = parseDelimited(csv);
    const analysis = ingestParsedFile(parsed, {
      dataset: 'usage',
      organizationId: ORG.id,
      importId: 'import-max',
      fileName: 'max.csv',
    });

    const projection = projectUsage(analysis.result.usage);
    expect(projection.hourlyUsage).toHaveLength(1);
    expect(projection.hourlyUsage[0]!.concurrent).toBe(31);
    expect(projection.dailyUsage[0]!.peak).toBe(31);
  });

  it('does not merge two features that merely share a prefix', () => {
    // MECH_ENT and MECH_ENT_HPC are different entitlements. Merging them would
    // roughly double the peak and recommend licences for a feature that does
    // not exist.
    const csv = [
      'DATE,TIME,FEATURE,USER,LICENSES_IN_USE',
      '2026-02-02,09:00,MECH_ENT,a,100',
      '2026-02-02,09:00,MECH_ENT_HPC,b,40',
    ].join('\n');

    const { dataset } = ingestToDataset(csv, 'two-features.csv');

    expect(dataset.features).toHaveLength(2);
    const peaks = aggregateHourlyToDaily(dataset.hourlyUsage);
    expect(peaks.map((row) => row.peak).sort((a, b) => a - b)).toEqual([40, 100]);
  });

  it('does merge spellings that differ only in case and separators', () => {
    // These are one string written three ways, not three features.
    const csv = [
      'DATE,TIME,FEATURE,USER,LICENSES_IN_USE',
      '2026-02-02,09:00,MECH_ENT,a,100',
      '2026-02-03,09:00,mech-ent,b,110',
      '2026-02-04,09:00,Mech Ent,c,120',
    ].join('\n');

    const { dataset } = ingestToDataset(csv, 'one-feature.csv');

    expect(dataset.features).toHaveLength(1);
    expect(dataset.hourlyUsage).toHaveLength(3);
  });
});

describe('grain honesty', () => {
  it('does not invent session hours for snapshot sources', () => {
    // Sentinel snapshots carry no duration. Usage hours must stay zero rather
    // than being inferred from the number of sample rows.
    const csv = [
      'Sample Time,Feature Name,Client User,Licenses In Use,Peak Usage,Sublicense',
      '2026-02-02 08:00:00,SOLIDCAM_PRO,wa,112,126,SL-A',
      '2026-02-02 09:00:00,SOLIDCAM_PRO,cm,124,131,SL-A',
    ].join('\n');

    const { dataset, analysis } = ingestToDataset(csv, 'sentinel.csv');

    expect(analysis.detection.source).toBe('sentinel');
    for (const row of dataset.dailyUsage) {
      expect(row.usageHours).toBe(0);
    }
    for (const activity of dataset.activities) {
      expect(activity.totalHours).toBe(0);
    }
  });

  it('produces no denial events when the source did not report denials', () => {
    const csv = [
      'DATE,TIME,FEATURE,USER,LICENSES_IN_USE',
      '2026-02-02,09:00,F1,a,10',
    ].join('\n');

    const { dataset } = ingestToDataset(csv, 'no-denials.csv');

    // Empty, so the capability layer reports "not supplied" rather than zero.
    expect(dataset.denials).toHaveLength(0);
  });

  it('never invents an entitlement price', () => {
    const csv = ['FEATURE,LICENSES_ISSUED,LICENSE_TYPE', 'MECH_ENT,400,concurrent'].join('\n');
    const parsed = parseDelimited(csv);
    const analysis = ingestParsedFile(parsed, {
      dataset: 'entitlements',
      organizationId: ORG.id,
      importId: 'import-ent',
      fileName: 'ent.csv',
    });

    const dataset = buildDatasetFromCanonical({
      organization: ORG,
      usage: [],
      entitlements: analysis.result.entitlements,
      people: [],
    });

    expect(dataset.contractItems).toHaveLength(1);
    expect(dataset.contractItems[0]!.quantity).toBe(400);
    // Unpriced means null, never zero — zero would read as free.
    expect(dataset.contractItems[0]!.unitPrice).toBeNull();
  });

  it('never invents HR context that was not imported', () => {
    const csv = [
      'network id,employee id,full name,email',
      'pandersson,E10442,Petra Andersson,petra@example.com',
    ].join('\n');
    const parsed = parseDelimited(csv);
    const analysis = ingestParsedFile(parsed, {
      dataset: 'people',
      organizationId: ORG.id,
      importId: 'import-people',
      fileName: 'people.csv',
    });

    const dataset = buildDatasetFromCanonical({
      organization: ORG,
      usage: [],
      entitlements: [],
      people: analysis.result.people,
    });

    const employee = dataset.employees[0]!;
    expect(employee.fullName).toBe('Petra Andersson');
    expect(employee.employeeCode).toBe('E10442');
    // Not supplied by the file, so not fabricated.
    expect(employee.department).toBeNull();
    expect(employee.managerName).toBeNull();
    expect(employee.program).toBeNull();
  });
});

/**
 * PHASE 2A REGRESSION.
 *
 * Adding commercial data must not move a single usage number. Price and
 * renewal dates answer "what is it worth" and "when is it due"; they say
 * nothing about how much was used, and demand analysis must be provably
 * indifferent to them.
 *
 * Without this, a pricing import could quietly shift P95 — and the resulting
 * recommendation would be wrong in exactly the situation where it finally
 * carries a dollar figure and someone acts on it.
 */
describe('commercial data does not disturb usage analytics', () => {
  const FEATURE = 'MECH_ENT';
  const direct = buildKnownHourly(FEATURE);
  const csv = toFlexNetCsv(direct, FEATURE);

  function contractRecord(feature: string) {
    return {
      feature,
      product: null,
      vendor: 'Ansys',
      sku: 'ANS-MECH-ENT',
      contractNumber: 'CTR-1',
      agreementNumber: null,
      purchaseOrder: 'PO-1',
      supplier: null,
      quantity: 400,
      unitPrice: 5000,
      totalCost: null,
      annualCost: 2_000_000,
      currency: 'USD',
      licenseModel: 'concurrent' as const,
      pricingUnit: null,
      contractStartDate: '2025-11-16',
      contractEndDate: '2026-11-15',
      renewalDate: '2026-11-15',
      businessUnit: null,
      costCenter: null,
      owner: null,
      notes: null,
      unitPriceBasis: 'supplied_unit_price' as const,
      annualCostBasis: 'quantity_x_unit' as const,
      multiYearTotal: false,
      provenance: {
        organizationId: ORG.id,
        importId: 'import-contracts',
        importedAt: '2026-08-15T00:00:00.000Z',
        sourceFile: 'contracts.csv',
        sourceSystem: 'generic' as const,
        sourceSheet: null,
        sourceRow: 2,
      },
    };
  }

  it('produces identical hourly and daily demand with and without contracts', () => {
    const parsed = parseDelimited(csv);
    const analysis = ingestParsedFile(parsed, {
      dataset: 'usage',
      organizationId: ORG.id,
      importId: 'import-usage',
      fileName: 'usage.csv',
    });

    const base = {
      organization: ORG,
      usage: analysis.result.usage,
      entitlements: [],
      people: [],
    };

    const without = buildDatasetFromCanonical(base);
    const with_ = buildDatasetFromCanonical({
      ...base,
      contracts: [contractRecord(FEATURE)],
    });

    expect(with_.hourlyUsage).toEqual(without.hourlyUsage);
    expect(with_.dailyUsage).toEqual(without.dailyUsage);
  });

  it('produces an identical P95 and recommendation with contracts present', () => {
    const parsed = parseDelimited(csv);
    const analysis = ingestParsedFile(parsed, {
      dataset: 'usage',
      organizationId: ORG.id,
      importId: 'import-usage',
      fileName: 'usage.csv',
    });

    const priced = buildDatasetFromCanonical({
      organization: ORG,
      usage: analysis.result.usage,
      entitlements: [],
      people: [],
      contracts: [contractRecord(FEATURE)],
    });

    const expectedPeaks = aggregateHourlyToDaily(direct).map((row) => row.peak);
    const actualPeaks = aggregateHourlyToDaily(priced.hourlyUsage).map((row) => row.peak);

    for (const p of [0.9, 0.95, 0.99]) {
      expect(percentile(actualPeaks, p)).toBe(percentile(expectedPeaks, p));
    }

    const options = { entitled: 400, percentile: 0.95, growthFactor: 1.05, safetyFactor: 1.1 };
    expect(computeRightSizing({ dailyPeaks: actualPeaks, ...options }).recommended).toBe(
      computeRightSizing({ dailyPeaks: expectedPeaks, ...options }).recommended,
    );

    // And the price DID arrive — this is not passing because contracts were
    // ignored altogether.
    const featureId = priced.features[0]!.id;
    const item = priced.contractItems.find((i) => i.featureId === featureId)!;
    expect(item.unitPrice).toBe(5000);
  });

  it('leaves demand untouched when a contract line matches nothing', () => {
    const parsed = parseDelimited(csv);
    const analysis = ingestParsedFile(parsed, {
      dataset: 'usage',
      organizationId: ORG.id,
      importId: 'import-usage',
      fileName: 'usage.csv',
    });

    const base = {
      organization: ORG,
      usage: analysis.result.usage,
      entitlements: [],
      people: [],
    };

    const orphaned = buildDatasetFromCanonical({
      ...base,
      contracts: [contractRecord('SOMETHING_ELSE_ENTIRELY')],
    });

    expect(orphaned.hourlyUsage).toEqual(buildDatasetFromCanonical(base).hourlyUsage);
    // The unmatched line is surfaced rather than silently absorbed.
    expect(orphaned.unmappedFeatures.some((f) => f.rawValue === 'SOMETHING_ELSE_ENTIRELY')).toBe(true);
  });
});
