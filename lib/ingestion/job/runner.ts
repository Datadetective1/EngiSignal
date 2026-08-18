/**
 * ── THE WORKER ──────────────────────────────────────────────────────────────
 *
 * One invocation of this does as much of one import as it safely can, then
 * stops and says whether there is more. It assumes it will be interrupted,
 * because it will be: the platform bounds how long any invocation may run, a
 * deploy replaces the process, and a crash takes it with no warning at all.
 *
 * Everything here follows from that assumption.
 *
 *   It re-reads the customer's file rather than trusting anything in memory,
 *   because the process that parsed it originally is long gone.
 *
 *   It writes in slices and lets the database move the checkpoint in the same
 *   statement, so the recorded position is never ahead of the rows.
 *
 *   It stops on its own before the platform stops it, because a slice killed
 *   mid-flight costs a retry, while a clean yield costs nothing.
 *
 *   It never decides that an import is finished. It asks, and the database
 *   counts the rows before agreeing.
 */

import type { CanonicalDataset } from '../canonical/types';
import { rowsForDataset } from '../store/row-shape';

export interface ClaimedJob {
  importId: string;
  organizationId: string;
  dataset: CanonicalDataset;
  fileName: string;
  sourcePath: string;
  rowsPersisted: number;
  acceptedRows: number;
  /** Exactly the options the accepting request parsed with. */
  parseOptions: Record<string, unknown>;
  token: string;
  attempt: number;
}

/** What one invocation did. Reported, never inferred. */
export type JobOutcome =
  | { status: 'idle' }
  | { status: 'complete'; importId: string; rowsPersisted: number; sliceCount: number }
  | { status: 'yielded'; importId: string; rowsPersisted: number; sliceCount: number }
  | { status: 'superseded'; importId: string }
  | { status: 'integrity-failed'; importId: string; reason: string }
  | { status: 'failed'; importId: string; reason: string };

export interface RunnerDeps {
  /** Calls the six functions the worker role may execute. */
  rpc: (name: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  /** Fetches the stored upload. */
  download: (path: string) => Promise<ArrayBuffer>;
  /** Re-parses it exactly as the accepting request did. */
  parse: (
    bytes: ArrayBuffer,
    job: ClaimedJob,
  ) => Promise<{
    usage: never[];
    entitlements: never[];
    people: never[];
    contracts: never[];
  }>;
  now?: () => number;
  /** Rows per slice. */
  sliceSize?: number;
  /** Stop and yield once this much of the invocation is spent. */
  budgetMs?: number;
  leaseSeconds?: number;
}

export const SLICE_SIZE = 500;
export const LEASE_SECONDS = 60;
/**
 * How long an invocation works before yielding.
 *
 * Comfortably inside the platform's limit. Yielding early is cheap -- the
 * checkpoint is durable and another invocation continues from it -- while being
 * killed mid-slice costs an attempt and re-sends work.
 */
export const BUDGET_MS = 40_000;

/** The claim returns a single row shaped by the function's RETURNS TABLE. */
function toJob(row: Record<string, unknown>): ClaimedJob {
  return {
    importId: String(row.import_id),
    organizationId: String(row.organization_id),
    dataset: row.dataset as CanonicalDataset,
    fileName: String(row.file_name),
    sourcePath: String(row.source_path),
    rowsPersisted: Number(row.rows_persisted ?? 0),
    acceptedRows: Number(row.accepted_rows ?? 0),
    parseOptions:
      row.parse_options !== null && typeof row.parse_options === 'object'
        ? (row.parse_options as Record<string, unknown>)
        : {},
    token: String(row.token),
    attempt: Number(row.attempt ?? 0),
  };
}

export async function runIngestionJob(deps: RunnerDeps): Promise<JobOutcome> {
  const now = deps.now ?? (() => Date.now());
  const sliceSize = deps.sliceSize ?? SLICE_SIZE;
  const budgetMs = deps.budgetMs ?? BUDGET_MS;
  const leaseSeconds = deps.leaseSeconds ?? LEASE_SECONDS;
  const startedAt = now();

  const claimed = await deps.rpc('claim_import_job', { lease_seconds: leaseSeconds });
  if (claimed.error !== null) throw new Error(`Could not claim a job: ${claimed.error.message}`);

  const rows = Array.isArray(claimed.data) ? (claimed.data as Record<string, unknown>[]) : [];
  if (rows.length === 0) return { status: 'idle' };

  const job = toJob(rows[0]!);

  try {
    const bytes = await deps.download(job.sourcePath);
    const parsed = await deps.parse(bytes, job);
    const all = rowsForDataset(job.dataset, parsed);

    // ── THE FILE MUST STILL SAY WHAT IT SAID ────────────────────────────────
    //
    // The accepting request counted these rows and promised that number to the
    // customer. If re-parsing the same bytes produces a different count then
    // something between the two is not deterministic, and continuing would
    // store a quantity nobody ever agreed to. Refuse instead: a failed import
    // with a reason is recoverable, a silently different one is not.
    if (all.length !== job.acceptedRows) {
      const reason =
        `Re-reading ${job.fileName} produced ${all.length} rows, but ${job.acceptedRows} ` +
        `were accepted when it was uploaded. Refusing to store a different quantity.`;
      await deps.rpc('fail_import_job', { job: job.importId, token: job.token, reason });
      return { status: 'integrity-failed', importId: job.importId, reason };
    }

    let cursor = job.rowsPersisted;
    let sliceCount = 0;

    while (cursor < all.length) {
      // Yield before the platform takes the decision away. The checkpoint is
      // durable, so stopping here costs nothing but a scheduling round trip.
      if (now() - startedAt > budgetMs) {
        return { status: 'yielded', importId: job.importId, rowsPersisted: cursor, sliceCount };
      }

      const slice = all.slice(cursor, cursor + sliceSize);
      const written = await deps.rpc('persist_import_slice', {
        job: job.importId,
        token: job.token,
        rows: slice,
        expected_from: cursor,
      });
      if (written.error !== null) throw new Error(written.error.message);

      const mark = Number(written.data);
      // -1: the claim is gone -- the lease expired or another worker has it.
      // -2: the checkpoint moved under us, so this slice was computed against a
      // job state that no longer exists. Both mean: stop, and do not write.
      if (mark === -1 || mark === -2) {
        return { status: 'superseded', importId: job.importId };
      }

      cursor = mark;
      sliceCount += 1;
    }

    const finished = await deps.rpc('complete_import_job', {
      job: job.importId,
      token: job.token,
    });
    if (finished.error !== null) throw new Error(finished.error.message);

    if (finished.data === 'integrity_failed') {
      return {
        status: 'integrity-failed',
        importId: job.importId,
        reason: 'Stored rows did not match accepted rows.',
      };
    }
    if (finished.data === 'superseded') return { status: 'superseded', importId: job.importId };

    return { status: 'complete', importId: job.importId, rowsPersisted: cursor, sliceCount };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'The import could not be persisted.';
    // Recorded against the job so the customer sees why, and so the attempt
    // counter decides whether it is retried or given up on. Best effort: if
    // this call fails too, the lease still expires and the job is reclaimed.
    await deps
      .rpc('fail_import_job', { job: job.importId, token: job.token, reason })
      .catch(() => undefined);
    return { status: 'failed', importId: job.importId, reason };
  }
}
