/**
 * Deterministic retrieval for Ask EngiSignal.
 *
 * Classifies a question by intent, then pulls the relevant metrics straight
 * from the analytics engine. This layer produces the answer; a language model,
 * when configured, only rephrases what this returns.
 */

import { formatDate } from '@/lib/analytics/dates';
import { computeForecast } from '@/lib/analytics/forecast';
import {
  formatCurrency,
  formatCurrencyExact,
  formatNumber,
  formatPercent,
  formatSignedPercent,
} from '@/lib/analytics/financial';
import type { Workspace } from '@/lib/workspace';

export interface RetrievedAnswer {
  intent: string;
  headline: string;
  /** Fact lines. Every number in the final answer must come from here. */
  facts: { label: string; value: string }[];
  narrative: string;
  links: { label: string; href: string }[];
}

export const SUGGESTED_QUESTIONS = [
  'What are my largest savings opportunities?',
  'Which renewals need attention?',
  'Why are we reducing Mechanical Enterprise?',
  'Who drives MATLAB demand?',
  'Which program consumes the most simulation software?',
  'What happens if Structures grows 12%?',
  'Why is this recommendation low confidence?',
  'What changed this month?',
] as const;

function findFeature(workspace: Workspace, question: string) {
  const lower = question.toLowerCase();
  // Longest product/feature name match wins, so "Simulink Coder" beats "Simulink".
  let best: (typeof workspace.portfolio)[number] | null = null;
  let bestLength = 0;

  for (const row of workspace.portfolio) {
    for (const candidate of [row.featureName, row.productName, row.featureCode]) {
      const needle = candidate.toLowerCase();
      if (needle.length > 2 && lower.includes(needle) && needle.length > bestLength) {
        best = row;
        bestLength = needle.length;
      }
    }
  }
  return best;
}

function extractPercent(question: string): number | null {
  const match = /(-?\d+(?:\.\d+)?)\s*%/.exec(question);
  return match === null ? null : Number(match[1]);
}

