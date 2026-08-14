/**
 * Portfolio composition.
 *
 * Joins the commercial position (what we own and pay) to the demand position
 * (what we actually used) and runs the appropriate model for each license type.
 * This is the single place where "a feature" becomes "a decision", so every
 * downstream surface — Signals, Renewals, Cost, Forecast, Evidence — reads from
 * the rows produced here rather than recomputing.
 */

import type { AnalysisOptions, AnalyticsDataset } from '@/lib/domain/dataset';
import type {
  AnalysisWindow,
  ConfidenceResult,
  Contract,
  ContractItem,
  DataQualityIssue,
  PortfolioRow,
  RenewalSummary,
  RenewalStage,
  RenewalStageDefinition,
  RiskLevel,
  SoftwareFeature,
} from '@/lib/domain/types';
import { aggregateConfidence, computeConfidence } from './confidence';
import { capacityRisk, computeConcurrentMetrics } from './concurrent';
import { buildWindow, diffDays } from './dates';
import { computeDenialMetrics } from './denials';
import { computeFinancial } from './financial';
import { computeNamedUserMetrics, computeNamedUserRightSizing } from './named-user';
import { computeRightSizing } from './rightsizing';
import { computeTokenMetrics } from './tokens';
import { round } from './stats';

const RISK_ORDER: RiskLevel[] = ['Low', 'Moderate', 'High', 'Critical'];

export function maxRisk(...risks: (RiskLevel | undefined | null)[]): RiskLevel {
  let highest = 0;
  for (const risk of risks) {
    if (risk === undefined || risk === null) continue;
    const index = RISK_ORDER.indexOf(risk);
    if (index > highest) highest = index;
  }
  return RISK_ORDER[highest] ?? 'Low';
}

/** License models whose sizing is governed by concurrent demand. */
const CONCURRENT_MODELS = new Set(['concurrent', 'hybrid', 'custom']);

export function buildPortfolio(dataset: AnalyticsDataset, options: AnalysisOptions): PortfolioRow[] {
  const window = buildWindow(dataset.asOf, options.periodKey, options.customDays);

  const vendorById = new Map(dataset.vendors.map((v) => [v.id, v]));
  const productById = new Map(dataset.products.map((p) => [p.id, p]));
  const familyById = new Map(dataset.productFamilies.map((f) => [f.id, f]));
  const contractById = new Map(dataset.contracts.map((c) => [c.id, c]));

  const itemByFeature = new Map<string, ContractItem>();
  for (const item of dataset.contractItems) itemByFeature.set(item.featureId, item);

  const featuresWithDenialData = new Set(dataset.denials.map((d) => d.featureId));

  const rows: PortfolioRow[] = [];

  for (const feature of dataset.features) {
    const product = productById.get(feature.productId);
    if (product === undefined) continue;
    const vendor = vendorById.get(product.vendorId);
    if (vendor === undefined) continue;

    const item = itemByFeature.get(feature.id);
    const contract = item === undefined ? undefined : contractById.get(item.contractId);
    const entitled = item?.quantity ?? 0;
    const unitPrice = item?.unitPrice ?? null;

    const row = buildRow({
      dataset,
      options,
      window,
      feature,
      entitled,
      unitPrice,
      contract,
      productName: product.name,
      vendorId: vendor.id,
      vendorName: vendor.name,
      familyName: feature.productId === null ? null : (familyById.get(product.productFamilyId ?? '')?.name ?? null),
      hasDenialData: featuresWithDenialData.has(feature.id),
    });

    rows.push(row);
  }

  rows.sort((a, b) => (b.financial.currentAnnualCost ?? 0) - (a.financial.currentAnnualCost ?? 0));
  return rows;
}

interface BuildRowInput {
  dataset: AnalyticsDataset;
  options: AnalysisOptions;
  window: AnalysisWindow;
  feature: SoftwareFeature;
  entitled: number;
  unitPrice: number | null;
  contract: Contract | undefined;
  productName: string;
  vendorId: string;
  vendorName: string;
  familyName: string | null;
  hasDenialData: boolean;
}

