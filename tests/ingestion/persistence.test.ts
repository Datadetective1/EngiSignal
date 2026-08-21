import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ingestParsedFile } from '@/lib/ingestion';
import { parseDelimited } from '@/lib/ingestion/parse';
import { __resetMemoryStore, memoryIngestionStore as store } from '@/lib/ingestion/store/memory-store';
import { summarizeCoverage } from '@/lib/ingestion/store/types';
import { projectUsage, projectedFeatureId } from '@/lib/ingestion/project';
import { capabilityLines, unlockSuggestions } from '@/lib/ingestion/capabilities';

const FIXTURES = path.resolve(__dirname, '../fixtures/ingestion');

function analyze(
  fileName: string,
  options: { organizationId?: string; importId?: string; dataset?: 'usage' | 'entitlements' | 'people' } = {},
) {
  const text = readFileSync(path.join(FIXTURES, fileName), 'utf8');
  const parsed = parseDelimited(text);
  return ingestParsedFile(parsed, {
    dataset: options.dataset ?? 'usage',
    organizationId: options.organizationId ?? 'org-alpha',
    importId: options.importId ?? 'import-0001',
    fileName,
    importedAt: '2026-08-15T00:00:00.000Z',
  });
}

async function commit(
  fileName: string,
  options: { organizationId?: string; importId?: string; dataset?: 'usage' | 'entitlements' | 'people' } = {},
) {
  const analysis = analyze(fileName, options);
  const mappingUsed: Record<string, string> = {};
  for (const mapping of analysis.mappings) {
    if (mapping.field !== null) mappingUsed[mapping.sourceColumn] = mapping.field;
  }

  return store.commitImport({
    organizationId: options.organizationId ?? 'org-alpha',
    importId: options.importId ?? 'import-0001',
    fileName,
    fileBytes: 1024,
    dataset: options.dataset ?? 'usage',
    detectionEvidence: analysis.detection.evidence,
    detectionConfidence: analysis.detection.confidence,
    detectionFellBack: analysis.detection.fellBack,
    sourceSheets: analysis.sheetNames,
    mappingUsed,
    result: analysis.result,
  });
}

beforeEach(() => {
  __resetMemoryStore();
});

