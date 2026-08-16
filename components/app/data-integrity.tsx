import Link from 'next/link';
import { Badge, Card, CardHeader, TableShell, Td, Th } from '@/components/ui/primitives';
import { formatNumber } from '@/lib/analytics/financial';
import type { IntegrityReport } from '@/lib/analytics/integrity';

/**
 * The row-completeness statement.
 *
 * A customer taking a number into a renewal negotiation needs to know that the
 * number was computed from all of their data, not from as much of it as the
 * transport happened to return. Phase 2C shipped a version that computed from
 * 24% of the estate and looked entirely healthy.
 */

/** Full accounting table. Lives on the Data page. */
export function DataIntegrityCard({ integrity }: { integrity: IntegrityReport }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Data integrity"
        description="What your imports promised, what the database holds, and what this analysis actually read. All three must agree."
      />

      <div className="es-scroll overflow-x-auto">
        <TableShell>
          <thead>
            <tr>
              <Th>Dataset</Th>
              <Th align="right">Accepted</Th>
              <Th align="right">Stored</Th>
              <Th align="right">Analyzed</Th>
              <Th>State</Th>
            </tr>
          </thead>
          <tbody>
            {integrity.datasets.map((entry) => (
              <tr key={entry.dataset}>
                <Td className="font-medium text-fg">{entry.label}</Td>
                <Td align="right" className="tnum">{formatNumber(entry.accepted)}</Td>
                <Td align="right" className="tnum">{formatNumber(entry.stored)}</Td>
                <Td align="right" className={`tnum ${entry.complete ? '' : 'font-semibold text-danger'}`}>
                  {formatNumber(entry.analyzed)}
                </Td>
                <Td>
                  {entry.stored === 0 && entry.accepted === 0 ? (
                    <span className="text-fg-subtle">No data</span>
                  ) : entry.complete ? (
                    <Badge tone="positive">Complete</Badge>
                  ) : (
                    <Badge tone="danger">Incomplete</Badge>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </div>

      <div className="border-t border-border px-5 py-3.5">
        <ul className="space-y-1.5">
          {integrity.datasets
            .filter((entry) => !entry.complete || entry.stored > 0)
            .map((entry) => (
              <li key={entry.dataset} className="text-[12px] leading-relaxed text-fg-subtle">
                <span className={entry.complete ? 'text-fg-muted' : 'font-medium text-danger'}>
                  {entry.label}:
                </span>{' '}
                {entry.statement}
              </li>
            ))}
        </ul>
      </div>
    </Card>
  );
}

/**
 * The banner every analytical page carries when something does not reconcile.
 *
 * Deliberately not dismissible. The condition it reports is one where every
 * number on the page behind it is untrustworthy, and a reader who dismisses it
 * is left with exactly the confident-but-wrong screen this exists to prevent.
 */
export function IntegrityBanner({ integrity }: { integrity: IntegrityReport }) {
  if (integrity.complete) return null;

  return (
    <div
      role="alert"
      className="rounded-md border border-danger/50 bg-danger-soft px-5 py-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[13px] font-semibold text-danger">
            EngiSignal did not read all of your data
          </p>
          <p className="mt-1.5 max-w-[70ch] text-[12.5px] leading-relaxed text-fg-muted">
            {integrity.headline} Figures on this page that depend on the affected data are
            withheld rather than computed from part of it — a recommendation derived from an
            unknown fraction of an estate is worse than no recommendation.
          </p>
        </div>
        <Link
          href="/app/data"
          className="shrink-0 rounded-md border border-danger/50 px-3 py-1.5 text-[12px] font-medium text-danger hover:bg-danger/10"
        >
          See the row counts
        </Link>
      </div>
    </div>
  );
}

/**
 * What an analytical surface renders INSTEAD of numbers when usage is short.
 *
 * Coarse on purpose: a truncated read gives no way to know which rows are
 * missing, so no usage-derived figure on the page can be defended.
 */
export function AnalyticsWithheld({ integrity }: { integrity: IntegrityReport }) {
  const usage = integrity.datasets.find((entry) => entry.dataset === 'usage');

  return (
    <Card>
      <CardHeader
        title="Analytics withheld"
        description="These figures are calculated from usage, and this analysis did not read all of the usage that is stored."
      />
      <div className="px-5 pb-5">
        <p className="max-w-[70ch] text-[13px] leading-relaxed text-fg-muted">
          {usage?.statement}
        </p>
        <p className="mt-3 max-w-[70ch] text-[13px] leading-relaxed text-fg-muted">
          EngiSignal will not show a percentile, a utilization, a recommended quantity or a
          financial opportunity until the counts reconcile. Reload the page — if the numbers
          still disagree, the import may have partially failed and should be deleted and
          re-imported from{' '}
          <Link href="/app/data" className="text-accent underline underline-offset-2">
            Data
          </Link>
          .
        </p>
      </div>
    </Card>
  );
}
