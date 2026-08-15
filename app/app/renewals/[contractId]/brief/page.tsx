import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LogoMark } from '@/components/brand/logo';
import { PrintButton } from '@/components/app/print-button';
import { TableShell, Td, Th } from '@/components/ui/primitives';
import { brand } from '@/config/brand';
import { formatDate } from '@/lib/analytics/dates';
import {
  formatCurrencyExact,
  formatNumber,
  formatPercent,
  formatSignedPercent,
} from '@/lib/analytics/financial';
import { computeForecast } from '@/lib/analytics/forecast';
import { employeeIndex, loadWorkspace } from '@/lib/workspace';

export const metadata: Metadata = { title: 'Negotiation brief' };

export default async function NegotiationBriefPage({
  params,
}: {
  params: Promise<{ contractId: string }>;
}) {
  const { contractId } = await params;
  const workspace = await loadWorkspace();

  const renewal = workspace.renewals.find((r) => r.contractId === contractId);
  const contract = workspace.dataset.contracts.find((c) => c.id === contractId);
  if (renewal === undefined || contract === undefined) notFound();

  const { dataset, options } = workspace;
  const rows = workspace.portfolio.filter((row) => row.contractId === contractId);
  const employees = employeeIndex(dataset);
  const net = (renewal.optimizationOpportunity ?? 0) - (renewal.incrementalSpend ?? 0);

  // Organizational drivers across the whole agreement.
  const featureIds = new Set(rows.map((r) => r.featureId));
  const byProgram = new Map<string, number>();
  const byDepartment = new Map<string, number>();
  for (const activity of dataset.activities) {
    if (!featureIds.has(activity.featureId)) continue;
    const employee = employees.get(activity.employeeId);
    const program = employee?.program ?? 'Unattributed';
    const department = employee?.department ?? 'Unattributed';
    byProgram.set(program, (byProgram.get(program) ?? 0) + activity.totalHours);
    byDepartment.set(department, (byDepartment.get(department) ?? 0) + activity.totalHours);
  }
  const totalHours = [...byProgram.values()].reduce((a, b) => a + b, 0) || 1;
  const topPrograms = [...byProgram.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topDepartments = [...byDepartment.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  const denialRows = rows.filter((row) => row.denials !== null && row.denials.totalDenials > 0);

  const forecasts = rows.map((row) => {
    if (row.metrics === null) return { row, forecast: null };
    return {
      row,
      forecast: computeForecast({
        metrics: row.metrics,
        headcountGrowthRate: dataset.organization.headcountGrowthRate ?? 0,
        safetyFactor: options.safetyFactor,
        unitPrice: row.unitPrice,
      }),
    };
  });

  return (
    <div className="mx-auto max-w-[900px]">
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link href={`/app/renewals/${contractId}`} className="text-[12.5px] text-fg-muted hover:text-fg">
          ← Back to renewal
        </Link>
        <PrintButton />
      </div>

      <article className="rounded-lg border border-border bg-surface px-8 py-8 print:border-0 print:px-0">
        {/* ── Masthead ──────────────────────────────────────────────────── */}
        <header className="mb-8 flex items-start justify-between gap-6 border-b border-border pb-6">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-fg-subtle">
              Vendor Negotiation Brief
            </p>
            <h1 className="mt-1.5 text-[27px] font-semibold leading-tight tracking-[-0.028em] text-fg">
              {renewal.vendorName}
            </h1>
            <p className="mt-1.5 text-[13px] text-fg-muted">
              {renewal.agreementName} · {renewal.contractNumber}
            </p>
            <p className="mt-0.5 text-[13px] text-fg-muted">
              Renews {formatDate(renewal.renewalDate)} · {renewal.daysRemaining} days remaining
            </p>
          </div>
          <div className="text-right">
            <span className="inline-flex items-center gap-2 text-fg">
              <LogoMark size={22} />
              <span className="text-[14px] font-semibold tracking-[-0.02em]">{brand.name}</span>
            </span>
            <p className="mt-2 text-[11px] text-fg-subtle">
              Prepared for {dataset.organization.name}
            </p>
            <p className="text-[11px] text-fg-subtle">Analysis as of {formatDate(dataset.asOf)}</p>
            <p className="mt-1 text-[11px] text-fg-subtle">Confidence: {renewal.confidence.level}</p>
          </div>
        </header>

        {/* ── Headline ──────────────────────────────────────────────────── */}
        <section className="print-avoid-break mb-8 rounded-lg border border-border bg-surface-2 px-6 py-5">
          <p className="text-[12.5px] leading-relaxed text-fg">
            Across {rows.length} line items on this agreement, observed demand supports a recommended
            annual position of{' '}
            <strong className="tnum">{formatCurrencyExact(renewal.recommendedAnnualSpend)}</strong> against
            a current commitment of{' '}
            <strong className="tnum">{formatCurrencyExact(renewal.currentAnnualSpend)}</strong>
            {net > 0 ? (
              <>
                {' '}— a reduction of{' '}
                <strong className="tnum text-positive">{formatCurrencyExact(net)}</strong> per year.
              </>
            ) : net < 0 ? (
              <>
                {' '}— an increase of{' '}
                <strong className="tnum text-danger">{formatCurrencyExact(-net)}</strong> per year.
              </>
            ) : (
              <> — the current position is already aligned to demand.</>
            )}
          </p>
        </section>

        <BriefSection number="01" title="Current position" subtitle="What is owned today.">
          <TableShell className="min-w-0">
            <thead>
              <tr>
                <Th>Product / Feature</Th>
                <Th>License model</Th>
                <Th align="right">Quantity</Th>
                <Th align="right">Unit price</Th>
                <Th align="right">Annual cost</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.featureId}>
                  <Td>
                    <span className="font-medium">{row.productName}</span>
                    <span className="block text-[11px] text-fg-subtle">{row.featureName}</span>
                  </Td>
                  <Td className="text-fg-muted">{row.licenseModel.replace('_', ' ')}</Td>
                  <Td align="right">{formatNumber(row.entitled)}</Td>
                  <Td align="right">{formatCurrencyExact(row.unitPrice)}</Td>
                  <Td align="right">{formatCurrencyExact(row.financial.currentAnnualCost)}</Td>
                </tr>
              ))}
              <tr>
                <Td className="font-semibold">Total</Td>
                <Td />
                <Td />
                <Td />
                <Td align="right" className="font-semibold">
                  {formatCurrencyExact(renewal.currentAnnualSpend)}
                </Td>
              </tr>
            </tbody>
          </TableShell>
        </BriefSection>

        <BriefSection number="02" title="Actual demand" subtitle="What was consumed over the observation period.">
          <TableShell className="min-w-0">
            <thead>
              <tr>
                <Th>Feature</Th>
                <Th align="right">Mean peak</Th>
                <Th align="right">P90</Th>
                <Th align="right">P95</Th>
                <Th align="right">P99</Th>
                <Th align="right">Maximum</Th>
                <Th align="right">Observed days</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.featureId}>
                  <Td>{row.featureName}</Td>
                  {row.metrics === null ? (
                    <Td align="right" className="text-fg-subtle" colSpan={6}>
                      {row.namedUser === null
                        ? 'Consumption model — see token analysis'
                        : `${formatNumber(row.namedUser.activeUsers)} active of ${formatNumber(row.namedUser.assigned)} assigned seats`}
                    </Td>
                  ) : (
                    <>
                      <Td align="right">{formatNumber(row.metrics.mean, 1)}</Td>
                      <Td align="right">{formatNumber(row.metrics.p90, 1)}</Td>
                      <Td align="right" className="font-medium">
                        {formatNumber(row.metrics.p95, 1)}
                      </Td>
                      <Td align="right">{formatNumber(row.metrics.p99, 1)}</Td>
                      <Td align="right">{formatNumber(row.metrics.max)}</Td>
                      <Td align="right" className="text-fg-muted">
                        {formatNumber(row.metrics.observedDays)}
                      </Td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </TableShell>
        </BriefSection>

        <BriefSection number="03" title="Utilization" subtitle="How effectively entitled capacity was used.">
          <ul className="space-y-2.5">
            {rows.map((row) => {
              const utilization = row.metrics?.utilizationPct ?? row.namedUser?.utilizationPct ?? null;
              if (utilization === null) return null;
              return (
                <li key={row.featureId}>
                  <div className="mb-1 flex items-baseline justify-between gap-4">
                    <span className="text-[12.5px] text-fg">{row.featureName}</span>
                    <span className="tnum text-[12.5px] font-medium text-fg">
                      {formatPercent(utilization, 0)}
                      {row.metrics !== null && (
                        <span className="ml-2 font-normal text-fg-subtle">
                          {formatNumber(row.metrics.saturationDays)} saturation days
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3">
                    <div
                      className={`h-full rounded-full ${utilization >= 92 ? 'bg-danger' : utilization < 60 ? 'bg-positive' : 'bg-accent'}`}
                      style={{ width: `${Math.min(100, Math.max(utilization, 1.5))}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </BriefSection>

        <BriefSection number="04" title="Trend" subtitle="How demand is changing.">
          <TableShell className="min-w-0">
            <thead>
              <tr>
                <Th>Feature</Th>
                <Th align="right">Trend / year</Th>
                <Th align="right">Volatility</Th>
                <Th>Direction</Th>
              </tr>
            </thead>
            <tbody>
              {rows
                .filter((row) => row.metrics !== null)
                .map((row) => (
                  <tr key={row.featureId}>
                    <Td>{row.featureName}</Td>
                    <Td align="right" className={row.metrics!.trendPctPerYear > 0 ? 'text-danger' : 'text-positive'}>
                      {formatSignedPercent(row.metrics!.trendPctPerYear)}
                    </Td>
                    <Td align="right" className="text-fg-muted">
                      {row.metrics!.volatility.toFixed(2)}
                    </Td>
                    <Td className="text-fg-muted">
                      {Math.abs(row.metrics!.trendPctPerYear) < 5
                        ? 'Stable'
                        : row.metrics!.trendPctPerYear > 0
                          ? 'Growing'
                          : 'Declining'}
                    </Td>
                  </tr>
                ))}
            </tbody>
          </TableShell>
          <p className="mt-3 text-[11.5px] leading-relaxed text-fg-subtle">
            Spend-weighted trend across the agreement is {formatSignedPercent(renewal.demandTrendPct)} per
            year.
          </p>
        </BriefSection>

        <BriefSection number="05" title="Denials" subtitle="Where shortages occurred, and whether quantity was the cause.">
          {denialRows.length === 0 ? (
            <p className="text-[12.5px] text-fg-muted">
              No denials recorded against this agreement in the observation period.
            </p>
          ) : (
            <ul className="space-y-3">
              {denialRows.map((row) => (
                <li key={row.featureId} className="rounded-md border border-border px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[12.5px] font-medium text-fg">{row.featureName}</span>
                    <span className="tnum text-[12px] text-fg-muted">
                      {formatNumber(row.denials!.totalDenials)} denials over{' '}
                      {formatNumber(row.denials!.denialDays)} days · {row.denials!.risk} risk
                    </span>
                  </div>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-fg-muted">
                    {row.denials!.riskRationale}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11.5px] leading-relaxed text-fg-subtle">
            Denial counts are reported as risk context. They are excluded from the recommended quantity
            calculation, so a retry burst or a licensing-rule denial cannot inflate a purchase position.
          </p>
        </BriefSection>

        <BriefSection number="06" title="Organizational drivers" subtitle="Who is generating this demand.">
          <div className="grid gap-6 sm:grid-cols-2">
            <DriverList title="By program" entries={topPrograms} total={totalHours} />
            <DriverList title="By department" entries={topDepartments} total={totalHours} />
          </div>
        </BriefSection>

        <BriefSection number="07" title="Forecast" subtitle="What future demand suggests.">
          <TableShell className="min-w-0">
            <thead>
              <tr>
                <Th>Feature</Th>
                <Th align="right">Current P95</Th>
                <Th align="right">Combined growth</Th>
                <Th align="right">Forecast demand</Th>
                <Th align="right">Forecast quantity</Th>
              </tr>
            </thead>
            <tbody>
              {forecasts
                .filter((f) => f.forecast !== null)
                .map(({ row, forecast }) => (
                  <tr key={row.featureId}>
                    <Td>{row.featureName}</Td>
                    <Td align="right">{formatNumber(forecast!.currentP95, 1)}</Td>
                    <Td align="right">{formatSignedPercent(forecast!.combinedGrowth * 100)}</Td>
                    <Td align="right">{formatNumber(forecast!.forecastDemand, 1)}</Td>
                    <Td align="right" className="font-medium">
                      {formatNumber(forecast!.recommendedQuantity)}
                    </Td>
                  </tr>
                ))}
            </tbody>
          </TableShell>
          <p className="mt-3 text-[11.5px] leading-relaxed text-fg-subtle">
            Forecast combines observed demand trend with the organization&rsquo;s{' '}
            {formatSignedPercent(renewal.headcountImpactPct, 0)} technical headcount growth assumption,
            compounded, then buffered by {((options.safetyFactor - 1) * 100).toFixed(0)}%.
          </p>
        </BriefSection>

        <BriefSection number="08" title="Recommended position" subtitle="What EngiSignal recommends purchasing.">
          <TableShell className="min-w-0">
            <thead>
              <tr>
                <Th>Feature</Th>
                <Th align="right">Current</Th>
                <Th align="right">Recommended</Th>
                <Th align="right">Change</Th>
                <Th>Basis</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.featureId}>
                  <Td>{row.featureName}</Td>
                  <Td align="right">{formatNumber(row.entitled)}</Td>
                  <Td align="right" className="font-semibold">
                    {row.rightSizing === null ? '—' : formatNumber(row.rightSizing.recommended)}
                  </Td>
                  <Td align="right">
                    {row.rightSizing === null || row.rightSizing.quantityDelta === 0 ? (
                      <span className="text-fg-subtle">—</span>
                    ) : (
                      <span className={row.rightSizing.quantityDelta < 0 ? 'text-positive' : 'text-danger'}>
                        {row.rightSizing.quantityDelta > 0 ? '+' : ''}
                        {formatNumber(row.rightSizing.quantityDelta)}
                      </span>
                    )}
                  </Td>
                  <Td className="text-[11px] text-fg-muted">{row.rightSizing?.methodology ?? '—'}</Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </BriefSection>

        <BriefSection number="09" title="Financial impact" subtitle="Current against recommended.">
          <div className="grid gap-4 sm:grid-cols-3">
            <BriefFigure label="Current annual" value={formatCurrencyExact(renewal.currentAnnualSpend)} />
            <BriefFigure label="Recommended annual" value={formatCurrencyExact(renewal.recommendedAnnualSpend)} />
            <BriefFigure
              label={net >= 0 ? 'Annual reduction' : 'Annual increase'}
              value={formatCurrencyExact(Math.abs(net))}
              tone={net > 0 ? 'positive' : net < 0 ? 'danger' : 'neutral'}
            />
          </div>
          <p className="mt-4 text-[12px] leading-relaxed text-fg-muted">
            Figures use contract unit prices as supplied. No discount, bundling or multi-year assumption is
            applied — those remain negotiation levers rather than analytical outputs.
          </p>
        </BriefSection>

        <BriefSection number="10" title="Supporting evidence" subtitle="Method and data conditions behind these figures.">
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            <BriefFact label="Observation period" value={`${options.periodKey === '12m' ? '12 months' : options.periodKey} ending ${formatDate(dataset.asOf)}`} />
            <BriefFact label="Sizing percentile" value={`P${(options.percentile * 100).toFixed(0)} of daily peak demand`} />
            <BriefFact label="Growth factor" value={options.growthFactor.toFixed(2)} />
            <BriefFact label="Safety buffer" value={`${((options.safetyFactor - 1) * 100).toFixed(0)}%`} />
            <BriefFact label="Named-user threshold" value={`${options.reclaimThresholdDays} days without activity`} />
            <BriefFact label="Employee mapping" value={formatPercent(dataset.employeeMappingRate * 100, 0)} />
            <BriefFact label="Feature mapping" value={formatPercent(dataset.featureMappingRate * 100, 0)} />
            <BriefFact label="Confidence" value={`${renewal.confidence.level} (${renewal.confidence.score}/100)`} />
          </dl>

          <ul className="mt-4 space-y-1.5">
            {renewal.confidence.reasons.map((reason, index) => (
              <li key={index} className="text-[12px] text-fg-muted">
                <span className="font-medium text-fg">{reason.label}:</span> {reason.detail}
              </li>
            ))}
          </ul>
        </BriefSection>

        <footer className="mt-8 border-t border-border pt-4 text-[10.5px] leading-relaxed text-fg-subtle">
          <p>
            Generated by {brand.name} on the analysis dataset as of {formatDate(dataset.asOf)}. Every
            quantity is derived from the organization&rsquo;s own usage and contract data using published,
            reproducible methodology.
          </p>
          <p className="mt-1.5">{brand.vendorDisclosure}</p>
        </footer>
      </article>
    </div>
  );
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
    <section className="print-avoid-break mb-8">
      <div className="mb-3 flex items-baseline gap-3 border-b border-border pb-2">
        <span className="tnum text-[11px] font-medium text-fg-subtle">{number}</span>
        <h2 className="text-[15px] font-semibold tracking-[-0.018em] text-fg">{title}</h2>
        <span className="text-[12px] text-fg-subtle">{subtitle}</span>
      </div>
      {children}
    </section>
  );
}

function BriefFigure({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'positive' | 'danger';
}) {
  return (
    <div className="rounded-md border border-border px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.08em] text-fg-subtle">{label}</p>
      <p
        className={`tnum mt-1.5 text-[19px] font-semibold tracking-[-0.02em] ${
          tone === 'positive' ? 'text-positive' : tone === 'danger' ? 'text-danger' : 'text-fg'
        }`}
      >
        {value}
      </p>
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

function DriverList({
  title,
  entries,
  total,
}: {
  title: string;
  entries: [string, number][];
  total: number;
}) {
  return (
    <div>
      <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.1em] text-fg-subtle">{title}</p>
      <ul className="space-y-2">
        {entries.map(([label, hours]) => (
          <li key={label}>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="truncate text-[12.5px] text-fg">{label}</span>
              <span className="tnum shrink-0 text-[12px] text-fg-muted">
                {((hours / total) * 100).toFixed(1)}%
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-accent" style={{ width: `${(hours / total) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