describe('committing an import', () => {
  it('persists canonical records and reports what was stored', async () => {
    const summary = await commit('flexnet-usage.csv');

    expect(summary.status).toBe('complete');
    expect(summary.sourceSystem).toBe('flexnet');
    expect(summary.usageRecords).toBe(8);
    expect(summary.acceptedRows).toBe(8);
    expect(summary.rejectedRows).toBe(0);

    const stored = await store.listUsage('org-alpha');
    expect(stored).toHaveLength(8);
    expect(stored[0]!.feature).toBe('MECH_ENT');
  });

  it('keeps provenance on every persisted record', async () => {
    await commit('flexnet-usage.csv');
    const stored = await store.listUsage('org-alpha');

    for (const record of stored) {
      expect(record.provenance.organizationId).toBe('org-alpha');
      expect(record.provenance.importId).toBe('import-0001');
      expect(record.provenance.sourceFile).toBe('flexnet-usage.csv');
      expect(record.provenance.sourceSystem).toBe('flexnet');
      expect(record.provenance.sourceRow).toBeGreaterThan(1);
    }
  });

  it('keeps accepted plus rejected reconcilable with the stored records', async () => {
    const summary = await commit('malformed-usage.csv');
    const stored = await store.listUsage('org-alpha');

    expect(summary.acceptedRows + summary.rejectedRows).toBe(summary.totalRows);
    expect(stored).toHaveLength(summary.acceptedRows);
    expect(summary.usageRecords).toBe(stored.length);
  });

  it('does not persist rejected rows as analytical records', async () => {
    const summary = await commit('malformed-usage.csv');
    const stored = await store.listUsage('org-alpha');

    expect(summary.rejectedRows).toBeGreaterThan(0);
    // Every stored record is a valid one; rejections live only in the audit.
    for (const record of stored) {
      expect(record.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(record.feature.length).toBeGreaterThan(0);
    }

    const detail = await store.getImport('org-alpha', 'import-0001');
    expect(detail?.rejections.length).toBeGreaterThan(0);
  });

  it('is retry-safe: re-committing the same import does not double-count', async () => {
    await commit('flexnet-usage.csv');
    await commit('flexnet-usage.csv');

    const stored = await store.listUsage('org-alpha');
    expect(stored).toHaveLength(8);

    const imports = await store.listImports('org-alpha');
    expect(imports).toHaveLength(1);
  });

  it('refuses records belonging to another organization', async () => {
    const analysis = analyze('flexnet-usage.csv', { organizationId: 'org-beta' });

    await expect(
      store.commitImport({
        organizationId: 'org-alpha',
        importId: 'import-mismatch',
        fileName: 'flexnet-usage.csv',
        fileBytes: 10,
        dataset: 'usage',
        detectionEvidence: [],
        detectionConfidence: 99,
        detectionFellBack: false,
        sourceSheets: [],
        mappingUsed: {},
        result: analysis.result,
      }),
    ).rejects.toThrow(/another organization/i);
  });
});

describe('import history', () => {
  it('lists imports for the owning tenant only', async () => {
    await commit('flexnet-usage.csv', { organizationId: 'org-alpha', importId: 'a-1' });
    await commit('rlm-usage.csv', { organizationId: 'org-beta', importId: 'b-1' });

    const alpha = await store.listImports('org-alpha');
    const beta = await store.listImports('org-beta');

    expect(alpha.map((row) => row.id)).toEqual(['a-1']);
    expect(beta.map((row) => row.id)).toEqual(['b-1']);
  });

  it('never returns another tenant import by id', async () => {
    await commit('flexnet-usage.csv', { organizationId: 'org-alpha', importId: 'a-1' });

    expect(await store.getImport('org-beta', 'a-1')).toBeNull();
    expect(await store.getImport('org-alpha', 'a-1')).not.toBeNull();
  });

  it('retains detection, mapping, warnings and quality for audit', async () => {
    await commit('flexnet-usage.csv');
    const detail = await store.getImport('org-alpha', 'import-0001');

    expect(detail?.detectionEvidence.length).toBeGreaterThan(0);
    expect(Object.keys(detail?.mappingUsed ?? {}).length).toBeGreaterThan(0);
    expect(detail?.quality).not.toBeNull();
    expect(detail?.mappingUsed.FEATURE).toBe('feature');
  });
});

describe('reversing an import', () => {
  it('removes only that import and its records', async () => {
    await commit('flexnet-usage.csv', { importId: 'a-1' });
    await commit('rlm-usage.csv', { importId: 'a-2' });

    expect(await store.listUsage('org-alpha')).toHaveLength(13);

    const removed = await store.deleteImport('org-alpha', 'a-1');
    expect(removed).toBe(true);

    const remaining = await store.listUsage('org-alpha');
    expect(remaining).toHaveLength(5);
    expect(remaining.every((row) => row.provenance.importId === 'a-2')).toBe(true);
    expect(await store.listImports('org-alpha')).toHaveLength(1);
  });

  it('cannot delete another tenant import', async () => {
    await commit('flexnet-usage.csv', { organizationId: 'org-alpha', importId: 'a-1' });

    expect(await store.deleteImport('org-beta', 'a-1')).toBe(false);
    expect(await store.listUsage('org-alpha')).toHaveLength(8);
  });

  it('reports false for an import that does not exist', async () => {
    expect(await store.deleteImport('org-alpha', 'missing')).toBe(false);
  });
});

describe('tenant isolation of persisted data', () => {
  it('keeps canonical records unreachable across tenants', async () => {
    await commit('flexnet-usage.csv', { organizationId: 'org-alpha', importId: 'a-1' });
    await commit('rlm-usage.csv', { organizationId: 'org-beta', importId: 'b-1' });

    const alpha = await store.listUsage('org-alpha');
    const beta = await store.listUsage('org-beta');

    expect(alpha.every((row) => row.provenance.organizationId === 'org-alpha')).toBe(true);
    expect(beta.every((row) => row.provenance.organizationId === 'org-beta')).toBe(true);
    expect(alpha.some((row) => row.feature === 'hwsolver')).toBe(false);
  });

  it('scopes coverage to one tenant', async () => {
    await commit('flexnet-usage.csv', { organizationId: 'org-alpha', importId: 'a-1' });
    await commit('rlm-usage.csv', { organizationId: 'org-beta', importId: 'b-1' });

    const alpha = await store.getCoverage('org-alpha');
    const beta = await store.getCoverage('org-beta');

    expect(alpha.usageRecords).toBe(8);
    expect(beta.usageRecords).toBe(5);
  });
});

describe('coverage', () => {
  it('summarizes what has been ingested', async () => {
    await commit('flexnet-usage.csv');
    const coverage = await store.getCoverage('org-alpha');

    expect(coverage.usageRecords).toBe(8);
    expect(coverage.distinctFeatures).toBe(3);
    expect(coverage.firstDate).toBe('2026-03-02');
    expect(coverage.lastDate).toBe('2026-03-03');
    expect(coverage.historyDays).toBe(2);
    expect(coverage.hasConcurrency).toBe(true);
    expect(coverage.sources).toEqual(['flexnet']);
  });

  it('reports denials as not supplied when the source did not carry them', () => {
    const coverage = summarizeCoverage(
      [
        {
          date: '2026-03-02',
          hour: null,
          observedAt: null,
          user: null,
          employeeCode: null,
          feature: 'F',
          product: null,
          vendor: null,
          quantity: null,
          concurrent: 5,
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
          hostname: null,
          version: null,
          borrowed: null,
          provenance: {
            organizationId: 'o',
            importId: 'i',
            importedAt: '2026-08-15T00:00:00.000Z',
            sourceFile: 'f.csv',
            sourceSystem: 'sentinel',
            sourceSheet: null,
            sourceRow: 2,
          },
        },
      ],
      [],
      [],
    );

    expect(coverage.hasDenials).toBe(false);
    expect(coverage.hasConcurrency).toBe(true);
  });
});

describe('projection to analytics shapes', () => {
  it('groups observations into hourly and daily usage', async () => {
    await commit('flexnet-usage.csv');
    const usage = await store.listUsage('org-alpha');
    const projection = projectUsage(usage);

    expect(projection.hourlyUsage.length).toBeGreaterThan(0);
    expect(projection.dailyUsage.length).toBeGreaterThan(0);

    for (const row of projection.hourlyUsage) {
      expect(row.hour).toBeGreaterThanOrEqual(0);
      expect(row.hour).toBeLessThanOrEqual(23);
      expect(row.concurrent).toBeGreaterThanOrEqual(0);
    }
  });

  it('takes the maximum when several observations share an hour', () => {
    const base = {
      hour: 9,
      observedAt: null,
      user: null,
      employeeCode: null,
      product: null,
      vendor: null,
      quantity: null,
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
      hostname: null,
      version: null,
      borrowed: null,
      provenance: {
        organizationId: 'o',
        importId: 'i',
        importedAt: '2026-08-15T00:00:00.000Z',
        sourceFile: 'f.csv',
        sourceSystem: 'flexnet' as const,
        sourceSheet: null,
        sourceRow: 2,
      },
    };

    const projection = projectUsage([
      { ...base, date: '2026-03-02', feature: 'F', concurrent: 12 },
      { ...base, date: '2026-03-02', feature: 'F', concurrent: 31 },
      { ...base, date: '2026-03-02', feature: 'F', concurrent: 8 },
    ]);

    expect(projection.hourlyUsage).toHaveLength(1);
    // The high-water mark, not the average: understating concurrent demand
    // would recommend too few licenses.
    expect(projection.hourlyUsage[0]!.concurrent).toBe(31);
    expect(projection.dailyUsage[0]!.peak).toBe(31);
  });

  it('produces a deterministic feature id from the raw string', () => {
    expect(projectedFeatureId('MECH_ENT')).toBe(projectedFeatureId('mech_ent'));
    expect(projectedFeatureId('MECH_ENT')).not.toBe(projectedFeatureId('CFD_PREM'));
  });

  it('counts observations that carry no concurrency rather than assuming zero', () => {
    const projection = projectUsage([
      {
        date: '2026-03-02',
        hour: null,
        observedAt: null,
        user: 'a',
        employeeCode: null,
        feature: 'F',
        product: null,
        vendor: null,
        quantity: 3,
        concurrent: null,
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
        hostname: null,
        version: null,
        borrowed: null,
        provenance: {
          organizationId: 'o',
          importId: 'i',
          importedAt: '2026-08-15T00:00:00.000Z',
          sourceFile: 'f.csv',
          sourceSystem: 'generic',
          sourceSheet: null,
          sourceRow: 2,
        },
      },
    ]);

    // A checkout count is not a concurrency figure and is not treated as one.
    expect(projection.observationsWithoutConcurrency).toBe(1);
    expect(projection.hourlyUsage).toHaveLength(0);
    expect(projection.dailyUsage[0]!.peak).toBe(0);
  });

  it('carries entitlement quantity onto the projected feature', async () => {
    await commit('flexnet-usage.csv', { importId: 'u-1' });
    await commit('flexnet-entitlements.csv', { importId: 'e-1', dataset: 'entitlements' });

    const usage = await store.listUsage('org-alpha');
    const entitlements = await store.listEntitlements('org-alpha');
    const projection = projectUsage(usage, entitlements);

    const mech = projection.features.find((feature) => feature.rawFeature === 'MECH_ENT');
    expect(mech?.entitledQuantity).toBe(400);
    expect(mech?.licenseModel).toBe('concurrent');
  });
});

describe('analysis capabilities', () => {
  it('grants only what the imported data supports', async () => {
    await commit('flexnet-usage.csv');
    const usage = await store.listUsage('org-alpha');
    const coverage = await store.getCoverage('org-alpha');

    const lines = capabilityLines({
      coverage,
      distinctDates: new Set(usage.map((row) => row.date)).size,
      hasCost: false,
      resolvedPeople: 0,
    });
    const by = (key: string) => lines.find((line) => line.key === key)!;

    expect(by('usageTrends').available).toBe(true);
    expect(by('dailyDemand').available).toBe(true);
    // Two days is not enough history for a percentile to mean anything.
    expect(by('percentileDemand').available).toBe(false);
    expect(by('capacityHeadroom').available).toBe(false);
    expect(by('organizationAllocation').available).toBe(false);

    const unlocks = unlockSuggestions({
      coverage,
      distinctDates: 2,
      hasCost: false,
      resolvedPeople: 0,
    });
    expect(unlocks.some((entry) => entry.needs.includes('entitlements'))).toBe(true);
  });

  it('never claims financial opportunity from a license export alone', async () => {
    await commit('flexnet-usage.csv');
    const coverage = await store.getCoverage('org-alpha');

    const lines = capabilityLines({
      coverage: { ...coverage, entitlementRecords: 4, hasDenials: true },
      distinctDates: 400,
      hasCost: false,
      resolvedPeople: 10,
    });

    // Cost never arrives through a license manager.
    const financial = lines.find((line) => line.key === 'financialOpportunity')!;
    expect(financial.available).toBe(false);
    expect(financial.requires).toContain('cost');
  });

  it('unlocks percentile demand once there is enough history', async () => {
    await commit('flexnet-usage.csv');
    const coverage = await store.getCoverage('org-alpha');

    const lines = capabilityLines({
      coverage: { ...coverage, entitlementRecords: 1 },
      distinctDates: 40,
      hasCost: false,
      resolvedPeople: 0,
    });

    expect(lines.find((line) => line.key === 'percentileDemand')!.available).toBe(true);
    expect(lines.find((line) => line.key === 'capacityHeadroom')!.available).toBe(true);
  });
});

describe('end-to-end across every source', () => {
  const sources = [
    { file: 'flexnet-usage.csv', source: 'flexnet', records: 8 },
    { file: 'rlm-usage.csv', source: 'rlm', records: 5 },
    { file: 'dsls-usage.csv', source: 'dsls', records: 5 },
    { file: 'sentinel-usage.csv', source: 'sentinel', records: 5 },
    { file: 'generic-usage.csv', source: 'generic', records: 5 },
  ] as const;

  it('detects, normalizes, persists and retrieves each source', async () => {
    for (const { file, source, records } of sources) {
      __resetMemoryStore();
      const summary = await commit(file, { importId: `imp-${source}` });

      expect(summary.sourceSystem).toBe(source);
      expect(summary.usageRecords).toBe(records);

      const stored = await store.listUsage('org-alpha');
      expect(stored).toHaveLength(records);

      const coverage = await store.getCoverage('org-alpha');
      expect(coverage.usageRecords).toBe(records);

      const projection = projectUsage(stored);
      expect(projection.dailyUsage.length).toBeGreaterThan(0);

      const history = await store.listImports('org-alpha');
      expect(history).toHaveLength(1);
      expect(history[0]!.sourceSystem).toBe(source);
    }
  });
});
