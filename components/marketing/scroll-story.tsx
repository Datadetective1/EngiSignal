'use client';

import { useRef } from 'react';
import { motion, useScroll, useTransform, useReducedMotion, type MotionValue } from 'framer-motion';

/**
 * The scroll story.
 *
 * Six frames that explain the product without prose: you own 400, demand was
 * 275, growth adds a little, protection adds a little, the answer is 318, and
 * that is worth $410,000 a year.
 *
 * The bar visual is driven directly by scroll progress. With reduced motion the
 * frames become a plain stacked list — every number is still present, nothing
 * is conveyed by animation alone.
 */

const FRAMES = [
  { step: '01', title: 'You own 400 licenses.', detail: 'The commitment made at the last renewal.' },
  { step: '02', title: 'P95 demand was 275.', detail: 'The level daily peak demand exceeded on only 5% of days.' },
  { step: '03', title: 'Engineering will grow 5%.', detail: 'Headcount plan applied to observed demand.' },
  { step: '04', title: 'Add 10% protection.', detail: 'A buffer so a busy week does not block work.' },
  { step: '05', title: 'Recommended: 318.', detail: '275 × 1.05 × 1.10, rounded up to a whole license.' },
  { step: '06', title: 'Worth $410,000 a year.', detail: '82 licenses released at $5,000 each.' },
];

