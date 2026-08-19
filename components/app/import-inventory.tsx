'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Badge, Button, Card, CardHeader, TableShell, Td, Th } from '@/components/ui/primitives';

/**
 * Imported sources.
 *
 * Answers "what does EngiSignal actually know, and where did it come from" —
 * and lets a customer withdraw an import. Reversal is per-import by design:
 * canonical records are stored at source grain with import lineage, so removing
 * one import cannot disturb another.
 */

export interface ImportRow {
  id: string;
  fileName: string;
  dataset: string;
  sourceSystem: string;
  detectionConfidence: number;
  detectionFellBack: boolean;
  status: string;
  uploadedAt: string;
  totalRows: number;
  acceptedRows: number;
  rejectedRows: number;
  usageRecords: number;
  entitlementRecords: number;
  peopleRecords: number;
}

export interface CoverageRow {
  usageRecords: number;
  entitlementRecords: number;
  peopleRecords: number;
  distinctFeatures: number;
  distinctUsers: number;
  firstDate: string | null;
  lastDate: string | null;
  historyDays: number;
  hasConcurrency: boolean;
  hasDenials: boolean;
  sources: string[];
}

const SOURCE_LABEL: Record<string, string> = {
  flexnet: 'FlexNet',
  rlm: 'RLM',
  dsls: 'DSLS',
  sentinel: 'Sentinel',
  generic: 'Generic',
};

export interface CoverageLineRow {
  label: string;
  state: 'complete' | 'partial' | 'missing' | 'not_supplied';
  detail: string;
}

export interface CapabilityLineRow {
  label: string;
  available: boolean;
  requires: string | null;
}

