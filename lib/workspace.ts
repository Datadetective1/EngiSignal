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
import { reconcile, type ReconciliationSummary } from '@/lib/analytics/reconciliation';
import { requireSession, type AppSession } from '@/lib/auth';
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
  totals: ReturnType<typeof computePortfolioTotals>;
  unusedCapacity: ReturnType<typeof unusedCapacitySpend>;
  confidence: ConfidenceResult;
  usingMockData: boolean;
}

/** Cached for the lifetime of one request. */
export const loadWorkspace = cache(async (): Promise<Workspace> => {
  const session = await requireSession();
  const provider = getDataProvider();

  const organizations = await provider.listOrganizations(session.userId);
  const organization = organizations[0];
  if (organization === undefined) notFound();

  const dataset = await provider.getDataset(organization.id);
  const options = DEFAULT_ANALYSIS_OPTIONS;

  // Three counts that must agree: what the import receipts promised, what the
  // database holds, and what this request actually read.
  const accounting = await provider.countRowAccounting(organization.id);
  const integrity = checkIntegrity({
    accepted: accounting.accepted,
    stored: accounting.stored,
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


