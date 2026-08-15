import type { ReactNode } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { ConfidenceLevel, RiskLevel } from '@/lib/domain/types';

// ── Surfaces ─────────────────────────────────────────────────────────────────

export function Card({
  children,
  className,
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'li';
}) {
  return (
    <Tag className={cn('rounded-lg border border-border bg-surface', className)}>{children}</Tag>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 border-b border-border px-5 py-4', className)}>
      <div className="min-w-0">
        <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-fg">{title}</h2>
        {description !== undefined && (
          <p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">{description}</p>
        )}
      </div>
      {action !== undefined && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow !== undefined && (
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.13em] text-fg-subtle">{eyebrow}</p>
        )}
        <h1 className="text-[22px] font-semibold tracking-[-0.022em] text-fg">{title}</h1>
        {description !== undefined && (
          <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-fg-muted">{description}</p>
        )}
      </div>
      {action !== undefined && <div>{action}</div>}
    </div>
  );
}

// ── Badges ───────────────────────────────────────────────────────────────────

type Tone = 'neutral' | 'accent' | 'positive' | 'warning' | 'danger' | 'violet';

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-fg-muted',
  accent: 'bg-accent-soft text-accent',
  positive: 'bg-positive-soft text-positive',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  violet: 'bg-[color-mix(in_srgb,var(--es-violet)_12%,transparent)] text-violet',
};

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[11px] font-medium leading-none whitespace-nowrap',
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const RISK_TONE: Record<RiskLevel, Tone> = {
  Low: 'neutral',
  Moderate: 'warning',
  High: 'danger',
  Critical: 'danger',
};

export function RiskBadge({ risk, className }: { risk: RiskLevel; className?: string }) {
  return (
    <Badge tone={RISK_TONE[risk]} className={className}>
      <span
        className={cn(
          'size-1.5 rounded-full',
          risk === 'Low' && 'bg-fg-subtle',
          risk === 'Moderate' && 'bg-warning',
          (risk === 'High' || risk === 'Critical') && 'bg-danger',
        )}
      />
      {risk}
    </Badge>
  );
}

const CONFIDENCE_TONE: Record<ConfidenceLevel, Tone> = {
  High: 'positive',
  Medium: 'warning',
  Low: 'danger',
};

export function ConfidenceBadge({
  level,
  score,
  className,
}: {
  level: ConfidenceLevel;
  score?: number;
  className?: string;
}) {
  return (
    <Badge tone={CONFIDENCE_TONE[level]} className={className}>
      {level}
      {score !== undefined && <span className="tnum opacity-70">{score}</span>}
    </Badge>
  );
}

// ── Buttons ──────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg hover:brightness-110 active:brightness-95',
  secondary: 'border border-border bg-surface text-fg hover:bg-surface-2',
  ghost: 'text-fg-muted hover:bg-surface-2 hover:text-fg',
  danger: 'bg-danger text-white hover:brightness-110',
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-[12px] rounded-sm gap-1.5',
  md: 'h-9 px-3.5 text-[13px] rounded-md gap-2',
  lg: 'h-11 px-5 text-[14px] rounded-md gap-2',
};

const BUTTON_BASE =
  'inline-flex items-center justify-center font-medium transition-[background-color,color,filter,border-color] duration-150 disabled:opacity-50 disabled:pointer-events-none';

export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      type={type}
      className={cn(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], className)}
      {...rest}
    >
      {children}
    </button>
  );
}

export function LinkButton({
  children,
  href,
  variant = 'secondary',
  size = 'md',
  className,
  ...rest
}: {
  children: ReactNode;
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} & Omit<React.ComponentProps<typeof Link>, 'href' | 'className'>) {
  return (
    <Link
      href={href}
      className={cn(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], className)}
      {...rest}
    >
      {children}
    </Link>
  );
}

// ── Data display ─────────────────────────────────────────────────────────────

