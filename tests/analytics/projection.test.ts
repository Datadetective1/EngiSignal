import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { ingestFile } from '@/lib/ingestion';
import { summarizeCoverage } from '@/lib/ingestion/store/types';
import { resolveUsers } from '@/lib/ingestion/identity';
import { buildDatasetFromCanonical } from '@/lib/ingestion/dataset';
import { buildPortfolio, buildRenewals, portfolioConfidence } from '@/lib/analytics/portfolio';
import { computePortfolioTotals, unusedCapacitySpend } from '@/lib/analytics/financial';
import { allocateCostAutomatically } from '@/lib/analytics/allocation';
import { DEFAULT_ANALYSIS_OPTIONS } from '@/lib/domain/dataset';
import {
  PROJECTION_VERSION,
  deserializeDataset,
  evidenceKeyFor,
  projectionUsable,
  serializeDataset,
  shortEvidenceKey,
} from '@/lib/analytics/projection';
import type { AnalyticsDataset } from '@/lib/domain/dataset';
import type { Organization } from '@/lib/domain/types';

/**
 * ── A CACHED ANSWER MUST BE THE SAME ANSWER ──────────────────────────────────
 *
 * Phase 2E stopped recomputing the whole estate on every page view. The risk it
 * introduces is the one this codebase has spent four phases removing: a
 * confident number derived from evidence that is no longer there.
 *
 * Two properties have to hold, and neither can be taken on trust.
 *
 *   1. A projection round trip changes nothing. Not "nothing important" —
 *      nothing. Every derived surface computed from a deserialized dataset must
 *      equal the same surface computed from the original.
 *
 *   2. A projection is used only when the evidence still matches exactly. Not
 *      recently, not approximately, not within a refresh window.
 *
 * Run against the Phase 2D ceiling estate rather than a toy, because the
 * collections that are expensive to serialize — daily peaks, weekday/hour
 * demand, per-user activity — only exist at volume.
 */

const FIXTURES = path.resolve(__dirname, '../fixtures/acceptance');
const ORG_ID = 'org-projection';

