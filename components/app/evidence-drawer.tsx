import Link from 'next/link';
import { ConfidenceBadge, MetricRow } from '@/components/ui/primitives';
import type { EvidenceRecord } from '@/lib/domain/types';
import { cn } from '@/lib/utils';
import { IconChevron } from './icons';

/**
 * The Evidence Drawer.
 *
 * Built on <details>/<summary> so it opens without JavaScript, is keyboard
 * operable by default, and prints expanded inside briefs. It renders values the
 * engine already produced — it never recomputes, so what the drawer shows and
 * what the page shows cannot diverge.
 */
export function EvidenceDrawer({
  evidence,
  defaultOpen = false,
  className,
}: {
  evidence: EvidenceRecord;
  defaultOpen?: boolean;
  className?: string;
}) {
  return (
    <details open={defaultOpen} className={cn('group rounded-lg border border-border bg-surface', className)}>
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-5 py-3.5 [&::-webkit-details-marker]:hidden">
        <IconChevron
          size={15}
          className="shrink-0 text-fg-subtle transition-transform duration-200 group-open:rotate-90"
        />
        <span className="text-[13px] font-semibold text-fg">Why this recommendation?</span>
        <span className="ml-auto flex items-center gap-2">
          <ConfidenceBadge level={evidence.confidence.level} score={evidence.confidence.score} />
        </span>
      </summary>

      <div className="border-t border-border px-5 pb-5 pt-4">
        <p className="mb-5 text-[13px] leading-relaxed text-fg-muted">{evidence.methodology}</p>

        <div className="grid gap-x-10 gap-y-6 lg:grid-cols-2">
          <section>
            <h4 className="mb-1 text-[11px] font-medium uppercase tracking-[0.1em] text-fg-subtle">
              Derivation
            </h4>
            <div>
              {evidence.derivation.map((row, index) => (
                <MetricRow
                  key={`${row.label}-${index}`}
                  label={row.label}
                  value={row.value}
                  note={row.note}
                  emphasis={row.emphasis}
                />
              ))}
            </div>
          </section>

          <div className="space-y-6">
            <section>
              <h4 className="mb-1 text-[11px] font-medium uppercase tracking-[0.1em] text-fg-subtle">
                Assumptions
              </h4>
              <div>
                {evidence.assumptions.map((row, index) => (
                  <MetricRow key={`${row.label}-${index}`} label={row.label} value={row.value} />
                ))}
              </div>
            </section>

            <section>
              <h4 className="mb-1 text-[11px] font-medium uppercase tracking-[0.1em] text-fg-subtle">
                Confidence
              </h4>
              <ul className="space-y-1.5 pt-1.5">
                {evidence.confidence.reasons.map((reason, index) => (
                  <li key={`${reason.label}-${index}`} className="flex gap-2.5 text-[12.5px]">
                    <span
                      className={cn(
                        'mt-[6px] size-1.5 shrink-0 rounded-full',
                        reason.impact === 'positive' && 'bg-positive',
                        reason.impact === 'neutral' && 'bg-warning',
                        reason.impact === 'negative' && 'bg-danger',
                      )}
                      aria-hidden="true"
                    />
                    <span className="text-fg-muted">
                      <span className="font-medium text-fg">{reason.label}:</span> {reason.detail}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>

        <section className="mt-6">
          <h4 className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.1em] text-fg-subtle">
            Observations
          </h4>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
            {evidence.observations.map((row, index) => (
              <div key={`${row.label}-${index}`}>
                <dt className="text-[11px] text-fg-subtle">{row.label}</dt>
                <dd
                  className={cn(
                    'tnum mt-0.5 text-[13.5px] text-fg',
                    row.emphasis === true && 'font-semibold text-accent',
                  )}
                >
                  {row.value}
                </dd>
                {row.note !== undefined && (
                  <p className="mt-0.5 text-[10.5px] leading-snug text-fg-subtle">{row.note}</p>
                )}
              </div>
            ))}
          </dl>
        </section>

        <nav className="mt-6 flex flex-wrap gap-2 border-t border-border pt-4">
          {evidence.drillThrough.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="inline-flex h-8 items-center rounded-md border border-border px-3 text-[12px] font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </details>
  );
}