export function Kpi({
  label,
  value,
  detail,
  tone = 'neutral',
  href,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: Tone;
  href?: string;
}) {
  const body = (
    <>
      <p className="text-[11.5px] font-medium uppercase tracking-[0.1em] text-fg-subtle">{label}</p>
      <p
        className={cn(
          'tnum mt-2 text-[26px] font-semibold leading-none tracking-[-0.03em]',
          tone === 'positive' && 'text-positive',
          tone === 'danger' && 'text-danger',
          tone === 'warning' && 'text-warning',
          tone === 'accent' && 'text-accent',
        )}
      >
        {value}
      </p>
      {detail !== undefined && <p className="mt-2 text-[12px] leading-snug text-fg-muted">{detail}</p>}
    </>
  );

  const className = cn(
    'block rounded-lg border border-border bg-surface px-4 py-4 transition-colors',
    href !== undefined && 'hover:border-border-strong hover:bg-surface-2',
  );

  return href === undefined ? (
    <div className={className}>{body}</div>
  ) : (
    <Link href={href} className={className}>
      {body}
    </Link>
  );
}

export function MetricRow({
  label,
  value,
  note,
  emphasis = false,
}: {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-6 border-b border-border/70 py-2.5 last:border-0',
        emphasis && 'bg-accent-soft/40 -mx-3 px-3 rounded-sm',
      )}
    >
      <div className="min-w-0">
        <p className={cn('text-[12.5px]', emphasis ? 'font-semibold text-fg' : 'text-fg-muted')}>{label}</p>
        {note !== undefined && <p className="mt-0.5 text-[11.5px] leading-snug text-fg-subtle">{note}</p>}
      </div>
      <p className={cn('tnum shrink-0 text-[13px]', emphasis ? 'font-semibold text-fg' : 'text-fg')}>{value}</p>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-14 text-center">
      <p className="text-[14px] font-medium text-fg">{title}</p>
      <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-fg-muted">{description}</p>
      {action !== undefined && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Horizontal utilization bar with an explicit capacity reference. */
export function UtilizationBar({
  value,
  max,
  tone = 'accent',
  className,
}: {
  value: number;
  max: number;
  tone?: Tone;
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const over = max > 0 && value > max;

  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-surface-3', className)}>
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-500',
          over ? 'bg-danger' : tone === 'positive' ? 'bg-positive' : tone === 'warning' ? 'bg-warning' : 'bg-accent',
        )}
        style={{ width: `${Math.max(pct, 1.5)}%` }}
      />
    </div>
  );
}

// ── Tables ───────────────────────────────────────────────────────────────────

export function TableShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('es-scroll overflow-x-auto', className)}>
      <table className="w-full min-w-[720px] border-collapse text-[12.5px]">{children}</table>
    </div>
  );
}

export function Th({
  children,
  align = 'left',
  className,
}: {
  children?: ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        'whitespace-nowrap border-b border-border px-3 py-2.5 text-[11px] font-medium uppercase tracking-[0.08em] text-fg-subtle',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        align === 'left' && 'text-left',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = 'left',
  className,
  colSpan,
}: {
  children?: ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={cn(
        'border-b border-border/60 px-3 py-2.5 align-middle text-fg',
        align === 'right' && 'tnum text-right',
        align === 'center' && 'text-center',
        className,
      )}
    >
      {children}
    </td>
  );
}

// ── Misc ─────────────────────────────────────────────────────────────────────

export function Divider({ className }: { className?: string }) {
  return <hr className={cn('border-0 border-t border-border', className)} />;
}

/** A short, always-visible note explaining how a number was produced. */
export function MethodologyNote({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 border-l-2 border-border pl-3 text-[11.5px] leading-relaxed text-fg-subtle">
      {children}
    </p>
  );
}

export function DeltaText({
  value,
  suffix = '',
  invert = false,
}: {
  value: number;
  suffix?: string;
  invert?: boolean;
}) {
  if (value === 0) return <span className="tnum text-fg-muted">—</span>;
  const good = invert ? value < 0 : value > 0;
  return (
    <span className={cn('tnum font-medium', good ? 'text-positive' : 'text-danger')}>
      {value > 0 ? '+' : ''}
      {value.toLocaleString('en-US')}
      {suffix}
    </span>
  );
}
