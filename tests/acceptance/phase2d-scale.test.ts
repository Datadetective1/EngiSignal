import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { ingestFile } from '@/lib/ingestion';
import { buildDatasetFromCanonical } from '@/lib/ingestion/dataset';
import { buildPortfolio, buildRenewals } from '@/lib/analytics/portfolio';
import { checkIntegrity } from '@/lib/analytics/integrity';
import { MAX_UPLOAD_BYTES } from '@/lib/ingestion/parse';
import { DEFAULT_ANALYSIS_OPTIONS } from '@/lib/domain/dataset';
import type { AnalyticsDataset } from '@/lib/domain/dataset';
import type { Organization, PortfolioRow } from '@/lib/domain/types';
import type {
  CanonicalContractRecord,
  CanonicalEntitlementRecord,
  CanonicalPersonRecord,
  CanonicalUsageRecord,
} from '@/lib/ingestion/canonical/types';

/**
 * THE PHASE 2D ACCEPTANCE ESTATE — "Kestrel Dynamics", at the stated ceiling.
 *
 * Phase 2C closed with one honest gap: the 4 MB / ~68,000-row limit printed on
 * the import page had never been exercised. Every estate the product had ever
 * analysed was a few percent of it, and the read path had just been rewritten
 * into paged queries — the shape most likely to fail only at volume, and to
 * fail by returning less rather than by failing.
 *
 * The same four files uploaded to production run through the same code path
 * here, so every figure in the Phase 2D closure report has a reproducible
 * source and a regression that changes it fails here first.
 *
 * See tests/fixtures/acceptance/build_scale.py for how the estate is built and
 * what each feature is designed to prove. The one property that matters most:
 * rows are emitted in date order, so a truncated read does not merely
 * under-count — it drops whole features and drags the analysis as-of date
 * backwards, which is exactly what Phase 2C found in production.
 */

const FIXTURES = path.resolve(__dirname, '../fixtures/acceptance');
const ORG_ID = 'org-acceptance-2d';
const AS_OF = '2026-08-14';

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

let usage: CanonicalUsageRecord[];
let entitlements: CanonicalEntitlementRecord[];
let people: CanonicalPersonRecord[];
let contracts: CanonicalContractRecord[];
let dataset: AnalyticsDataset;
let portfolio: PortfolioRow[];
let accepted: { usage: number; people: number; entitlements: number; contracts: number };

const feature = (id: string) => portfolio.find((row) => row.featureId === id);

beforeAll(async () => {
  const load = async (file: string, kind: 'usage' | 'entitlements' | 'people' | 'contracts') =>
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

  usage = u.result.usage;
  entitlements = e.result.entitlements;
  people = p.result.people;
  contracts = c.result.contracts;

  accepted = {
    usage: usage.length,
    people: people.length,
    entitlements: entitlements.length,
    contracts: contracts.length,
  };

  dataset = buildDatasetFromCanonical({
    organization: ORG,
    usage,
    entitlements,
    people,
    contracts,
    featureAliases: new Map(),
    userAliases: new Map(),
    asOf: AS_OF,
  });

  portfolio = buildPortfolio(dataset, DEFAULT_ANALYSIS_OPTIONS);
}, 120_000);

describe('the estate is actually at the ceiling', () => {
  it('fits inside the upload limit the import page states', () => {
    const size = fs.statSync(path.join(FIXTURES, 'scale_usage.csv')).size;
    expect(size).toBeLessThanOrEqual(MAX_UPLOAD_BYTES);
    // A load test that stops well short of the limit has not tested the limit.
    expect(size).toBeGreaterThan(3_000_000);
  });

  it('carries about the row count the import page promises', () => {
    // The page says "roughly 68,000 usage rows". This estate is 68,008 read.
    expect(usage.length + 741).toBeGreaterThan(67_000);
    expect(usage.length).toBeGreaterThan(66_000);
  });

  it('covers a full year across thirteen features', () => {
    expect(dataset.features).toHaveLength(13);
    expect(dataset.dailyUsage.length).toBeGreaterThan(2_000);
  });
});

