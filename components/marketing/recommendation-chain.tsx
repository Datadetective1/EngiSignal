'use client';

import { Reveal } from './motion';

/**
 * The evidence chain behind a renewal position.
 *
 * This replaces the earlier six-frame scroll story, which consumed several
 * viewport heights to deliver the same four numbers. The methodology itself is
 * unchanged — entitlement, observed demand, assumptions, recommendation — and
 * the full derivation stays available behind an expand rather than behind a
 * long scroll.
 *
 * Numbers here match the demo position used elsewhere on the page: 400
 * entitled, P95 daily peak of 275, ×1.05 growth, ×1.10 buffer, 318 recommended.
 */

const OWNED = 400;
const P95 = 275;
const AFTER_GROWTH = 289;
const RECOMMENDED = 318;
const UNIT_PRICE = 5000;

const pct = (value: number) => `${((value / OWNED) * 100).toFixed(2)}%`;

const STAGES = [
  {
    step: '01',
    label: 'Current entitlement',
    value: '400',
    detail: 'The quantity committed at the last renewal.',
    colour: 'var(--es-border-strong)',
  },
  {
    step: '02',
    label: 'Observed demand',
    value: '275',
    detail: 'P95 daily peak — the level demand exceeded on only 5% of days.',
    colour: 'var(--es-accent)',
  },
  {
    step: '03',
    label: 'Forecast + safety assumptions',
    value: '×1.05 · ×1.10',
    detail: 'Headcount growth applied to demand, then a buffer so a busy week does not block work.',
    colour: 'var(--es-violet)',
  },
  {
    step: '04',
    label: 'Recommended position',
    value: '318',
    detail: '275 × 1.05 × 1.10, rounded up to a whole license.',
    colour: 'var(--es-positive)',
  },
];

export function RecommendationChain() {
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr] lg:gap-6">
      <Reveal>
        <CapacityBar />
      </Reveal>

      <div className="space-y-3">
        {STAGES.map((stage, index) => (
          <Reveal key={stage.step} delay={index * 70}>
            <article className="flex gap-4 rounded-lg border border-border bg-surface px-5 py-4">
              <span
                className="mt-[7px] size-2 shrink-0 rounded-full"
                style={{ background: stage.colour }}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="text-[13.5px] font-semibold tracking-[-0.015em] text-fg">
                    <span className="tnum mr-2 text-[11px] font-medium text-fg-subtle">{stage.step}</span>
                    {stage.label}
                  </p>
                  <p className="tnum text-[17px] font-semibold leading-none tracking-[-0.025em] text-fg">
                    {stage.value}
                  </p>
                </div>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-fg-muted">{stage.detail}</p>
              </div>
            </article>
          </Reveal>
        ))}

        <Reveal delay={300}>
          <MethodologyDetail />
        </Reveal>
      </div>
    </div>
  );
}

/** 400 entitled, with demand, growth and buffer stacked against it. */
function CapacityBar() {
  return (
    <div className="flex h-full flex-col rounded-xl border border-border bg-surface p-6">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.11em] text-fg-subtle">
          Entitled capacity
        </span>
        <span className="tnum text-[13px] font-semibold text-fg">{OWNED}</span>
      </div>

      <div
        className="relative h-20 w-full overflow-hidden rounded-lg bg-surface-3 sm:h-24"
        role="img"
        aria-label={`Of ${OWNED} entitled licenses, P95 daily peak demand is ${P95}, and the recommended position after growth and buffer is ${RECOMMENDED}.`}
      >
        <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: pct(P95) }} />
        <div
          className="absolute inset-y-0 bg-violet opacity-80"
          style={{ left: pct(P95), width: pct(AFTER_GROWTH - P95) }}
        />
        <div
          className="absolute inset-y-0 bg-aqua opacity-70"
          style={{ left: pct(AFTER_GROWTH), width: pct(RECOMMENDED - AFTER_GROWTH) }}
        />
        <div className="absolute inset-y-0 w-[2.5px] bg-positive" style={{ left: pct(RECOMMENDED) }} />
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span className="h-2 w-8 shrink-0 rounded-full bg-surface-3" aria-hidden="true" />
        <span className="text-[12px] text-fg-muted">Capacity above the recommended position</span>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3">
        <Legend colour="var(--es-accent)" label="P95 demand" value="275" />
        <Legend colour="var(--es-violet)" label="+5% growth" value="289" />
        <Legend colour="var(--es-aqua)" label="+10% buffer" value="318" />
        <Legend colour="var(--es-positive)" label="Recommended" value="318" />
      </dl>

      <div className="mt-auto pt-5">
        <div className="rounded-lg border border-positive/30 bg-positive-soft px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-positive">
            Estimated annual opportunity
          </p>
          <p className="tnum mt-1 text-[26px] font-semibold leading-none tracking-[-0.03em] text-positive">
            $410,000
          </p>
          <p className="mt-1.5 text-[11.5px] text-fg-muted">
            {OWNED - RECOMMENDED} licenses released at ${UNIT_PRICE.toLocaleString('en-US')} each.
          </p>
        </div>
      </div>
    </div>
  );
}

/** The full derivation, one interaction away rather than several screens away. */
function MethodologyDetail() {
  return (
    <details className="group rounded-lg border border-border bg-surface px-5 py-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[13px] font-medium text-fg-muted transition-colors hover:text-fg">
        Show the full derivation
        <span
          className="text-[11px] text-fg-subtle transition-transform group-open:rotate-180"
          aria-hidden="true"
        >
          ▾
        </span>
      </summary>

      <dl className="mt-4 space-y-2 border-t border-border pt-4 text-[12px]">
        <Row label="Entitled on contract" value="400" />
        <Row label="P95 daily peak demand" value="275" />
        <Row label="× Growth factor" value="1.05" />
        <Row label="× Safety factor" value="1.10" />
        <Row label="= Unrounded" value="317.63" />
        <Row label="→ Rounded up" value="318" emphasis />
        <Row label="Capacity above recommendation" value="82" />
        <Row label="× Unit price" value="$5,000" />
        <Row label="= Estimated annual opportunity" value="$410,000" emphasis />
      </dl>

      <p className="mt-4 text-[11.5px] leading-relaxed text-fg-subtle">
        Every number carries its own evidence in the product: the daily peak series it was computed from,
        the window it covers, and the assumptions applied. Confidence is reported alongside each
        recommendation rather than assumed.
      </p>
    </details>
  );
}

function Row({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 pb-1.5 last:border-0">
      <dt className={emphasis ? 'font-medium text-fg' : 'text-fg-muted'}>{label}</dt>
      <dd className={emphasis ? 'tnum font-semibold text-accent' : 'tnum text-fg'}>{value}</dd>
    </div>
  );
}

function Legend({ colour, label, value }: { colour: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="size-2.5 shrink-0 rounded-full" style={{ background: colour }} aria-hidden="true" />
      <dt className="flex-1 text-[12px] text-fg-muted">{label}</dt>
      <dd className="tnum text-[12.5px] font-medium text-fg">{value}</dd>
    </div>
  );
}
