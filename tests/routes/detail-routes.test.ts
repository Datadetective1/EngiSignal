import { describe, expect, it, vi } from 'vitest';
import { buildDatasetFromCanonical } from '@/lib/ingestion/dataset';
import { buildPortfolio, buildRenewals, buildDataQualityIssues, portfolioConfidence } from '@/lib/analytics/portfolio';
import { computePortfolioTotals, unusedCapacitySpend } from '@/lib/analytics/financial';
import { checkIntegrity } from '@/lib/analytics/integrity';
import { AnalyticsWithheld } from '@/components/app/data-integrity';
import { reconcile } from '@/lib/analytics/reconciliation';
import { generateSignals } from '@/lib/analytics/signals';
import { DEFAULT_ANALYSIS_OPTIONS } from '@/lib/domain/dataset';
import {
  decodeRouteId,
  encodeRouteId,
  featureHref,
  renewalBriefHref,
  renewalHref,
} from '@/lib/routes';
import { ingestFile } from '@/lib/ingestion';
import type { Organization } from '@/lib/domain/types';

/**
 * EVERY DETAIL PAGE IN THE PRODUCT ANSWERED 404.
 *
 * Found in Phase 2D against the deployed application with a real imported
 * estate. The Renewals list showed a $2.2M Ansys agreement; clicking it — and
 * clicking any feature in the Portfolio, and every "Generate negotiation brief"
 * button — returned "This page could not be found."
 *
 * The cause is a difference between two halves of the App Router that is easy
 * to miss and impossible to see from a passing unit suite:
 *
 *   a ROUTE HANDLER receives its dynamic segment DECODED
 *   a PAGE receives the same segment STILL PERCENT-ENCODED
 *
 * Canonical identities here are `feature:<key>` and `contract:<org>:<key>`, and
 * a colon is percent-encoded in a path segment. So the page compared
 * `feature%3Aansys_mech_ent` against `feature:ansys_mech_ent`, found nothing,
 * and called notFound() — on data it had just finished listing.
 *
 * The second half of the defect is worse and had not been hit yet: a feature a
 * customer exports as "CATIA/V5" normalizes to the key `catia/v5`, and an
 * unencoded link puts a SLASH inside what must be one path segment. That is not
 * a lookup miss, it is a different route, and no amount of decoding recovers
 * it. Identities are therefore encoded on the way out as well as decoded on the
 * way in.
 *
 * These tests drive the real page components, with the params shaped exactly as
 * Next delivers them.
 */

const notFoundError = () => {
  const error = new Error('NEXT_NOT_FOUND');
  (error as { digest?: string }).digest = 'NEXT_HTTP_ERROR_FALLBACK;404';
  return error;
};

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw notFoundError();
  },
  redirect: (path: string) => {
    const error = new Error(`NEXT_REDIRECT:${path}`);
    (error as { digest?: string }).digest = `NEXT_REDIRECT;${path}`;
    throw error;
  },
}));

const ORG_ID = 'org-routes';
const AS_OF = '2026-08-14';

