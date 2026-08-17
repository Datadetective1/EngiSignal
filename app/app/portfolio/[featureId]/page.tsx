import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BulletChart, ChartLegend, DemandChart, RankedBars, UsageHeatmap } from '@/components/charts';
import { ConfidenceExplainer } from '@/components/app/confidence-explainer';
import { EvidenceDrawer } from '@/components/app/evidence-drawer';
import {
  Badge,
  Card,
  CardHeader,
  ConfidenceBadge,
  LinkButton,
  MethodologyNote,
  MetricRow,
  RiskBadge,
} from '@/components/ui/primitives';
import { dailySeriesForFeature } from '@/lib/analytics/concurrent';
import { dayOfWeek, formatDate } from '@/lib/analytics/dates';
import { denialsByGroup, denialsByHour } from '@/lib/analytics/denials';
import {
  formatCurrency,
  formatCurrencyExact,
  formatNumber,
  formatPercent,
  formatSignedPercent,
} from '@/lib/analytics/financial';
import { buildRecommendationEvidence } from '@/lib/analytics/evidence';
import { decodeRouteId, encodeRouteId, renewalHref } from '@/lib/routes';
import { employeeIndex, loadWorkspace } from '@/lib/workspace';

export const metadata: Metadata = { title: 'Feature detail' };