function buildRow(input: BuildRowInput): PortfolioRow {
  const { dataset, options, window, feature, entitled, unitPrice, contract } = input;

  const isConcurrent = CONCURRENT_MODELS.has(feature.licenseModel);
  const isNamedUser = feature.licenseModel === 'named_user' || feature.licenseModel === 'subscription';
  const isToken = feature.licenseModel === 'token';

  const metrics = isConcurrent
    ? computeConcurrentMetrics({ featureId: feature.id, daily: dataset.dailyUsage, window, entitled })
    : null;

  const namedUser = isNamedUser
    ? computeNamedUserMetrics({
        featureId: feature.id,
        activities: dataset.activities,
        asOf: dataset.asOf,
        unitPrice,
        reclaimThresholdDays: options.reclaimThresholdDays,
        entitled: entitled > 0 ? entitled : undefined,
      })
    : null;

  const tokens = isToken
    ? computeTokenMetrics({
        featureId: feature.id,
        daily: dataset.tokenUsage,
        window,
        tokenPool: entitled > 0 ? entitled : null,
      })
    : null;

  const observedDays = metrics?.observedDays ?? (isToken ? window.days : (namedUser === null ? 0 : window.days));

  const denials = computeDenialMetrics({
    featureId: feature.id,
    denials: dataset.denials,
    window,
    observedDays,
    entitled,
  });

  // ── Right-sizing: the correct model for the license type, never a blend ────
  let rightSizing = null;
  if (isConcurrent && metrics !== null) {
    rightSizing = computeRightSizing({
      dailyPeaks: dailyPeaksFor(dataset, feature.id, window),
      entitled,
      percentile: options.percentile,
      growthFactor: options.growthFactor,
      safetyFactor: options.safetyFactor,
      periodKey: options.periodKey,
    });
  } else if (isNamedUser && namedUser !== null) {
    rightSizing = computeNamedUserRightSizing(namedUser, {
      growthFactor: options.growthFactor,
      safetyFactor: options.safetyFactor,
      periodKey: options.periodKey,
    });
  }

  const financial = computeFinancial({
    entitled,
    recommended: rightSizing?.recommended ?? entitled,
    unitPrice,
  });

  const confidence = computeConfidence({
    observedDays,
    windowDays: window.days,
    hasPrice: unitPrice !== null,
    employeeMappingRate: dataset.employeeMappingRate,
    featureMappingRate: dataset.featureMappingRate,
    hasDenialData: input.hasDenialData,
    hasForecastInput: dataset.organization.headcountGrowthRate !== null,
  });

  const risk = maxRisk(
    metrics === null ? null : capacityRisk(metrics),
    denials.totalDenials > 0 ? denials.risk : null,
    tokens?.risk ?? null,
  );

  const daysToRenewal = contract === undefined ? null : diffDays(dataset.asOf, contract.renewalDate);

  return {
    featureId: feature.id,
    featureName: feature.name,
    featureCode: feature.code,
    productId: feature.productId,
    productName: input.productName,
    vendorId: input.vendorId,
    vendorName: input.vendorName,
    familyName: input.familyName,
    licenseModel: feature.licenseModel,
    entitled,
    unitPrice,
    currentAnnualCost: financial.currentAnnualCost,
    metrics,
    namedUser,
    tokens,
    denials: denials.totalDenials > 0 ? denials : null,
    rightSizing,
    financial,
    confidence,
    risk,
    renewalDate: contract?.renewalDate ?? null,
    daysToRenewal,
    contractId: contract?.id ?? null,
  };
}

function dailyPeaksFor(dataset: AnalyticsDataset, featureId: string, window: AnalysisWindow): number[] {
  const peaks: number[] = [];
  for (const row of dataset.dailyUsage) {
    if (row.featureId !== featureId) continue;
    if (row.date < window.start || row.date > window.end) continue;
    peaks.push(row.peak);
  }
  return peaks;
}

