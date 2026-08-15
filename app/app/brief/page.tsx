import type { Metadata } from 'next';
import Link from 'next/link';
import { LogoMark } from '@/components/brand/logo';
import { PrintButton } from '@/components/app/print-button';
import { CostBridge, RankedBars } from '@/components/charts';
import { Badge, TableShell, Td, Th } from '@/components/ui/primitives';
import { brand } from '@/config/brand';
import { formatDate } from '@/lib/analytics/dates';
import {
  costPerEngineer,
  formatCurrency,
  formatCurrencyExact,
  formatNumber,
  formatPercent,
  formatSignedPercent,
} from '@/lib/analytics/financial';
import { computeForecast, forecastPortfolioSpend } from '@/lib/analytics/forecast';
import { SIGNAL_LABELS } from '@/lib/analytics/signals';
import { employeeIndex, loadWorkspace } from '@/lib/workspace';

export const metadata: Metadata = { title: 'Executive brief' };

export default async function ExecutiveBriefPage() {
  const workspace = await loadWorkspace();
  const { dataset, portfolio, renewals, signals, totals, unusedCapacity, confidence, options, dataQuality } =
    workspace;

  const employees = employeeIndex(dataset);
  const headcountGrowth = dataset.organization.headcountGrowthRate ?? 0;

  const forecasts = portfolio
    .filter((row) => row.metrics !== null)
    .map((row) => ({
      row,
      forecast: computeForecast({
        metrics: row.metrics!,
        headcountGrowthRate: headcountGrowth,
        safetyFactor: options.safetyFactor,
        unitPrice: row.unitPrice,
      }),
    }));

  const forecastSpend = forecastPortfolioSpend(
    forecasts.map((f) => ({ recommendedQuantity: f.forecast.recommendedQuantity, unitPrice: f.row.unitPrice })),
  );

  const upcoming = renewals.filter((r) => r.daysRemaining >= 0 && r.daysRemaining <= 180);
  const capacityRisks = portfolio.filter((row) => row.risk === 'High' || row.risk === 'Critical');
  const reclaimTotal = portfolio.reduce((acc, row) => acc + (row.namedUser?.reclaimValue ?? 0), 0);
  const reclaimSeats = portfolio.reduce((acc, row) => acc + (row.namedUser?.reclaimCandidates ?? 0), 0);
  const perEngineer = costPerEngineer(totals.annualSpend, dataset.organization.technicalHeadcount);

  const byProgram = new Map<string, number>();
  for (const activity of dataset.activities) {
    const program = employees.get(activity.employeeId)?.program ?? 'Unattributed';
    byProgram.set(program, (byProgram.get(program) ?? 0) + activity.totalHours);
  }
  const programBars = [...byProgram.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  const topOpportunities = [...portfolio]
    .filter((row) => (row.financial.optimizationOpportunity ?? 0) > 0)
    .sort((a, b) => (b.financial.optimizationOpportunity ?? 0) - (a.financial.optimizationOpportunity ?? 0))
    .slice(0, 6);

  return (
    <div className="mx-auto max-w-[940px]">
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link href="/app" className="text-[12.5px] text-fg-muted hover:text-fg">
          ← Back to Intelligence
        </Link>
        <PrintButton label="Print / Save as PDF" />
      </div>

      <article className="rounded-lg border border-border bg-surface px-8 py-8 print:border-0 print:px-0">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-6 border-b border-border pb-6">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-fg-subtle">
              Executive Brief
            </p>
            <h1 className="mt-1.5 text-[28px] font-semibold leading-tight tracking-[-0.028em] text-fg">
              Engineering Software Portfolio
            </h1>
            <p className="mt-1.5 text-[13px] text-fg-muted">
              {dataset.organization.name} · {formatNumber(dataset.organization.technicalHeadcount)} technical
              employees
            </p>
          </div>
          <div className="text-right">
            <span className="inline-flex items-center gap-2 text-fg">
              <LogoMark size={22} />
              <span className="text-[14px] font-semibold tracking-[-0.02em]">{brand.name}</span>
            </span>
            <p className="mt-2 text-[11px] text-fg-subtle">Analysis as of {formatDate(dataset.asOf)}</p>
            <p className="text-[11px] text-fg-subtle">
              Portfolio confidence: {confidence.level} ({confidence.score}/100)
            </p>
          </div>
        </header>

        {/* ── Headline figures ──────────────────────────────────────────── */}
        <section className="print-avoid-break mb-9">
          <div className="grid gap-3 sm:grid-cols-3">
            <BriefKpi label="Annual software spend" value={formatCurrency(totals.annualSpend)} sub={perEngineer === null ? undefined : `${formatCurrency(perEngineer)} per technical employee`} />
            <BriefKpi
              label="Optimization opportunity"
              value={formatCurrency(totals.optimizationOpportunity)}
              tone="positive"
              sub={`${formatPercent((totals.optimizationOpportunity / totals.annualSpend) * 100)} of current spend`}
            />
            <BriefKpi
              label="Forecast spend"
              value={formatCurrency(forecastSpend)}
              tone={forecastSpend > totals.annualSpend ? 'danger' : 'positive'}
              sub={`At ${formatSignedPercent(headcountGrowth * 100, 0)} headcount growth`}
            />
          </div>
        </section>

        {/* ── 1. What changed ───────────────────────────────────────────── */}
        <BriefSection number="01" title="What changed" subtitle="The signals that warrant leadership attention.">
          <ul className="space-y-2.5">
            {signals.slice(0, 5).map((signal) => (
              <li key={signal.id} className="rounded-md border border-border px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-fg-subtle">
                    {SIGNAL_LABELS[signal.kind]}
                  </span>
                  <span className="flex items-center gap-2">
                    {signal.urgencyDays !== null && (
                      <span className="tnum text-[11.5px] text-fg-muted">{signal.urgencyDays} days</span>
                    )}
                    <Badge tone={signal.confidence === 'High' ? 'positive' : signal.confidence === 'Medium' ? 'warning' : 'danger'}>
                      {signal.confidence}
                    </Badge>
                  </span>
                </div>
                <p className="mt-1 text-[13px] font-medium text-fg">{signal.title}</p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-fg-muted">{signal.subtitle}</p>
                {signal.financialImpact !== null && (
                  <p className="tnum mt-1.5 text-[12.5px] font-medium text-accent">
                    {formatCurrencyExact(signal.financialImpact)} annual impact
                  </p>
                )}
              </li>
            ))}
          </ul>
        </BriefSection>

        {/* ── 2. Financial opportunity ──────────────────────────────────── */}
        <BriefSection number="02" title="Financial opportunity" subtitle="Where the money is, and what demand supports.">
          <div className="mb-5">
            <CostBridge
              start={{ label: 'Current', value: totals.annualSpend }}
              changes={[
                { label: 'Reductions', delta: -totals.optimizationOpportunity },
                { label: 'Increases', delta: totals.incrementalSpend },
              ]}
              formatValue={(value) => formatCurrency(value)}
            />
          </div>

          <TableShell className="min-w-0">
            <thead>
              <tr>
                <Th>Vendor / Product</Th>
                <Th align="right">Entitled</Th>
                <Th align="right">Demand basis</Th>
                <Th align="right">Recommended</Th>
                <Th align="right">Annual opportunity</Th>
              </tr>
            </thead>
            <tbody>
              {topOpportunities.map((row) => (
                <tr key={row.featureId}>
                  <Td>
                    <span className="font-medium">{row.productName}</span>
                    <span className="block text-[11px] text-fg-subtle">
                      {row.vendorName} · {row.featureName}
                    </span>
                  </Td>
                  <Td align="right">{formatNumber(row.entitled)}</Td>
                  <Td align="right">{formatNumber(row.rightSizing?.basis ?? 0, 0)}</Td>
                  <Td align="right" className="font-medium">
                    {formatNumber(row.rightSizing?.recommended ?? 0)}
                  </Td>
                  <Td align="right" className="font-semibold text-positive">
                    {formatCurrencyExact(row.financial.optimizationOpportunity)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableShell>

          <p className="mt-3 text-[11.5px] leading-relaxed text-fg-subtle">
            Unused concurrent capacity above P95 demand alone accounts for{' '}
            {formatCurrencyExact(unusedCapacity.amount)} across {unusedCapacity.featureCount} features.
            Named-user waste adds {formatCurrencyExact(reclaimTotal)} across {formatNumber(reclaimSeats)} idle
            seats. The two are reported separately because they use different definitions of waste.
          </p>
        </BriefSection>

        {/* ── 3. Upcoming decisions ─────────────────────────────────────── */}
        <BriefSection number="03" title="Upcoming decisions" subtitle="Commitments inside the next six months.">
          <TableShell className="min-w-0">
            <thead>
              <tr>
                <Th>Vendor</Th>
                <Th>Renewal</Th>
                <Th align="right">Days</Th>
                <Th align="right">Current spend</Th>
                <Th align="right">Recommended</Th>
                <Th align="right">Net change</Th>
                <Th>Confidence</Th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((renewal) => {
                const net = (renewal.optimizationOpportunity ?? 0) - (renewal.incrementalSpend ?? 0);
                return (
                  <tr key={renewal.contractId}>
                    <Td className="font-medium">{renewal.vendorName}</Td>
                    <Td className="whitespace-nowrap text-fg-muted">{formatDate(renewal.renewalDate)}</Td>
                    <Td align="right" className={renewal.daysRemaining <= 60 ? 'font-medium text-danger' : ''}>
                      {renewal.daysRemaining}
                    </Td>
                    <Td align="right">{formatCurrencyExact(renewal.currentAnnualSpend)}</Td>
                    <Td align="right">{formatCurrencyExact(renewal.recommendedAnnualSpend)}</Td>
                    <Td align="right" className={net > 0 ? 'font-medium text-positive' : net < 0 ? 'font-medium text-danger' : ''}>
                      {net === 0 ? '—' : `${net > 0 ? '−' : '+'}${formatCurrencyExact(Math.abs(net))}`}
                    </Td>
                    <Td>{renewal.confidence.level}</Td>
                  </tr>
                );
              })}
            </tbody>
          </TableShell>
        </BriefSection>

        {/* ── 4. Capacity exposure ──────────────────────────────────────── */}
        <BriefSection number="04" title="Capacity exposure" subtitle="Where engineering work is at risk of being blocked.">
          {capacityRisks.length === 0 ? (
            <p className="text-[12.5px] text-fg-muted">No features are currently at elevated capacity risk.</p>
          ) : (
            <ul className="space-y-2.5">
              {capacityRisks.map((row) => (
                <li key={row.featureId} className="rounded-md border border-border px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[13px] font-medium text-fg">
                      {row.productName} · {row.featureName}
                    </span>
                    <Badge tone="danger">{row.risk} risk</Badge>
                  </div>
                  <p className="tnum mt-1 text-[12.5px] text-fg-muted">
                    {formatPercent(row.metrics?.utilizationPct ?? 0)} utilization at P95 ·{' '}
                    {formatNumber(row.metrics?.saturationDays ?? 0)} saturation days · entitled{' '}
                    {formatNumber(row.entitled)}, maximum observed {formatNumber(row.metrics?.max ?? 0)}
                  </p>
                  {row.denials !== null && (
                    <p className="mt-1 text-[12px] leading-relaxed text-fg-subtle">
                      {row.denials.riskRationale}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </BriefSection>

        {/* ── 5. Forecast ───────────────────────────────────────────────── */}
        <BriefSection number="05" title="Forecast" subtitle="Where demand is heading over the next twelve months.">
          <div className="grid gap-4 sm:grid-cols-3">
            <BriefKpi label="Current spend" value={formatCurrencyExact(totals.annualSpend)} />
            <BriefKpi label="Forecast spend" value={formatCurrencyExact(forecastSpend)} tone={forecastSpend > totals.annualSpend ? 'danger' : 'positive'} />
            <BriefKpi
              label="Features needing more capacity"
              value={formatNumber(forecasts.filter((f) => f.forecast.shortfall > 0).length)}
            />
          </div>

          <div className="mt-5">
            <p className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.1em] text-fg-subtle">
              Consumption by program
            </p>
            <RankedBars data={programBars} formatValue={(v) => `${formatNumber(v)} h`} />
          </div>
        </BriefSection>

        {/* ── 6. Recommended actions ────────────────────────────────────── */}
        <BriefSection number="06" title="Recommended actions" subtitle="What leadership should direct next.">
          <ol className="space-y-3">
            {buildActions({
              upcoming,
              opportunity: totals.optimizationOpportunity,
              capacityRisks: capacityRisks.length,
              reclaimSeats,
              reclaimTotal,
              dataIssues: dataQuality.filter((issue) => issue.severity !== 'info').length,
            }).map((action, index) => (
              <li key={index} className="flex gap-3 rounded-md border border-border px-4 py-3">
                <span className="tnum mt-0.5 text-[11px] font-semibold text-fg-subtle">{index + 1}</span>
                <div>
                  <p className="text-[13px] font-medium text-fg">{action.title}</p>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-fg-muted">{action.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </BriefSection>

        {/* ── 7. Evidence ───────────────────────────────────────────────── */}
        <BriefSection number="07" title="Evidence" subtitle="Method and data conditions behind every figure above.">
          <dl className="grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
            <BriefFact label="Observation period" value={`12 months ending ${formatDate(dataset.asOf)}`} />
            <BriefFact label="Sizing basis" value={`P${(options.percentile * 100).toFixed(0)} of daily peak demand`} />
            <BriefFact label="Growth factor" value={options.growthFactor.toFixed(2)} />
            <BriefFact label="Safety buffer" value={`${((options.safetyFactor - 1) * 100).toFixed(0)}%`} />
            <BriefFact label="Named-user threshold" value={`${options.reclaimThresholdDays} days idle`} />
            <BriefFact label="Employee mapping" value={formatPercent(dataset.employeeMappingRate * 100, 0)} />
            <BriefFact label="Feature mapping" value={formatPercent(dataset.featureMappingRate * 100, 0)} />
            <BriefFact label="Features analyzed" value={formatNumber(portfolio.length)} />
          </dl>

          <ul className="mt-4 space-y-1.5">
            {confidence.reasons.map((reason, index) => (
              <li key={index} className="text-[12px] text-fg-muted">
                <span className="font-medium text-fg">{reason.label}:</span> {reason.detail}
              </li>
            ))}
          </ul>

          <p className="mt-4 text-[11.5px] leading-relaxed text-fg-subtle">
            Quantitative analysis is deterministic and reproducible. Denials are reported as risk context and
            are excluded from recommended quantities. Where a figure could not be calculated — typically
            missing contract pricing — it is shown as unavailable rather than estimated.
          </p>
        </BriefSection>

        <footer className="mt-8 border-t border-border pt-4 text-[10.5px] leading-relaxed text-fg-subtle">
          <p>
            Generated by {brand.name} from {dataset.organization.name}&rsquo;s own usage and contract data,
            as of {formatDate(dataset.asOf)}.
            {dataset.organization.isDemo && ' This is a synthetic demonstration organization.'}
          </p>
          <p className="mt-1.5">{brand.vendorDisclosure}</p>
        </footer>
      </article>
    </div>
  );
}

function buildActions(input: {
  upcoming: { vendorName: string; daysRemaining: number; optimizationOpportunity: number | null; incrementalSpend: number | null }[];
  opportunity: number;
  capacityRisks: number;
  reclaimSeats: number;
  reclaimTotal: number;
  dataIssues: number;
}): { title: string; detail: string }[] {
  const actions: { title: string; detail: string }[] = [];
  const nearest = input.upcoming[0];

  if (nearest !== undefined) {
    const net = (nearest.optimizationOpportunity ?? 0) - (nearest.incrementalSpend ?? 0);
    actions.push({
      title: `Approve the ${nearest.vendorName} renewal position`,
      detail: `${nearest.daysRemaining} days remain. The demand-backed position ${net > 0 ? `reduces annual spend by ${formatCurrencyExact(net)}` : net < 0 ? `increases annual spend by ${formatCurrencyExact(-net)}` : 'holds the current commitment'}. A negotiation brief is ready to take to the vendor.`,
    });
  }

  if (input.opportunity > 0) {
    actions.push({
      title: 'Direct procurement to hold quantities to the recommended position',
      detail: `${formatCurrencyExact(input.opportunity)} of annual reduction is supported by observed demand across the portfolio. Each line item carries its own evidence, so positions can be defended individually.`,
    });
  }

  if (input.capacityRisks > 0) {
    actions.push({
      title: `Resolve ${input.capacityRisks} capacity exposure${input.capacityRisks === 1 ? '' : 's'} before renewal`,
      detail:
        'These features run at or near entitled capacity. Decide deliberately whether to increase quantity or accept the operational risk — this is the one place where reducing spend has a real engineering cost.',
    });
  }

  if (input.reclaimSeats > 0) {
    actions.push({
      title: `Run a reclaim campaign on ${input.reclaimSeats} idle named-user seats`,
      detail: `Worth ${formatCurrencyExact(input.reclaimTotal)} annually. Each seat routes to the holder's manager for confirmation rather than being reclaimed automatically.`,
    });
  }

  if (input.dataIssues > 0) {
    actions.push({
      title: 'Close the outstanding data conditions',
      detail: `${input.dataIssues} conditions currently reduce confidence in the recommendations. Resolving them raises the confidence score measurably and, where feature mapping is involved, may increase measured demand.`,
    });
  }

  return actions;
}

function BriefSection({
  number,
  title,
  subtitle,
  children,
}: {
  number: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="print-avoid-break mb-9">
      <div className="mb-3.5 flex flex-wrap items-baseline gap-3 border-b border-border pb-2">
        <span className="tnum text-[11px] font-medium text-fg-subtle">{number}</span>
        <h2 className="text-[16px] font-semibold tracking-[-0.018em] text-fg">{title}</h2>
        <span className="text-[12px] text-fg-subtle">{subtitle}</span>
      </div>
      {children}
    </section>
  );
}

function BriefKpi({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'neutral' | 'positive' | 'danger';
}) {
  return (
    <div className="rounded-md border border-border px-4 py-3.5">
      <p className="text-[11px] uppercase tracking-[0.08em] text-fg-subtle">{label}</p>
      <p
        className={`tnum mt-1.5 text-[22px] font-semibold tracking-[-0.025em] ${
          tone === 'positive' ? 'text-positive' : tone === 'danger' ? 'text-danger' : 'text-fg'
        }`}
      >
        {value}
      </p>
      {sub !== undefined && <p className="mt-1 text-[11.5px] text-fg-muted">{sub}</p>}
    </div>
  );
}

function BriefFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 pb-1.5">
      <dt className="text-[12px] text-fg-muted">{label}</dt>
      <dd className="tnum text-[12.5px] font-medium text-fg">{value}</dd>
    </div>
  );
}