export default async function FeatureDetailPage({
  params,
}: {
  params: Promise<{ featureId: string }>;
}) {
  // Pages receive dynamic segments percent-encoded; identities are not. See
  // lib/routes.ts — comparing the two directly 404s every detail page.
  const featureId = decodeRouteId((await params).featureId);
  const workspace = await loadWorkspace();
  const row = workspace.portfolio.find((r) => r.featureId === featureId);
  if (row === undefined) notFound();

  const { dataset } = workspace;
  const employees = employeeIndex(dataset);
  const evidence = buildRecommendationEvidence(row);

  const series =
    row.metrics === null
      ? []
      : dailySeriesForFeature(dataset.dailyUsage, featureId, row.metrics.window).map((d) => ({
          date: d.date,
          peak: d.peak,
        }));

  // Weekday × hour demand grid, from the recent hourly detail.
  const heatmap: number[][] = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const heatmapCounts: number[][] = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const hour of dataset.hourlyUsage) {
    if (hour.featureId !== featureId) continue;
    const day = dayOfWeek(hour.date);
    const dayRow = heatmap[day];
    const countRow = heatmapCounts[day];
    if (dayRow === undefined || countRow === undefined) continue;
    dayRow[hour.hour] = (dayRow[hour.hour] ?? 0) + hour.concurrent;
    countRow[hour.hour] = (countRow[hour.hour] ?? 0) + 1;
  }
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const count = heatmapCounts[d]?.[h] ?? 0;
      const total = heatmap[d]?.[h] ?? 0;
      const dayRow = heatmap[d];
      if (dayRow !== undefined) dayRow[h] = count === 0 ? 0 : total / count;
    }
  }

  const featureActivities = dataset.activities.filter((a) => a.featureId === featureId);
  const topUsers = [...featureActivities]
    .sort((a, b) => b.totalHours - a.totalHours)
    .slice(0, 8)
    .map((activity) => {
      const employee = employees.get(activity.employeeId);
      return {
        label: employee?.fullName ?? activity.employeeId,
        value: activity.totalHours,
        sub: [employee?.department, employee?.program].filter(Boolean).join(' · '),
      };
    });

  const byProgram = new Map<string, number>();
  for (const activity of featureActivities) {
    const program = employees.get(activity.employeeId)?.program ?? 'Unattributed';
    byProgram.set(program, (byProgram.get(program) ?? 0) + activity.totalHours);
  }
  const programBars = [...byProgram.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  const net = (row.financial.optimizationOpportunity ?? 0) - (row.financial.incrementalSpend ?? 0);

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header>
        <nav className="mb-2 flex items-center gap-1.5 text-[12px] text-fg-subtle">
          <Link href="/app/portfolio" className="hover:text-fg">
            Portfolio
          </Link>
          <span>/</span>
          <span>{row.vendorName}</span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[24px] font-semibold tracking-[-0.026em] text-fg">
              {row.productName}
              <span className="ml-2.5 text-[17px] font-normal text-fg-muted">{row.featureName}</span>
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge>{row.featureCode}</Badge>
              <Badge tone="accent">{row.licenseModel.replace('_', ' ')}</Badge>
              {row.familyName !== null && <Badge>{row.familyName}</Badge>}
              <RiskBadge risk={row.risk} />
              <ConfidenceBadge level={row.confidence.level} score={row.confidence.score} />
            </div>
          </div>

          <div className="flex gap-2">
            <LinkButton href={`/app/scenario?feature=${encodeRouteId(row.featureId)}`} size="sm">
              Model scenario
            </LinkButton>
            <LinkButton href={`/app/users?feature=${encodeRouteId(row.featureId)}`} size="sm">
              Users
            </LinkButton>
            {row.contractId !== null && (
              <LinkButton href={renewalHref(row.contractId)} size="sm" variant="primary">
                Renewal
              </LinkButton>
            )}
          </div>
        </div>
      </header>

      {/* ── The recommendation ──────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <div className="grid divide-y divide-border md:grid-cols-4 md:divide-x md:divide-y-0">
          <Figure label="Current licenses" value={formatNumber(row.entitled)} sub="Entitled on contract" />
          <Figure
            label={row.metrics === null ? 'Active users' : 'P95 daily peak'}
            value={formatNumber(row.rightSizing?.basis ?? 0, 0)}
            sub={
              row.metrics === null
                ? `Within ${row.namedUser?.reclaimThresholdDays ?? 90} days`
                : `Max observed ${formatNumber(row.metrics.max)}`
            }
          />
          <Figure
            label="EngiSignal recommendation"
            value={formatNumber(row.rightSizing?.recommended ?? row.entitled)}
            sub={
              row.rightSizing === null
                ? 'No sizing model applies'
                : row.rightSizing.quantityDelta === 0
                  ? 'Already right-sized'
                  : row.rightSizing.quantityDelta < 0
                    ? `${formatNumber(row.rightSizing.surplus)} more than needed today`
                    : `${formatNumber(row.rightSizing.shortfall)} short of demand`
            }
            accent
          />
          <Figure
            label={net >= 0 ? 'Annual opportunity' : 'Incremental spend'}
            value={formatCurrency(Math.abs(net))}
            sub={
              row.financial.priced
                ? `Current ${formatCurrencyExact(row.financial.currentAnnualCost)}`
                : 'No unit price recorded'
            }
            tone={net > 0 ? 'positive' : net < 0 ? 'danger' : 'neutral'}
          />
        </div>
      </Card>

      {/* Immediately under the recommendation it qualifies, before the reader
          scrolls past it into the supporting detail. */}
      <ConfidenceExplainer confidence={row.confidence} />

      <EvidenceDrawer evidence={evidence} />

      {/* ── Demand ──────────────────────────────────────────────────────── */}
      {row.metrics !== null && (
        <Card>
          <CardHeader
            title="Daily peak concurrent demand"
            description={`${formatDate(row.metrics.window.start)} – ${formatDate(row.metrics.window.end)} · ${formatNumber(row.metrics.observedDays)} observed days`}
            action={
              <span className="tnum text-[12px] text-fg-muted">
                Trend {formatSignedPercent(row.metrics.trendPctPerYear)} / yr
              </span>
            }
          />
          <div className="px-4 pb-3 pt-4">
            <DemandChart
              points={series}
              entitled={row.entitled}
              p95={row.metrics.p95}
              recommended={row.rightSizing?.recommended ?? null}
            />
          </div>
          <div className="border-t border-border px-5 py-3">
            <ChartLegend
              items={[
                { label: 'Daily peak demand', color: 'var(--es-accent)' },
                { label: 'P95', color: 'var(--es-accent)' },
                { label: 'Entitled capacity', color: 'var(--es-fg-muted)', dash: true },
                { label: 'Recommended', color: 'var(--es-positive)', dash: true },
                { label: 'Unused capacity', color: 'var(--es-positive)' },
              ]}
            />
          </div>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ── Distribution ──────────────────────────────────────────────── */}
        {row.metrics !== null && (
          <Card>
            <CardHeader title="Demand distribution" description="How peak demand sits against what is owned." />
            <div className="px-5 py-4">
              <BulletChart
                p95={row.metrics.p95}
                max={row.metrics.max}
                entitled={row.entitled}
                recommended={row.rightSizing?.recommended ?? null}
              />
              <div className="mt-3">
                <MetricRow label="Mean daily peak" value={formatNumber(row.metrics.mean, 1)} />
                <MetricRow label="Median daily peak" value={formatNumber(row.metrics.median, 1)} />
                <MetricRow label="P90" value={formatNumber(row.metrics.p90, 1)} />
                <MetricRow label="P95" value={formatNumber(row.metrics.p95, 1)} emphasis />
                <MetricRow label="P99" value={formatNumber(row.metrics.p99, 1)} />
                <MetricRow label="Maximum" value={formatNumber(row.metrics.max)} />
                <MetricRow
                  label="Utilization at P95"
                  value={formatPercent(row.metrics.utilizationPct)}
                  note={`${formatNumber(row.metrics.availableCapacity, 0)} licenses of headroom`}
                />
                <MetricRow
                  label="Saturation days"
                  value={`${formatNumber(row.metrics.saturationDays)} (${formatPercent(row.metrics.saturationPct)})`}
                  note="Days peak demand met or exceeded entitled capacity"
                />
                <MetricRow
                  label="Volatility"
                  value={row.metrics.volatility.toFixed(2)}
                  note="Coefficient of variation of daily peaks"
                />
              </div>
            </div>
          </Card>
        )}

        {/* ── Named user ────────────────────────────────────────────────── */}
        {row.namedUser !== null && (
          <Card>
            <CardHeader
              title="Named user position"
              description={`Seats idle for ${row.namedUser.reclaimThresholdDays}+ days are reclaim candidates.`}
              action={
                <LinkButton href={`/app/reclaim?feature=${encodeRouteId(row.featureId)}`} size="sm">
                  Reclaim queue
                </LinkButton>
              }
            />
            <div className="px-5 py-4">
              <MetricRow label="Assigned seats" value={formatNumber(row.namedUser.assigned)} />
              <MetricRow label="Active users" value={formatNumber(row.namedUser.activeUsers)} emphasis />
              <MetricRow
                label="Inactive users"
                value={formatNumber(row.namedUser.inactiveUsers)}
                note={`Including ${formatNumber(row.namedUser.neverUsed)} never used since assignment`}
              />
              <MetricRow label="Active in last 30 days" value={formatNumber(row.namedUser.active30)} />
              <MetricRow label="Active in last 90 days" value={formatNumber(row.namedUser.active90)} />
              <MetricRow label="Seat utilization" value={formatPercent(row.namedUser.utilizationPct)} />
              <MetricRow
                label="Reclaim value"
                value={formatCurrencyExact(row.namedUser.reclaimValue)}
                note="Annual cost of seats idle beyond the threshold"
                emphasis
              />
            </div>
          </Card>
        )}

        {/* ── Token ─────────────────────────────────────────────────────── */}
        {row.tokens !== null && (
          <Card>
            <CardHeader title="Token consumption" description="Pool draw over the analysis window." />
            <div className="px-5 py-4">
              <MetricRow label="Token pool" value={formatNumber(row.entitled)} />
              <MetricRow label="Mean daily token-hours" value={formatNumber(row.tokens.meanTokenHours)} />
              <MetricRow label="P95 daily token-hours" value={formatNumber(row.tokens.p95TokenHours)} emphasis />
              <MetricRow label="Peak daily token-hours" value={formatNumber(row.tokens.peakTokenHours)} />
              <MetricRow
                label="Pool utilization"
                value={formatPercent(row.tokens.capacityUtilizationPct)}
                note="Consumed token-hours against pool availability"
              />
              <MetricRow
                label="Forecast consumption"
                value={formatNumber(row.tokens.forecastTokenHours)}
                note="12 months ahead at the observed trend"
              />
            </div>
          </Card>
        )}

        {/* ── Organizational drivers ────────────────────────────────────── */}
        <Card>
          <CardHeader
            title="Who drives this demand"
            description="Consumption is concentrated — this is who to talk to before changing quantity."
          />
          <div className="space-y-5 px-5 py-4">
            <div>
              <p className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.1em] text-fg-subtle">
                Top users by license-hours
              </p>
              <RankedBars data={topUsers} formatValue={(v) => `${formatNumber(v)} h`} />
            </div>
            <div>
              <p className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.1em] text-fg-subtle">
                By program
              </p>
              <RankedBars data={programBars} formatValue={(v) => `${formatNumber(v)} h`} />
            </div>
          </div>
        </Card>
      </div>

      {/* ── Time-of-day pattern ─────────────────────────────────────────── */}
      {row.metrics !== null && (
        <Card>
          <CardHeader
            title="Demand by hour and weekday"
            description="Mean concurrent demand over the most recent 90 days of hourly collection."
          />
          <div className="px-5 py-4">
            <UsageHeatmap grid={heatmap} />
          </div>
        </Card>
      )}

      {/* ── Denials ─────────────────────────────────────────────────────── */}
      {row.denials !== null && (
        <Card>
          <CardHeader
            title="Denials"
            description="Unmet demand, assessed in context."
            action={<RiskBadge risk={row.denials.risk} />}
          />
          <div className="grid gap-6 px-5 py-4 lg:grid-cols-2">
            <div>
              <MetricRow label="Total denials" value={formatNumber(row.denials.totalDenials)} />
              <MetricRow label="Denial days" value={formatNumber(row.denials.denialDays)} />
              <MetricRow label="Distinct users affected" value={formatNumber(row.denials.distinctUsers)} />
              <MetricRow
                label="Concentration"
                value={formatPercent(row.denials.concentration * 100, 0)}
                note="Share of all denials falling on the single worst day"
              />
              <MetricRow
                label="Mean concurrent at denial"
                value={formatNumber(row.denials.meanConcurrentAtDenial, 1)}
                note={`Against ${formatNumber(row.entitled)} entitled licenses`}
              />
              <MetricRow
                label="Peak denial hour"
                value={row.denials.peakHour === null ? '—' : `${String(row.denials.peakHour).padStart(2, '0')}:00`}
              />

              <div className="mt-4 rounded-md border border-border bg-surface-2 px-3.5 py-3">
                <p className="text-[12px] font-medium text-fg">Assessment</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">
                  {row.denials.riskRationale}
                </p>
              </div>

              <MethodologyNote>
                Denials inform risk. They are deliberately excluded from the recommended quantity
                calculation, so a retry burst or a licensing-rule denial can never inflate a purchase.
              </MethodologyNote>
            </div>

            <div>
              <p className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.1em] text-fg-subtle">
                Denials by department
              </p>
              <RankedBars
                data={denialsByGroup(dataset.denials, featureId, (employeeId) =>
                  employeeId === null ? null : (employees.get(employeeId)?.department ?? null),
                )
                  .slice(0, 6)
                  .map((entry) => ({ label: entry.group, value: entry.count }))}
                formatValue={(v) => formatNumber(v)}
              />

              <p className="mb-2.5 mt-6 text-[11px] font-medium uppercase tracking-[0.1em] text-fg-subtle">
                Denials by hour
              </p>
              <RankedBars
                data={denialsByHour(dataset.denials, featureId)
                  .map((count, hour) => ({ label: `${String(hour).padStart(2, '0')}:00`, value: count }))
                  .filter((item) => item.value > 0)
                  .sort((a, b) => b.value - a.value)
                  .slice(0, 6)}
                formatValue={(v) => formatNumber(v)}
              />
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function Figure({
  label,
  value,
  sub,
  accent = false,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
  tone?: 'neutral' | 'positive' | 'danger';
}) {
  return (
    <div className="px-5 py-5">
      <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-fg-subtle">{label}</p>
      <p
        className={`tnum mt-2 text-[30px] font-semibold leading-none tracking-[-0.03em] ${
          accent ? 'text-accent' : tone === 'positive' ? 'text-positive' : tone === 'danger' ? 'text-danger' : 'text-fg'
        }`}
      >
        {value}
      </p>
      <p className="mt-2 text-[12px] leading-snug text-fg-muted">{sub}</p>
    </div>
  );
}
