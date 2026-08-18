'use client';

/**
 * ── WHAT A LARGE UPLOAD LOOKS LIKE WHILE IT IS HAPPENING ────────────────────
 *
 * Persistence used to finish inside the request, so there was nothing to show:
 * the response arrived and the rows were there. Now a 466,000-row import is
 * accepted in seconds and written over the following minutes, and the customer
 * is left looking at a page that does not obviously disagree with "this froze".
 *
 * The honest fix is not a spinner. A spinner asserts that something is
 * happening without knowing whether it is. This shows the checkpoint the worker
 * actually resumes from, so the number the customer watches and the number the
 * system relies on are the same one -- if it stops moving, it has genuinely
 * stopped, and the page says so rather than animating over it.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Card, CardHeader } from '@/components/ui/primitives';
import { formatNumber } from '@/lib/analytics/financial';

interface InFlightImport {
  id: string;
  fileName: string;
  status: string;
  acceptedRows: number;
  rowsPersisted: number;
  attempt: number;
  failureReason: string | null;
}

/** States in which nothing further will happen without a new import. */
const TERMINAL = new Set(['complete', 'failed']);

function describe(record: InFlightImport): { label: string; tone: 'positive' | 'warning' | 'neutral'; detail: string } {
  if (record.status === 'failed') {
    return {
      label: 'Failed',
      tone: 'warning',
      detail:
        record.failureReason ??
        'This import stopped and did not finish. Nothing partial has been included in your analysis.',
    };
  }
  if (record.status === 'queued') {
    return {
      label: record.attempt > 0 ? 'Retrying' : 'Queued',
      tone: 'neutral',
      detail:
        record.attempt > 0
          ? `Attempt ${record.attempt + 1}. The previous attempt stopped before finishing and the import was returned to the queue.`
          : 'Your file is stored. Writing begins within a minute, and continues whether or not this page stays open.',
    };
  }
  if (record.status === 'importing') {
    return {
      label: 'Writing rows',
      tone: 'neutral',
      detail: 'You can close this page. The import continues without it.',
    };
  }
  return { label: record.status, tone: 'neutral', detail: '' };
}

export function ImportProgress() {
  const router = useRouter();
  const [inFlight, setInFlight] = useState<InFlightImport[] | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [resuming, setResuming] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);

  /**
   * Renews the worker's access to the uploaded file and requeues.
   *
   * The signed URL the worker reads through lasts a day, so an import left
   * failed for longer than that cannot be retried until it is renewed. The
   * file never went anywhere; only permission to read it lapsed.
   */
  const resume = useCallback(
    async (id: string) => {
      setResuming(id);
      setResumeError(null);
      try {
        const response = await fetch(`/api/ingestion/imports/${encodeURIComponent(id)}/resume`, {
          method: 'POST',
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          setResumeError(body.error ?? 'This import could not be resumed.');
          return;
        }
        router.refresh();
      } catch {
        setResumeError('The server could not be reached. Nothing has changed.');
      } finally {
        setResuming(null);
      }
    },
    [router],
  );

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Tracks whether anything was moving last time, so the page can be
    // refreshed exactly once when the last import lands rather than on a loop.
    let sawWork = false;

    async function poll() {
      try {
        const response = await fetch('/api/ingestion/imports', { cache: 'no-store' });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { imports: InFlightImport[] };
        if (cancelled) return;

        setUnreachable(false);
        const active = (body.imports ?? []).filter((record) => !TERMINAL.has(record.status));
        const failed = (body.imports ?? []).filter((record) => record.status === 'failed');
        setInFlight([...active, ...failed]);

        if (active.length > 0) {
          sawWork = true;
          timer = setTimeout(poll, 3000);
        } else if (sawWork) {
          // The last import finished. Re-render the server components so the
          // analysis built from it replaces the empty state.
          sawWork = false;
          router.refresh();
        }
      } catch {
        if (cancelled) return;
        // Losing the connection is not evidence that the import stopped -- it
        // runs in the database's schedule, not in this tab -- so say exactly
        // that instead of reporting a failure that has not happened.
        setUnreachable(true);
        timer = setTimeout(poll, 5000);
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [router]);

  if (inFlight === null || inFlight.length === 0) return null;

  return (
    <Card>
      <CardHeader
        title="Imports in progress"
        description="Rows are written by a background worker. Closing this page does not stop it."
      />
      {resumeError !== null && (
        <p className="mb-3 text-[12px] text-warning">{resumeError}</p>
      )}
      {unreachable && (
        <p className="mb-3 text-[12px] text-warning">
          This page cannot reach the server right now, so the figures below may be out of date. The
          import itself is unaffected.
        </p>
      )}
      <ul className="flex flex-col gap-4">
        {inFlight.map((record) => {
          const { label, tone, detail } = describe(record);
          const percent =
            record.acceptedRows > 0
              ? Math.min(100, Math.round((record.rowsPersisted / record.acceptedRows) * 100))
              : 0;

          return (
            <li key={record.id} className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-[12.5px] font-medium">{record.fileName}</span>
                <Badge tone={tone}>{label}</Badge>
              </div>

              {record.status !== 'failed' && (
                <>
                  <div
                    className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={record.acceptedRows}
                    aria-valuenow={record.rowsPersisted}
                    aria-label={`${record.fileName} rows written`}
                  >
                    <div
                      className="h-full rounded-full bg-accent transition-[width] duration-500"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <p className="text-[11.5px] tabular-nums text-fg-muted">
                    {formatNumber(record.rowsPersisted)} of {formatNumber(record.acceptedRows)} rows
                    written
                    {record.attempt > 1 && ` · attempt ${record.attempt}`}
                  </p>
                </>
              )}

              {detail !== '' && <p className="text-[11.5px] text-fg-muted">{detail}</p>}

              {record.status === 'failed' && (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void resume(record.id)}
                    disabled={resuming === record.id}
                    className="rounded-md border border-border px-2.5 py-1 text-[11.5px] font-medium hover:bg-surface-3 disabled:opacity-60"
                  >
                    {resuming === record.id ? 'Resuming…' : 'Resume import'}
                  </button>
                  <span className="text-[11px] text-fg-muted">
                    Continues from {formatNumber(record.rowsPersisted)} rows already written.
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