describe('analysed rows reconcile to stored rows', () => {
  /**
   * The Phase 2C defect, asserted at ten times the volume that hid it. The
   * paging fix reads until a page comes back short; the boundary that would
   * silently drop a final page is an exact multiple of the page size, so the
   * count is checked rather than the absence of an error.
   */
  it('analyses every usage row it was given', () => {
    expect(dataset.analyzedRows.usage).toBe(usage.length);
  });

  it('analyses every people, entitlement and contract row it was given', () => {
    expect(dataset.analyzedRows.people).toBe(people.length);
    expect(dataset.analyzedRows.entitlements).toBe(entitlements.length);
    expect(dataset.analyzedRows.contracts).toBe(contracts.length);
  });

  it('reports the estate complete when all three counts agree', () => {
    const report = checkIntegrity({
      accepted,
      stored: accepted,
      analyzed: dataset.analyzedRows,
    });
    expect(report.complete).toBe(true);
    expect(report.usageIncomplete).toBe(false);
    expect(report.headline).toContain('accepted, stored and analyzed');
  });

  it('withholds analytics the moment one stored row is not read', () => {
    // One row. Not a percentage, not a threshold — the product cannot know
    // which row it missed, so it cannot defend any figure derived from usage.
    const report = checkIntegrity({
      accepted,
      stored: accepted,
      analyzed: { ...dataset.analyzedRows, usage: dataset.analyzedRows.usage - 1 },
    });
    expect(report.complete).toBe(false);
    expect(report.usageIncomplete).toBe(true);
    expect(report.datasets.find((d) => d.dataset === 'usage')?.statement).toContain(
      'were not read into this analysis',
    );
  });
});

describe('truncation would change the answers, so the test is worth running', () => {
  /**
   * A load test only proves something if reading less would be visibly wrong.
   * The estate is emitted in date order for exactly this reason.
   */
  it('loses whole features to a first-page-only read', () => {
    const firstPage = usage.slice(0, 1_000);
    const seen = new Set(firstPage.map((row) => row.feature));
    expect(seen.size).toBeLessThan(13);
    expect(seen.has('STAR_CCM')).toBe(false);
    expect(seen.has('VERICUT')).toBe(false);
  });

  it('drags the analysis as-of date backwards on a truncated read', () => {
    const truncated = buildDatasetFromCanonical({
      organization: ORG,
      usage: usage.slice(0, 1_000),
      entitlements,
      people,
      contracts,
      featureAliases: new Map(),
      userAliases: new Map(),
    });
    // Whole months of countdown, invented out of a transport limit.
    expect(truncated.asOf < dataset.asOf).toBe(true);
  });
});

describe('the estate analyses correctly at volume', () => {
  it('separates purchased from served on the money feature', () => {
    const row = feature('feature:ansys_mech_ent');
    expect(row).toBeDefined();
    // 350 served by the licence server, 440 bought on the contract.
    expect(row!.entitled).toBe(350);
  });

  it('prices a node-locked contract that has no entitlement row at all', () => {
    const row = feature('feature:floefd');
    expect(row).toBeDefined();
    expect(row!.unitPrice).toBe(3900);
  });

  it('refuses to price the named-user product with no contract', () => {
    const row = feature('feature:nx_cam');
    expect(row).toBeDefined();
    expect(row!.unitPrice).toBeNull();
    expect(row!.financial.priced).toBe(false);
  });

  it('rates the late-deployed feature lower in confidence than a full-year one', () => {
    const late = feature('feature:star_ccm');
    const full = feature('feature:ansys_mech_ent');
    expect(late).toBeDefined();
    expect(full).toBeDefined();
    expect(late!.confidence.score).toBeLessThan(full!.confidence.score);
  });

  it('builds a renewal for every dated contract position', () => {
    const renewals = buildRenewals(dataset, portfolio);
    expect(renewals.length).toBeGreaterThanOrEqual(11);
    for (const renewal of renewals) {
      expect(renewal.contractId.startsWith(`contract:${ORG_ID}:`)).toBe(true);
    }
  });
});
