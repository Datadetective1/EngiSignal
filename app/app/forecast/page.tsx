import type { Metadata } from 'next';
import Link from 'next/link';
import { ForecastChart } from '@/components/charts';
import {
  Card,
  CardHeader,
  Kpi,
  MethodologyNote,
  SectionHeading,
  TableShell,
  Td,
  Th,
} from '@/components/ui/primitives';
import { monthlyPeakSeries } from '@/lib/analytics/concurrent';
import { formatMonth } from '@/lib/analytics/dates';
import { formatCurrency, formatNumber, formatSignedPercent } from '@/lib/analytics/financial';
import { computeForecast, forecastPortfolioSpend, forecastSeries, trendClampNote } from '@/lib/analytics/forecast';
import { loadWorkspace } from '@/lib/workspace';

export const metadata: Metadata = { title: 'Forecast' };

export default async function ForecastPage({
  searchParams,
}: {
  searchParams: Promise<{ feature?: string }>;
}) {
  const { dataset, portfolio, totals, options } = await loadWorkspace();
  const params = await searchParams;

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
    }))
    .sort((a, b) => Math.abs(b.forecast.financialImpact ?? 0) - Math.abs(a.forecast.financialImpact ?? 0));

  const forecastSpend = forecastPortfolioSpend(
    forecasts.map((f) => ({ recommendedQuantity: f.forecast.recommendedQuantity, unitPrice: f.row.unitPrice })),
  );

  const shortfalls = forecasts.filter((f) => f.forecast.shortfall > 0);
  const surpluses = forecasts.filter((f) => f.forecast.surplus > 0);

  const selected =
    forecasts.find((f) => f.row.featureId === params.feature) ?? forecasts.find((f) => f.forecast.shortfall > 0) ?? forecasts[0];

  const history =
    selected === undefined || selected.row.metrics === null
      ? []
      : monthlyPeakSeries(dataset.dailyUsage, selected.row.featureId, selected.row.metrics.window).map((m) => ({
          label: formatMonth(`${m.month}-01`).split(' ')[0] ?? '',
          value: m.maxPeak,
        }));

  const projection =
    selected === undefined
      ? []
      : forecastSeries(selected.forecast.currentP95, selected.forecast.combinedGrowth, 12)
          .slice(1)
          .map((point) => ({ label: `+${point.monthOffset}m`, value: point.demand }));

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Forecast"
        title="What demand looks like next year"
        description="Observed demand trend compounded with the organization's headcount growth assumption, then buffered. Deliberately simple enough to argue with."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Current annual spend" value={formatCurrency(totals.annualSpend)} detail="At today's quantities" />
        <Kpi
          label="Forecast spend"
          value={formatCurrency(forecastSpend)}
          tone={forecastSpend > totals.annualSpend ? 'danger' : 'positive'}
          detail={`At ${(headcountGrowth * 100).toFixed(0)}% headcount growth`}
        />
        <Kpi
          label="Features needing more"
          value={formatNumber(shortfalls.length)}
          tone={shortfalls.length > 0 ? 'warning' : 'neutral'}
          detail="Forecast demand exceeds entitlement"
        />
        <Kpi
          label="Features with surplus"
          value={formatNumber(surpluses.length)}
          tone="positive"
          detail="Entitlement above forecast demand"
        />
      </div>

      {selected !== undefined && (
        <Card>
          <CardHeader
            title={`${selected.row.productName} — ${selected.row.featureName}`}
            description="Monthly maximum demand observed, then projected forward twelve months."
            action={
              <Link
                href={`/app/portfolio/${selected.row.featureId}`}
                className="text-[12.5px] font-medium text-accent hover:underline"
              >
                Feature detail
              </Link>
            }
          />
          <div className="px-4 pb-4 pt-4">
            <ForecastChart
              history={history}
              forecast={projection}
              entitled={selected.row.entitled}
              recommended={selected.forecast.recommendedQuantity}
            />
          </div>
          <div className="grid gap-x-8 gap-y-1 border-t border-border px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label="Current entitlement" value={formatNumber(selected.forecast.currentEntitled)} />
            <Fact label="Current P95 demand" value={formatNumber(selected.forecast.currentP95, 1)} />
            <Fact
              label="Demand trend contribution"
              value={formatSignedPercent(selected.forecast.trendGrowth * 100)}
            />
            <Fact
              label="Headcount contribution"
              value={formatSignedPercent(selected.forecast.headcountGrowth * 100)}
            />
            <Fact
              label="Combined growth"
              value={formatSignedPercent(selected.forecast.combinedGrowth * 100)}
            />
            <Fact label="Forecast demand" value={formatNumber(selected.forecast.forecastDemand, 1)} />
            <Fact label="Recommended quantity" value={formatNumber(selected.forecast.recommendedQuantity)} />
            <Fact
              label={selected.forecast.shortfall > 0 ? 'Shortfall' : 'Surplus'}
              value={formatNumber(
                selected.forecast.shortfall > 0 ? selected.forecast.shortfall : selected.forecast.surplus,
              )}
            />
            <Fact
              label="Financial impact"
              value={formatCurrency(selected.forecast.financialImpact)}
            />
          </div>
          {selected.row.metrics !== null && trendClampNote(selected.row.metrics.trendPctPerYear) !== null && (
            <MethodologyNote>{trendClampNote(selected.row.metrics.trendPctPerYear)}</MethodologyNote>
          )}
        </Card>
      )}

      <Card>
        <CardHeader
          title="Forecast by feature"
          description="Ordered by the size of the financial consequence, in either direction."
        />
        <TableShell>
          <thead>
            <tr>
              <Th>Product / Feature</Th>
              <Th align="right">Entitled</Th>
              <Th align="right">Current P95</Th>
              <Th align="right">Trend</Th>
              <Th align="right">Headcount</Th>
              <Th align="right">Combined</Th>
              <Th align="right">Forecast demand</Th>
              <Th align="right">Recommended</Th>
              <Th align="right">Gap</Th>
              <Th align="right">Impact</Th>
            </tr>
          </thead>
          <tbody>
            {forecasts.map(({ row, forecast }) => (
              <tr key={row.featureId} className="hover:bg-surface-2">
                <Td>
                  <Link href={`/app/forecast?feature=${row.featureId}`} className="group block min-w-[180px]">
                    <span className="block truncate text-[12.5px] font-medium text-fg group-hover:text-accent">
                      {row.productName}
                    </span>
                    <span className="block truncate text-[11px] text-fg-subtle">{row.featureName}</span>
                  </Link>
                </Td>
                <Td align="right">{formatNumber(forecast.currentEntitled)}</Td>
                <Td align="right">{formatNumber(forecast.currentP95, 1)}</Td>
                <Td align="right" className="text-fg-muted">
                  {formatSignedPercent(forecast.trendGrowth * 100)}
                </Td>
                <Td align="right" className="text-fg-muted">
                  {formatSignedPercent(forecast.headcountGrowth * 100)}
                </Td>
                <Td align="right">{formatSignedPercent(forecast.combinedGrowth * 100)}</Td>
                <Td align="right">{formatNumber(forecast.forecastDemand, 1)}</Td>
                <Td align="right" className="font-medium">
                  {formatNumber(forecast.recommendedQuantity)}
                </Td>
                <Td align="right">
                  {forecast.shortfall > 0 ? (
                    <span className="font-medium text-danger">+{formatNumber(forecast.shortfall)}</span>
                  ) : forecast.surplus > 0 ? (
                    <span className="text-positive">−{formatNumber(forecast.surplus)}</span>
                  ) : (
                    <span className="text-fg-subtle">—</span>
                  )}
                </Td>
                <Td align="right">
                  <span
                    className={
                      (forecast.financialImpact ?? 0) > 0
                        ? 'text-danger'
                        : (forecast.financialImpact ?? 0) < 0
                          ? 'text-positive'
                          : 'text-fg-subtle'
                    }
                  >
                    {forecast.financialImpact === null
                      ? '—'
                      : `${forecast.financialImpact > 0 ? '+' : '−'}${formatCurrency(Math.abs(forecast.financialImpact))}`}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </Card>

      <MethodologyNote>
        Trend and headcount growth are compounded multiplicatively because they stack: more engineers each
        doing more simulation produces more demand than either alone. The observed trend is capped at +50%
        and floored at −30% per year before extrapolation, because an OLS slope fitted to a short or noisy
        series can annualize to a figure no one would defend. Where a cap applied, it is stated on the
        feature.
      </MethodologyNote>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-2">
      <span className="text-[12px] text-fg-muted">{label}</span>
      <span className="tnum text-[12.5px] font-medium text-fg">{value}</span>
    </div>
  );
}