const ORG: Organization = {
  id: ORG_ID,
  name: 'Kestrel Dynamics',
  slug: 'kestrel-dynamics',
  industry: 'Aerospace',
  technicalHeadcount: 403,
  headcountGrowthRate: null,
  currency: 'USD',
  isDemo: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function bytes(file: string): ArrayBuffer {
  const buffer = fs.readFileSync(path.join(FIXTURES, file));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

let dataset: AnalyticsDataset;
let restored: AnalyticsDataset;
let payloadBytes: number;

beforeAll(async () => {
  const load = (file: string, kind: 'usage' | 'entitlements' | 'people' | 'contracts') =>
    ingestFile(bytes(file), {
      dataset: kind,
      organizationId: ORG_ID,
      importId: `import-${kind}`,
      fileName: file,
    });

  const [u, e, p, c] = await Promise.all([
    load('scale_usage.csv', 'usage'),
    load('scale_entitlements.csv', 'entitlements'),
    load('scale_people.csv', 'people'),
    load('scale_contracts.csv', 'contracts'),
  ]);

  dataset = buildDatasetFromCanonical({
    organization: ORG,
    usage: u.result.usage,
    entitlements: e.result.entitlements,
    people: p.result.people,
    contracts: c.result.contracts,
    featureAliases: new Map(),
    userAliases: new Map(),
    asOf: '2026-08-14',
  });

  const serialized = serializeDataset({
    dataset,
    coverage: summarizeCoverage(u.result.usage, e.result.entitlements, p.result.people, c.result.contracts),
    userIdentities: resolveUsers(u.result.usage, p.result.people),
  });
  payloadBytes = serialized.bytes;
  restored = deserializeDataset(serialized.payload).dataset;
}, 300_000);

describe('a projection round trip', () => {
  it('preserves the dataset exactly', () => {
    expect(restored).toEqual(dataset);
  });

  it('preserves every collection that costs anything to carry', () => {
    expect(restored.dailyUsage).toHaveLength(dataset.dailyUsage.length);
    expect(restored.hourlyUsage).toHaveLength(dataset.hourlyUsage.length);
    expect(restored.activities).toHaveLength(dataset.activities.length);
    expect(restored.employees).toHaveLength(dataset.employees.length);
    expect(restored.features).toHaveLength(dataset.features.length);
    expect(restored.contracts).toHaveLength(dataset.contracts.length);
  });

  it('preserves the row accounting, which is what proves the read was complete', () => {
    expect(restored.analyzedRows).toEqual(dataset.analyzedRows);
    expect(restored.analyzedRows.usage).toBeGreaterThan(66_000);
  });

  it('preserves null as null, and never as zero', () => {
    // The whole product rests on this. NX_CAM has no contract, so its price is
    // unknown; a serialization that turned that into 0 would invent a free
    // licence and a reclaim value to go with it.
    const unpriced = dataset.contractItems.find((item) => item.unitPrice === null);
    expect(unpriced).toBeDefined();
    const after = restored.contractItems.find((item) => item.id === unpriced!.id);
    expect(after?.unitPrice).toBeNull();

    const nulls = JSON.stringify(restored).match(/:null/g) ?? [];
    expect(nulls.length).toBeGreaterThan(0);
  });

  it('is an order of magnitude smaller than the rows behind it', () => {
    // 67,267 canonical rows are ~18 MB on the wire. The projection is bounded
    // by features x days x people instead, which is why this works at all.
    expect(payloadBytes).toBeLessThan(2_000_000);
  });
});

describe('every derived surface, computed from the projection', () => {
  const surfaces = (source: AnalyticsDataset) => {
    const portfolio = buildPortfolio(source, DEFAULT_ANALYSIS_OPTIONS);
    return {
      portfolio,
      renewals: buildRenewals(source, portfolio),
      totals: computePortfolioTotals(portfolio),
      unusedCapacity: unusedCapacitySpend(portfolio),
      confidence: portfolioConfidence(portfolio),
      allocation: allocateCostAutomatically({
        dimension: 'department',
        // Exactly what the Cost page passes, so the comparison is of the real
        // allocation and not of a simplified stand-in.
        features: portfolio.map((row) => ({
          featureId: row.featureId,
          licenseModel: row.licenseModel,
          annualCost: row.financial.currentAnnualCost,
          wasteAmount:
            row.licenseModel === 'concurrent' && row.unitPrice !== null && row.metrics !== null
              ? Math.max(0, row.entitled - row.metrics.p95) * row.unitPrice
              : (row.namedUser?.reclaimValue ?? 0),
        })),
        activities: source.activities,
        employees: source.employees,
      }),
    };
  };

  it('matches the same surface computed from canonical rows', () => {
    expect(surfaces(restored)).toEqual(surfaces(dataset));
  });

  it('still refuses to price what was never priced', () => {
    const after = buildPortfolio(restored, DEFAULT_ANALYSIS_OPTIONS);
    const nxCam = after.find((row) => row.featureId === 'feature:nx_cam');
    expect(nxCam).toBeDefined();
    expect(nxCam!.unitPrice).toBeNull();
    expect(nxCam!.financial.priced).toBe(false);
  });

  it('recomputes correctly under different assumptions', () => {
    // The Scenario Lab changes percentile and growth and recalculates. That has
    // to work off the projection, or the projection has thrown away an input.
    const options = { ...DEFAULT_ANALYSIS_OPTIONS, percentile: 0.99, growthFactor: 1.15 };
    expect(buildPortfolio(restored, options)).toEqual(buildPortfolio(dataset, options));
  });
});

describe('the evidence key', () => {
  const base = {
    storedRows: { usage: 67_267, people: 403, entitlements: 12, contracts: 11 },
    imports: [
      { id: 'b', fingerprint: '12' },
      { id: 'a', fingerprint: '67267' },
    ],
    confirmations: { count: 2, latest: '2026-08-17T05:00:00.000Z' },
  };

  it('is stable regardless of the order rows came back in', () => {
    const reordered = { ...base, imports: [...base.imports].reverse() };
    expect(evidenceKeyFor(reordered)).toBe(evidenceKeyFor(base));
  });

  it('changes when a row count changes', () => {
    const changed = { ...base, storedRows: { ...base.storedRows, usage: 67_266 } };
    expect(evidenceKeyFor(changed)).not.toBe(evidenceKeyFor(base));
  });

  it('changes when an import is deleted and an identical-sized one added', () => {
    // The count-only key this replaces would have called these the same estate
    // and served the old answer for the new evidence.
    const swapped = {
      ...base,
      imports: [
        { id: 'c', fingerprint: '67267' },
        { id: 'b', fingerprint: '12' },
      ],
    };
    expect(evidenceKeyFor(swapped)).not.toBe(evidenceKeyFor(base));
  });

  it('changes when the customer confirms an identity', () => {
    // Confirming that two usernames are one person moves allocation, reclaim
    // and manager rollups without touching a canonical row.
    const confirmed = { ...base, confirmations: { count: 3, latest: '2026-08-17T06:00:00.000Z' } };
    expect(evidenceKeyFor(confirmed)).not.toBe(evidenceKeyFor(base));
  });

  it('changes when an existing decision is edited but the count is not', () => {
    const edited = { ...base, confirmations: { count: 2, latest: '2026-08-17T09:00:00.000Z' } };
    expect(evidenceKeyFor(edited)).not.toBe(evidenceKeyFor(base));
  });

  it('carries the format version, so an upgrade cannot reuse an old payload', () => {
    expect(evidenceKeyFor(base).startsWith(`v${PROJECTION_VERSION}|`)).toBe(true);
  });

  it('has a short form that differs for different evidence', () => {
    const other = { ...base, storedRows: { ...base.storedRows, usage: 1 } };
    expect(shortEvidenceKey(evidenceKeyFor(other))).not.toBe(shortEvidenceKey(evidenceKeyFor(base)));
  });
});

describe('deciding whether a stored projection may be used', () => {
  const key = 'v1|u10.p1.e1.c1|0@-|a:10';
  const record = { version: PROJECTION_VERSION, evidenceKey: key };

  it('uses it when the evidence matches exactly', () => {
    expect(projectionUsable(record, key)).toBeNull();
  });

  it('rebuilds when there is nothing stored', () => {
    expect(projectionUsable(null, key)).toBe('absent');
  });

  it('rebuilds when the evidence has moved', () => {
    expect(projectionUsable(record, 'v1|u11.p1.e1.c1|0@-|a:11')).toBe('evidence-changed');
  });

  it('rebuilds rather than deserializing a payload from an older format', () => {
    // A missing collection would deserialize as absent and read as "no usage
    // evidence", which is the absence-became-zero failure in a new costume.
    expect(projectionUsable({ ...record, version: PROJECTION_VERSION - 1 }, key)).toBe(
      'version-changed',
    );
  });

  it('has no notion of age, because age is not evidence', () => {
    // There is deliberately no maxAge parameter to pass. A projection is either
    // built from the evidence that exists now, or it is not used.
    expect(projectionUsable.length).toBe(2);
  });
});