// ─────────────────────────────────────────────────────────────────────────────
// Renewals
// ─────────────────────────────────────────────────────────────────────────────

export const RENEWAL_STAGES: RenewalStageDefinition[] = [
  { stage: 'analyze', label: 'Analyze', startsAtDays: 180, description: 'Establish demand position and data confidence.' },
  { stage: 'validate', label: 'Validate', startsAtDays: 120, description: 'Confirm findings with license administrators.' },
  { stage: 'recommend', label: 'Recommend', startsAtDays: 90, description: 'Agree the recommended quantities internally.' },
  { stage: 'negotiate', label: 'Negotiate', startsAtDays: 60, description: 'Take the position to the vendor.' },
  { stage: 'finalize', label: 'Finalize', startsAtDays: 30, description: 'Complete paperwork and purchase orders.' },
  { stage: 'renewed', label: 'Renewed', startsAtDays: 0, description: 'Contract renewed.' },
];

export function stageForDaysRemaining(daysRemaining: number): RenewalStage {
  if (daysRemaining > 180) return 'analyze';
  for (const definition of RENEWAL_STAGES) {
    if (daysRemaining > definition.startsAtDays) return definition.stage;
  }
  return 'renewed';
}

export function buildRenewals(
  dataset: AnalyticsDataset,
  portfolio: readonly PortfolioRow[],
): RenewalSummary[] {
  const vendorById = new Map(dataset.vendors.map((v) => [v.id, v]));
  const rowsByContract = new Map<string, PortfolioRow[]>();

  for (const row of portfolio) {
    if (row.contractId === null) continue;
    const bucket = rowsByContract.get(row.contractId);
    if (bucket === undefined) rowsByContract.set(row.contractId, [row]);
    else bucket.push(row);
  }

  const summaries: RenewalSummary[] = [];

  for (const contract of dataset.contracts) {
    const rows = rowsByContract.get(contract.id) ?? [];
    if (rows.length === 0) continue;

    const vendor = vendorById.get(contract.vendorId);
    const daysRemaining = diffDays(dataset.asOf, contract.renewalDate);

    let currentAnnualSpend = 0;
    let recommendedAnnualSpend = 0;
    let optimizationOpportunity = 0;
    let incrementalSpend = 0;
    let capacityExposure = 0;
    let trendWeightSum = 0;
    let trendWeighted = 0;
    let priced = false;

    for (const row of rows) {
      const f = row.financial;
      if (f.priced && f.currentAnnualCost !== null) {
        priced = true;
        currentAnnualSpend += f.currentAnnualCost;
        recommendedAnnualSpend += f.recommendedAnnualCost ?? f.currentAnnualCost;
        optimizationOpportunity += f.optimizationOpportunity ?? 0;
        incrementalSpend += f.incrementalSpend ?? 0;
      }
      if (row.risk === 'High' || row.risk === 'Critical') capacityExposure += 1;
      if (row.metrics !== null) {
        // Weight the trend by spend so a large product dominates the headline
        // figure, rather than a $2K feature swinging a $4M renewal.
        const weight = row.financial.currentAnnualCost ?? 1;
        trendWeighted += row.metrics.trendPctPerYear * weight;
        trendWeightSum += weight;
      }
    }

    summaries.push({
      contractId: contract.id,
      vendorId: contract.vendorId,
      vendorName: vendor?.name ?? 'Unknown vendor',
      contractNumber: contract.contractNumber,
      agreementName: contract.agreementName,
      renewalDate: contract.renewalDate,
      daysRemaining,
      stage: stageForDaysRemaining(daysRemaining),
      status: contract.status,
      owner: contract.businessOwner,
      itemCount: rows.length,
      currentAnnualSpend: priced ? round(currentAnnualSpend, 2) : null,
      recommendedAnnualSpend: priced ? round(recommendedAnnualSpend, 2) : null,
      optimizationOpportunity: priced ? round(optimizationOpportunity, 2) : null,
      incrementalSpend: priced ? round(incrementalSpend, 2) : null,
      capacityExposure,
      demandTrendPct: trendWeightSum > 0 ? round(trendWeighted / trendWeightSum, 1) : 0,
      headcountImpactPct: round((dataset.organization.headcountGrowthRate ?? 0) * 100, 1),
      confidence: aggregateConfidence(rows.map((r) => r.confidence)),
    });
  }

  summaries.sort((a, b) => a.daysRemaining - b.daysRemaining);
  return summaries;
}

