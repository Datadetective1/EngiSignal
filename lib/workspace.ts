/**
 * Per-request workspace.
 *
 * Every authenticated page needs the same composition: session → organization
 * → dataset → portfolio → renewals → signals. Computing it once per request and
 * caching it means each surface reads from identical numbers, which is what
 * makes the Evidence Drawer trustworthy — the drawer renders what the page
 * already computed rather than deriving its own version.
 */

import 'server-only';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { computePortfolioTotals, unusedCapacitySpend } from '@/lib/analytics/financial';
import {
  buildDataQualityIssues,
  buildPortfolio,
  buildRenewals,
  portfolioConfidence,
} from '@/lib/analytics/portfolio';
import { generateSignals } from '@/lib/analytics/signals';
import { checkIntegrity, type IntegrityReport } from '@/lib/analytics/integrity';
import type { ProjectionStatus } from '@/lib/analytics/projection';
import type { CoverageSummary } from '@/lib/ingestion/store/types';
import type { UserIdentity } from '@/lib/ingestion/identity';
import { reconcile, type ReconciliationSummary } from '@/lib/analytics/reconciliation';
import { requireSession, type AppSession } from '@/lib/auth';
import { ensureOrganization } from '@/app/signin/actions';
import { getDataProvider } from '@/lib/data';
import { buildDatasetFromCanonical } from '@/lib/ingestion/dataset';
import { DEFAULT_ANALYSIS_OPTIONS, type AnalysisOptions, type AnalyticsDataset } from '@/lib/domain/dataset';
import type {
  ConfidenceResult,
  DataQualityIssue,
  Organization,
  PortfolioRow,
  RenewalSummary,
  Signal,
} from '@/lib/domain/types';

export interface Workspace {
  session: AppSession;
  organization: Organization;
  /**
   * The analysis.
   *
   * Never null, so no surface has to null-check its way through a render — but
   * when no analysis exists yet it is an EMPTY dataset, and
   * `integrity.analysisCurrent` is false, which every analytical page already
   * gates on. An empty dataset that reached a page ungated would print zeroes
   * where "not analysed yet" belongs, so the gate is the load-bearing part and
   * this is only the convenience.
   */
  dataset: AnalyticsDataset;
  options: AnalysisOptions;
  portfolio: PortfolioRow[];
  renewals: RenewalSummary[];
  dataQuality: DataQualityIssue[];
  /** Entitlement versus contract, computed once per request. */
  reconciliation: ReconciliationSummary;
  signals: Signal[];
  /**
   * Did we analyse everything we stored? Computed once per request and read by
   * every surface, so no page can render a number the integrity check would
   * have withheld.
   */
  integrity: IntegrityReport;
  /**
   * Where this request's dataset came from, and why.
   *
   * Reported rather than assumed. A projection is only ever used when its
   * evidence key matches the estate exactly, so this can never say
   * 'projection' about numbers derived from evidence that has since changed.
   */
  projection: ProjectionStatus;
  /**
   * What the imported evidence covers, derived alongside the dataset.
   *
   * Carried on the workspace so the Data page can gate capabilities without
   * re-reading the estate — which it did until Phase 2E, at the cost of two
   * more full scans on the one page whose job is to report on them.
   */
  coverage: CoverageSummary;
  /** Identities resolved without confirmed aliases, for the review queue. */
  userIdentities: UserIdentity[];
  totals: ReturnType<typeof computePortfolioTotals>;
  unusedCapacity: ReturnType<typeof unusedCapacitySpend>;
  confidence: ConfidenceResult;
  usingMockData: boolean;
}

