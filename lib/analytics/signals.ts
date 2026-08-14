/**
 * The Signals engine.
 *
 * A Signal is a ranked, actionable statement about the portfolio. The ranking
 * blends four dimensions — financial impact, urgency, risk and confidence —
 * because optimizing for any one alone produces a bad queue: pure impact buries
 * an imminent renewal behind a large but distant opportunity, and pure urgency
 * surfaces trivial decisions simply because they are near.
 *
 * Confidence is a MULTIPLIER, not an addend. A large opportunity computed from
 * poor data should not outrank a modest one computed from good data.
 */

import type {
  ConfidenceLevel,
  DataQualityIssue,
  PortfolioRow,
  RenewalSummary,
  RiskLevel,
  Signal,
  SignalKind,
} from '@/lib/domain/types';
import { confidenceWeight } from './confidence';
import { formatCurrency, formatNumber, formatPercent } from './financial';
import { clamp, round } from './stats';

const RISK_WEIGHT: Record<RiskLevel, number> = {
  Low: 0.1,
  Moderate: 0.4,
  High: 0.75,
  Critical: 1,
};

/** Financial impact above which a signal scores full marks on impact. */
const IMPACT_CEILING = 500_000;

/** Days ahead at which urgency starts to register. */
const URGENCY_HORIZON = 180;

export interface SignalScoreInput {
  financialImpact: number | null;
  urgencyDays: number | null;
  risk: RiskLevel;
  confidence: ConfidenceLevel;
}

/**
 * Compute a signal's ranking score, 0–100.
 *
 * Impact uses a logarithmic curve so that a $2M opportunity outranks a $400K
 * one without drowning it — in practice a queue ordered by raw dollars becomes
 * a list of the same three vendors.
 */
export function scoreSignal(input: SignalScoreInput): number {
  const impact = input.financialImpact === null ? 0 : Math.abs(input.financialImpact);
  const impactScore = impact <= 0 ? 0 : clamp(Math.log10(1 + impact) / Math.log10(1 + IMPACT_CEILING), 0, 1);

  const urgencyScore =
    input.urgencyDays === null
      ? 0.25
      : clamp((URGENCY_HORIZON - input.urgencyDays) / URGENCY_HORIZON, 0, 1);

  const riskScore = RISK_WEIGHT[input.risk];

  const base = 0.45 * impactScore + 0.28 * urgencyScore + 0.22 * riskScore + 0.05;
  return round(base * confidenceWeight(input.confidence) * 100, 1);
}

function makeSignal(
  params: Omit<Signal, 'score'> & { score?: number },
): Signal {
  return {
    ...params,
    score:
      params.score ??
      scoreSignal({
        financialImpact: params.financialImpact,
        urgencyDays: params.urgencyDays,
        risk: params.risk,
        confidence: params.confidence,
      }),
  };
}

export interface SignalGenerationInput {
  portfolio: readonly PortfolioRow[];
  renewals: readonly RenewalSummary[];
  dataQuality: readonly DataQualityIssue[];
  /** Minimum annual opportunity worth raising as a cost signal. */
  costThreshold?: number;
}

export function generateSignals(input: SignalGenerationInput): Signal[] {
  const signals: Signal[] = [
    ...renewalSignals(input.renewals),
    ...capacitySignals(input.portfolio),
    ...costSignals(input.portfolio, input.costThreshold ?? 25_000),
    ...reclaimSignals(input.portfolio),
    ...usageSignals(input.portfolio),
    ...forecastSignals(input.portfolio),
    ...dataSignals(input.dataQuality),
  ];

  signals.sort((a, b) => b.score - a.score);
  return signals;
}

// ── Renewal ──────────────────────────────────────────────────────────────────

