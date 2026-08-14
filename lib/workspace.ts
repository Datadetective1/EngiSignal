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
  signals: Signal[];
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

  const portfolio = buildPortfolio(dataset, options);
  const renewals = buildRenewals(dataset, portfolio);
  const dataQuality = buildDataQualityIssues(dataset, portfolio);
  const signals = generateSignals({ portfolio, renewals, dataQuality });

  return {
    session,
    organization,
    dataset,
    options,
    portfolio,
    renewals,
    dataQuality,
    signals,
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
