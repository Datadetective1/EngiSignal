import type { Metadata } from 'next';
import Link from 'next/link';
import { SignalCard } from '@/components/app/signal-card';
import {
  Card,
  CardHeader,
  ConfidenceBadge,
  Kpi,
  LinkButton,
  MethodologyNote,
  RiskBadge,
} from '@/components/ui/primitives';
import { Sparkline } from '@/components/charts';
import { formatDate } from '@/lib/analytics/dates';
import {
  COST_NOT_PROVIDED,
  costFigure,
  costPerEngineer,
  describeSpendHeadline,
  describeSpendShare,
  formatCurrency,
  formatNumber,
  hasCostEvidence,
} from '@/lib/analytics/financial';
import { computeForecast } from '@/lib/analytics/forecast';
import { forecastPortfolioSpend } from '@/lib/analytics/forecast';
import { monthlyPeakSeries } from '@/lib/analytics/concurrent';
import { loadWorkspace } from '@/lib/workspace';
import { AnalyticsWithheld } from '@/components/app/data-integrity';
import { analyticsAvailable } from '@/lib/analytics/integrity';
import { featureHref, renewalHref } from '@/lib/routes';

export const metadata: Metadata = { title: 'Intelligence' };

export default async function IntelligencePage() {
  const { dataset, portfolio, renewals, signals, totals, unusedCapacity, confidence, options, integrity } =
    await loadWorkspace();

  // Every figure below is computed from usage. When the analysis did not read
  // all of it, there is no honest version of this page.
  if (!analyticsAvailable(integrity)) return <AnalyticsWithheld integrity={integrity} />;

  const capacityRisks = portfolio.filter((row) => row.risk === 'High' || row.risk === 'Critical').length;
  const reclaimCandidates = portfolio.reduce((acc, row) => acc + (row.namedUser?.reclaimCandidates ?? 0), 0);
  const actionableRenewals = renewals.filter((r) => r.daysRemaining >= 0 && r.daysRemaining <= 120);

  const forecastSpend = forecastPortfolioSpend(
    portfolio.map((row) => {
      if (row.metrics === null) {
        return { recommendedQuantity: row.entitled, unitPrice: row.unitPrice };
      }
      const forecast = computeForecast({
        metrics: row.metrics,
        headcountGrowthRate: dataset.organization.headcountGrowthRate ?? 0,
        safetyFactor: options.safetyFactor,
        unitPrice: row.unitPrice,
      });
      return { recommendedQuantity: forecast.recommendedQuantity, unitPrice: row.unitPrice };
    }),
  );

  const perEngineer = costPerEngineer(totals.annualSpend, dataset.organization.technicalHeadcount);
  // What the headline figure actually measures. Served capacity and a signed
  // commitment are different numbers and must not share a label.
  const headline = describeSpendHeadline(totals);
  const topSignals = signals.slice(0, 6);
  const remaining = signals.length - topSignals.length;

  return (
    <div className="space-y-8">
      {/* ── Briefing header ─────────────────────────────────────────────── */}
      <header>
        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.13em] text-fg-subtle">
          Engineering Software Intelligence
        </p>
        <h1 className="max-w-3xl text-[26px] font-semibold leading-[1.2] tracking-[-0.026em] text-fg">
          Here&rsquo;s what changed in your engineering software portfolio.
        </h1>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-fg-muted">
          <span>
            {formatNumber(portfolio.length)} features · {formatNumber(totals.vendorCount)} vendors ·{' '}
            {formatNumber(dataset.organization.technicalHeadcount)} technical employees
          </span>
          <span className="hidden text-fg-subtle sm:inline">·</span>
          <span className="inline-flex items-center gap-1.5">
            Portfolio confidence <ConfidenceBadge level={confidence.level} score={confidence.score} />
          </span>
        </p>
      </header>

      {/* ── KPIs ────────────────────────────────────────────────────────── */}
      <section aria-label="Portfolio indicators">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Kpi
            label={headline.label}
            value={formatCurrency(headline.value)}
            detail={
              headline.contrast === null
                ? perEngineer === null
                  ? undefined
                  : `${formatCurrency(perEngineer)} per technical employee`
                : `${headline.contrast.label} ${formatCurrency(headline.contrast.value)}`
            }
            href="/app/cost"
          />
          <Kpi
            label="Optimization"
            value={formatCurrency(costFigure(totals.optimizationOpportunity, totals))}
            tone="positive"
            detail={
              hasCostEvidence(totals)
                ? describeSpendShare(totals.optimizationOpportunity, totals.annualSpend)
                : COST_NOT_PROVIDED
            }
            href="/app/portfolio"
          />
          <Kpi
            label="Renewals to action"
            value={formatNumber(actionableRenewals.length)}
            detail={
              actionableRenewals[0] === undefined
                ? 'None within 120 days'
                : `Next: ${actionableRenewals[0].vendorName} in ${actionableRenewals[0].daysRemaining} days`
            }
            href="/app/renewals"
          />
          <Kpi
            label="Capacity risks"
            value={formatNumber(capacityRisks)}
            tone={capacityRisks > 0 ? 'danger' : 'neutral'}
            detail={capacityRisks > 0 ? 'Features at High or Critical risk' : 'No features at elevated risk'}
            href="/app/portfolio?risk=high"
          />
          <Kpi
            label="Reclaim candidates"
            value={formatNumber(reclaimCandidates)}
            detail={`Idle ${options.reclaimThresholdDays}+ days across named-user products`}
            href="/app/reclaim"
          />
          <Kpi
            label="Forecast spend"
            value={formatCurrency(forecastSpend)}
            detail={`At ${((dataset.organization.headcountGrowthRate ?? 0) * 100).toFixed(0)}% headcount growth`}
            href="/app/forecast"
          />
        </div>

        <MethodologyNote>
          Optimization is the annual value of entitled capacity above the recommended quantity, at contract
          unit price. Unused concurrent capacity above P95 demand alone accounts for{' '}
          {formatCurrency(unusedCapacity.amount)} across {unusedCapacity.featureCount} features.
        </MethodologyNote>
      </section>

      {/* ── Signals ─────────────────────────────────────────────────────── */}
      <section aria-label="Signals">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-fg">Signals</h2>
            <p className="mt-1 text-[13px] text-fg-muted">
              Ranked by financial impact, urgency and risk — then weighted by how much the underlying data
              can be trusted.
            </p>
          </div>
          {remaining > 0 && (
            <Link
              href="/app/decisions"
              className="text-[12.5px] font-medium text-accent underline-offset-4 hover:underline"
            >
              View all {signals.length} signals
            </Link>
          )}
        </div>

        <ul className="space-y-2.5">
          {topSignals.map((signal, index) => (
            <SignalCard key={signal.id} signal={signal} rank={index + 1} />
          ))}
        </ul>
      </section>

      {/* ── Supporting detail ───────────────────────────────────────────── */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Renewal runway"
            description="Every contract decision on the next twelve months."
            action={
              <LinkButton href="/app/renewals" size="sm">
                Command centre
              </LinkButton>
            }
          />
          <ul className="divide-y divide-border">
            {renewals.slice(0, 6).map((renewal) => {
              const net = (renewal.optimizationOpportunity ?? 0) - (renewal.incrementalSpend ?? 0);
              return (
                <li key={renewal.contractId}>
                  <Link
                    href={renewalHref(renewal.contractId)}
                    className="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-surface-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-fg">{renewal.vendorName}</p>
                      <p className="mt-0.5 text-[11.5px] text-fg-subtle">
                        {formatDate(renewal.renewalDate)} · {renewal.itemCount} line items
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="tnum text-[13px] font-medium text-fg">
                        {formatCurrency(renewal.currentAnnualSpend)}
                      </p>
                      <p
                        className={`tnum mt-0.5 text-[11.5px] ${net > 0 ? 'text-positive' : net < 0 ? 'text-danger' : 'text-fg-subtle'}`}
                      >
                        {net === 0 ? 'At position' : `${net > 0 ? '−' : '+'}${formatCurrency(Math.abs(net))}`}
                      </p>
                    </div>
                    <div className="w-16 shrink-0 text-right">
                      <span
                        className={`tnum text-[12px] font-medium ${renewal.daysRemaining <= 60 ? 'text-danger' : 'text-fg-muted'}`}
                      >
                        {renewal.daysRemaining}d
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card>
          <CardHeader
            title="Largest positions"
            description="Where the money is, and how demand is moving."
            action={
              <LinkButton href="/app/portfolio" size="sm">
                Full portfolio
              </LinkButton>
            }
          />
          <ul className="divide-y divide-border">
            {portfolio.slice(0, 6).map((row) => {
              const series =
                row.metrics === null
                  ? []
                  : monthlyPeakSeries(dataset.dailyUsage, row.featureId, row.metrics.window).map(
                      (m) => m.meanPeak,
                    );
              return (
                <li key={row.featureId}>
                  <Link
                    href={featureHref(row.featureId)}
                    className="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-surface-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-fg">
                        {row.productName}
                        <span className="ml-1.5 font-normal text-fg-subtle">{row.featureName}</span>
                      </p>
                      <p className="mt-0.5 text-[11.5px] text-fg-subtle">
                        {row.vendorName} ·{' '}
                        {row.metrics === null
                          ? `${formatNumber(row.namedUser?.assigned ?? row.entitled)} seats`
                          : `${formatNumber(row.entitled)} entitled · P95 ${formatNumber(row.metrics.p95, 0)}`}
                      </p>
                    </div>
                    <Sparkline
                      values={series}
                      tone={row.metrics !== null && row.metrics.trendPctPerYear < 0 ? 'muted' : 'accent'}
                      className="hidden sm:block"
                    />
                    <div className="w-24 shrink-0 text-right">
                      <p className="tnum text-[13px] font-medium text-fg">
                        {formatCurrency(row.financial.currentAnnualCost)}
                      </p>
                      {row.risk !== 'Low' && <RiskBadge risk={row.risk} className="mt-1" />}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </div>
  );
}
