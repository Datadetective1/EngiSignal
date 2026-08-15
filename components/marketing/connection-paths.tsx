'use client';

import { Reveal } from './motion';
import { cn } from '@/lib/utils';

/**
 * Connection paths.
 *
 * TRUTHFULNESS CONSTRAINT — read before editing.
 *
 * Status labels here must match `lib/connectors/index.ts`, where every
 * connector currently reports `available: false`. Only the file importer is
 * implemented (parse → suggest mapping → validate, in lib/import/*), so only
 * Quick Start carries a "live" label.
 *
 * The other two paths are labelled as architecture and roadmap, in EngiSignal's
 * own words, with no claimed polling intervals, install times, real-time
 * guarantees or specific license-manager compatibility. If a connector ships
 * with code and tests, change its label here — not before.
 */

type Status = 'live' | 'architecture' | 'roadmap';

const STATUS_LABEL: Record<Status, string> = {
  live: 'Available now',
  architecture: 'Connector-ready architecture',
  roadmap: 'Production connector roadmap',
};

const STATUS_CLASS: Record<Status, string> = {
  live: 'bg-positive-soft text-positive',
  architecture: 'bg-accent-soft text-accent',
  roadmap: 'bg-surface-3 text-fg-muted',
};

function StatusBadge({ status }: { status: Status }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium',
        STATUS_CLASS[status],
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          status === 'live' ? 'bg-positive' : status === 'architecture' ? 'bg-accent' : 'bg-fg-subtle',
        )}
        aria-hidden="true"
      />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function ConnectionPaths() {
  return (
    <div className="space-y-5">
      {/* The message that must survive: files are the on-ramp, not the architecture. */}
      <Reveal>
        <p className="rounded-xl border border-border bg-surface px-6 py-5 text-[16px] font-medium leading-relaxed tracking-[-0.015em] text-fg sm:text-[18px]">
          Start with files for the pilot.{' '}
          <span className="text-accent">Automate when you&rsquo;re ready for production.</span>
        </p>
      </Reveal>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ── 1. Quick Start — genuinely implemented ─────────────────────── */}
        <Reveal delay={60}>
          <article className="flex h-full flex-col rounded-xl border border-border bg-surface p-6">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <h3 className="text-[16px] font-semibold tracking-[-0.02em] text-fg">Quick Start</h3>
              <StatusBadge status="live" />
            </div>
            <p className="text-[13.5px] leading-relaxed text-fg-muted">Use the data you already have.</p>

            <ul className="mt-5 space-y-2 border-t border-border pt-4">
              {[
                'CSV and XLSX imports',
                'License usage exports',
                'Vendor portal exports',
                'Reports from tools such as OpenLM or Open iT',
                'Any tabular export, mapped to your own column names',
              ].map((item) => (
                <li key={item} className="flex gap-2.5 text-[12.5px] leading-relaxed text-fg-muted">
                  <span className="mt-[7px] size-1 shrink-0 rounded-full bg-positive" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>

            <p className="mt-auto pt-5 text-[12px] leading-relaxed text-fg-subtle">
              Ideal for pilots, historical analysis and one-time imports. EngiSignal maps whatever column
              names your export already uses — there is no template to conform to.
            </p>
          </article>
        </Reveal>

        {/* ── 2. Direct Connections — architecture, not implemented ──────── */}
        <Reveal delay={120}>
          <article className="flex h-full flex-col rounded-xl border border-border bg-surface p-6">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <h3 className="text-[16px] font-semibold tracking-[-0.02em] text-fg">Direct Connections</h3>
              <StatusBadge status="architecture" />
            </div>
            <p className="text-[13.5px] leading-relaxed text-fg-muted">
              Automate data from the systems your organization already uses.
            </p>

            <div className="mt-5 border-t border-border pt-4">
              <ul className="flex flex-wrap gap-1.5">
                {[
                  'REST APIs',
                  'SFTP delivery',
                  'SQL Server',
                  'PostgreSQL',
                  'Databricks',
                  'Snowflake',
                  'Object storage',
                  'Procurement systems',
                  'HR systems',
                  'Vendor APIs',
                  'ServiceNow / SAM',
                ].map((item) => (
                  <li
                    key={item}
                    className="rounded-md border border-border px-2 py-1 text-[11.5px] text-fg-muted"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <p className="mt-auto pt-5 text-[12px] leading-relaxed text-fg-subtle">
              The data layer is built against a provider interface so these become configuration rather than
              rework. Scoped and delivered during implementation — none is live today.
            </p>
          </article>
        </Reveal>

        {/* ── 3. Collector — roadmap, not implemented ────────────────────── */}
        <Reveal delay={180}>
          <article className="flex h-full flex-col rounded-xl border border-border bg-surface p-6">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <h3 className="text-[16px] font-semibold tracking-[-0.02em] text-fg">
                Engineering License Collector
              </h3>
              <StatusBadge status="roadmap" />
            </div>
            <p className="text-[13.5px] leading-relaxed text-fg-muted">
              Continuously capture engineering license usage at the source.
            </p>

            <div className="mt-5 border-t border-border pt-4">
              <CollectorFlow />
            </div>

            <p className="mt-auto pt-5 text-[12px] leading-relaxed text-fg-subtle">
              The engineering-specific direction for production data. Connector interfaces are defined in the
              codebase; no collector ships yet, and EngiSignal will not show one as connected until it does.
            </p>
          </article>
        </Reveal>
      </div>
    </div>
  );
}

/** FlexNet / RLM / DSLS / Sentinel → Collector → secure outbound → EngiSignal. */
function CollectorFlow() {
  return (
    <div className="space-y-2" role="img" aria-label="License managers feed a collector, which sends usage outbound to EngiSignal.">
      <div className="flex flex-wrap gap-1.5">
        {['FlexNet', 'RLM', 'DSLS', 'Sentinel'].map((manager) => (
          <span
            key={manager}
            className="rounded-md border border-border px-2 py-1 text-[11.5px] text-fg-muted"
          >
            {manager}
          </span>
        ))}
      </div>

      <FlowArrow />

      <div className="rounded-md border border-accent/35 bg-accent-soft px-3 py-2 text-center text-[12px] font-medium text-accent">
        EngiSignal Collector
      </div>

      <FlowArrow label="Secure outbound transfer" />

      <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-center text-[12px] font-medium text-fg">
        EngiSignal
      </div>
    </div>
  );
}

function FlowArrow({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2" aria-hidden="true">
      <span className="ml-3 h-4 w-px bg-border-strong" />
      {label !== undefined && <span className="text-[11px] text-fg-subtle">{label}</span>}
    </div>
  );
}

/**
 * What EngiSignal combines.
 *
 * Reinforces that this is engineering software intelligence — license-manager
 * data joined to enterprise context — rather than generic SaaS management.
 */
export function ArchitectureDiagram() {
  return (
    <div className="rounded-xl border border-border bg-surface p-6 lg:p-8">
      <div className="grid gap-4 md:grid-cols-2">
        <InputColumn
          label="Engineering license data"
          accent="var(--es-accent)"
          items={['FlexNet', 'RLM', 'DSLS', 'Sentinel', 'Vendor exports']}
        />
        <InputColumn
          label="Enterprise context"
          accent="var(--es-aqua)"
          items={['HR & organization', 'Contracts', 'Cost', 'Procurement', 'Forecasts']}
        />
      </div>

      <div className="my-5 flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        <span className="text-fg-subtle">↓</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <p className="rounded-lg border border-accent/35 bg-accent-soft py-3 text-center text-[15px] font-semibold tracking-[-0.02em] text-accent">
        EngiSignal
      </p>

      <div className="my-5 flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        <span className="text-fg-subtle">↓</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <ul className="flex flex-wrap justify-center gap-2">
        {[
          'Signals',
          'Forecasts',
          'Evidence',
          'Renewal positions',
          'Cost allocation',
          'Reclaim opportunities',
          'Capacity decisions',
        ].map((output) => (
          <li
            key={output}
            className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[12.5px] font-medium text-fg"
          >
            {output}
          </li>
        ))}
      </ul>
    </div>
  );
}

function InputColumn({
  label,
  items,
  accent,
}: {
  label: string;
  items: string[];
  accent: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-4">
      <p className="mb-3 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.11em] text-fg-subtle">
        <span className="size-1.5 rounded-full" style={{ background: accent }} aria-hidden="true" />
        {label}
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <li key={item} className="rounded-md border border-border px-2 py-1 text-[11.5px] text-fg-muted">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
