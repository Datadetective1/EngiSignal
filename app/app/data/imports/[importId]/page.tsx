import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Badge,
  Card,
  CardHeader,
  Kpi,
  MethodologyNote,
  SectionHeading,
  TableShell,
  Td,
  Th,
} from '@/components/ui/primitives';
import { formatNumber } from '@/lib/analytics/financial';
import { resolveIngestionContext } from '@/lib/ingestion/session';
import { getIngestionStore } from '@/lib/ingestion/store';

export const metadata: Metadata = { title: 'Import detail' };

/**
 * ── WHAT DID ENGISIGNAL REJECT, AND WHY ─────────────────────────────────────
 *
 * Before committing an import, a customer sees every rejected row with the rule
 * that caught it and an example value. Afterwards there was no way back to any
 * of it: no route read the detail, and `ingestion_rejections` had been written
 * by nothing since the bulk-insert path was retired — so a tenant looking at
 * "4,458 rejected" had 4,458 unanswerable questions.
 *
 * This page is deliberately the smallest thing that answers them. It reads the
 * evidence the import already stored and renders it. There is no new model, no
 * recomputation, and nothing here can change an import: a customer asking why a
 * row was dropped is auditing, and an audit surface that can mutate what it
 * reports is not an audit surface.
 */
export default async function ImportDetailPage({
  params,
}: {
  params: Promise<{ importId: string }>;
}) {
  const { importId } = await params;

  // Scoped by organization inside the store as well as here: an import id alone
  // must never be enough to reach another tenant's import.
  const auth = await resolveIngestionContext();
  if (!auth.ok) notFound();

  const detail = await getIngestionStore().getImport(auth.context.organizationId, importId);
  if (detail === null) notFound();

  const rejectedRows = detail.rejectedRows ?? 0;
  const acceptedRows = detail.acceptedRows ?? 0;
  const totalRows = detail.totalRows ?? acceptedRows + rejectedRows;
  const sample = detail.rejections;
  const summary = detail.rejectionSummary;
  // The sample is capped at commit time. Saying so matters: a customer counting
  // rows on this page must not conclude the rest were silently forgotten.
  const sampleIsPartial = rejectedRows > sample.length;
  const mappingEntries = Object.entries(detail.mappingUsed);

  return (
    <div className="space-y-6">
      <nav className="mb-2 flex flex-wrap items-center gap-1.5 text-[12px] text-fg-subtle">
        <Link href="/app/data" className="hover:text-fg">
          Data
        </Link>
        <span>/</span>
        <span className="text-fg-muted">{detail.fileName}</span>
      </nav>

      <SectionHeading
        eyebrow="Import detail"
        title={detail.fileName}
        description="What this file contained, what was stored, and what was not — with the rule that rejected each row."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Rows read" value={formatNumber(totalRows)} detail={`Dataset: ${detail.dataset}`} />
        <Kpi label="Accepted" value={formatNumber(acceptedRows)} tone="positive" detail="Stored and analysed" />
        <Kpi
          label="Rejected"
          value={formatNumber(rejectedRows)}
          tone={rejectedRows > 0 ? 'danger' : 'neutral'}
          detail={rejectedRows === 0 ? 'Every row passed validation' : 'Never used in any analysis'}
        />
        <Kpi
          label="Duplicates"
          value={formatNumber(detail.duplicateRows ?? 0)}
          detail="Repeated rows collapsed"
        />
      </div>

      {/* ── Why rows were rejected ──────────────────────────────────────── */}
      {rejectedRows === 0 ? (
        <Card>
          <CardHeader
            title="Nothing was rejected"
            description="Every row in this file passed validation and was stored."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardHeader
            title="Why rows were rejected"
            description="Every rejected row is counted here. Rejected rows are kept as an audit record and are never used in analysis."
          />
          <div className="es-scroll overflow-x-auto">
            <TableShell>
              <thead>
                <tr>
                  <Th>Reason</Th>
                  <Th>Field</Th>
                  <Th align="right">Rows</Th>
                  <Th>Example values</Th>
                </tr>
              </thead>
              <tbody>
                {summary.length === 0 ? (
                  <tr>
                    <Td className="text-fg-muted">
                      This import was committed before per-rule totals were recorded. The sample below
                      still shows individual rejected rows where they were retained.
                    </Td>
                    <Td>—</Td>
                    <Td align="right">—</Td>
                    <Td>—</Td>
                  </tr>
                ) : (
                  summary.map((entry) => (
                    <tr key={`${entry.rule}:${entry.field ?? ''}`}>
                      <Td className="font-medium text-fg">{entry.message}</Td>
                      <Td className="text-fg-muted">{entry.field ?? '—'}</Td>
                      <Td align="right" className="tnum">{formatNumber(entry.count)}</Td>
                      <Td className="text-fg-muted">
                        {entry.examples.length === 0
                          ? '—'
                          : entry.examples.slice(0, 3).map((example) => (
                              <code key={example} className="mr-1.5 text-[11.5px]">
                                {example}
                              </code>
                            ))}
                      </Td>
                    </tr>
                  ))
                )}
              </tbody>
            </TableShell>
          </div>
        </Card>
      )}

      {/* ── The individual rows ─────────────────────────────────────────── */}
      {sample.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader
            title="Rejected rows"
            description={
              sampleIsPartial
                ? `The first ${formatNumber(sample.length)} of ${formatNumber(rejectedRows)} rejected rows. The totals above count every one.`
                : `All ${formatNumber(sample.length)} rejected rows.`
            }
          />
          <div className="es-scroll overflow-x-auto">
            <TableShell>
              <thead>
                <tr>
                  <Th align="right">Row</Th>
                  <Th>Sheet</Th>
                  <Th>Field</Th>
                  <Th>Value</Th>
                  <Th>Reason</Th>
                </tr>
              </thead>
              <tbody>
                {sample.map((rejection, index) => (
                  <tr key={`${rejection.sourceSheet ?? ''}:${rejection.sourceRow}:${index}`}>
                    <Td align="right" className="tnum text-fg-muted">
                      {formatNumber(rejection.sourceRow)}
                    </Td>
                    <Td className="text-fg-muted">{rejection.sourceSheet ?? '—'}</Td>
                    <Td className="text-fg-muted">{rejection.field ?? '—'}</Td>
                    <Td>
                      {rejection.value === null || rejection.value === '' ? (
                        <span className="text-fg-subtle">empty</span>
                      ) : (
                        <code className="text-[11.5px]">{rejection.value}</code>
                      )}
                    </Td>
                    <Td className="text-fg-muted">{rejection.message}</Td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          </div>
        </Card>
      )}

      {/* ── How the file was read ───────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <CardHeader
          title="How this file was read"
          description="The source EngiSignal recognised, and the mapping actually applied to these rows."
        />
        <div className="es-scroll overflow-x-auto">
          <TableShell>
            <tbody>
              <tr>
                <Td className="font-medium text-fg">Source</Td>
                <Td className="text-fg-muted">
                  {detail.sourceSystem}{' '}
                  {detail.detectionFellBack ? (
                    <Badge tone="warning">not identified</Badge>
                  ) : (
                    <Badge tone="positive">
                      {Math.round((detail.detectionConfidence ?? 0) * 100)}% confidence
                    </Badge>
                  )}
                </Td>
              </tr>
              <tr>
                <Td className="font-medium text-fg">Imported</Td>
                <Td className="text-fg-muted">
                  {detail.importedAt === null
                    ? 'Not yet completed'
                    : new Date(detail.importedAt).toLocaleString('en-GB')}
                </Td>
              </tr>
              <tr>
                <Td className="font-medium text-fg">Status</Td>
                <Td className="text-fg-muted">{detail.status}</Td>
              </tr>
              {detail.sourceSheets.length > 0 && (
                <tr>
                  <Td className="font-medium text-fg">Sheets</Td>
                  <Td className="text-fg-muted">{detail.sourceSheets.join(', ')}</Td>
                </tr>
              )}
            </tbody>
          </TableShell>
        </div>

        {mappingEntries.length > 0 && (
          <div className="es-scroll overflow-x-auto border-t border-border">
            <TableShell>
              <thead>
                <tr>
                  <Th>Column in your file</Th>
                  <Th>Mapped to</Th>
                </tr>
              </thead>
              <tbody>
                {mappingEntries.map(([column, field]) => (
                  <tr key={column}>
                    <Td className="text-fg-muted">
                      <code className="text-[11.5px]">{column}</code>
                    </Td>
                    <Td className="font-medium text-fg">{field}</Td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          </div>
        )}
      </Card>

      {/* ── Warnings raised at import time ──────────────────────────────── */}
      {detail.warnings.length > 0 && (
        <Card>
          <CardHeader
            title="Warnings"
            description="Conditions noted when this file was read. These did not reject any row."
          />
          <div className="space-y-2 px-5 pb-5">
            {detail.warnings.map((warning, index) => (
              <p key={`${warning.code}:${index}`} className="text-[12.5px] leading-relaxed text-fg-muted">
                <span className="font-medium text-fg">{warning.message}</span>{' '}
                {warning.detail ?? ''}
              </p>
            ))}
          </div>
        </Card>
      )}

      <MethodologyNote>
        Rejected rows are never counted in any figure EngiSignal shows. They are retained so a
        rejection can be explained rather than merely reported — a per-rule total for every rejected
        row, and the individual rows themselves up to a stored limit.
      </MethodologyNote>
    </div>
  );
}
