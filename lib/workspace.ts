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
import type { ProjectionState } from '@/lib/analytics/projection';
import { reconcile, type ReconciliationSummary } from '@/lib/analytics/reconciliation';
import { requireSession, type AppSession } from '@/lib/auth';
import { ensureOrganization } from '@/app/signin/actions';
import { getDataProvider } from '@/lib/data';
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
  projection: ProjectionState;
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
  const { dataset, projection, storedRows, acceptedRows } =
    await provider.getDatasetWithProjection(organization.id);
  const options = DEFAULT_ANALYSIS_OPTIONS;

  // Three counts that must agree: what the import receipts promised, what the
  // database holds, and what this request actually read. Unchanged by the
  // projection: `analyzed` is still what the analytics consumed, and it is
  // still compared against a count the database performed, so a projection
  // built from a truncated read is caught by exactly the same gate.
  // The counts come back from the same fetch that decided whether the
  // projection could be used, rather than from a second round trip asking the
  // database the questions it was just asked.
  const integrity = checkIntegrity({
    accepted: acceptedRows,
    stored: storedRows,
    analyzed: dataset.analyzedRows,
  });

  const portfolio = buildPortfolio(dataset, options);
  const renewals = buildRenewals(dataset, portfolio);
  const dataQuality = buildDataQualityIssues(dataset, portfolio);

  // Both quantity sources, compared rather than collapsed.
  const entitlementByFeature = new Map<string, number>();
  const contractByFeature = new Map<string, number>();
  for (const source of dataset.quantitySources) {
    if (source.entitlementQuantity !== null) {
      entitlementByFeature.set(source.featureId, source.entitlementQuantity);
    }
    if (source.contractQuantity !== null) {
      contractByFeature.set(source.featureId, source.contractQuantity);
    }
  }
  const reconciliation = reconcile({ portfolio, entitlementByFeature, contractByFeature });

  const unmatchedPositions = {
    count: dataset.contractReview.length,
    // Priced lines only. An unpriced position is still worth reviewing, but it
    // must not be added to a dollar figure as if it were zero.
    value: dataset.contractReview.reduce((total, item) => total + (item.annualCost ?? 0), 0),
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
    dataset,
    options,
    portfolio,
    renewals,
    dataQuality,
    reconciliation,
    signals,
    integrity,
    projection,
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