export function ImportInventory({
  imports,
  coverage,
  coverageLines,
  capabilityLines,
  quality,
  ephemeral,
  serverless = false,
}: {
  imports: ImportRow[];
  coverage: CoverageRow;
  coverageLines: CoverageLineRow[];
  capabilityLines: CapabilityLineRow[];
  quality: string;
  ephemeral: boolean;
  serverless?: boolean;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remove = async (importId: string) => {
    setBusyId(importId);
    setError(null);
    try {
      const response = await fetch(`/api/ingestion/imports/${importId}`, { method: 'DELETE' });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(typeof payload.error === 'string' ? payload.error : 'The import could not be removed.');
        return;
      }
      router.refresh();
    } catch {
      setError('The import could not be removed.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Imported sources"
        description="Files EngiSignal has ingested, what they contained, and what they support."
      />

      <div className="space-y-5 px-5 py-5">
        {ephemeral && (
          <p className="rounded-md border border-warning/40 bg-warning-soft px-3.5 py-2.5 text-[12px] leading-relaxed text-warning">
            {serverless ? (
              <>
                <span className="font-medium">
                  This demo runs on serverless functions with in-memory storage, so an import will
                  usually not appear in this list.
                </span>{' '}
                Each request can be handled by a different instance, and an import written by one is
                invisible to the next. Detection, mapping, validation and the normalized preview are
                fully functional; durable storage and import history require Supabase.
              </>
            ) : (
              <>
                This environment stores imports in memory for the life of the server process. They are
                not durable and will reset on restart. Configure Supabase for persistent storage.
              </>
            )}
          </p>
        )}

        {error !== null && (
          <p role="alert" className="rounded-md border border-danger/40 bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">
            {error}
          </p>
        )}

        {imports.length === 0 ? (
          <p className="text-[13px] text-fg-muted">
            No files have been imported yet. Import a FlexNet, RLM, DSLS, Sentinel or tabular export to
            begin.
          </p>
        ) : (
          <>
            <div className="es-scroll overflow-x-auto">
              <TableShell>
                <thead>
                  <tr>
                    <Th>Source</Th>
                    <Th>File</Th>
                    <Th>Type</Th>
                    <Th>Records</Th>
                    <Th>Accepted</Th>
                    <Th>Imported</Th>
                    <Th>Quality</Th>
                    <Th>Status</Th>
                    <Th>Action</Th>
                  </tr>
                </thead>
                <tbody>
                  {imports.map((record) => (
                    <tr key={record.id}>
                      <Td className="font-medium text-fg">
                        {SOURCE_LABEL[record.sourceSystem] ?? record.sourceSystem}
                        <span className="ml-2 text-[11px] font-normal text-fg-subtle">
                          {record.detectionFellBack ? 'not identified' : `${record.detectionConfidence}%`}
                        </span>
                      </Td>
                      <Td>
                        {/* The way back to "what did you reject, and why". This
                            table is the one a customer is looking at minutes
                            after an import, before any analysis exists. */}
                        <Link
                          href={`/app/data/imports/${record.id}`}
                          className="text-accent underline underline-offset-2"
                        >
                          {record.fileName}
                        </Link>
                      </Td>
                      <Td className="text-fg-muted">File import · {record.dataset}</Td>
                      <Td className="tnum">
                        {(record.usageRecords + record.entitlementRecords + record.peopleRecords).toLocaleString('en-US')}
                      </Td>
                      <Td className="tnum text-fg-muted">
                        {record.acceptedRows.toLocaleString('en-US')} / {record.totalRows.toLocaleString('en-US')}
                      </Td>
                      <Td className="text-fg-muted">{record.uploadedAt.slice(0, 10)}</Td>
                      <Td>
                        <Badge tone={quality === 'High' ? 'positive' : quality === 'Medium' ? 'warning' : 'neutral'}>
                          {quality}
                        </Badge>
                      </Td>
                      <Td>
                        <Badge tone={record.status === 'complete' ? 'positive' : 'warning'}>
                          {record.status === 'complete' ? 'Active' : record.status}
                        </Badge>
                      </Td>
                      <Td>
                        <Button
                          size="sm"
                          disabled={busyId === record.id}
                          onClick={() => void remove(record.id)}
                        >
                          {busyId === record.id ? 'Removing…' : 'Remove'}
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="mb-2 text-[12px] font-medium text-fg">Data coverage</p>
                <ul className="space-y-1.5">
                  {coverageLines.map((row) => (
                    <li key={row.label} className="flex items-center justify-between gap-3 text-[12.5px]">
                      <span className="text-fg-muted">{row.label}</span>
                      <Badge
                        tone={
                          row.state === 'complete'
                            ? 'positive'
                            : row.state === 'partial'
                              ? 'warning'
                              : 'neutral'
                        }
                      >
                        {row.detail}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="mb-2 text-[12px] font-medium text-fg">Supported analysis</p>
                <ul className="space-y-1.5">
                  {capabilityLines.map((row) => (
                    <li key={row.label} className="flex items-start gap-2 text-[12.5px]">
                      <span
                        className={row.available ? 'text-positive' : 'text-fg-subtle'}
                        aria-hidden="true"
                      >
                        {row.available ? '✓' : '○'}
                      </span>
                      <span className={row.available ? 'text-fg' : 'text-fg-subtle'}>
                        {row.label}
                        {row.requires !== null && (
                          <span className="text-fg-subtle"> — {row.requires}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="mb-2 text-[12px] font-medium text-fg">What has been ingested</p>
                <dl className="space-y-1.5 text-[12.5px]">
                  <Row label="Distinct features" value={coverage.distinctFeatures.toLocaleString('en-US')} />
                  <Row label="Distinct users" value={coverage.distinctUsers.toLocaleString('en-US')} />
                  <Row
                    label="History"
                    value={coverage.historyDays > 0 ? `${coverage.historyDays} days` : '—'}
                  />
                  <Row
                    label="Window"
                    value={
                      coverage.firstDate !== null && coverage.lastDate !== null
                        ? `${coverage.firstDate} → ${coverage.lastDate}`
                        : '—'
                    }
                  />
                </dl>
              </div>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="tnum font-medium text-fg">{value}</dd>
    </div>
  );
}
