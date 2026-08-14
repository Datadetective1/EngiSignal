/**
 * Evidence assembly.
 *
 * The Evidence Drawer is a *rendering* of what the engine already computed —
 * never a re-derivation. If the drawer had to recompute anything, the number in
 * the drawer could drift from the number on the page, which is precisely the
 * failure this feature exists to prevent.
 *
 * The customer must never wonder where a recommendation came from.
 */

import type { EvidenceRecord, EvidenceRow, PortfolioRow } from '@/lib/domain/types';
import { PERIOD_LABELS, formatDate } from './dates';
import { formatCurrencyExact, formatNumber, formatPercent, formatSignedPercent } from './financial';
import { percentileLabel } from './rightsizing';
import { round } from './stats';

export function buildRecommendationEvidence(row: PortfolioRow): EvidenceRecord {
  const { metrics, rightSizing, financial, namedUser, denials } = row;

  const derivation: EvidenceRow[] = [];
  const assumptions: EvidenceRow[] = [];
  const observations: EvidenceRow[] = [];

  if (rightSizing !== null && metrics !== null) {
    const a = rightSizing.assumptions;

    derivation.push({
      label: `${percentileLabel(a.percentile)} daily peak`,
      value: formatNumber(rightSizing.basis, 0),
      note: 'The demand level exceeded on only a small share of observed days',
    });
    derivation.push({
      label: 'Growth factor',
      value: `× ${a.growthFactor.toFixed(2)}`,
      note: a.growthFactor === 1 ? 'No growth assumed' : `${formatSignedPercent((a.growthFactor - 1) * 100)} expected demand growth`,
    });
    derivation.push({
      label: 'Safety factor',
      value: `× ${a.safetyFactor.toFixed(2)}`,
      note: `${formatSignedPercent((a.safetyFactor - 1) * 100)} protective buffer`,
    });
    derivation.push({
      label: 'Unrounded result',
      value: formatNumber(rightSizing.rawRecommended, 2),
      note: 'Before rounding up to a whole license',
    });
    derivation.push({
      label: 'Recommended quantity',
      value: formatNumber(rightSizing.recommended),
      emphasis: true,
    });
    derivation.push({
      label: 'Current entitlement',
      value: formatNumber(rightSizing.entitled),
      note:
        rightSizing.quantityDelta === 0
          ? 'Already right-sized'
          : rightSizing.quantityDelta < 0
            ? `${formatNumber(rightSizing.surplus)} more than demand requires`
            : `${formatNumber(rightSizing.shortfall)} fewer than demand requires`,
    });

    assumptions.push({ label: 'Percentile', value: percentileLabel(a.percentile) });
    assumptions.push({ label: 'Observation period', value: PERIOD_LABELS[a.periodKey] });
    assumptions.push({
      label: 'Growth',
      value: `${formatSignedPercent((a.growthFactor - 1) * 100)}`,
    });
    assumptions.push({
      label: 'Safety buffer',
      value: `${formatSignedPercent((a.safetyFactor - 1) * 100)}`,
    });
    assumptions.push({ label: 'Method', value: rightSizing.methodology });
  }

  if (metrics !== null) {
    observations.push({ label: 'Observed days', value: formatNumber(metrics.observedDays) });
    observations.push({
      label: 'Window',
      value: `${formatDate(metrics.window.start)} – ${formatDate(metrics.window.end)}`,
    });
    observations.push({ label: 'Mean daily peak', value: formatNumber(metrics.mean, 1) });
    observations.push({ label: 'Median daily peak', value: formatNumber(metrics.median, 1) });
    observations.push({ label: 'P90 daily peak', value: formatNumber(metrics.p90, 1) });
    observations.push({ label: 'P95 daily peak', value: formatNumber(metrics.p95, 1), emphasis: true });
    observations.push({ label: 'P99 daily peak', value: formatNumber(metrics.p99, 1) });
    observations.push({ label: 'Maximum daily peak', value: formatNumber(metrics.max) });
    observations.push({ label: 'Utilization at P95', value: formatPercent(metrics.utilizationPct) });
    observations.push({
      label: 'Saturation days',
      value: formatNumber(metrics.saturationDays),
      note: `Days peak demand met or exceeded ${formatNumber(metrics.entitled)} entitled licenses`,
    });
    observations.push({
      label: 'Demand trend',
      value: `${formatSignedPercent(metrics.trendPctPerYear)} / year`,
    });
    observations.push({
      label: 'Volatility',
      value: round(metrics.volatility, 2).toFixed(2),
      note: 'Coefficient of variation of daily peaks',
    });
    if (metrics.missingDays > 0) {
      observations.push({
        label: 'Missing days',
        value: formatNumber(metrics.missingDays),
        note: 'No usage data recorded on these dates',
      });
    }
  }

  if (namedUser !== null) {
    observations.push({ label: 'Assigned seats', value: formatNumber(namedUser.assigned) });
    observations.push({ label: 'Active users', value: formatNumber(namedUser.activeUsers) });
    observations.push({
      label: `Inactive ${namedUser.reclaimThresholdDays}+ days`,
      value: formatNumber(namedUser.inactiveUsers),
    });
    if (namedUser.neverUsed > 0) {
      observations.push({ label: 'Never used', value: formatNumber(namedUser.neverUsed) });
    }
  }

  if (denials !== null && denials.totalDenials > 0) {
    observations.push({
      label: 'Denials',
      value: formatNumber(denials.totalDenials),
      note: denials.riskRationale,
    });
    observations.push({ label: 'Denial days', value: formatNumber(denials.denialDays) });
  }

  if (financial.priced) {
    derivation.push({
      label: 'Unit price',
      value: formatCurrencyExact(financial.unitPrice),
      note: 'Annual price per license from the contract',
    });
    derivation.push({ label: 'Current annual cost', value: formatCurrencyExact(financial.currentAnnualCost) });
    derivation.push({
      label: 'Recommended annual cost',
      value: formatCurrencyExact(financial.recommendedAnnualCost),
    });
    if ((financial.optimizationOpportunity ?? 0) > 0) {
      derivation.push({
        label: 'Annual opportunity',
        value: formatCurrencyExact(financial.optimizationOpportunity),
        emphasis: true,
        note: `${formatPercent(financial.savingsPct)} of current spend`,
      });
    }
    if ((financial.incrementalSpend ?? 0) > 0) {
      derivation.push({
        label: 'Incremental annual spend',
        value: formatCurrencyExact(financial.incrementalSpend),
        emphasis: true,
      });
    }
  } else {
    derivation.push({
      label: 'Financial impact',
      value: 'Not available',
      note: 'No unit price recorded for this feature — add contract pricing to quantify impact',
    });
  }

  return {
    headline:
      rightSizing === null
        ? `${row.productName} — ${row.featureName}`
        : `Recommended ${formatNumber(rightSizing.recommended)} licenses for ${row.featureName}`,
    derivation,
    assumptions,
    observations,
    confidence: row.confidence,
    methodology: rightSizing?.methodology ?? 'No concurrent demand model applies to this license type.',
    drillThrough: [
      { label: 'Daily demand detail', href: `/app/portfolio/${row.featureId}` },
      { label: 'Users driving demand', href: `/app/users?feature=${row.featureId}` },
      { label: 'Model this in Scenario Lab', href: `/app/scenario?feature=${row.featureId}` },
    ],
  };
}
