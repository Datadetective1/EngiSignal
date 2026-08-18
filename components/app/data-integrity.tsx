import Link from 'next/link';
import { Badge, Card, CardHeader, TableShell, Td, Th } from '@/components/ui/primitives';
import { formatNumber } from '@/lib/analytics/financial';
import type { IntegrityReport } from '@/lib/analytics/integrity';
import { shortEvidenceKey, type ProjectionStatus } from '@/lib/analytics/projection';

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

const STARTED_BECAUSE: Record<string, string> = {
  absent: 'nothing had been analysed yet',
  'version-changed': 'the analysis format changed in a release',
  'evidence-changed': 'your evidence changed',
  unreadable: 'the stored analysis could not be read',
  disabled: 'this deployment analyses on every request',
};

function ago(iso: string | null): string | null {
  if (iso === null) return null;
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) return seconds + 's ago';
  if (seconds < 3600) return Math.round(seconds / 60) + 'm ago';
  return Math.round(seconds / 3600) + 'h ago';
}

/**
 * Where the numbers on this page came from, and whether they are finished.
 *
 * Phase 2F made the analysis asynchronous, which means a page can now be in a
 * state the product never had before: the evidence is durably stored and
 * correct, and the analysis of it does not exist yet. A card that could only
 * say "cached" or "computed" would have no way to express that, and the
 * difference between "no features" and "not analysed yet" is the whole
 * question a customer is asking.
 */