export function renewalSignals(renewals: readonly RenewalSummary[]): Signal[] {
  return renewals
    .filter((r) => r.daysRemaining >= 0 && r.daysRemaining <= 240)
    .map((renewal) => {
      const opportunity = renewal.optimizationOpportunity ?? 0;
      const incremental = renewal.incrementalSpend ?? 0;
      const net = opportunity - incremental;

      const facts = [
        { label: 'Renewal in', value: `${renewal.daysRemaining} days` },
        { label: 'Current spend', value: formatCurrency(renewal.currentAnnualSpend) },
      ];
      if (net > 0) facts.push({ label: 'Opportunity', value: formatCurrency(net) });
      else if (net < 0) facts.push({ label: 'Incremental', value: formatCurrency(-net) });
      if (renewal.capacityExposure > 0) {
        facts.push({ label: 'Capacity exposure', value: `${renewal.capacityExposure} feature(s)` });
      }

      return makeSignal({
        id: `renewal:${renewal.contractId}`,
        kind: 'renewal',
        title: `${renewal.vendorName} renewal`,
        subtitle:
          net > 0
            ? `${formatCurrency(net)} optimization opportunity identified before commitment.`
            : net < 0
              ? `${formatCurrency(-net)} additional spend indicated by demand.`
              : 'Position analyzed and ready for review.',
        facts,
        financialImpact: Math.abs(net) > 0 ? Math.abs(net) : renewal.currentAnnualSpend,
        urgencyDays: renewal.daysRemaining,
        risk: renewal.capacityExposure > 0 ? 'High' : renewal.daysRemaining <= 60 ? 'Moderate' : 'Low',
        confidence: renewal.confidence.level,
        href: `/app/renewals/${renewal.contractId}`,
        cta: 'Review',
      });
    });
}

// ── Capacity ─────────────────────────────────────────────────────────────────

export function capacitySignals(portfolio: readonly PortfolioRow[]): Signal[] {
  return portfolio
    .filter((row) => row.metrics !== null && (row.risk === 'High' || row.risk === 'Critical'))
    .map((row) => {
      const metrics = row.metrics;
      if (metrics === null) return null;

      const facts = [
        { label: 'Utilization (P95)', value: formatPercent(metrics.utilizationPct) },
        { label: 'Entitled', value: formatNumber(metrics.entitled) },
        { label: 'Saturation days', value: formatNumber(metrics.saturationDays) },
      ];
      if (row.denials !== null && row.denials.totalDenials > 0) {
        facts.push({ label: 'Denials', value: formatNumber(row.denials.totalDenials) });
      }

      return makeSignal({
        id: `capacity:${row.featureId}`,
        kind: 'capacity',
        title: `${row.productName} capacity risk`,
        subtitle: `${row.featureName} is running at ${formatPercent(metrics.utilizationPct)} of entitled capacity at P95.`,
        facts,
        financialImpact: row.financial.incrementalSpend,
        urgencyDays: row.daysToRenewal,
        risk: row.risk,
        confidence: row.confidence.level,
        href: `/app/portfolio/${row.featureId}`,
        cta: 'Review',
      });
    })
    .filter((s): s is Signal => s !== null);
}

// ── Cost ─────────────────────────────────────────────────────────────────────

export function costSignals(portfolio: readonly PortfolioRow[], threshold: number): Signal[] {
  return portfolio
    .filter((row) => (row.financial.optimizationOpportunity ?? 0) >= threshold)
    .map((row) => {
      const opportunity = row.financial.optimizationOpportunity ?? 0;
      const metrics = row.metrics;

      const facts = [
        { label: 'Entitled', value: formatNumber(row.entitled) },
        { label: 'Recommended', value: formatNumber(row.rightSizing?.recommended ?? null) },
        { label: 'Opportunity', value: formatCurrency(opportunity) },
      ];
      if (metrics !== null) {
        facts.splice(1, 0, { label: 'P95 demand', value: formatNumber(metrics.p95, 0) });
      }

      return makeSignal({
        id: `cost:${row.featureId}`,
        kind: 'cost',
        title: `${row.productName} is over-provisioned`,
        subtitle: `Entitled capacity exceeds demand by ${formatNumber(row.rightSizing?.surplus ?? 0)} licenses.`,
        facts,
        financialImpact: opportunity,
        urgencyDays: row.daysToRenewal,
        risk: 'Low',
        confidence: row.confidence.level,
        href: `/app/portfolio/${row.featureId}`,
        cta: 'Review',
      });
    });
}

// ── Reclaim ──────────────────────────────────────────────────────────────────

export function reclaimSignals(portfolio: readonly PortfolioRow[]): Signal[] {
  return portfolio
    .filter((row) => row.namedUser !== null && row.namedUser.reclaimCandidates >= 5)
    .map((row) => {
      const named = row.namedUser;
      if (named === null) return null;

      return makeSignal({
        id: `reclaim:${row.featureId}`,
        kind: 'reclaim',
        title: `${row.productName} named users inactive`,
        subtitle: `${named.reclaimCandidates} assigned licenses show no activity for ${named.reclaimThresholdDays}+ days.`,
        facts: [
          { label: 'Assigned', value: formatNumber(named.assigned) },
          { label: 'Inactive', value: formatNumber(named.reclaimCandidates) },
          { label: 'Annual value', value: formatCurrency(named.reclaimValue) },
        ],
        financialImpact: named.reclaimValue,
        urgencyDays: row.daysToRenewal,
        risk: 'Low',
        confidence: row.confidence.level,
        href: `/app/reclaim?feature=${row.featureId}`,
        cta: 'Review',
      });
    })
    .filter((s): s is Signal => s !== null);
}