export function ScrollStory() {
  const containerRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end end'],
  });

  if (reduceMotion === true) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <StaticBars />
        <ol className="space-y-3">
          {FRAMES.map((frame) => (
            <li key={frame.step} className="rounded-lg border border-border bg-surface px-5 py-4">
              <span className="tnum text-[11px] font-medium text-fg-subtle">{frame.step}</span>
              <p className="mt-1 text-[17px] font-semibold tracking-[-0.02em] text-fg">{frame.title}</p>
              <p className="mt-1 text-[13px] text-fg-muted">{frame.detail}</p>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    // Shortened from 420vh: the original left long stretches of dead scroll
    // between frames, which read as the page having stalled.
    <div ref={containerRef} className="relative h-[300vh]">
      <div className="sticky top-0 flex h-dvh items-center overflow-hidden">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-6 lg:grid-cols-[1.15fr_1fr] lg:gap-14">
          <div className="order-2 lg:order-1">
            <StoryBars progress={scrollYProgress} />
          </div>

          <div className="order-1 lg:order-2">
            <StepProgress progress={scrollYProgress} />
            <div className="relative mt-5 min-h-[190px]">
              {FRAMES.map((frame, index) => (
                <StoryFrame key={frame.step} frame={frame} index={index} progress={scrollYProgress} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Step rail.
 *
 * Makes the progression legible and, importantly, shows that more frames follow
 * — without it a reader cannot tell whether the section has more to give.
 */
function StepProgress({ progress }: { progress: MotionValue<number> }) {
  return (
    <div>
      <div className="flex items-center gap-1.5">
        {FRAMES.map((frame, index) => (
          // Each tick is its own component so useTransform stays at the top
          // level of a component rather than being called inside a loop.
          <StepTick key={frame.step} index={index} progress={progress} />
        ))}
      </div>
      <p className="mt-2.5 text-[11px] font-medium uppercase tracking-[0.13em] text-fg-subtle">
        Keep scrolling · {FRAMES.length} steps
      </p>
    </div>
  );
}

function StepTick({ index, progress }: { index: number; progress: MotionValue<number> }) {
  const segment = 1 / FRAMES.length;
  const opacity = useTransform(
    progress,
    [index * segment - segment * 0.4, index * segment + segment * 0.15],
    [0.22, 1],
  );
  return <motion.span style={{ opacity }} className="h-[3px] flex-1 rounded-full bg-accent" />;
}

function StoryFrame({
  frame,
  index,
  progress,
}: {
  frame: (typeof FRAMES)[number];
  index: number;
  progress: MotionValue<number>;
}) {
  const segment = 1 / FRAMES.length;
  const start = index * segment;

  const opacity = useTransform(
    progress,
    [start - segment * 0.35, start + segment * 0.1, start + segment * 0.75, start + segment * 1.1],
    [0, 1, 1, 0],
  );
  const y = useTransform(progress, [start - segment * 0.35, start + segment * 0.1], [26, 0]);

  return (
    <motion.div style={{ opacity, y }} className="absolute max-w-md">
      <span className="tnum text-[11px] font-medium uppercase tracking-[0.16em] text-accent">
        {frame.step}
      </span>
      <p className="mt-2.5 text-[30px] font-semibold leading-[1.15] tracking-[-0.03em] text-fg">
        {frame.title}
      </p>
      <p className="mt-2.5 text-[14px] leading-relaxed text-fg-muted">{frame.detail}</p>
    </motion.div>
  );
}

/**
 * Capacity bar: 400 owned, with demand, growth, buffer and the recommendation
 * revealed in turn as the story advances.
 */
function StoryBars({ progress }: { progress: MotionValue<number> }) {
  const OWNED = 400;
  const pct = (value: number) => `${(value / OWNED) * 100}%`;

  const demandWidth = useTransform(progress, [0.1, 0.28], ['0%', pct(275)]);
  const growthWidth = useTransform(progress, [0.34, 0.5], ['0%', pct(289 - 275)]);
  const bufferWidth = useTransform(progress, [0.55, 0.7], ['0%', pct(318 - 289)]);
  const unusedOpacity = useTransform(progress, [0.2, 0.34], [0, 1]);
  const markerOpacity = useTransform(progress, [0.7, 0.82], [0, 1]);
  const savingsOpacity = useTransform(progress, [0.84, 0.95], [0, 1]);

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.11em] text-fg-subtle">
          Entitled capacity
        </span>
        <span className="tnum text-[13px] font-semibold text-fg">400</span>
      </div>

      <div className="relative h-20 w-full overflow-hidden rounded-lg bg-surface-3 sm:h-24">
        <motion.div style={{ width: demandWidth }} className="absolute inset-y-0 left-0 bg-accent" />
        <motion.div
          style={{ width: growthWidth, left: pct(275) }}
          className="absolute inset-y-0 bg-violet opacity-80"
        />
        <motion.div
          style={{ width: bufferWidth, left: pct(289) }}
          className="absolute inset-y-0 bg-aqua opacity-70"
        />
        <motion.div
          style={{ opacity: markerOpacity, left: pct(318) }}
          className="absolute inset-y-0 w-[2.5px] bg-positive"
        />
      </div>

      <motion.div style={{ opacity: unusedOpacity }} className="mt-3 flex items-center gap-2">
        <span className="h-2 w-8 rounded-full bg-surface-3" />
        <span className="text-[12px] text-fg-muted">Capacity never used at P95</span>
      </motion.div>

      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3">
        <Legend colour="var(--es-accent)" label="P95 demand" value="275" />
        <Legend colour="var(--es-violet)" label="+5% growth" value="289" />
        <Legend colour="var(--es-aqua)" label="+10% buffer" value="318" />
        <Legend colour="var(--es-positive)" label="Recommended" value="318" />
      </dl>

      <motion.div
        style={{ opacity: savingsOpacity }}
        className="mt-5 rounded-lg border border-positive/30 bg-positive-soft px-4 py-3"
      >
        <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-positive">
          Estimated annual opportunity
        </p>
        <p className="tnum mt-1 text-[26px] font-semibold leading-none tracking-[-0.03em] text-positive">
          $410,000
        </p>
      </motion.div>
    </div>
  );
}

function StaticBars() {
  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.11em] text-fg-subtle">
          Entitled capacity
        </span>
        <span className="tnum text-[13px] font-semibold text-fg">400</span>
      </div>
      <div className="relative h-20 w-full overflow-hidden rounded-lg bg-surface-3 sm:h-24">
        <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: '68.75%' }} />
        <div className="absolute inset-y-0 bg-violet opacity-80" style={{ left: '68.75%', width: '3.5%' }} />
        <div className="absolute inset-y-0 bg-aqua opacity-70" style={{ left: '72.25%', width: '7.25%' }} />
        <div className="absolute inset-y-0 w-[2.5px] bg-positive" style={{ left: '79.5%' }} />
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3">
        <Legend colour="var(--es-accent)" label="P95 demand" value="275" />
        <Legend colour="var(--es-violet)" label="+5% growth" value="289" />
        <Legend colour="var(--es-aqua)" label="+10% buffer" value="318" />
        <Legend colour="var(--es-positive)" label="Recommended" value="318" />
      </dl>
      <div className="mt-5 rounded-lg border border-positive/30 bg-positive-soft px-4 py-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-positive">
          Estimated annual opportunity
        </p>
        <p className="tnum mt-1 text-[26px] font-semibold leading-none tracking-[-0.03em] text-positive">
          $410,000
        </p>
      </div>
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
