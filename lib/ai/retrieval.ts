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
  COST_NOT_PROVIDED,
  costFigure,
  formatCurrency,
  formatCurrencyExact,
  formatNumber,
  formatPercent,
  formatSignedPercent,
  hasCostEvidence,
} from '@/lib/analytics/financial';
import type { Workspace } from '@/lib/workspace';
import { INSUFFICIENT_TREND_LABEL, annualizedTrend } from '@/lib/analytics/trend';

/**
 * Whether EngiSignal actually holds evidence that answers the question.
 *
 * This is the hallucination guard, and it lives here rather than in the prompt
 * because a prompt is a request and this is a rule. When it reports `none`, the
 * caller does not send the question to a language model at all — there is
 * nothing to phrase, and a model handed an empty FACTS block and a direct
 * question is being invited to fill the gap from its own memory.
 */
export type EvidenceGrade = 'sufficient' | 'partial' | 'none';

export interface RetrievedAnswer {
  intent: string;
  headline: string;
  /** Fact lines. Every number in the final answer must come from here. */
  facts: { label: string; value: string }[];
  narrative: string;
  links: { label: string; href: string }[];
  evidence: EvidenceGrade;
  /** Present when evidence is `none`: what would have to be imported. */
  missing?: string[];
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

/**
 * Words that look like a product name but are not one.
 *
 * The unknown-subject check below asks "is the customer naming something I do
 * not have?", and the cost of a false positive is telling somebody EngiSignal
 * lacks evidence about "Which" or "Explain". Anything that routinely starts an
 * English sentence, and every term the intent classifier itself keys on, is
 * excluded.
 */
const NOT_A_PRODUCT = new Set([
  'what', 'which', 'who', 'why', 'when', 'where', 'how', 'explain', 'show', 'tell',
  'the', 'our', 'my', 'we', 'us', 'is', 'are', 'do', 'does', 'did', 'can', 'should',
  'this', 'that', 'these', 'those', 'and', 'or', 'for', 'from', 'with', 'about',
  'renewal', 'renewals', 'contract', 'contracts', 'licence', 'license', 'licenses',
  'licences', 'portfolio', 'executive', 'summary', 'evidence', 'missing', 'data',
  'cost', 'costs', 'spend', 'saving', 'savings', 'opportunity', 'opportunities',
  'capacity', 'risk', 'demand', 'usage', 'forecast', 'scenario', 'confidence',
  'engisignal', 'vendor', 'vendors', 'feature', 'features', 'product', 'products',
  'user', 'users', 'seat', 'seats', 'team', 'teams', 'department', 'departments',
  'program', 'programs', 'priorit', 'prioritise', 'prioritize', 'biggest', 'largest',
  'top', 'next', 'now', 'year', 'month', 'quarter', 'reclaim', 'idle', 'utilisation',
  'utilization', 'growth', 'grow', 'increase', 'decrease', 'reduce', 'change',
  'changes', 'changed', 'under', 'assumption', 'assumptions', 'lab', 'driving',
  'drives', 'driver', 'drivers', 'recommendation', 'recommendations', 'made', 'being',
]);

/**
 * A subject the customer named that EngiSignal has never seen.
 *
 * Returns the offending term, or null when everything named is recognised.
 *
 * The direction of the error matters here. Answering a question about
 * "Solidworks" with portfolio-wide figures — because Solidworks was not found
 * and the classifier fell through to the overview — produces a confident answer
 * to a question nobody asked, and every number in it is real, which is what
 * makes it convincing. Saying "EngiSignal holds no evidence about Solidworks"
 * is occasionally pedantic and never misleading.
 */
function unknownSubject(workspace: Workspace, question: string): string | null {
  const known = new Set<string>();
  for (const row of workspace.portfolio) {
    for (const value of [row.featureName, row.productName, row.featureCode, row.vendorName]) {
      for (const token of value.toLowerCase().split(/[^a-z0-9]+/)) {
        if (token.length > 2) known.add(token);
      }
    }
  }

  // Candidates: capitalised or ALL-CAPS tokens, and underscore-joined codes —
  // the three shapes engineering software names actually take.
  const candidates = question.match(/\b[A-Z][A-Za-z0-9]{2,}(?:[_-][A-Za-z0-9]+)*\b|\b[A-Z0-9]{3,}(?:_[A-Z0-9]+)+\b/g) ?? [];

  for (const candidate of candidates) {
    const lower = candidate.toLowerCase();
    if (NOT_A_PRODUCT.has(lower)) continue;
    // A multi-part code counts as known if any part is known.
    const parts = lower.split(/[^a-z0-9]+/).filter((part) => part.length > 2);
    if (parts.length === 0) continue;
    if (parts.some((part) => known.has(part) || NOT_A_PRODUCT.has(part))) continue;
    return candidate;
  }
  return null;
}

/**
 * Retrieval, with the evidence gate in front of it.
 *
 * Two questions are answered before any intent is classified, because both are
 * reasons no intent can be answered honestly:
 *
 *   1. Is there any analysis at all?
 *   2. Did the customer name something this workspace has never seen?
 */
export function retrieve(workspace: Workspace, question: string): RetrievedAnswer {
  if (workspace.portfolio.length === 0) {
    return {
      intent: 'no-evidence',
      headline: 'EngiSignal has no analysis for this workspace yet.',
      facts: [],
      narrative:
        'Nothing has been imported, so there is no usage, entitlement or contract evidence to answer from. EngiSignal does not estimate an answer in place of one.',
      links: [{ label: 'Import data', href: '/app/data/import' }],
      evidence: 'none',
      missing: ['A usage export', 'An entitlement export', 'A contract or price file'],
    };
  }

  const unknown = unknownSubject(workspace, question);
  if (unknown !== null) {
    return {
      intent: 'no-evidence',
      headline: `EngiSignal holds no evidence about "${unknown}".`,
      facts: [
        { label: 'Features analysed in this workspace', value: formatNumber(workspace.portfolio.length) },
      ],
      narrative:
        `Nothing imported into this workspace matches "${unknown}". It may be licensed under a different feature code, ` +
        `served by a licence server whose export has not been imported, or not present in this estate at all. ` +
        `EngiSignal will not answer for it from anything other than your own data.`,
      links: [
        { label: 'Portfolio', href: '/app/portfolio' },
        { label: 'Unmapped features', href: '/app/data/unmapped-features' },
      ],
      evidence: 'none',
      missing: [`Usage or entitlement rows naming "${unknown}"`],
    };
  }

  const answer = classify(workspace, question);
  return {
    ...answer,
    // Intents that grade themselves keep their grade. The rest are graded on
    // whether retrieval actually found anything: a fact list that came back
    // empty is a question this workspace's data does not reach, and saying so
    // is the honest answer.
    evidence: answer.evidence ?? (answer.facts.length === 0 ? 'partial' : 'sufficient'),
  };
}

type ClassifiedAnswer = Omit<RetrievedAnswer, 'evidence'> & { evidence?: EvidenceGrade };

function classify(workspace: Workspace, question: string): ClassifiedAnswer {
  const q = question.toLowerCase().trim();
  const feature = findFeature(workspace, question);
  const { portfolio, renewals, totals, dataset, signals, confidence } = workspace;

  // ── Explain this portfolio to an executive ───────────────────────────────
  if (/executive|board|leadership|cfo|summar(y|ise|ize)|brief|one page|elevator/.test(q)) {
    const priced = portfolio.filter((row) => row.financial.priced);
    const topOpportunity = [...portfolio]
      .filter((row) => (row.financial.optimizationOpportunity ?? 0) > 0)
      .sort((a, b) => (b.financial.optimizationOpportunity ?? 0) - (a.financial.optimizationOpportunity ?? 0))[0];
    const nearest = [...renewals]
      .filter((r) => r.daysRemaining >= 0)
      .sort((a, b) => a.daysRemaining - b.daysRemaining)[0];
    const atRisk = portfolio.filter((row) => row.risk === 'High' || row.risk === 'Critical');

    return {
      intent: 'executive-brief',
      headline: hasCostEvidence(totals)
        ? `${dataset.organization.name}: ${formatCurrency(totals.annualSpend)} of served capacity, ${formatCurrency(totals.optimizationOpportunity)} addressable.`
        : `${dataset.organization.name}: ${formatNumber(portfolio.length)} features analysed, no prices supplied.`,
      facts: [
        { label: 'Annual value of served capacity', value: formatCurrencyExact(costFigure(totals.annualSpend, totals)) },
        { label: 'Purchased commitment', value: formatCurrencyExact(costFigure(totals.purchasedCommitment, totals)) },
        { label: 'Optimization opportunity', value: formatCurrencyExact(costFigure(totals.optimizationOpportunity, totals)) },
        { label: 'Features analysed', value: formatNumber(portfolio.length) },
        { label: 'Features with a price', value: `${formatNumber(priced.length)} of ${formatNumber(portfolio.length)}` },
        { label: 'Vendors', value: formatNumber(totals.vendorCount) },
        { label: 'Features at High or Critical capacity risk', value: formatNumber(atRisk.length) },
        ...(topOpportunity === undefined
          ? []
          : [{
              label: 'Largest single opportunity',
              value: `${topOpportunity.vendorName} ${topOpportunity.productName} — ${formatCurrencyExact(topOpportunity.financial.optimizationOpportunity)}`,
            }]),
        ...(nearest === undefined
          ? []
          : [{
              label: 'Nearest renewal',
              value: `${nearest.vendorName} in ${formatNumber(nearest.daysRemaining)} days (${formatDate(nearest.renewalDate)})`,
            }]),
        { label: 'Portfolio confidence', value: `${confidence.level} (${confidence.score}/100)` },
        { label: 'Analysis date', value: formatDate(dataset.asOf) },
      ],
      narrative:
        'Served capacity is what the licence servers are configured to issue; purchased commitment is what procurement records buying. Where they differ, the difference is reported rather than resolved, because only the customer can say which document is current.',
      links: [
        { label: 'Executive Brief', href: '/app/brief' },
        { label: 'Intelligence', href: '/app' },
      ],
      evidence: hasCostEvidence(totals) ? 'sufficient' : 'partial',
    };
  }

  // ── What evidence is missing ─────────────────────────────────────────────
  if (/missing|what.*(don't|do not|dont).*have|gap|incomplete|improve.*confidence|what.*need/.test(q)) {
    const unpriced = portfolio.filter((row) => !row.financial.priced);
    const noUsage = portfolio.filter((row) => row.metrics === null);
    const noRenewalDate = portfolio.filter((row) => row.renewalDate === null);
    const shortHistory = portfolio.filter(
      (row) => row.metrics !== null && row.metrics.observedDays < 300,
    );

    return {
      intent: 'missing-evidence',
      headline: `Portfolio confidence is ${confidence.level} at ${confidence.score}/100. ${formatNumber(confidence.reasons.length)} factors are holding it there.`,
      facts: [
        ...confidence.reasons.map((reason) => ({ label: reason.label, value: reason.detail })),
        { label: 'Features with no price supplied', value: `${formatNumber(unpriced.length)} of ${formatNumber(portfolio.length)}` },
        { label: 'Features with no usage observed', value: `${formatNumber(noUsage.length)} of ${formatNumber(portfolio.length)}` },
        { label: 'Features with no renewal date', value: `${formatNumber(noRenewalDate.length)} of ${formatNumber(portfolio.length)}` },
        { label: 'Features with under 300 days of history', value: `${formatNumber(shortHistory.length)} of ${formatNumber(portfolio.length)}` },
        {
          label: 'Usernames not tied to a person',
          value: formatNumber(
            // `ambiguous` counts too: two people claiming one identifier is not
            // a resolved identity, and its usage cannot be attributed either.
            workspace.userIdentities.filter(
              (identity) => identity.status === 'unmatched' || identity.status === 'ambiguous',
            ).length,
          ),
        },
      ],
      narrative:
        'Every one of these is a specific file or column that would raise confidence. EngiSignal reports the gap rather than filling it: an unpriced feature has no opportunity figure at all, which is different from an opportunity of zero.',
      links: [
        { label: 'Data centre', href: '/app/data' },
        { label: 'Import more', href: '/app/data/import' },
      ],
      evidence: 'sufficient',
    };
  }

  // ── Which renewal should we prioritise ───────────────────────────────────
  // Deliberately narrow. "Which renewals need attention?" is a request for the
  // list and is answered by the `renewals` intent below; only language that
  // actually asks for an ORDER lands here. `first` and `order` were tried as
  // triggers and both swept up ordinary phrasing.
  if (/priorit|most urgent|which renewal should|rank/.test(q) && /renew|contract|expir/.test(q)) {
    // Ranked by what actually decides a renewal conversation: how soon it is,
    // and how much is riding on it. Both are reported so the reader can see
    // the trade-off rather than being handed a single opaque score.
    const ranked = [...renewals]
      .filter((r) => r.daysRemaining >= 0)
      .sort((a, b) => {
        const aValue = (a.currentAnnualSpend ?? 0) + (a.optimizationOpportunity ?? 0);
        const bValue = (b.currentAnnualSpend ?? 0) + (b.optimizationOpportunity ?? 0);
        if (a.daysRemaining !== b.daysRemaining && (a.daysRemaining <= 90) !== (b.daysRemaining <= 90)) {
          return a.daysRemaining - b.daysRemaining;
        }
        return bValue - aValue;
      });

    return {
      intent: 'renewal-priority',
      headline:
        ranked[0] === undefined
          ? 'No dated renewals are ahead of the analysis date.'
          : `${ranked[0].vendorName} is the one to take first — ${formatNumber(ranked[0].daysRemaining)} days out.`,
      facts: ranked.slice(0, 6).map((renewal, index) => ({
        label: `${index + 1}. ${renewal.vendorName} — ${formatDate(renewal.renewalDate)}`,
        value:
          `${formatNumber(renewal.daysRemaining)} days · ${formatCurrencyExact(renewal.currentAnnualSpend)} current · ` +
          `${renewal.optimizationOpportunity === null ? 'opportunity not priced' : `${formatCurrencyExact(renewal.optimizationOpportunity)} opportunity`} · ` +
          `${renewal.confidence.level} confidence`,
      })),
      narrative:
        'Anything inside ninety days is ordered by date, because the decision window is the binding constraint. Beyond that, the ranking follows the money at stake. An unpriced line is listed but never ranked above a priced one on value it does not have.',
      links: [{ label: 'Renewal Command Centre', href: '/app/renewals' }],
      evidence: ranked.length === 0 ? 'partial' : 'sufficient',
    };
  }

  // ── Savings opportunities ────────────────────────────────────────────────
  if (/saving|opportunit|reduce spend|overspend|waste|cut cost/.test(q)) {
    const top = [...portfolio]
      .filter((row) => (row.financial.optimizationOpportunity ?? 0) > 0)
      .sort((a, b) => (b.financial.optimizationOpportunity ?? 0) - (a.financial.optimizationOpportunity ?? 0))
      .slice(0, 5);
    const leader = top[0];

    return {
      intent: 'savings',
      headline: hasCostEvidence(totals)
        ? `${formatCurrency(totals.optimizationOpportunity)} of annual optimization opportunity across the portfolio.`
        : `Optimization opportunity cannot be calculated: ${COST_NOT_PROVIDED.toLowerCase()} for any feature.`,
      facts: [
        { label: 'Total annual spend', value: formatCurrencyExact(costFigure(totals.annualSpend, totals)) },
        {
          label: 'Total optimization opportunity',
          value: formatCurrencyExact(costFigure(totals.optimizationOpportunity, totals)),
        },
        { label: 'Share of spend', value: formatPercent((totals.optimizationOpportunity / totals.annualSpend) * 100) },
        ...top.map((row) => ({
          label: `${row.vendorName} ${row.productName} (${row.featureName})`,
          value: `${formatCurrencyExact(row.financial.optimizationOpportunity)} — entitled ${formatNumber(row.entitled)}, recommended ${formatNumber(row.rightSizing?.recommended ?? 0)}`,
        })),
        // ── WHAT IS *DRIVING* THE LARGEST ONE ────────────────────────────────
        //
        // "You have $281,400 of opportunity" is a number. "You are serving 220
        // seats against a P95 of 139, so 66 seats are never reached" is the
        // reason, and it is the part somebody has to defend to a vendor. The
        // arithmetic is the deterministic engine's; this only surfaces it.
        ...(leader === undefined
          ? []
          : [
              { label: `Driver — entitled quantity`, value: formatNumber(leader.entitled) },
              ...(leader.metrics === null
                ? [{ label: 'Driver — observed demand', value: 'No usage evidence supplied for this feature' }]
                : [
                    { label: 'Driver — P95 daily peak demand', value: formatNumber(leader.metrics.p95, 1) },
                    { label: 'Driver — maximum daily peak', value: formatNumber(leader.metrics.max) },
                    { label: 'Driver — utilization at P95', value: formatPercent(leader.metrics.utilizationPct) },
                    { label: 'Driver — days observed', value: formatNumber(leader.metrics.observedDays) },
                  ]),
              ...(leader.rightSizing === null
                ? []
                : [
                    { label: 'Driver — recommended quantity', value: formatNumber(leader.rightSizing.recommended) },
                    { label: 'Driver — surplus seats', value: formatNumber(leader.entitled - leader.rightSizing.recommended) },
                  ]),
              { label: 'Driver — unit price', value: formatCurrencyExact(leader.unitPrice) },
              { label: 'Driver — confidence', value: `${leader.confidence.level} (${leader.confidence.score}/100)` },
            ]),
      ],
      narrative:
        leader === undefined
          ? 'No feature currently carries a priced optimization opportunity.'
          : `The largest single opportunity is ${leader.vendorName} ${leader.productName}. ` +
            `It is entitled capacity above what observed demand supports at the current assumptions, valued at the contract unit price — ` +
            `not a discount, a forecast, or a negotiating position.`,
      links: [
        { label: 'Portfolio', href: '/app/portfolio' },
        ...(leader === undefined ? [] : [{ label: `${leader.productName} evidence`, href: `/app/portfolio/${leader.featureId}` }]),
      ],
      evidence: hasCostEvidence(totals) ? 'sufficient' : 'partial',
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
              {
                label: 'Demand trend',
                value:
                  annualizedTrend(feature.metrics) === null
                    ? INSUFFICIENT_TREND_LABEL
                    : `${formatSignedPercent(annualizedTrend(feature.metrics))} per year`,
              },
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
        // Never coalesce an absent measurement to zero in an answer: a feature
        // can be risky on denials alone, and "0.0% utilization" would state a
        // measurement that was never taken.
        value:
          (row.metrics === null
            ? 'Usage evidence not supplied'
            : `${formatPercent(row.metrics.utilizationPct)} utilization at P95, ${formatNumber(row.metrics.saturationDays)} saturation days`) +
          (row.denials === null
            ? ''
            : `, ${formatNumber(row.denials.totalDenials)} denials (${row.denials.risk} risk)`),
      })),
      narrative:
        'Denials are reported as context and are deliberately excluded from the recommended quantity calculation, so a retry burst cannot inflate a purchase.',
      links: [{ label: 'Portfolio at risk', href: '/app/portfolio?risk=high' }],
    };
  }

  // ── Fallback: portfolio position ─────────────────────────────────────────
  return {
    intent: 'overview',
    headline: hasCostEvidence(totals)
      ? `${dataset.organization.name} commits ${formatCurrency(totals.annualSpend)} annually across ${formatNumber(portfolio.length)} features.`
      : `${dataset.organization.name} has ${formatNumber(portfolio.length)} analyzed features. ${COST_NOT_PROVIDED}, so no annual value can be stated.`,
    facts: [
      // Portfolio-wide sums: $0 here means "nothing was priced", not "free".
      { label: 'Annual spend', value: formatCurrencyExact(costFigure(totals.annualSpend, totals)) },
      {
        label: 'Optimization opportunity',
        value: formatCurrencyExact(costFigure(totals.optimizationOpportunity, totals)),
      },
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
