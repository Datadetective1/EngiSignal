/**
 * EngiSignal chart layer — hand-built SVG.
 *
 * These are not decorative. Each one answers a specific business question, and
 * each distinguishes the series that matter in a licensing conversation:
 * observed demand, P95, maximum, entitled capacity, recommended, forecast.
 *
 * Built directly in SVG rather than on a charting library because the required
 * marks — capacity bands, saturation shading, reference lines with labels,
 * bullet comparisons, cost bridges — need exact control, and because a static
 * server-rendered SVG costs no client JavaScript.
 */

import { formatMonth } from '@/lib/analytics/dates';
import { cn } from '@/lib/utils';

const AXIS = 'var(--es-border)';
const MUTED = 'var(--es-fg-subtle)';

function niceMax(value: number): number {
  if (value <= 0) return 10;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const scaled = value / magnitude;
  const step = scaled <= 1.2 ? 1.25 : scaled <= 2 ? 2 : scaled <= 3 ? 3 : scaled <= 5 ? 5 : 10;
  return step * magnitude;
}

// ─────────────────────────────────────────────────────────────────────────────
// Demand over time, with capacity context
// ─────────────────────────────────────────────────────────────────────────────

export interface DemandPoint {
  date: string;
  peak: number;
}

export function DemandChart({
  points,
  entitled,
  p95,
  recommended,
  height = 240,
  className,
}: {
  points: DemandPoint[];
  entitled: number;
  p95: number;
  recommended?: number | null;
  height?: number;
  className?: string;
}) {
  const width = 900;
  const padding = { top: 16, right: 74, bottom: 26, left: 42 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  if (points.length === 0) {
    return <ChartEmpty height={height} message="No usage data in this period" />;
  }

  const dataMax = Math.max(...points.map((p) => p.peak), entitled, recommended ?? 0);
  const yMax = niceMax(dataMax * 1.06);
  const x = (i: number) => padding.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v: number) => padding.top + plotH - (v / yMax) * plotH;

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.peak).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${x(points.length - 1).toFixed(1)},${(padding.top + plotH).toFixed(1)} L${x(0).toFixed(1)},${(padding.top + plotH).toFixed(1)} Z`;

  // Month boundaries for the x axis.
  const monthTicks: { index: number; label: string }[] = [];
  let lastMonth = '';
  points.forEach((point, index) => {
    const month = point.date.slice(0, 7);
    if (month !== lastMonth) {
      monthTicks.push({ index, label: formatMonth(point.date).split(' ')[0] ?? '' });
      lastMonth = month;
    }
  });
  const tickStep = Math.ceil(monthTicks.length / 8);

  const gridValues = [0, yMax * 0.25, yMax * 0.5, yMax * 0.75, yMax];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      className={cn('overflow-visible', className)}
      role="img"
      aria-label={`Daily peak demand over time. P95 ${p95}, entitled capacity ${entitled}.`}
    >
      <defs>
        <linearGradient id="es-demand-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--es-accent)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--es-accent)" stopOpacity="0.01" />
        </linearGradient>
      </defs>

      {gridValues.map((value) => (
        <g key={value}>
          <line x1={padding.left} x2={padding.left + plotW} y1={y(value)} y2={y(value)} stroke={AXIS} strokeWidth="1" />
          <text x={padding.left - 8} y={y(value) + 3.5} textAnchor="end" fontSize="10" fill={MUTED}>
            {Math.round(value)}
          </text>
        </g>
      ))}

      {/* Unused capacity: the space between P95 demand and what is owned. */}
      {entitled > p95 && (
        <rect
          x={padding.left}
          y={y(entitled)}
          width={plotW}
          height={Math.max(0, y(p95) - y(entitled))}
          fill="var(--es-positive)"
          opacity="0.07"
        />
      )}

      <path d={areaPath} fill="url(#es-demand-fill)" />
      <path d={linePath} fill="none" stroke="var(--es-accent)" strokeWidth="1.4" strokeLinejoin="round" />

      <ReferenceLine y={y(entitled)} x1={padding.left} x2={padding.left + plotW} label={`Entitled ${entitled}`} color="var(--es-fg-muted)" dash="5 4" />
      <ReferenceLine y={y(p95)} x1={padding.left} x2={padding.left + plotW} label={`P95 ${Math.round(p95)}`} color="var(--es-accent)" dash="none" />
      {recommended !== null && recommended !== undefined && recommended !== entitled && (
        <ReferenceLine
          y={y(recommended)}
          x1={padding.left}
          x2={padding.left + plotW}
          label={`Rec. ${recommended}`}
          color="var(--es-positive)"
          dash="4 3"
        />
      )}

      {monthTicks
        .filter((_, i) => i % tickStep === 0)
        .map((tick) => (
          <text key={tick.index} x={x(tick.index)} y={height - 8} textAnchor="middle" fontSize="10" fill={MUTED}>
            {tick.label}
          </text>
        ))}
    </svg>
  );
}

function ReferenceLine({
  y,
  x1,
  x2,
  label,
  color,
  dash,
}: {
  y: number;
  x1: number;
  x2: number;
  label: string;
  color: string;
  dash: string;
}) {
  return (
    <g>
      <line
        x1={x1}
        x2={x2}
        y1={y}
        y2={y}
        stroke={color}
        strokeWidth="1.3"
        strokeDasharray={dash === 'none' ? undefined : dash}
      />
      <text x={x2 + 6} y={y + 3.5} fontSize="10.5" fill={color} fontWeight="500">
        {label}
      </text>
    </g>
  );
}

function ChartEmpty({ height, message }: { height: number; message: string }) {
  return (
    <div
      className="flex items-center justify-center rounded-md border border-dashed border-border text-[12px] text-fg-subtle"
      style={{ height }}
    >
      {message}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sparkline
// ─────────────────────────────────────────────────────────────────────────────

export function Sparkline({
  values,
  width = 96,
  height = 24,
  tone = 'accent',
  className,
}: {
  values: number[];
  width?: number;
  height?: number;
  tone?: 'accent' | 'positive' | 'danger' | 'muted';
  className?: string;
}) {
  if (values.length < 2) return <span className={cn('inline-block', className)} style={{ width, height }} />;

  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const stroke =
    tone === 'positive'
      ? 'var(--es-positive)'
      : tone === 'danger'
        ? 'var(--es-danger)'
        : tone === 'muted'
          ? 'var(--es-fg-subtle)'
          : 'var(--es-accent)';

  const path = values
    .map((value, index) => {
      const px = (index / (values.length - 1)) * width;
      const py = height - ((value - min) / range) * (height - 2) - 1;
      return `${index === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg width={width} height={height} className={cn('shrink-0', className)} aria-hidden="true">
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Bullet chart — demand against capacity in one compact row
// ─────────────────────────────────────────────────────────────────────────────

export function BulletChart({
  p95,
  max,
  entitled,
  recommended,
  height = 34,
  className,
}: {
  p95: number;
  max: number;
  entitled: number;
  recommended?: number | null;
  height?: number;
  className?: string;
}) {
  const width = 420;
  const scaleMax = niceMax(Math.max(p95, max, entitled, recommended ?? 0) * 1.05);
  const x = (v: number) => (v / scaleMax) * width;
  const barY = height / 2 - 6;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" className={className}
      aria-label={`P95 ${p95}, maximum ${max}, entitled ${entitled}`}>
      <rect x="0" y={barY} width={width} height="12" rx="3" fill="var(--es-surface-3)" />
      <rect x="0" y={barY} width={x(entitled)} height="12" rx="3" fill="var(--es-accent)" opacity="0.14" />
      <rect x="0" y={barY} width={x(p95)} height="12" rx="3" fill="var(--es-accent)" opacity="0.85" />

      {/* Maximum observed demand. */}
      <line x1={x(max)} x2={x(max)} y1={barY - 4} y2={barY + 16} stroke="var(--es-fg)" strokeWidth="1.6" />
      {/* Entitled capacity. */}
      <line
        x1={x(entitled)}
        x2={x(entitled)}
        y1={barY - 6}
        y2={barY + 18}
        stroke="var(--es-fg-muted)"
        strokeWidth="1.6"
        strokeDasharray="3 2"
      />
      {recommended !== null && recommended !== undefined && (
        <line
          x1={x(recommended)}
          x2={x(recommended)}
          y1={barY - 6}
          y2={barY + 18}
          stroke="var(--es-positive)"
          strokeWidth="2"
        />
      )}
    </svg>
  );
}

