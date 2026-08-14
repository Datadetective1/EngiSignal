import Link from 'next/link';
import { SIGNAL_LABELS } from '@/lib/analytics/signals';
import type { Signal, SignalKind } from '@/lib/domain/types';
import { cn } from '@/lib/utils';
import { ConfidenceBadge, RiskBadge } from '@/components/ui/primitives';
import { IconArrowRight } from './icons';

const KIND_ACCENT: Record<SignalKind, string> = {
  renewal: 'var(--es-accent)',
  cost: 'var(--es-positive)',
  capacity: 'var(--es-danger)',
  usage: 'var(--es-violet)',
  forecast: 'var(--es-violet)',
  reclaim: 'var(--es-aqua)',
  data: 'var(--es-warning)',
};

export function SignalCard({ signal, rank }: { signal: Signal; rank?: number }) {
  const accent = KIND_ACCENT[signal.kind];

  return (
    <li className="group relative overflow-hidden rounded-lg border border-border bg-surface transition-colors hover:border-border-strong">
      {/* The kind is carried by a colour rail as well as the text label, so it
          is never conveyed by colour alone. */}
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: accent }} aria-hidden="true" />

      <div className="flex flex-col gap-4 py-4 pl-5 pr-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.1em]" style={{ color: accent }}>
              {SIGNAL_LABELS[signal.kind]}
            </span>
            {rank !== undefined && (
              <span className="tnum text-[11px] text-fg-subtle">#{rank}</span>
            )}
            {signal.urgencyDays !== null && signal.urgencyDays <= 60 && (
              <span className="tnum rounded-full bg-danger-soft px-2 py-[2px] text-[10.5px] font-medium text-danger">
                {signal.urgencyDays} days
              </span>
            )}
          </div>

          <h3 className="text-[14.5px] font-semibold tracking-[-0.012em] text-fg">{signal.title}</h3>
          <p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">{signal.subtitle}</p>

          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
            {signal.facts.map((fact) => (
              <div key={fact.label}>
                <dt className="text-[10.5px] uppercase tracking-[0.08em] text-fg-subtle">{fact.label}</dt>
                <dd className="tnum mt-0.5 text-[13px] font-medium text-fg">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="flex shrink-0 flex-row items-center gap-2 sm:flex-col sm:items-end sm:gap-2.5">
          <div className="flex items-center gap-1.5">
            <ConfidenceBadge level={signal.confidence} />
            {signal.risk !== 'Low' && <RiskBadge risk={signal.risk} />}
          </div>
          <Link
            href={signal.href}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-[12.5px] font-medium text-fg',
              'transition-colors hover:bg-surface-2 group-hover:border-border-strong',
            )}
          >
            {signal.cta}
            <IconArrowRight size={14} className="text-fg-subtle" />
          </Link>
        </div>
      </div>
    </li>
  );
}