/** Cached for the lifetime of one request. */
export const loadWorkspace = cache(async (): Promise<Workspace> => {
  const session = await requireSession();
  const provider = getDataProvider();

  let organizations = await provider.listOrganizations(session.userId);

  // A signed-in user with no organization is a provisioning gap, not a missing
  // page. It happened in production to every customer who confirmed their email
  // address: they held a valid session, belonged to no tenant, and got a 404 on
  // the first screen of the product.
  //
  // The callback now provisions on confirmation. This is the backstop for every
  // other way into the app — a bookmark, a shared link, a retried request — and
  // is idempotent, so it can never create a second tenant for the same person.
  if (organizations.length === 0) {
    await ensureOrganization();
    organizations = await provider.listOrganizations(session.userId);
  }

  const organization = organizations[0];
  if (organization === undefined) notFound();

  // The dataset comes from a stored projection when one provably matches the
  // evidence that exists right now, and is rebuilt from canonical rows when it
  // does not. Which of those happened is carried through to the Data page —
  // a cached answer that cannot say it is cached is how a stale number gets
  // presented as a current one.
  const { dataset, coverage, userIdentities, projection, storedRows, acceptedRows } =
    await provider.getDatasetWithProjection(organization.id);
  const options = DEFAULT_ANALYSIS_OPTIONS;

  // No analysis yet is not an analysis of nothing. An empty dataset stands in
  // so rendering code stays simple; the gate below is what stops it being
  // mistaken for a finished answer.
  const analysis: AnalyticsDataset =
    dataset ??
    buildDatasetFromCanonical({
      organization,
      usage: [],
      entitlements: [],
      people: [],
      contracts: [],
    });

  const integrity = checkIntegrity({
    accepted: acceptedRows,
    stored: storedRows,
    // ── WHY THIS IS NOT ALWAYS dataset.analyzedRows ────────────────────────
    //
    // The integrity gate asks one question: did the analysis read every row
    // that is stored? That question only means anything when the analysis is
    // OF the rows that are stored.
    //
    // While a build is running, the readable analysis describes an EARLIER
    // evidence version, so comparing its row count against today's is
    // comparing two different estates. Production showed exactly what that
    // looks like: a tenant mid-build was told "317,936 of 317,936 stored usage
    // rows were not read into this analysis" — the truncation alarm, raised on
    // a perfectly healthy import that was simply still being analysed. That is
    // the alarm this product cannot afford to cry wolf on.
    //
    // So the comparison is made only when the analysis is current. When it is
    // not, the honest report is "the analysis is not finished", which is what
    // `analysis` below carries and what every surface gates on.
    analyzed: projection.analyticsCurrent && dataset !== null ? dataset.analyzedRows : storedRows,
    analysis:
      projection.source === 'current'
        ? 'current'
        : projection.state === 'failed'
          ? 'failed'
          : projection.source === 'superseded'
            ? 'superseded'
            : projection.state === 'building'
              ? 'building'
              : 'absent',
  });

  // Nothing to analyse yet. Every derived collection is empty rather than
  // wrong, and `projection.analyticsCurrent` is what surfaces use to decide
  // whether they may render figures at all.
  const portfolio = buildPortfolio(analysis, options);
  const renewals = buildRenewals(analysis, portfolio);
  const dataQuality = buildDataQualityIssues(analysis, portfolio);

  // Both quantity sources, compared rather than collapsed.
  const entitlementByFeature = new Map<string, number>();
  const contractByFeature = new Map<string, number>();
  for (const source of analysis.quantitySources) {
    if (source.entitlementQuantity !== null) {
      entitlementByFeature.set(source.featureId, source.entitlementQuantity);
    }
    if (source.contractQuantity !== null) {
      contractByFeature.set(source.featureId, source.contractQuantity);
    }
  }
  const reconciliation = reconcile({ portfolio, entitlementByFeature, contractByFeature });

  const unmatchedPositions = {
    count: analysis.contractReview.length,
    // Priced lines only. An unpriced position is still worth reviewing, but it
    // must not be added to a dollar figure as if it were zero.
    value: analysis.contractReview.reduce((total, item) => total + (item.annualCost ?? 0), 0),
  };

  const signals = generateSignals({
    portfolio,
    renewals,
    dataQuality,
    reconciliation,
    unmatchedPositions,
  });

  return {
    session,
    organization,
    dataset: analysis,
    options,
    portfolio,
    renewals,
    dataQuality,
    reconciliation,
    signals,
    integrity,
    projection,
    coverage,
    userIdentities,
    totals: computePortfolioTotals(portfolio),
    unusedCapacity: unusedCapacitySpend(portfolio),
    confidence: portfolioConfidence(portfolio),
    usingMockData: provider.kind === 'mock',
  };
});

/** Recompute the portfolio under different assumptions, for scenario surfaces. */
export function recompute(dataset: AnalyticsDataset, overrides: Partial<AnalysisOptions>) {
  const options: AnalysisOptions = { ...DEFAULT_ANALYSIS_OPTIONS, ...overrides };
  const portfolio = buildPortfolio(dataset, options);
  return { options, portfolio, totals: computePortfolioTotals(portfolio) };
}

/** Employee lookup, built once per request. */
export const employeeIndex = cache((dataset: AnalyticsDataset) => {
  return new Map(dataset.employees.map((employee) => [employee.id, employee]));
});