export function ChartLegend({ items }: { items: { label: string; color: string; dash?: boolean }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-[11.5px] text-fg-muted">
          <span
            className="inline-block h-0.5 w-4 rounded-full"
            style={{
              background: item.dash === true ? `repeating-linear-gradient(90deg, ${item.color} 0 4px, transparent 4px 7px)` : item.color,
            }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Categorical bars
// ─────────────────────────────────────────────────────────────────────────────

export function BarSeries({
  data,
  height = 150,
  tone = 'accent',
  formatValue,
  highlightIndex,
  className,
}: {
  data: { label: string; value: number }[];
  height?: number;
  tone?: 'accent' | 'danger' | 'positive';
  formatValue?: (value: number) => string;
  highlightIndex?: number;
  className?: string;
}) {
  const width = 720;
  const padding = { top: 12, right: 8, bottom: 24, left: 34 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  if (data.length === 0) return <ChartEmpty height={height} message="No data" />;

  const yMax = niceMax(Math.max(...data.map((d) => d.value)));
  const slot = plotW / data.length;
  const barW = Math.max(2, Math.min(slot * 0.68, 44));
  const color =
    tone === 'danger' ? 'var(--es-danger)' : tone === 'positive' ? 'var(--es-positive)' : 'var(--es-accent)';
  const labelStep = Math.ceil(data.length / 14);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} className={className} role="img" aria-label="Bar chart">
      <line
        x1={padding.left}
        x2={padding.left + plotW}
        y1={padding.top + plotH}
        y2={padding.top + plotH}
        stroke={AXIS}
      />
      <text x={padding.left - 8} y={padding.top + 4} textAnchor="end" fontSize="10" fill={MUTED}>
        {formatValue?.(yMax) ?? Math.round(yMax)}
      </text>

      {data.map((item, index) => {
        const barH = yMax === 0 ? 0 : (item.value / yMax) * plotH;
        const cx = padding.left + slot * index + slot / 2;
        return (
          <g key={`${item.label}-${index}`}>
            <rect
              x={cx - barW / 2}
              y={padding.top + plotH - barH}
              width={barW}
              height={Math.max(barH, item.value > 0 ? 1.5 : 0)}
              rx="2"
              fill={color}
              opacity={highlightIndex === undefined || highlightIndex === index ? 0.85 : 0.32}
            />
            {index % labelStep === 0 && (
              <text x={cx} y={height - 8} textAnchor="middle" fontSize="9.5" fill={MUTED}>
                {item.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Horizontal ranked bars — for "who drives this" questions. */
export function RankedBars({
  data,
  formatValue,
  className,
}: {
  data: { label: string; value: number; sub?: string }[];
  formatValue: (value: number) => string;
  className?: string;
}) {
  if (data.length === 0) return <ChartEmpty height={120} message="No attributable usage" />;
  const max = Math.max(...data.map((d) => d.value)) || 1;

  return (
    <ul className={cn('space-y-2.5', className)}>
      {data.map((item) => (
        <li key={item.label}>
          <div className="mb-1 flex items-baseline justify-between gap-4">
            <span className="truncate text-[12.5px] text-fg">{item.label}</span>
            <span className="tnum shrink-0 text-[12.5px] font-medium text-fg">{formatValue(item.value)}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500"
              style={{ width: `${Math.max((item.value / max) * 100, 1.5)}%` }}
            />
          </div>
          {item.sub !== undefined && <p className="mt-1 text-[11px] text-fg-subtle">{item.sub}</p>}
        </li>
      ))}
    </ul>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Cost bridge (waterfall)
// ─────────────────────────────────────────────────────────────────────────────

export function CostBridge({
  start,
  changes,
  formatValue,
  height = 190,
  className,
}: {
  start: { label: string; value: number };
  changes: { label: string; delta: number }[];
  formatValue: (value: number) => string;
  height?: number;
  className?: string;
}) {
  const width = 760;
  const padding = { top: 24, right: 10, bottom: 34, left: 10 };
  const plotH = height - padding.top - padding.bottom;

  const steps: { label: string; from: number; to: number; kind: 'total' | 'up' | 'down' }[] = [];
  let running = start.value;
  steps.push({ label: start.label, from: 0, to: start.value, kind: 'total' });
  for (const change of changes) {
    const from = running;
    running += change.delta;
    steps.push({ label: change.label, from, to: running, kind: change.delta >= 0 ? 'up' : 'down' });
  }
  steps.push({ label: 'Recommended', from: 0, to: running, kind: 'total' });

  const maxValue = niceMax(Math.max(start.value, running, ...steps.map((s) => Math.max(s.from, s.to))));
  const y = (v: number) => padding.top + plotH - (v / maxValue) * plotH;
  const slot = (width - padding.left - padding.right) / steps.length;
  const barW = Math.min(slot * 0.56, 84);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} className={className} role="img" aria-label="Cost bridge">
      {steps.map((step, index) => {
        const cx = padding.left + slot * index + slot / 2;
        const top = y(Math.max(step.from, step.to));
        const barH = Math.max(2, Math.abs(y(step.from) - y(step.to)));
        const fill =
          step.kind === 'total'
            ? 'var(--es-fg-muted)'
            : step.kind === 'down'
              ? 'var(--es-positive)'
              : 'var(--es-danger)';

        return (
          <g key={`${step.label}-${index}`}>
            <rect x={cx - barW / 2} y={top} width={barW} height={barH} rx="2" fill={fill} opacity={step.kind === 'total' ? 0.55 : 0.8} />
            <text x={cx} y={top - 7} textAnchor="middle" fontSize="10.5" fill="var(--es-fg)" fontWeight="500">
              {step.kind === 'total' ? formatValue(step.to) : formatValue(step.to - step.from)}
            </text>
            <text x={cx} y={height - 10} textAnchor="middle" fontSize="10" fill={MUTED}>
              {step.label}
            </text>
            {index < steps.length - 1 && (
              <line
                x1={cx + barW / 2}
                x2={cx + slot - barW / 2}
                y1={y(step.to)}
                y2={y(step.to)}
                stroke={AXIS}
                strokeDasharray="2 2"
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Heatmap — hour of day against day of week
// ─────────────────────────────────────────────────────────────────────────────

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function UsageHeatmap({
  grid,
  className,
}: {
  /** 7 rows (Sun–Sat) × 24 columns of mean concurrent demand. */
  grid: number[][];
  className?: string;
}) {
  const max = Math.max(1, ...grid.flat());
  const cell = 26;
  const gap = 2;
  const left = 34;
  const top = 16;
  const width = left + 24 * (cell + gap);
  const height = top + 7 * (cell + gap) + 6;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} className={className} role="img" aria-label="Demand by hour and weekday">
      {[0, 6, 12, 18, 23].map((hour) => (
        <text key={hour} x={left + hour * (cell + gap) + cell / 2} y={10} textAnchor="middle" fontSize="9.5" fill={MUTED}>
          {String(hour).padStart(2, '0')}
        </text>
      ))}
      {grid.map((row, dayIndex) => (
        <g key={dayIndex}>
          <text x={left - 7} y={top + dayIndex * (cell + gap) + cell / 2 + 3.5} textAnchor="end" fontSize="9.5" fill={MUTED}>
            {DAY_LABELS[dayIndex]}
          </text>
          {row.map((value, hour) => (
            <rect
              key={hour}
              x={left + hour * (cell + gap)}
              y={top + dayIndex * (cell + gap)}
              width={cell}
              height={cell}
              rx="2.5"
              fill="var(--es-accent)"
              opacity={0.05 + (value / max) * 0.85}
            >
              <title>{`${DAY_LABELS[dayIndex]} ${String(hour).padStart(2, '0')}:00 — ${Math.round(value)} concurrent`}</title>
            </rect>
          ))}
        </g>
      ))}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Forecast band
// ─────────────────────────────────────────────────────────────────────────────

export function ForecastChart({
  history,
  forecast,
  entitled,
  recommended,
  height = 220,
  className,
}: {
  history: { label: string; value: number }[];
  forecast: { label: string; value: number }[];
  entitled: number;
  recommended: number;
  height?: number;
  className?: string;
}) {
  const width = 860;
  const padding = { top: 16, right: 80, bottom: 26, left: 40 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const all = [...history, ...forecast];

  if (all.length === 0) return <ChartEmpty height={height} message="No forecast available" />;

  const yMax = niceMax(Math.max(...all.map((p) => p.value), entitled, recommended) * 1.06);
  const x = (i: number) => padding.left + (all.length === 1 ? plotW / 2 : (i / (all.length - 1)) * plotW);
  const y = (v: number) => padding.top + plotH - (v / yMax) * plotH;

  const historyPath = history.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.value)}`).join(' ');
  const forecastPath = forecast
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(history.length - 1 + i)},${y(p.value)}`)
    .join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} className={className} role="img" aria-label="Demand forecast">
      {[0, yMax * 0.5, yMax].map((value) => (
        <g key={value}>
          <line x1={padding.left} x2={padding.left + plotW} y1={y(value)} y2={y(value)} stroke={AXIS} />
          <text x={padding.left - 7} y={y(value) + 3.5} textAnchor="end" fontSize="10" fill={MUTED}>
            {Math.round(value)}
          </text>
        </g>
      ))}

      {forecast.length > 0 && (
        <rect
          x={x(history.length - 1)}
          y={padding.top}
          width={padding.left + plotW - x(history.length - 1)}
          height={plotH}
          fill="var(--es-fg-subtle)"
          opacity="0.05"
        />
      )}

      <path d={historyPath} fill="none" stroke="var(--es-accent)" strokeWidth="1.8" strokeLinejoin="round" />
      <path d={forecastPath} fill="none" stroke="var(--es-violet)" strokeWidth="1.8" strokeDasharray="5 4" strokeLinejoin="round" />

      <ReferenceLine y={y(entitled)} x1={padding.left} x2={padding.left + plotW} label={`Entitled ${entitled}`} color="var(--es-fg-muted)" dash="5 4" />
      <ReferenceLine y={y(recommended)} x1={padding.left} x2={padding.left + plotW} label={`Rec. ${recommended}`} color="var(--es-positive)" dash="4 3" />

      {all
        .filter((_, i) => i % Math.ceil(all.length / 10) === 0)
        .map((point, index) => (
          <text
            key={`${point.label}-${index}`}
            x={x(index * Math.ceil(all.length / 10))}
            y={height - 8}
            textAnchor="middle"
            fontSize="9.5"
            fill={MUTED}
          >
            {point.label}
          </text>
        ))}
    </svg>
  );
}
