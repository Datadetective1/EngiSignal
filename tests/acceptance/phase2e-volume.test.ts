import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ingestFile } from '@/lib/ingestion';
import { summarizeCoverage } from '@/lib/ingestion/store/types';
import { buildDatasetFromCanonical } from '@/lib/ingestion/dataset';
import { buildPortfolio } from '@/lib/analytics/portfolio';
import { DEFAULT_ANALYSIS_OPTIONS } from '@/lib/domain/dataset';
import { deserializeDataset, serializeDataset } from '@/lib/analytics/projection';
import type { Organization } from '@/lib/domain/types';
import type {
  CanonicalContractRecord,
  CanonicalEntitlementRecord,
  CanonicalPersonRecord,
  CanonicalUsageRecord,
} from '@/lib/ingestion/canonical/types';

/**
 * ── THE CLAIM PHASE 2E RESTS ON ─────────────────────────────────────────────
 *
 * Raw evidence grows with observations. The projection grows with features ×
 * days × people. If that is true, caching the projection keeps working as a
 * customer's estate grows; if it is false, Phase 2E has bought one release of
 * headroom and will fail again at the next ceiling.
 *
 * So it is measured rather than asserted, across a 4x range of estate sizes
 * built from the same generator with the same features, prices and dates:
 *
 *     68,008   the Phase 2D per-file ceiling estate
 *    144,258   three files
 *    286,453   five files
 *
 * These are the numbers quoted in the Phase 2E closure report.
 */

const FIXTURES = path.resolve(__dirname, '../fixtures/acceptance');

function bytes(file: string): ArrayBuffer {
  const buffer = fs.readFileSync(path.join(FIXTURES, file));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

const org = (id: string, headcount: number): Organization => ({
  id,
  name: 'Kestrel Dynamics',
  slug: 'kestrel-dynamics',
  industry: 'Aerospace',
  technicalHeadcount: headcount,
  headcountGrowthRate: null,
  currency: 'USD',
  isDemo: false,
  createdAt: '2026-01-01T00:00:00.000Z',
});

interface Measured {
  label: string;
  usageRows: number;
  people: number;
  rawBytes: number;
  projectionBytes: number;
  buildMs: number;
  inflateMs: number;
  hourly: number;
  daily: number;
  activities: number;
}

async function measure(label: string, usageFiles: string[], stem: string, headcount: number): Promise<Measured> {
  const id = `org-${label}`;
  const usage: CanonicalUsageRecord[] = [];
  let rawBytes = 0;

  for (const [index, file] of usageFiles.entries()) {
    rawBytes += fs.statSync(path.join(FIXTURES, file)).size;
    const result = await ingestFile(bytes(file), {
      dataset: 'usage',
      organizationId: id,
      importId: `import-usage-${index}`,
      fileName: file,
    });
    usage.push(...result.result.usage);
  }

  const load = async <T,>(file: string, kind: 'entitlements' | 'people' | 'contracts') => {
    const result = await ingestFile(bytes(file), {
      dataset: kind,
      organizationId: id,
      importId: `import-${kind}`,
      fileName: file,
    });
    return result.result[kind] as T[];
  };

  const entitlements = await load<CanonicalEntitlementRecord>(`${stem}_entitlements.csv`, 'entitlements');
  const people = await load<CanonicalPersonRecord>(`${stem}_people.csv`, 'people');
  const contracts = await load<CanonicalContractRecord>(`${stem}_contracts.csv`, 'contracts');

  const startedAt = Date.now();
  const dataset = buildDatasetFromCanonical({
    organization: org(id, headcount),
    usage,
    entitlements,
    people,
    contracts,
    featureAliases: new Map(),
    userAliases: new Map(),
    asOf: '2026-08-14',
  });
  buildPortfolio(dataset, DEFAULT_ANALYSIS_OPTIONS);
  const buildMs = Date.now() - startedAt;

  const serialized = serializeDataset({
    dataset,
    coverage: summarizeCoverage(usage, entitlements, people, contracts),
  });

  const inflateStart = Date.now();
  const restored = deserializeDataset(serialized.payload).dataset;
  const inflateMs = Date.now() - inflateStart;

  // The measurement is worthless if the thing measured is not equivalent.
  expect(buildPortfolio(restored, DEFAULT_ANALYSIS_OPTIONS)).toEqual(
    buildPortfolio(dataset, DEFAULT_ANALYSIS_OPTIONS),
  );
  expect(dataset.analyzedRows.usage).toBe(usage.length);

  return {
    label,
    usageRows: usage.length,
    people: people.length,
    rawBytes,
    projectionBytes: serialized.bytes,
    buildMs,
    inflateMs,
    hourly: dataset.hourlyUsage.length,
    daily: dataset.dailyUsage.length,
    activities: dataset.activities.length,
  };
}

describe('the projection at 68k, 150k and 300k rows', () => {
  it('stays bounded while the evidence behind it quadruples', async () => {
    const results: Measured[] = [];
    results.push(await measure('68k', ['scale_usage.csv'], 'scale', 403));
    results.push(
      await measure('150k', ['vol150_usage_1.csv', 'vol150_usage_2.csv', 'vol150_usage_3.csv'], 'vol150', 603),
    );
    results.push(
      await measure(
        '300k',
        ['vol300_usage_1.csv', 'vol300_usage_2.csv', 'vol300_usage_3.csv', 'vol300_usage_4.csv', 'vol300_usage_5.csv'],
        'vol300',
        1203,
      ),
    );

    const mb = (v: number) => `${(v / 1_048_576).toFixed(2)} MB`;
    console.log('\n  estate    usage rows   people   raw usage   projection   build    inflate   hourly  daily  activities');
    for (const r of results) {
      console.log(
        `  ${r.label.padEnd(8)} ${String(r.usageRows).padStart(10)} ${String(r.people).padStart(8)} ` +
          `${mb(r.rawBytes).padStart(11)} ${mb(r.projectionBytes).padStart(12)} ` +
          `${(r.buildMs + ' ms').padStart(8)} ${(r.inflateMs + ' ms').padStart(9)} ` +
          `${String(r.hourly).padStart(7)} ${String(r.daily).padStart(6)} ${String(r.activities).padStart(11)}`,
      );
    }

    const [small, , large] = results as [Measured, Measured, Measured];
    const rowGrowth = large.usageRows / small.usageRows;
    const projectionGrowth = large.projectionBytes / small.projectionBytes;
    console.log(
      `\n  rows grew ${rowGrowth.toFixed(1)}x, projection grew ${projectionGrowth.toFixed(1)}x\n`,
    );

    // The property the architecture depends on: the projection must grow
    // materially more slowly than the evidence. If this ever fails, caching the
    // projection has stopped being the right answer and the report should say
    // so rather than the test being relaxed.
    expect(projectionGrowth).toBeLessThan(rowGrowth * 0.75);

    // Hourly demand is bounded by features x days x slots, not by observations:
    // four times the rows over the same year must not multiply it.
    expect(large.hourly).toBeLessThan(small.hourly * 1.5);
    expect(large.daily).toBeLessThan(small.daily * 1.5);

    // Every payload has to fit comfortably in one request.
    for (const r of results) expect(r.projectionBytes).toBeLessThan(8_000_000);
  }, 900_000);
});
