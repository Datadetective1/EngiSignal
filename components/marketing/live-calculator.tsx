'use client';

import { useMemo, useState } from 'react';
import { computeFinancial } from '@/lib/analytics/financial';
import { computeRightSizing } from '@/lib/analytics/rightsizing';
import { percentile } from '@/lib/analytics/stats';
import { cn } from '@/lib/utils';

/**
 * The live recommendation demo.
 *
 * This runs the production analytics engine — `computeRightSizing`,
 * `computeFinancial` and `percentile` are the same modules the authenticated
 * product uses, imported directly. The daily peaks are the reproducible
 * synthetic series for the demo organization's largest position, so the P95
 * shown here is computed on the page, not hard-coded.
 *
 * The calculation is not faked. The dataset behind it is synthetic, and the
 * surrounding copy must keep saying so.
 */
export function LiveCalculator({
  dailyPeaks,
  entitled,
  unitPrice,
  productLabel,
}: {
  dailyPeaks: number[];
  entitled: number;
  unitPrice: number;
  productLabel: string;
}) {
  const [growthPct, setGrowthPct] = useState(5);
  const [safetyPct, setSafetyPct] = useState(10);

  const result = useMemo(() => {
    const sizing = computeRightSizing({
      dailyPeaks,
      entitled,
      percentile: 0.95,
      growthFactor: 1 + growthPct / 100,
      safetyFactor: 1 + safetyPct / 100,
    });
    const financial = computeFinancial({ entitled, recommended: sizing.recommended, unitPrice });
    return { sizing, financial, p95: percentile(dailyPeaks, 0.95) };
  }, [dailyPeaks, entitled, unitPrice, growthPct, safetyPct]);

  const net = (result.financial.optimizationOpportunity ?? 0) - (result.financial.incrementalSpend ?? 0);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3.5">
        <div>
          <p className="text-[13px] font-medium text-fg">{productLabel}</p>
          <p className="mt-0.5 text-[11.5px] text-fg-subtle">
            {dailyPeaks.length} days of observed daily peak demand
          </p>
        </div>
        <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-medium text-accent">
          Live calculation
        </span>
      </div>

      <div className="grid lg:grid-cols-[1fr_1.15fr]">
        {/* ── Inputs ──────────────────────────────────────────────────── */}
        <div className="space-y-6 border-b border-border px-5 py-5 lg:border-b-0 lg:border-r">
          <Readout label="Current licenses" value={entitled.toLocaleString('en-US')} note="Entitled on contract" />
          <Readout
            label="P95 daily peak demand"
            value={Math.round(result.p95).toLocaleString('en-US')}
            note="Computed from the series above, in your browser"
          />

          <Slider
            label="Forecast growth"
            value={growthPct}
            min={-10}
            max={30}
            onChange={setGrowthPct}
            format={(v) => `${v > 0 ? '+' : ''}${v}%`}
          />
          <Slider
            label="Safety buffer"
            value={safetyPct}
            min={0}
            max={25}
            onChange={setSafetyPct}
            format={(v) => `${v}%`}
          />
        </div>

        {/* ── Output ──────────────────────────────────────────────────── */}
        <div className="px-5 py-5">
          <div className="rounded-lg bg-surface-2 px-5 py-5">
            <p className="text-[11px] font-medium uppercase tracking-[0.11em] text-fg-subtle">
              EngiSignal recommendation
            </p>
            <p className="tnum mt-2 text-[52px] font-semibold leading-none tracking-[-0.04em] text-fg transition-all duration-300">
              {result.sizing.recommended.toLocaleString('en-US')}
            </p>
            <p className="mt-2.5 text-[12.5px] text-fg-muted">
              {result.sizing.surplus > 0
                ? `${result.sizing.surplus} licenses above the recommended position`
                : result.sizing.shortfall > 0
                  ? `${result.sizing.shortfall} licenses below the recommended position`
                  : 'Exactly right-sized'}
            </p>

            <div className="mt-5 border-t border-border pt-4">
              <p className="text-[11px] font-medium uppercase tracking-[0.11em] text-fg-subtle">
                {net >= 0 ? 'Estimated annual opportunity' : 'Additional annual spend'}
              </p>
              <p
                className={cn(
                  'tnum mt-1.5 text-[28px] font-semibold leading-none tracking-[-0.03em] transition-colors',
                  net > 0 ? 'text-positive' : net < 0 ? 'text-danger' : 'text-fg',
                )}
              >
                {/* Unsigned: the label above states the direction. An opportunity is
                    a gain, so rendering it as a negative dollar amount read as a loss. */}
                {net === 0
                  ? '—'
                  : `$${Math.abs(net).toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
              </p>
            </div>
          </div>

          {/* The derivation, always visible — this is the whole point. */}
          <dl className="mt-4 space-y-2 text-[12px]">
            <Derivation label="P95 daily peak" value={result.sizing.basis.toFixed(1)} />
            <Derivation label="× Growth factor" value={result.sizing.assumptions.growthFactor.toFixed(2)} />
            <Derivation label="× Safety factor" value={result.sizing.assumptions.safetyFactor.toFixed(2)} />
            <Derivation label="= Unrounded" value={result.sizing.rawRecommended.toFixed(2)} />
            <Derivation
              label="→ Rounded up"
              value={result.sizing.recommended.toLocaleString('en-US')}
              emphasis
            />
            <Derivation
              label="Unit price × surplus"
              value={`$${unitPrice.toLocaleString('en-US')} × ${result.sizing.surplus}`}
            />
          </dl>
        </div>
      </div>

      <p className="border-t border-border px-5 py-3 text-[11.5px] leading-relaxed text-fg-subtle">
        {result.sizing.methodology}
      </p>
    </div>
  );
}

function Readout({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-[0.11em] text-fg-subtle">{label}</p>
      <p className="tnum mt-1.5 text-[26px] font-semibold leading-none tracking-[-0.03em] text-fg">{value}</p>
      <p className="mt-1.5 text-[11.5px] text-fg-muted">{note}</p>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  format: (value: number) => string;
}) {
  const id = `calc-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <label htmlFor={id} className="text-[12px] font-medium text-fg">
          {label}
        </label>
        <span className="tnum text-[14px] font-semibold text-accent">{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-3 accent-[var(--es-accent)]"
      />
    </div>
  );
}

function Derivation({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 pb-1.5 last:border-0">
      <dt className={cn('text-fg-muted', emphasis && 'font-medium text-fg')}>{label}</dt>
      <dd className={cn('tnum text-fg', emphasis && 'font-semibold text-accent')}>{value}</dd>
    </div>
  );
}