const ORG: Organization = {
  id: ORG_ID,
  name: 'Route Test Co',
  slug: 'route-test-co',
  industry: 'Aerospace',
  technicalHeadcount: 10,
  headcountGrowthRate: null,
  currency: 'USD',
  isDemo: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

/**
 * Feature names chosen to be hostile to URLs, and all of them legal in a real
 * licence-manager export: a colon (which the identity scheme adds anyway), a
 * slash, a space, a percent sign and a hash.
 */
const FEATURES = ['ANSYS_MECH_ENT', 'CATIA/V5', 'NX CAM', 'DISC%50', 'REV#2'] as const;

/** CSV text through the real ingestion path, so the records are real records. */
function csv(rows: string[]): ArrayBuffer {
  const buffer = Buffer.from(rows.join('\n'), 'utf8');
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

const usageCsv = ['date,hour,feature,user,in_use,license_server'];
for (let day = 1; day <= 20; day++) {
  const date = `2026-07-${String(day).padStart(2, '0')}`;
  for (const feature of FEATURES) {
    for (const hour of ['09:00', '14:00']) {
      usageCsv.push(`${date},${hour},"${feature}",user${day % 4},${8 + (day % 3)},lic-01`);
    }
  }
}

const entitlementsCsv = ['feature,vendor,quantity,license_type,license_server,expiry'];
for (const feature of FEATURES) {
  entitlementsCsv.push(`"${feature}",Test Vendor,20,concurrent,lic-01,2027-01-31`);
}

const contractsCsv = [
  'feature,vendor,contract_number,po_number,quantity,unit_price,currency,license_type,renewal_date',
];
FEATURES.forEach((feature, index) => {
  contractsCsv.push(
    `"${feature}",Test Vendor,CTR-${100 + index},PO-${900 + index},20,1000,USD,concurrent,2027-01-31`,
  );
});

const ingest = async (rows: string[], kind: 'usage' | 'entitlements' | 'contracts') =>
  ingestFile(csv(rows), {
    dataset: kind,
    organizationId: ORG_ID,
    importId: `import-${kind}`,
    fileName: `${kind}.csv`,
  });

const [usageImport, entitlementImport, contractImport] = await Promise.all([
  ingest(usageCsv, 'usage'),
  ingest(entitlementsCsv, 'entitlements'),
  ingest(contractsCsv, 'contracts'),
]);

const dataset = buildDatasetFromCanonical({
  organization: ORG,
  usage: usageImport.result.usage,
  entitlements: entitlementImport.result.entitlements,
  people: [],
  contracts: contractImport.result.contracts,
  featureAliases: new Map(),
  userAliases: new Map(),
  asOf: AS_OF,
});

const portfolio = buildPortfolio(dataset, DEFAULT_ANALYSIS_OPTIONS);
const renewals = buildRenewals(dataset, portfolio);
const dataQuality = buildDataQualityIssues(dataset, portfolio);
const reconciliation = reconcile({
  portfolio,
  entitlementByFeature: new Map(),
  contractByFeature: new Map(),
});

const counts = {
  usage: dataset.analyzedRows.usage,
  people: dataset.analyzedRows.people,
  entitlements: dataset.analyzedRows.entitlements,
  contracts: dataset.analyzedRows.contracts,
};

const workspace = {
  session: { userId: 'user-1', email: 'someone@example.com' },
  organization: ORG,
  dataset,
  options: DEFAULT_ANALYSIS_OPTIONS,
  portfolio,
  renewals,
  dataQuality,
  reconciliation,
  signals: generateSignals({
    portfolio,
    renewals,
    dataQuality,
    reconciliation,
    unmatchedPositions: { count: 0, value: 0 },
  }),
  integrity: checkIntegrity({ accepted: counts, stored: counts, analyzed: counts }),
  totals: computePortfolioTotals(portfolio),
  unusedCapacity: unusedCapacitySpend(portfolio),
  confidence: portfolioConfidence(portfolio),
  usingMockData: false,
};

vi.mock('server-only', () => ({}));

/** Swapped per test so a page can be driven under a short read. */
let loaded = workspace;

vi.mock('@/lib/workspace', () => ({
  loadWorkspace: async () => loaded,
  employeeIndex: (data: { employees: { id: string }[] }) =>
    new Map(data.employees.map((employee) => [employee.id, employee])),
  recompute: () => {
    throw new Error('not used by the detail pages');
  },
}));

const FeatureDetailPage = (await import('@/app/app/portfolio/[featureId]/page')).default;
const RenewalDetailPage = (await import('@/app/app/renewals/[contractId]/page')).default;
const NegotiationBriefPage = (await import('@/app/app/renewals/[contractId]/brief/page')).default;

/** The last path segment of an href, exactly as Next hands it to a page. */
function segment(href: string, index = -1): string {
  const parts = href.split('/').filter((part) => part.length > 0);
  return parts.at(index) ?? '';
}

async function renders(page: (props: never) => Promise<unknown>, params: Record<string, string>) {
  try {
    await page({ params: Promise.resolve(params) } as never);
    return true;
  } catch (error) {
    if ((error as { digest?: string }).digest === 'NEXT_HTTP_ERROR_FALLBACK;404') return false;
    throw error;
  }
}

describe('the identity scheme and the URL', () => {
  it('produces identities that are not safe as a raw path segment', () => {
    // The premise of the whole defect, asserted rather than assumed.
    const ids = portfolio.map((row) => row.featureId);
    expect(ids).toContain('feature:ansys_mech_ent');
    expect(ids.some((id) => id !== encodeURIComponent(id))).toBe(true);
  });

  it('round-trips every hostile identity through a path segment', () => {
    for (const row of portfolio) {
      expect(decodeRouteId(segment(featureHref(row.featureId)))).toBe(row.featureId);
    }
    for (const renewal of renewals) {
      expect(decodeRouteId(segment(renewalHref(renewal.contractId)))).toBe(renewal.contractId);
      expect(decodeRouteId(segment(renewalBriefHref(renewal.contractId), -2))).toBe(
        renewal.contractId,
      );
    }
  });

  it('keeps a slash inside the identity out of the path structure', () => {
    // "CATIA/V5" is an ordinary product name and an extra route segment.
    const withSlash = portfolio.find((row) => row.featureId.includes('/'));
    expect(withSlash).toBeDefined();
    const href = featureHref(withSlash!.featureId);
    expect(href.split('/')).toHaveLength(4); // '', 'app', 'portfolio', '<one segment>'
    expect(href).toContain('%2F');
  });

  it('returns the raw segment rather than throwing on a malformed escape', () => {
    // A truncated or hand-typed URL must produce an honest 404, not a 500.
    expect(decodeRouteId('feature%')).toBe('feature%');
    expect(decodeRouteId('%E0%A4%A')).toBe('%E0%A4%A');
  });
});

describe('the feature detail page', () => {
  it('resolves the encoded segment Next actually delivers', async () => {
    // The exact production failure: this is what the page received, and it
    // answered 404 for a feature that was listed on the page linking to it.
    expect(await renders(FeatureDetailPage, { featureId: 'feature%3Aansys_mech_ent' })).toBe(true);
  });

  it('resolves every feature the portfolio links to', async () => {
    for (const row of portfolio) {
      const params = { featureId: segment(featureHref(row.featureId)) };
      expect(await renders(FeatureDetailPage, params), row.featureId).toBe(true);
    }
  });

  it('still resolves an unencoded colon, which browsers and bookmarks send', async () => {
    expect(await renders(FeatureDetailPage, { featureId: 'feature:ansys_mech_ent' })).toBe(true);
  });

  it('404s on a feature that genuinely does not exist', async () => {
    expect(await renders(FeatureDetailPage, { featureId: 'feature%3Anot_imported' })).toBe(false);
  });
});

describe('the renewal detail and negotiation brief', () => {
  it('resolves every contract the renewals list links to', async () => {
    expect(renewals.length).toBeGreaterThan(0);
    for (const renewal of renewals) {
      const params = { contractId: segment(renewalHref(renewal.contractId)) };
      expect(await renders(RenewalDetailPage, params), renewal.contractId).toBe(true);
      expect(await renders(NegotiationBriefPage, params), renewal.contractId).toBe(true);
    }
  });

  it('resolves an unencoded contract id, which is what the old links emitted', async () => {
    const renewal = renewals[0]!;
    expect(renewal.contractId).toContain(':');
    expect(await renders(RenewalDetailPage, { contractId: renewal.contractId })).toBe(true);
  });

  it('404s on a contract that genuinely does not exist', async () => {
    expect(
      await renders(RenewalDetailPage, { contractId: encodeRouteId(`contract:${ORG_ID}:nope`) }),
    ).toBe(false);
  });
});

/**
 * THE DRILL-DOWN THAT WOULD STILL HAVE ANSWERED.
 *
 * The list pages have withheld their figures since Phase 2C whenever the
 * analysis did not read every stored usage row. The detail pages behind them
 * did not — so a truncated read produced a Portfolio that said "figures
 * withheld" and a feature page one click away that cheerfully showed a P95, a
 * recommended quantity and an annual opportunity computed from the fraction
 * that happened to arrive. The negotiation brief did the same.
 *
 * Found by reading the code during Phase 2D rather than by a failure, because
 * nothing in the suite covered a detail page under a short read.
 */
describe('a detail page under a truncated read', () => {
  const short = {
    ...workspace,
    integrity: checkIntegrity({
      accepted: counts,
      stored: counts,
      analyzed: { ...counts, usage: counts.usage - 1 },
    }),
  };

  /** Did the page render the withheld notice instead of its numbers? */
  async function withheld(page: (props: never) => Promise<unknown>, params: Record<string, string>) {
    const element = (await page({ params: Promise.resolve(params) } as never)) as {
      type?: unknown;
    };
    return element?.type === AnalyticsWithheld;
  }

  it('is reported incomplete before any of this runs', () => {
    expect(short.integrity.usageIncomplete).toBe(true);
  });

  it('withholds the feature detail rather than sizing from part of the evidence', async () => {
    loaded = short;
    expect(await withheld(FeatureDetailPage, { featureId: 'feature%3Aansys_mech_ent' })).toBe(true);
  });

  it('withholds the renewal detail', async () => {
    loaded = short;
    const params = { contractId: segment(renewalHref(renewals[0]!.contractId)) };
    expect(await withheld(RenewalDetailPage, params)).toBe(true);
  });

  it('withholds the negotiation brief, which is the one that goes into the room', async () => {
    loaded = short;
    const params = { contractId: segment(renewalHref(renewals[0]!.contractId)) };
    expect(await withheld(NegotiationBriefPage, params)).toBe(true);
  });

  it('shows the numbers again once the counts reconcile', async () => {
    loaded = workspace;
    expect(await withheld(FeatureDetailPage, { featureId: 'feature%3Aansys_mech_ent' })).toBe(false);
    expect(await renders(FeatureDetailPage, { featureId: 'feature%3Aansys_mech_ent' })).toBe(true);
  });
});
