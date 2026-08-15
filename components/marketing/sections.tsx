'use client';

import { CountUp, Reveal, RotatingText } from './motion';
import { cn } from '@/lib/utils';

/**
 * Landing page sections.
 *
 * Vendor names are rendered typographically rather than as logos. EngiSignal
 * does not scrape or reproduce third-party brand assets, and a clean textual
 * treatment carries the same message — this product is built for these tools —
 * without any brand-guideline or endorsement risk.
 */

const VENDORS = [
  'Ansys',
  'MathWorks',
  'Dassault Systèmes',
  'Siemens',
  'Altair',
  'Autodesk',
  'PTC',
  'Bentley Systems',
  'Hexagon',
  'Cadence',
  'Synopsys',
];

export function VendorMarquee() {
  return (
    <div className="es-marquee relative overflow-hidden" aria-label="Engineering software vendors">
      {/* Edge fades, so the strip reads as continuous rather than clipped. */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-bg to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-bg to-transparent" />

      {/* Desktop: a slow, restrained marquee that pauses on hover. */}
      <ul className="es-marquee-track hidden w-max items-center gap-14 md:flex">
        {[...VENDORS, ...VENDORS].map((vendor, index) => (
          <li
            key={`${vendor}-${index}`}
            aria-hidden={index >= VENDORS.length}
            className="whitespace-nowrap text-[17px] font-medium tracking-[-0.015em] text-fg-subtle transition-colors hover:text-fg-muted"
          >
            {vendor}
          </li>
        ))}
      </ul>

      {/* Mobile: a static, swipeable strip — no autoplaying motion. */}
      <ul className="es-scroll flex gap-8 overflow-x-auto pb-2 md:hidden">
        {VENDORS.map((vendor) => (
          <li
            key={vendor}
            className="whitespace-nowrap text-[15px] font-medium tracking-[-0.015em] text-fg-subtle"
          >
            {vendor}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const PROBLEMS = [
  {
    title: 'Overcapacity',
    tone: 'positive' as const,
    rows: [
      { label: 'Owned', value: 400 },
      { label: 'P95 demand', value: 275 },
    ],
    outcome: '125 licenses never used',
    outcomeTone: 'positive' as const,
  },
  {
    title: 'Capacity risk',
    tone: 'danger' as const,
    rows: [
      { label: 'Owned', value: 100 },
      { label: 'P95 demand', value: 94 },
    ],
    outcome: 'Work blocked on 11 days',
    outcomeTone: 'danger' as const,
  },
  {
    title: 'Named user waste',
    tone: 'warning' as const,
    rows: [
      { label: 'Assigned', value: 420 },
      { label: 'Inactive 90+ days', value: 43 },
    ],
    outcome: '$96,105 recoverable',
    outcomeTone: 'positive' as const,
  },
];

export function ProblemCards() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {PROBLEMS.map((problem, index) => (
        <Reveal key={problem.title} delay={index * 90}>
          <article className="h-full rounded-xl border border-border bg-surface px-6 py-6">
            <div className="mb-5 flex items-center gap-2.5">
              <span
                className={cn(
                  'size-2 rounded-full',
                  problem.tone === 'positive' && 'bg-positive',
                  problem.tone === 'danger' && 'bg-danger',
                  problem.tone === 'warning' && 'bg-warning',
                )}
              />
              <h3 className="text-[14px] font-semibold tracking-[-0.015em] text-fg">{problem.title}</h3>
            </div>

            <dl className="space-y-3.5">
              {problem.rows.map((row) => (
                <div key={row.label} className="flex items-baseline justify-between gap-4">
                  <dt className="text-[12.5px] text-fg-muted">{row.label}</dt>
                  <dd className="tnum text-[26px] font-semibold leading-none tracking-[-0.03em] text-fg">
                    <CountUp value={row.value} format={(v) => Math.round(v).toLocaleString('en-US')} />
                  </dd>
                </div>
              ))}
            </dl>

            <p
              className={cn(
                'mt-5 border-t border-border pt-4 text-[12.5px] font-medium',
                problem.outcomeTone === 'positive' ? 'text-positive' : 'text-danger',
              )}
            >
              {problem.outcome}
            </p>
          </article>
        </Reveal>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const PIPELINE = [
  { step: 'Usage', line: 'Know demand' },
  { step: 'People', line: 'Know who' },
  { step: 'Contracts', line: 'Know cost' },
  { step: 'Forecast', line: "Know what's next" },
  { step: 'Signal', line: 'Know what matters' },
  { step: 'Decision', line: 'Know what to do' },
];

export function Pipeline() {
  return (
    <div className="es-scroll overflow-x-auto pb-2">
      <ol className="flex min-w-[820px] items-stretch gap-2">
        {PIPELINE.map((stage, index) => (
          <Reveal key={stage.step} delay={index * 80} as="li" className="flex-1">
            <div className="relative flex h-full flex-col rounded-lg border border-border bg-surface px-4 py-4">
              <span className="tnum text-[10.5px] font-medium text-fg-subtle">
                {String(index + 1).padStart(2, '0')}
              </span>
              <p className="mt-1.5 text-[15px] font-semibold tracking-[-0.02em] text-fg">{stage.step}</p>
              <p className="mt-1 text-[12.5px] text-fg-muted">{stage.line}</p>

              {index < PIPELINE.length - 1 && (
                <span
                  className="absolute -right-[13px] top-1/2 z-10 hidden -translate-y-1/2 text-fg-subtle md:block"
                  aria-hidden="true"
                >
                  →
                </span>
              )}
            </div>
          </Reveal>
        ))}
      </ol>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const OUTCOMES = [
  { title: 'Right-size renewals', line: 'Know what to buy.' },
  { title: 'Find unused licenses', line: 'Recover idle spend.' },
  { title: 'Forecast demand', line: 'Plan ahead.' },
  { title: 'Allocate cost', line: 'Know who drives spend.' },
];

export function OutcomeCards() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {OUTCOMES.map((outcome, index) => (
        <Reveal key={outcome.title} delay={index * 70}>
          <article className="h-full rounded-xl border border-border bg-surface px-5 py-6">
            <h3 className="text-[15px] font-semibold tracking-[-0.02em] text-fg">{outcome.title}</h3>
            <p className="mt-1.5 text-[13px] text-fg-muted">{outcome.line}</p>
          </article>
        </Reveal>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const SHOWCASE_SIGNALS = [
  {
    kind: 'Cost Signal',
    colour: 'var(--es-positive)',
    title: '$1.3M optimization opportunity identified',
    detail: 'Entitled capacity above P95 demand across 14 concurrent positions.',
    facts: ['14 features', '$1.3M annual', 'High confidence'],
  },
  {
    kind: 'Renewal Signal',
    colour: 'var(--es-accent)',
    title: 'Ansys renewal requires action in 58 days',
    detail: '$410K optimization opportunity ahead of the commitment.',
    facts: ['58 days', '$410K', 'High confidence'],
  },
  {
    kind: 'Forecast Signal',
    colour: 'var(--es-violet)',
    title: 'Structures demand forecast +11%',
    detail: 'Trend and headcount growth compound over the next twelve months.',
    facts: ['+11%', '4 features', 'Medium confidence'],
  },
  {
    kind: 'Reclaim Signal',
    colour: 'var(--es-aqua)',
    title: '43 MATLAB users inactive over 90 days',
    detail: 'Each seat routes to the holder’s manager for confirmation.',
    facts: ['43 seats', '$96,105', 'High confidence'],
  },
  {
    kind: 'Capacity Signal',
    colour: 'var(--es-danger)',
    title: 'Simcenter STAR-CCM+ risk increased to High',
    detail: '94% utilization at P95 with recurring saturation days.',
    facts: ['94% at P95', '100 entitled', 'High confidence'],
  },
];

export function SignalsShowcase() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="size-2.5 rounded-full bg-border-strong" />
          <span className="size-2.5 rounded-full bg-border-strong" />
          <span className="size-2.5 rounded-full bg-border-strong" />
        </span>
        <span className="ml-2 text-[11.5px] text-fg-subtle">EngiSignal — Intelligence</span>
      </div>

      <ul className="divide-y divide-border">
        {SHOWCASE_SIGNALS.map((signal, index) => (
          <Reveal key={signal.title} delay={index * 110} as="li">
            <div className="relative flex flex-wrap items-center gap-4 py-4 pl-5 pr-4">
              <span
                className="absolute inset-y-0 left-0 w-[3px]"
                style={{ background: signal.colour }}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <span
                  className="text-[10.5px] font-semibold uppercase tracking-[0.11em]"
                  style={{ color: signal.colour }}
                >
                  {signal.kind}
                </span>
                <p className="mt-1 text-[14px] font-semibold tracking-[-0.015em] text-fg">{signal.title}</p>
                <p className="mt-1 text-[12.5px] text-fg-muted">{signal.detail}</p>
                <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1">
                  {signal.facts.map((fact) => (
                    <li key={fact} className="tnum text-[11.5px] text-fg-subtle">
                      {fact}
                    </li>
                  ))}
                </ul>
              </div>
              <span className="shrink-0 rounded-md border border-border px-3 py-1.5 text-[12px] font-medium text-fg-muted">
                Review
              </span>
            </div>
          </Reveal>
        ))}
      </ul>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const ASK_EXCHANGES = [
  {
    question: 'Why are we reducing Ansys?',
    answer: 'P95 daily peak demand was 275 against 400 entitled licenses over 12 months.',
    facts: [
      ['P95 daily peak', '275'],
      ['Maximum observed', '314'],
      ['Recommended', '318'],
      ['Annual opportunity', '$410,000'],
    ],
  },
  {
    question: 'Which renewals need attention?',
    answer: 'Three contracts fall inside 90 days, together carrying $3.4M of current annual spend.',
    facts: [
      ['Autodesk', '23 days'],
      ['MathWorks', '41 days'],
      ['Ansys', '58 days'],
      ['Combined opportunity', '$612,000'],
    ],
  },
  {
    question: 'Who drives MATLAB demand?',
    answer: 'Flight Controls generates 38% of consumption, concentrated in 12 heavy users.',
    facts: [
      ['Flight Controls', '38%'],
      ['Systems Engineering', '21%'],
      ['Program Helios', '44%'],
      ['Active users', '377 of 420'],
    ],
  },
];

export function AskShowcase() {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {ASK_EXCHANGES.map((exchange, index) => (
        <Reveal key={exchange.question} delay={index * 100}>
          <article className="flex h-full flex-col rounded-xl border border-border bg-surface p-5">
            <p className="rounded-lg bg-surface-2 px-3.5 py-2.5 text-[13px] font-medium text-fg">
              {exchange.question}
            </p>
            <p className="mt-3.5 text-[13px] leading-relaxed text-fg-muted">{exchange.answer}</p>
            <dl className="mt-4 space-y-1.5 border-t border-border pt-3.5">
              {exchange.facts.map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-4">
                  <dt className="text-[12px] text-fg-subtle">{label}</dt>
                  <dd className="tnum text-[12.5px] font-medium text-fg">{value}</dd>
                </div>
              ))}
            </dl>
          </article>
        </Reveal>
      ))}
    </div>
  );
}

export function AskTypingLine() {
  return (
    <span className="text-accent">
      <RotatingText
        items={[
          'Why are we reducing Ansys?',
          'Which renewals need attention?',
          'Who drives MATLAB demand?',
          'What happens if Structures grows 12%?',
          'Why is this recommendation low confidence?',
        ]}
      />
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const STEPS = [
  {
    number: '01',
    title: 'Connect your data',
    detail: 'Upload the CSV or XLSX exports you already produce. EngiSignal maps your column names.',
  },
  {
    number: '02',
    title: 'EngiSignal finds what matters',
    detail: 'Demand, cost, capacity risk and renewal exposure, ranked into a queue.',
  },
  {
    number: '03',
    title: 'Make the decision',
    detail: 'Recommended quantities with the evidence behind them, ready to take to the vendor.',
  },
];

export function HowItWorks() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {STEPS.map((step, index) => (
        <Reveal key={step.number} delay={index * 100}>
          <article className="h-full rounded-xl border border-border bg-surface px-6 py-6">
            <span className="tnum text-[12px] font-semibold text-accent">{step.number}</span>
            <h3 className="mt-2.5 text-[16px] font-semibold tracking-[-0.02em] text-fg">{step.title}</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">{step.detail}</p>
          </article>
        </Reveal>
      ))}
    </div>
  );
}