// ─────────────────────────────────────────────────────────────────────────────
// Data quality
// ─────────────────────────────────────────────────────────────────────────────

export function buildDataQualityIssues(
  dataset: AnalyticsDataset,
  portfolio: readonly PortfolioRow[],
): DataQualityIssue[] {
  const issues: DataQualityIssue[] = [];
  const orgId = dataset.organization.id;

  const openUnmatched = dataset.unmatchedUsers.filter((u) => u.status === 'open');
  if (openUnmatched.length > 0) {
    const occurrences = openUnmatched.reduce((acc, u) => acc + u.occurrences, 0);
    issues.push({
      id: 'unmatched-users',
      organizationId: orgId,
      severity: openUnmatched.length > 25 ? 'critical' : 'warning',
      category: 'Identity resolution',
      title: `${openUnmatched.length} usernames not matched to an employee`,
      detail: `${occurrences.toLocaleString('en-US')} usage records cannot be attributed to a department, program or manager until these are resolved.`,
      affectedCount: openUnmatched.length,
      href: '/app/data/unmatched-users',
    });
  }

  const openUnmapped = dataset.unmappedFeatures.filter((f) => f.status === 'open');
  if (openUnmapped.length > 0) {
    issues.push({
      id: 'unmapped-features',
      organizationId: orgId,
      severity: openUnmapped.length > 10 ? 'critical' : 'warning',
      category: 'Normalization',
      title: `${openUnmapped.length} license features not mapped to a product`,
      detail:
        'Demand for these features is excluded from portfolio analytics. Mapping them may increase measured demand.',
      affectedCount: openUnmapped.length,
      href: '/app/data/unmapped-features',
    });
  }

  const unpriced = portfolio.filter((row) => !row.financial.priced);
  if (unpriced.length > 0) {
    issues.push({
      id: 'missing-pricing',
      organizationId: orgId,
      severity: 'warning',
      category: 'Contract data',
      title: `${unpriced.length} features have no unit price`,
      detail: 'Financial impact and optimization opportunity cannot be calculated without contract pricing.',
      affectedCount: unpriced.length,
      href: '/app/data',
    });
  }

  const thinHistory = portfolio.filter((row) => row.metrics !== null && row.metrics.observedDays < 90);
  if (thinHistory.length > 0) {
    issues.push({
      id: 'thin-history',
      organizationId: orgId,
      severity: 'warning',
      category: 'Usage history',
      title: `${thinHistory.length} features have under 90 days of usage history`,
      detail: 'Recommendations for these features carry reduced confidence until a longer demand cycle is observed.',
      affectedCount: thinHistory.length,
      href: '/app/portfolio',
    });
  }

  const gapped = portfolio.filter((row) => row.metrics !== null && row.metrics.missingDays > 20);
  if (gapped.length > 0) {
    issues.push({
      id: 'usage-gaps',
      organizationId: orgId,
      severity: 'info',
      category: 'Usage history',
      title: `${gapped.length} features have gaps in usage collection`,
      detail: 'Missing collection days may understate peak demand.',
      affectedCount: gapped.length,
      href: '/app/portfolio',
    });
  }

  return issues;
}

/** Portfolio-level confidence, for the Intelligence header. */
export function portfolioConfidence(portfolio: readonly PortfolioRow[]): ConfidenceResult {
  return aggregateConfidence(portfolio.map((row) => row.confidence));
}
