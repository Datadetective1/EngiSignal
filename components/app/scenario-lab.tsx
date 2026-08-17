'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AnimatedNumber } from '@/components/app/animated-number';
import { BulletChart, ChartLegend, DemandChart } from '@/components/charts';
import { Badge, Card, CardHeader, MethodologyNote, MetricRow } from '@/components/ui/primitives';
import { capacityRisk } from '@/lib/analytics/concurrent';
import { formatCurrency, formatCurrencyExact, formatNumber, formatPercent } from '@/lib/analytics/financial';
import { computeFinancial } from '@/lib/analytics/financial';
import { computeRightSizing, describeMethodology } from '@/lib/analytics/rightsizing';
import { ceilPrecise, percentile, round, trendPercentPerYear } from '@/lib/analytics/stats';
import type { RiskLevel } from '@/lib/domain/types';
import { cn } from '@/lib/utils';
import { featureHref } from '@/lib/routes';

/**
 * The Scenario Lab.
 *
 * Recalculation happens in the browser using the SAME analytics modules the
 * server uses — not a simplified copy. That is the whole point: an assumption a
 * customer changes here produces exactly the number the Renewal Command Centre
 * would produce, because it is the same function.
 */

export interface ScenarioFeature {
  featureId: string;
  featureName: string;
  productName: string;
  vendorName: string;
  kind: 'concurrent' | 'named' | 'other';
  entitled: number;
  unitPrice: number | null;
  /** Daily peaks, oldest first, for concurrent features. */
  peaks: number[];
  /** Dates matching `peaks`, for charting. */
  dates: string[];
  /** Active user count, for named-user features. */
  activeUsers: number | null;
  renewalDays: number | null;
}

const PERIODS = [
  { key: '3m', label: '3M', days: 90 },
  { key: '6m', label: '6M', days: 182 },
  { key: '12m', label: '12M', days: 365 },
  { key: '24m', label: '24M', days: 730 },
] as const;

const PERCENTILES = [
  { key: 0.9, label: 'P90' },
  { key: 0.95, label: 'P95' },
  { key: 0.99, label: 'P99' },
] as const;