export function ProjectionCard({
  projection,
  analyzedUsage,
  storedUsage,
}: {
  projection: ProjectionStatus;
  analyzedUsage: number;
  storedUsage: number;
}) {
  // An abandoned claim is not a build in progress.
  const building = projection.state === 'building' && projection.buildLive;
  const failed = projection.state === 'failed';

  const tone = projection.analyticsCurrent
    ? 'positive'
    : failed
      ? 'danger'
      : building
        ? 'accent'
        : 'warning';

  const label = projection.analyticsCurrent
    ? 'Current'
    : failed
      ? 'Last build failed'
      : projection.source === 'superseded'
        ? 'Superseded'
        : building
          ? 'Being analysed'
          : 'Not analysed yet';

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="How this analysis was produced"
        description="Your evidence is analysed once when it changes, then reused. Reuse is allowed only while the evidence still matches exactly."
      />

      <div className="es-scroll overflow-x-auto">
        <TableShell>
          <tbody>
            <tr>
              <Td className="font-medium text-fg">State</Td>
              <Td><Badge tone={tone}>{label}</Badge></Td>
            </tr>
            <tr>
              <Td className="font-medium text-fg">Evidence shown</Td>
              <Td className="text-fg-muted">
                {projection.evidenceKey === null ? (
                  <span className="text-fg-subtle">None yet</span>
                ) : (
                  <>
                    <code className="text-[11.5px]">{shortEvidenceKey(projection.evidenceKey)}</code>
                    {projection.stale && (
                      <span className="ml-2 text-warning">
                        &middot; your evidence has since changed to{' '}
                        <code className="text-[11.5px]">
                          {shortEvidenceKey(projection.currentEvidenceKey)}
                        </code>
                      </span>
                    )}
                  </>
                )}
              </Td>
            </tr>
            {building && (
              <tr>
                <Td className="font-medium text-fg">Building</Td>
                <Td className="text-fg-muted">
                  <code className="text-[11.5px]">
                    {shortEvidenceKey(projection.buildingEvidenceKey ?? projection.currentEvidenceKey)}
                  </code>
                  {projection.buildStartedAt !== null && ' · started ' + ago(projection.buildStartedAt)}
                  {projection.buildAttempt > 1 && ' · attempt ' + projection.buildAttempt}
                </Td>
              </tr>
            )}
            <tr>
              <Td className="font-medium text-fg">Last finished</Td>
              <Td className="text-fg-muted">
                {projection.buildFinishedAt === null && projection.computedAt === null ? (
                  <span className="text-fg-subtle">Never</span>
                ) : (
                  <>
                    {new Date(
                      projection.buildFinishedAt ?? (projection.computedAt as string),
                    ).toLocaleString('en-GB')}
                    {projection.buildMs !== null &&
                      ' · took ' + formatNumber(projection.buildMs) + ' ms'}
                  </>
                )}
              </Td>
            </tr>
            <tr>
              <Td className="font-medium text-fg">Rows</Td>
              <Td className="tnum text-fg-muted">
                {formatNumber(storedUsage)} usage rows stored{' · '}
                {projection.analyticsCurrent ? (
                  <>{formatNumber(analyzedUsage)} analysed</>
                ) : (
                  <span className="text-fg-subtle">analysis pending</span>
                )}
              </Td>
            </tr>
            <tr>
              <Td className="font-medium text-fg">Format version</Td>
              <Td className="tnum text-fg-muted">{projection.version}</Td>
            </tr>
            {projection.payloadBytes !== null && (
              <tr>
                <Td className="font-medium text-fg">Analysis size</Td>
                <Td className="tnum text-fg-muted">
                  {formatNumber(Math.round(projection.payloadBytes / 1024))} KB
                </Td>
              </tr>
            )}
            {projection.buildError !== null && (
              <tr>
                <Td className="font-medium text-danger">Last error</Td>
                <Td className="text-danger">{projection.buildError}</Td>
              </tr>
            )}
          </tbody>
        </TableShell>
      </div>

      <div className="border-t border-border px-5 py-3.5">
        <p className="text-[12px] leading-relaxed text-fg-subtle">
          {projection.analyticsCurrent ? (
            <>
              These figures were computed earlier and reused because a fingerprint of your imports,
              row counts and identity decisions still matches the one they were built from. Import,
              delete or confirm anything and the fingerprint stops matching, and the analysis is
              rebuilt before any page presents it as current.
            </>
          ) : failed ? (
            <>
              The last attempt to analyse your evidence did not finish. Your imported rows are
              unaffected &mdash; they are stored and complete. Reload this page, or import anything,
              and the analysis will be attempted again.
            </>
          ) : (
            <>
              Your evidence is stored and complete; the analysis of it is still being built
              {projection.startedBecause !== null &&
                ', because ' +
                  (STARTED_BECAUSE[projection.startedBecause] ?? 'it was out of date')}
              . Figures are withheld rather than shown from a version that no longer matches what
              you imported. Reload the page to see whether it has finished.
            </>
          )}
        </p>
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
 * What an analytical surface renders INSTEAD of numbers.
 *
 * Two different reasons, and they must not be worded the same. A truncated read
 * means the numbers cannot be trusted; a build in flight means they do not
 * exist yet. Telling somebody their data "did not reconcile" when their import
 * is simply still being analysed would send them to delete and re-import a
 * perfectly good estate.
 */
export function AnalyticsWithheld({ integrity }: { integrity: IntegrityReport }) {
  const usage = integrity.datasets.find((entry) => entry.dataset === 'usage');
  const storedUsage = usage?.stored ?? 0;

  // Rows do reconcile; the analysis of them is not finished.
  if (!integrity.usageIncomplete && !integrity.analysisCurrent) {
    const failed = integrity.analysisState === 'failed';
    const superseded = integrity.analysisState === 'superseded';

    return (
      <Card>
        <CardHeader
          title={failed ? 'This analysis could not be completed' : 'Your data is being analysed'}
          description={
            failed
              ? 'Your imported rows are stored and complete. The analysis of them did not finish.'
              : 'Your imported rows are stored and complete. The figures derived from them are still being built.'
          }
        />
        <div className="px-5 pb-5">
          <p className="max-w-[70ch] text-[13px] leading-relaxed text-fg-muted">
            {storedUsage > 0
              ? `${formatNumber(storedUsage)} usage rows are stored and accounted for.`
              : 'Your evidence is stored and accounted for.'}{' '}
            {superseded
              ? 'A complete analysis of an earlier version of your evidence exists, and is shown elsewhere clearly labelled — but it is not an analysis of what you have just imported, so no figure on this page is derived from it.'
              : 'Nothing on this page is shown as zero, because zero and "not yet counted" are different answers and only one of them is true.'}
          </p>
          <p className="mt-3 max-w-[70ch] text-[13px] leading-relaxed text-fg-muted">
            {failed
              ? 'Reload this page to try again, or import anything to trigger a fresh attempt. '
              : 'This usually takes a few seconds; a very large estate takes longer. Reload the page to see whether it has finished. '}
            <Link href="/app/data" className="text-accent underline underline-offset-2">
              Data
            </Link>{' '}
            shows what is building, which evidence version it is building, and when it started.
          </p>
        </div>
      </Card>
    );
  }

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