// ── Usage ────────────────────────────────────────────────────────────────────

export function usageSignals(portfolio: readonly PortfolioRow[]): Signal[] {
  return portfolio
    .filter((row) => row.metrics !== null && Math.abs(row.metrics.trendPctPerYear) >= 25)
    .map((row) => {
      const metrics = row.metrics;
      if (metrics === null) return null;
      const rising = metrics.trendPctPerYear > 0;

      return makeSignal({
        id: `usage:${row.featureId}`,
        kind: 'usage',
        title: `${row.productName} demand ${rising ? 'rising' : 'declining'}`,
        subtitle: `Daily peak demand is trending ${rising ? 'up' : 'down'} ${formatPercent(Math.abs(metrics.trendPctPerYear))} per year.`,
        facts: [
          { label: 'Trend', value: `${rising ? '+' : '-'}${formatPercent(Math.abs(metrics.trendPctPerYear))}/yr` },
          { label: 'P95 demand', value: formatNumber(metrics.p95, 0) },
          { label: 'Entitled', value: formatNumber(metrics.entitled) },
        ],
        financialImpact: rising ? row.financial.incrementalSpend : row.financial.optimizationOpportunity,
        urgencyDays: row.daysToRenewal,
        risk: rising && metrics.utilizationPct > 70 ? 'Moderate' : 'Low',
        confidence: row.confidence.level,
        href: `/app/portfolio/${row.featureId}`,
        cta: 'Review',
      });
    })
    .filter((s): s is Signal => s !== null);
}

// ── Forecast ─────────────────────────────────────────────────────────────────

export function forecastSignals(portfolio: readonly PortfolioRow[]): Signal[] {
  return portfolio
    .filter((row) => {
      const metrics = row.metrics;
      if (metrics === null) return false;
      // Demand projected to cross entitled capacity within the horizon.
      const projected = metrics.p95 * (1 + Math.max(0, metrics.trendPctPerYear) / 100);
      return metrics.entitled > 0 && projected > metrics.entitled && metrics.utilizationPct < 100;
    })
    .map((row) => {
      const metrics = row.metrics;
      if (metrics === null) return null;
      const projected = round(metrics.p95 * (1 + Math.max(0, metrics.trendPctPerYear) / 100), 0);

      return makeSignal({
        id: `forecast:${row.featureId}`,
        kind: 'forecast',
        title: `${row.productName} forecast to exceed capacity`,
        subtitle: `Projected demand of ${formatNumber(projected)} passes entitled capacity of ${formatNumber(metrics.entitled)} within 12 months.`,
        facts: [
          { label: 'Current P95', value: formatNumber(metrics.p95, 0) },
          { label: 'Forecast', value: formatNumber(projected) },
          { label: 'Entitled', value: formatNumber(metrics.entitled) },
        ],
        financialImpact: row.unitPrice === null ? null : round((projected - metrics.entitled) * row.unitPrice, 2),
        urgencyDays: row.daysToRenewal,
        risk: 'Moderate',
        confidence: row.confidence.level,
        href: `/app/forecast?feature=${row.featureId}`,
        cta: 'Review',
      });
    })
    .filter((s): s is Signal => s !== null);
}

// ── Data quality ─────────────────────────────────────────────────────────────

export function dataSignals(issues: readonly DataQualityIssue[]): Signal[] {
  return issues
    .filter((issue) => issue.severity !== 'info')
    .map((issue) =>
      makeSignal({
        id: `data:${issue.id}`,
        kind: 'data',
        title: issue.title,
        subtitle: issue.detail,
        facts: [
          { label: 'Affected', value: formatNumber(issue.affectedCount) },
          { label: 'Category', value: issue.category },
        ],
        financialImpact: null,
        urgencyDays: null,
        risk: issue.severity === 'critical' ? 'High' : 'Moderate',
        confidence: 'High',
        href: issue.href ?? '/app/data',
        cta: 'Resolve',
      }),
    );
}

export const SIGNAL_LABELS: Record<SignalKind, string> = {
  renewal: 'Renewal Signal',
  cost: 'Cost Signal',
  capacity: 'Capacity Signal',
  usage: 'Usage Signal',
  forecast: 'Forecast Signal',
  reclaim: 'Reclaim Signal',
  data: 'Data Signal',
};