export function ScenarioLab({
  features,
  initialFeatureId,
}: {
  features: ScenarioFeature[];
  initialFeatureId?: string;
}) {
  const [featureId, setFeatureId] = useState(
    initialFeatureId !== undefined && features.some((f) => f.featureId === initialFeatureId)
      ? initialFeatureId
      : (features[0]?.featureId ?? ''),
  );
  const [periodDays, setPeriodDays] = useState(365);
  const [percentileValue, setPercentileValue] = useState(0.95);
  const [safetyPct, setSafetyPct] = useState(10);
  const [growthPct, setGrowthPct] = useState(0);
  const [escalationPct, setEscalationPct] = useState(0);

  const growthFactor = 1 + growthPct / 100;
  const safetyFactor = 1 + safetyPct / 100;

  const selected = features.find((f) => f.featureId === featureId) ?? features[0];

  // ── Selected feature ──────────────────────────────────────────────────────
  const detail = useMemo(() => {
    if (selected === undefined) return null;

    if (selected.kind === 'named') {
      const basis = selected.activeUsers ?? 0;
      const raw = basis * growthFactor * safetyFactor;
      const recommended = ceilPrecise(raw);
      const financial = computeFinancial({
        entitled: selected.entitled,
        recommended,
        unitPrice: selected.unitPrice === null ? null : selected.unitPrice * (1 + escalationPct / 100),
      });
      return {
        basis,
        raw,
        recommended,
        financial,
        risk: 'Low' as RiskLevel,
        peaks: [] as number[],
        dates: [] as string[],
        max: basis,
        utilization: selected.entitled > 0 ? round((basis / selected.entitled) * 100, 1) : 0,
        trend: 0,
        methodology: `Users active within the configured threshold (${basis}), adjusted for ${growthPct}% growth and a ${safetyPct}% onboarding buffer, rounded up to a whole seat.`,
      };
    }

    const peaks = selected.peaks.slice(-periodDays);
    const dates = selected.dates.slice(-periodDays);
    const sizing = computeRightSizing({
      dailyPeaks: peaks,
      entitled: selected.entitled,
      percentile: percentileValue,
      growthFactor,
      safetyFactor,
    });
    const financial = computeFinancial({
      entitled: selected.entitled,
      recommended: sizing.recommended,
      unitPrice: selected.unitPrice === null ? null : selected.unitPrice * (1 + escalationPct / 100),
    });

    const p95 = percentile(peaks, 0.95);
    const max = peaks.length === 0 ? 0 : Math.max(...peaks);
    const utilization = selected.entitled > 0 ? round((p95 / selected.entitled) * 100, 1) : 0;
    const saturationDays = peaks.filter((p) => p >= selected.entitled).length;

    return {
      basis: sizing.basis,
      raw: sizing.rawRecommended,
      recommended: sizing.recommended,
      financial,
      risk: capacityRisk({
        featureId: selected.featureId,
        window: { start: dates[0] ?? '', end: dates[dates.length - 1] ?? '', key: '12m', days: periodDays },
        observedDays: peaks.length,
        missingDays: 0,
        mean: 0,
        median: 0,
        p90: percentile(peaks, 0.9),
        p95,
        p99: percentile(peaks, 0.99),
        max,
        min: 0,
        stdDev: 0,
        volatility: 0,
        trendPctPerYear: 0,
        entitled: selected.entitled,
        utilizationPct: utilization,
        saturationDays,
        saturationPct: peaks.length === 0 ? 0 : round((saturationDays / peaks.length) * 100, 1),
        availableCapacity: selected.entitled - p95,
      }),
      peaks,
      dates,
      max,
      utilization,
      trend: round(trendPercentPerYear(peaks), 1),
      methodology: describeMethodology({
        percentile: percentileValue,
        growthFactor,
        safetyFactor,
        periodKey: '12m',
      }),
    };
  }, [selected, periodDays, percentileValue, growthFactor, safetyFactor, escalationPct, growthPct, safetyPct]);

  // ── Portfolio rollup under the same assumptions ───────────────────────────
  const rollup = useMemo(() => {
    let current = 0;
    let recommended = 0;
    let opportunity = 0;
    let incremental = 0;
    let atRisk = 0;

    for (const feature of features) {
      const price = feature.unitPrice === null ? null : feature.unitPrice * (1 + escalationPct / 100);
      let recommendedQty = feature.entitled;

      if (feature.kind === 'concurrent') {
        const peaks = feature.peaks.slice(-periodDays);
        recommendedQty = computeRightSizing({
          dailyPeaks: peaks,
          entitled: feature.entitled,
          percentile: percentileValue,
          growthFactor,
          safetyFactor,
        }).recommended;
        const p95 = percentile(peaks, 0.95);
        if (feature.entitled > 0 && (p95 / feature.entitled) * 100 >= 92) atRisk += 1;
      } else if (feature.kind === 'named') {
        recommendedQty = ceilPrecise((feature.activeUsers ?? 0) * growthFactor * safetyFactor);
      }

      const financial = computeFinancial({
        entitled: feature.entitled,
        recommended: recommendedQty,
        unitPrice: price,
      });
      current += financial.currentAnnualCost ?? 0;
      recommended += financial.recommendedAnnualCost ?? 0;
      opportunity += financial.optimizationOpportunity ?? 0;
      incremental += financial.incrementalSpend ?? 0;
    }

    return { current, recommended, opportunity, incremental, atRisk, net: opportunity - incremental };
  }, [features, periodDays, percentileValue, growthFactor, safetyFactor, escalationPct]);

  if (selected === undefined || detail === null) {
    return <p className="text-[13px] text-fg-muted">No features available to model.</p>;
  }

  const net = (detail.financial.optimizationOpportunity ?? 0) - (detail.financial.incrementalSpend ?? 0);

  return (
    <div className="space-y-5">
      {/* ── Controls ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Assumptions"
          description="Change any input; every figure below recalculates immediately using the production analytics engine."
        />
        <div className="grid gap-5 px-5 py-5 lg:grid-cols-2">
          <div className="space-y-5">
            <Control label="Feature">
              <select
                value={featureId}
                onChange={(event) => setFeatureId(event.target.value)}
                className="h-9 w-full rounded-md border border-border bg-surface px-2.5 text-[13px] text-fg focus:border-accent focus:outline-none"
              >
                {features.map((feature) => (
                  <option key={feature.featureId} value={feature.featureId}>
                    {feature.vendorName} · {feature.productName} — {feature.featureName}
                  </option>
                ))}
              </select>
            </Control>

            <Control label="Historical period" hint="Longer periods capture more of the demand cycle.">
              <SegmentedControl
                options={PERIODS.map((p) => ({ value: p.days, label: p.label }))}
                value={periodDays}
                onChange={setPeriodDays}
                disabled={selected.kind !== 'concurrent'}
              />
            </Control>

            <Control label="Percentile" hint="The demand level the pool is sized to meet.">
              <SegmentedControl
                options={PERCENTILES.map((p) => ({ value: p.key, label: p.label }))}
                value={percentileValue}
                onChange={setPercentileValue}
                disabled={selected.kind !== 'concurrent'}
              />
            </Control>
          </div>

          <div className="space-y-5">
            <Slider
              label="Safety buffer"
              value={safetyPct}
              min={0}
              max={30}
              step={1}
              onChange={setSafetyPct}
              format={(v) => `${v}%`}
              hint="Protective headroom above modelled demand."
            />
            <Slider
              label="Headcount growth"
              value={growthPct}
              min={-10}
              max={30}
              step={1}
              onChange={setGrowthPct}
              format={(v) => `${v > 0 ? '+' : ''}${v}%`}
              hint="Expected change in engineering demand over the term."
            />
            <Slider
              label="Price escalation"
              value={escalationPct}
              min={0}
              max={20}
              step={0.5}
              onChange={setEscalationPct}
              format={(v) => `+${v}%`}
              hint="Vendor uplift applied to unit price."
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
          <span className="text-[11.5px] text-fg-subtle">Presets</span>
          <PresetButton
            label="Defaults"
            onClick={() => {
              setPeriodDays(365);
              setPercentileValue(0.95);
              setSafetyPct(10);
              setGrowthPct(0);
              setEscalationPct(0);
            }}
          />
          <PresetButton
            label="Conservative"
            onClick={() => {
              setPeriodDays(730);
              setPercentileValue(0.99);
              setSafetyPct(20);
              setGrowthPct(10);
            }}
          />
          <PresetButton
            label="Aggressive"
            onClick={() => {
              setPeriodDays(365);
              setPercentileValue(0.9);
              setSafetyPct(0);
              setGrowthPct(0);
            }}
          />
          <PresetButton
            label="Growth plan"
            onClick={() => {
              setPeriodDays(365);
              setPercentileValue(0.95);
              setSafetyPct(10);
              setGrowthPct(5);
              setEscalationPct(4);
            }}
          />
        </div>
      </Card>

      {/* ── Result ─────────────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-x lg:grid-cols-4 lg:divide-y-0">
          <ScenarioFigure
            label="Current licenses"
            value={selected.entitled}
            format={(v) => formatNumber(Math.round(v))}
          />
          <ScenarioFigure
            label={selected.kind === 'named' ? 'Active users' : `${(percentileValue * 100).toFixed(0)}th percentile demand`}
            value={detail.basis}
            format={(v) => formatNumber(Math.round(v))}
            sub={selected.kind === 'concurrent' ? `Maximum ${formatNumber(detail.max)}` : undefined}
          />
          <ScenarioFigure
            label="EngiSignal recommendation"
            value={detail.recommended}
            format={(v) => formatNumber(Math.round(v))}
            accent
            sub={`Unrounded ${detail.raw.toFixed(2)}`}
          />
          <ScenarioFigure
            label={net >= 0 ? 'Annual opportunity' : 'Incremental spend'}
            value={Math.abs(net)}
            format={(v) => formatCurrency(v)}
            tone={net > 0 ? 'positive' : net < 0 ? 'danger' : 'neutral'}
            sub={detail.financial.priced ? undefined : 'No unit price recorded'}
          />
        </div>

        <div className="border-t border-border px-5 py-4">
          <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
            <MetricRow
              label="Surplus against current"
              value={formatNumber(Math.max(0, selected.entitled - detail.recommended))}
            />
            <MetricRow
              label="Shortfall against current"
              value={formatNumber(Math.max(0, detail.recommended - selected.entitled))}
            />
            <MetricRow label="Current annual cost" value={formatCurrencyExact(detail.financial.currentAnnualCost)} />
            <MetricRow
              label="Recommended annual cost"
              value={formatCurrencyExact(detail.financial.recommendedAnnualCost)}
            />
            <MetricRow label="Utilization at P95" value={formatPercent(detail.utilization, 0)} />
            <MetricRow
              label="Capacity risk"
              value={detail.risk}
              note={detail.risk === 'Low' ? 'Comfortable headroom at this position' : 'Review before reducing'}
            />
          </div>

          <MethodologyNote>{detail.methodology}</MethodologyNote>
        </div>
      </Card>

      {/* ── Chart ──────────────────────────────────────────────────────── */}
      {selected.kind === 'concurrent' && (
        <Card>
          <CardHeader
            title="Demand under these assumptions"
            description={`${formatNumber(detail.peaks.length)} observed days · trend ${detail.trend > 0 ? '+' : ''}${detail.trend}% per year`}
          />
          <div className="px-4 pb-3 pt-4">
            <DemandChart
              points={detail.dates.map((date, index) => ({ date, peak: detail.peaks[index] ?? 0 }))}
              entitled={selected.entitled}
              p95={detail.basis}
              recommended={detail.recommended}
            />
          </div>
          <div className="border-t border-border px-5 py-3">
            <BulletChart
              p95={detail.basis}
              max={detail.max}
              entitled={selected.entitled}
              recommended={detail.recommended}
            />
            <div className="mt-2">
              <ChartLegend
                items={[
                  { label: 'Demand at percentile', color: 'var(--es-accent)' },
                  { label: 'Maximum observed', color: 'var(--es-fg)' },
                  { label: 'Entitled', color: 'var(--es-fg-muted)', dash: true },
                  { label: 'Recommended', color: 'var(--es-positive)' },
                ]}
              />
            </div>
          </div>
        </Card>
      )}

      {/* ── Portfolio rollup ───────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Whole portfolio at these assumptions"
          description="The same settings applied to every position, so a policy choice can be evaluated at portfolio scale."
        />
        <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-5">
          <RollupFigure label="Current spend" value={rollup.current} format={formatCurrency} />
          <RollupFigure label="Recommended spend" value={rollup.recommended} format={formatCurrency} />
          <RollupFigure label="Reductions" value={rollup.opportunity} format={formatCurrency} tone="positive" />
          <RollupFigure label="Increases" value={rollup.incremental} format={formatCurrency} tone="danger" />
          <RollupFigure
            label="Net change"
            value={Math.abs(rollup.net)}
            format={(v) => `${rollup.net >= 0 ? '−' : '+'}${formatCurrency(v)}`}
            tone={rollup.net >= 0 ? 'positive' : 'danger'}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-3">
          <Badge tone={rollup.atRisk > 0 ? 'danger' : 'neutral'}>
            {rollup.atRisk} feature{rollup.atRisk === 1 ? '' : 's'} above 92% utilization at this percentile
          </Badge>
          <Link
            href={featureHref(selected.featureId)}
            className="text-[12.5px] font-medium text-accent underline-offset-4 hover:underline"
          >
            Open full evidence for {selected.productName}
          </Link>
        </div>
      </Card>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function Control({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[12px] font-medium text-fg">{label}</p>
      {children}
      {hint !== undefined && <p className="mt-1.5 text-[11.5px] text-fg-subtle">{hint}</p>}
    </div>
  );
}

function SegmentedControl<T extends number>({
  options,
  value,
  onChange,
  disabled = false,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="group"
      className={cn('inline-flex rounded-md border border-border bg-surface-2 p-0.5', disabled && 'opacity-40')}
    >
      {options.map((option) => (
        <button
          key={option.label}
          type="button"
          disabled={disabled}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-[5px] px-3 py-1 text-[12.5px] font-medium transition-colors',
            value === option.value ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg',
            disabled && 'cursor-not-allowed',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format: (value: number) => string;
  hint?: string;
}) {
  const id = `slider-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <label htmlFor={id} className="text-[12px] font-medium text-fg">
          {label}
        </label>
        <span className="tnum text-[13px] font-semibold text-accent">{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-3 accent-[var(--es-accent)]"
      />
      {hint !== undefined && <p className="mt-1.5 text-[11.5px] text-fg-subtle">{hint}</p>}
    </div>
  );
}

function PresetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-border px-2.5 py-1 text-[11.5px] font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
    >
      {label}
    </button>
  );
}

function ScenarioFigure({
  label,
  value,
  format,
  sub,
  accent = false,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  format: (value: number) => string;
  sub?: string;
  accent?: boolean;
  tone?: 'neutral' | 'positive' | 'danger';
}) {
  return (
    <div className="px-5 py-5">
      <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-fg-subtle">{label}</p>
      <p
        className={cn(
          'tnum mt-2 text-[30px] font-semibold leading-none tracking-[-0.03em]',
          accent ? 'text-accent' : tone === 'positive' ? 'text-positive' : tone === 'danger' ? 'text-danger' : 'text-fg',
        )}
      >
        <AnimatedNumber value={value} format={format} />
      </p>
      {sub !== undefined && <p className="mt-2 text-[11.5px] text-fg-muted">{sub}</p>}
    </div>
  );
}

function RollupFigure({
  label,
  value,
  format,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  format: (value: number) => string;
  tone?: 'neutral' | 'positive' | 'danger';
}) {
  return (
    <div className="bg-surface px-4 py-4">
      <p className="text-[11px] uppercase tracking-[0.08em] text-fg-subtle">{label}</p>
      <p
        className={cn(
          'tnum mt-1.5 text-[19px] font-semibold tracking-[-0.02em]',
          tone === 'positive' ? 'text-positive' : tone === 'danger' ? 'text-danger' : 'text-fg',
        )}
      >
        <AnimatedNumber value={value} format={format} />
      </p>
    </div>
  );
}