export function retrieve(workspace: Workspace, question: string): RetrievedAnswer {
  const q = question.toLowerCase().trim();
  const feature = findFeature(workspace, question);
  const { portfolio, renewals, totals, dataset, signals, confidence } = workspace;

  // ── Savings opportunities ────────────────────────────────────────────────
  if (/saving|opportunit|reduce spend|overspend|waste|cut cost/.test(q)) {
    const top = [...portfolio]
      .filter((row) => (row.financial.optimizationOpportunity ?? 0) > 0)
      .sort((a, b) => (b.financial.optimizationOpportunity ?? 0) - (a.financial.optimizationOpportunity ?? 0))
      .slice(0, 5);

    return {
      intent: 'savings',
      headline: `${formatCurrency(totals.optimizationOpportunity)} of annual optimization opportunity across the portfolio.`,
      facts: [
        { label: 'Total annual spend', value: formatCurrencyExact(totals.annualSpend) },
        { label: 'Total optimization opportunity', value: formatCurrencyExact(totals.optimizationOpportunity) },
        { label: 'Share of spend', value: formatPercent((totals.optimizationOpportunity / totals.annualSpend) * 100) },
        ...top.map((row) => ({
          label: `${row.vendorName} ${row.productName} (${row.featureName})`,
          value: `${formatCurrencyExact(row.financial.optimizationOpportunity)} — entitled ${formatNumber(row.entitled)}, recommended ${formatNumber(row.rightSizing?.recommended ?? 0)}`,
        })),
      ],
      narrative:
        `The largest opportunities are concentrated in ${top.length} positions. ` +
        `Each is entitled capacity above what observed demand supports at the current assumptions, valued at contract unit price.`,
      links: [
        { label: 'Portfolio', href: '/app/portfolio' },
        ...(top[0] === undefined ? [] : [{ label: `${top[0].productName} evidence`, href: `/app/portfolio/${top[0].featureId}` }]),
      ],
    };
  }

  // ── Renewals ─────────────────────────────────────────────────────────────
  if (/renew|contract|expir|negotiat/.test(q) && feature === null) {
    const upcoming = renewals.filter((r) => r.daysRemaining >= 0 && r.daysRemaining <= 180);
    return {
      intent: 'renewals',
      headline: `${upcoming.length} renewals fall within the next 180 days.`,
      facts: upcoming.map((renewal) => {
        const net = (renewal.optimizationOpportunity ?? 0) - (renewal.incrementalSpend ?? 0);
        return {
          label: `${renewal.vendorName} — ${formatDate(renewal.renewalDate)} (${renewal.daysRemaining} days)`,
          value: `${formatCurrencyExact(renewal.currentAnnualSpend)} current · ${net >= 0 ? 'reduce' : 'increase'} ${formatCurrencyExact(Math.abs(net))} · ${renewal.confidence.level} confidence`,
        };
      }),
      narrative:
        upcoming[0] === undefined
          ? 'No renewal decisions are due inside the six-month window.'
          : `${upcoming[0].vendorName} is closest at ${upcoming[0].daysRemaining} days, which puts it in the ${upcoming[0].stage} stage of the decision timeline.`,
      links: [{ label: 'Renewal Command Centre', href: '/app/renewals' }],
    };
  }

  // ── Why this recommendation ──────────────────────────────────────────────
  if (feature !== null && /why|reduc|increas|explain|justif|how did|basis/.test(q)) {
    const sizing = feature.rightSizing;
    return {
      intent: 'explain-recommendation',
      headline:
        sizing === null
          ? `${feature.productName} has no concurrent sizing model.`
          : `${feature.productName} is recommended at ${formatNumber(sizing.recommended)} against ${formatNumber(feature.entitled)} entitled.`,
      facts: [
        { label: 'Entitled quantity', value: formatNumber(feature.entitled) },
        ...(feature.metrics === null
          ? []
          : [
              { label: 'P95 daily peak demand', value: formatNumber(feature.metrics.p95, 1) },
              { label: 'Maximum daily peak', value: formatNumber(feature.metrics.max) },
              { label: 'Observed days', value: formatNumber(feature.metrics.observedDays) },
              { label: 'Utilization at P95', value: formatPercent(feature.metrics.utilizationPct) },
              { label: 'Saturation days', value: formatNumber(feature.metrics.saturationDays) },
              { label: 'Demand trend', value: `${formatSignedPercent(feature.metrics.trendPctPerYear)} per year` },
            ]),
        ...(feature.namedUser === null
          ? []
          : [
              { label: 'Assigned seats', value: formatNumber(feature.namedUser.assigned) },
              { label: 'Active users', value: formatNumber(feature.namedUser.activeUsers) },
              { label: 'Idle seats', value: formatNumber(feature.namedUser.reclaimCandidates) },
            ]),
        ...(sizing === null
          ? []
          : [
              { label: 'Growth factor', value: sizing.assumptions.growthFactor.toFixed(2) },
              { label: 'Safety factor', value: sizing.assumptions.safetyFactor.toFixed(2) },
              { label: 'Unrounded result', value: sizing.rawRecommended.toFixed(2) },
              { label: 'Recommended quantity', value: formatNumber(sizing.recommended) },
            ]),
        { label: 'Annual cost', value: formatCurrencyExact(feature.financial.currentAnnualCost) },
        {
          label: feature.financial.quantityDelta < 0 ? 'Annual opportunity' : 'Incremental spend',
          value: formatCurrencyExact(
            feature.financial.quantityDelta < 0
              ? feature.financial.optimizationOpportunity
              : feature.financial.incrementalSpend,
          ),
        },
        { label: 'Confidence', value: `${feature.confidence.level} (${feature.confidence.score}/100)` },
      ],
      narrative: sizing?.methodology ?? 'No sizing methodology applies to this license type.',
      links: [
        { label: 'Full evidence', href: `/app/portfolio/${feature.featureId}` },
        { label: 'Model it', href: `/app/scenario?feature=${feature.featureId}` },
      ],
    };
  }

  // ── Who drives demand ────────────────────────────────────────────────────
  if (/who|driver|drives|user|team|which department|which program/.test(q)) {
    const employees = new Map(dataset.employees.map((employee) => [employee.id, employee]));
    const relevant = dataset.activities.filter(
      (activity) => feature === null || activity.featureId === feature.featureId,
    );

    const byPerson = new Map<string, number>();
    const byProgram = new Map<string, number>();
    const byDepartment = new Map<string, number>();

    for (const activity of relevant) {
      const employee = employees.get(activity.employeeId);
      byPerson.set(activity.employeeId, (byPerson.get(activity.employeeId) ?? 0) + activity.totalHours);
      const program = employee?.program ?? 'Unattributed';
      const department = employee?.department ?? 'Unattributed';
      byProgram.set(program, (byProgram.get(program) ?? 0) + activity.totalHours);
      byDepartment.set(department, (byDepartment.get(department) ?? 0) + activity.totalHours);
    }

    const totalHours = [...byProgram.values()].reduce((a, b) => a + b, 0) || 1;
    const topPeople = [...byPerson.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const topPrograms = [...byProgram.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const topDepartments = [...byDepartment.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);

    return {
      intent: 'demand-drivers',
      headline:
        feature === null
          ? 'Demand across the portfolio is concentrated in a small number of programs.'
          : `${feature.productName} demand is driven by ${topPrograms[0]?.[0] ?? 'an unattributed group'}.`,
      facts: [
        ...topPrograms.map(([program, hours]) => ({
          label: `Program: ${program}`,
          value: `${formatNumber(hours)} license-hours (${formatPercent((hours / totalHours) * 100)})`,
        })),
        ...topDepartments.map(([department, hours]) => ({
          label: `Department: ${department}`,
          value: `${formatNumber(hours)} license-hours (${formatPercent((hours / totalHours) * 100)})`,
        })),
        ...topPeople.map(([employeeId, hours]) => ({
          label: `User: ${employees.get(employeeId)?.fullName ?? employeeId}`,
          value: `${formatNumber(hours)} license-hours`,
        })),
      ],
      narrative:
        'Consumption in engineering software is genuinely concentrated — a minority of specialists generate most of the load, which is who to consult before changing a quantity.',
      links: [
        { label: 'Users', href: feature === null ? '/app/users' : `/app/users?feature=${feature.featureId}` },
        { label: 'Cost intelligence', href: '/app/cost' },
      ],
    };
  }

  // ── What-if growth ───────────────────────────────────────────────────────
  if (/what if|what happens|grow|growth|scenario|increase.*%|\+\d+%/.test(q)) {
    const requested = extractPercent(question) ?? 10;
    const target = feature ?? portfolio.find((row) => row.metrics !== null);

    if (target?.metrics != null) {
      const forecast = computeForecast({
        metrics: target.metrics,
        headcountGrowthRate: requested / 100,
        safetyFactor: workspace.options.safetyFactor,
        unitPrice: target.unitPrice,
      });

      return {
        intent: 'what-if',
        headline: `At ${formatSignedPercent(requested, 0)} growth, ${target.productName} needs ${formatNumber(forecast.recommendedQuantity)} licenses.`,
        facts: [
          { label: 'Current entitlement', value: formatNumber(forecast.currentEntitled) },
          { label: 'Current P95 demand', value: formatNumber(forecast.currentP95, 1) },
          { label: 'Growth applied', value: formatSignedPercent(requested, 0) },
          { label: 'Observed trend contribution', value: formatSignedPercent(forecast.trendGrowth * 100) },
          { label: 'Combined growth', value: formatSignedPercent(forecast.combinedGrowth * 100) },
          { label: 'Forecast demand', value: formatNumber(forecast.forecastDemand, 1) },
          { label: 'Recommended quantity', value: formatNumber(forecast.recommendedQuantity) },
          {
            label: forecast.shortfall > 0 ? 'Shortfall against entitlement' : 'Surplus against entitlement',
            value: formatNumber(forecast.shortfall > 0 ? forecast.shortfall : forecast.surplus),
          },
          { label: 'Financial impact', value: formatCurrencyExact(forecast.financialImpact) },
        ],
        narrative:
          'Growth and observed demand trend are compounded rather than added, because more engineers each doing more work produces more demand than either effect alone.',
        links: [
          { label: 'Model this', href: `/app/scenario?feature=${target.featureId}` },
          { label: 'Forecast', href: `/app/forecast?feature=${target.featureId}` },
        ],
      };
    }
  }

  // ── Confidence ───────────────────────────────────────────────────────────
  if (/confiden|trust|reliab|how sure|data quality/.test(q)) {
    const target = feature ?? [...portfolio].sort((a, b) => a.confidence.score - b.confidence.score)[0];
    const result = target?.confidence ?? confidence;

    return {
      intent: 'confidence',
      headline:
        target === undefined
          ? `Portfolio confidence is ${confidence.level} at ${confidence.score}/100.`
          : `${target.productName} is rated ${result.level} confidence at ${result.score}/100.`,
      facts: result.reasons.map((reason) => ({ label: reason.label, value: reason.detail })),
      narrative:
        'Confidence is computed from observation period, data completeness, price availability, employee and feature mapping rates, and denial visibility. Improving any of these raises it.',
      links: [{ label: 'Data centre', href: '/app/data' }],
    };
  }

  // ── What changed ─────────────────────────────────────────────────────────
  if (/what changed|changed|new|latest|update|this month|attention/.test(q)) {
    return {
      intent: 'what-changed',
      headline: `${signals.length} signals are currently active across the portfolio.`,
      facts: signals.slice(0, 6).map((signal) => ({
        label: signal.title,
        value: `${signal.subtitle}${signal.financialImpact === null ? '' : ` · ${formatCurrencyExact(signal.financialImpact)}`}${signal.urgencyDays === null ? '' : ` · ${signal.urgencyDays} days`}`,
      })),
      narrative:
        'Signals are ranked by financial impact, urgency and risk, then weighted by how much the underlying data can be trusted.',
      links: [
        { label: 'Intelligence', href: '/app' },
        { label: 'Decisions', href: '/app/decisions' },
      ],
    };
  }

  // ── Capacity risk ────────────────────────────────────────────────────────
  if (/risk|capacity|denial|saturat|constrain|short/.test(q)) {
    const risky = portfolio.filter((row) => row.risk === 'High' || row.risk === 'Critical');
    return {
      intent: 'capacity',
      headline: `${risky.length} features are at High or Critical capacity risk.`,
      facts: risky.map((row) => ({
        label: `${row.productName} — ${row.featureName}`,
        value: `${formatPercent(row.metrics?.utilizationPct ?? 0)} utilization at P95, ${formatNumber(row.metrics?.saturationDays ?? 0)} saturation days${row.denials === null ? '' : `, ${formatNumber(row.denials.totalDenials)} denials (${row.denials.risk} risk)`}`,
      })),
      narrative:
        'Denials are reported as context and are deliberately excluded from the recommended quantity calculation, so a retry burst cannot inflate a purchase.',
      links: [{ label: 'Portfolio at risk', href: '/app/portfolio?risk=high' }],
    };
  }

  // ── Fallback: portfolio position ─────────────────────────────────────────
  return {
    intent: 'overview',
    headline: `${dataset.organization.name} commits ${formatCurrency(totals.annualSpend)} annually across ${formatNumber(portfolio.length)} features.`,
    facts: [
      { label: 'Annual spend', value: formatCurrencyExact(totals.annualSpend) },
      { label: 'Optimization opportunity', value: formatCurrencyExact(totals.optimizationOpportunity) },
      { label: 'Vendors', value: formatNumber(totals.vendorCount) },
      { label: 'Features analyzed', value: formatNumber(portfolio.length) },
      { label: 'Active signals', value: formatNumber(signals.length) },
      { label: 'Portfolio confidence', value: `${confidence.level} (${confidence.score}/100)` },
      { label: 'Analysis date', value: formatDate(dataset.asOf) },
    ],
    narrative:
      'Ask about savings, renewals, capacity risk, demand drivers, forecasts or confidence — or name a product to see exactly how its recommendation was derived.',
    links: [
      { label: 'Intelligence', href: '/app' },
      { label: 'Portfolio', href: '/app/portfolio' },
    ],
  };
}

/** Serialize retrieved facts for a language model to phrase. */
export function factsToText(answer: RetrievedAnswer): string {
  const lines = [answer.headline, ''];
  for (const fact of answer.facts) lines.push(`- ${fact.label}: ${fact.value}`);
  lines.push('', `Methodology note: ${answer.narrative}`);
  return lines.join('\n');
}
