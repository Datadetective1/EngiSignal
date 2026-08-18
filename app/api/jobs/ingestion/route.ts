/**
 * ── THE WORKER ENDPOINT ─────────────────────────────────────────────────────
 *
 * Driven by pg_cron inside Postgres, which is the point: the schedule does not
 * live in a browser, a request, or `after()`. It fires whether or not anyone is
 * signed in, whether or not the tab that started the import is still open, and
 * whether or not the invocation that last worked on a job still exists.
 *
 * One call does as much of one import as it can in its budget and then says
 * whether there is more. When there is, it wakes a successor immediately rather
 * than waiting for the next tick -- the tick is the safety net, not the
 * mechanism. If the successor never arrives, the lease expires and the next
 * tick reclaims the job, which is the same path a crash takes.
 *
 * It connects as `ingestion_worker`, a database role with EXECUTE on six
 * functions and no privilege over any table, and refuses to do anything at all
 * until it has confirmed that is who it is.
 */

import { NextResponse } from 'next/server';
import { after } from 'next/server';
import {
  assertLeastPrivilege,
  isScheduler,
  openWorkerConnection,
  workerConfigured,
} from '@/lib/ingestion/job/worker-db';
import { pgRpc } from '@/lib/ingestion/job/worker-rpc';
import { runIngestionJob } from '@/lib/ingestion/job/runner';
import { runProjectionJob } from '@/lib/analytics/projection-job';
import type { ClaimedJob } from '@/lib/ingestion/job/runner';
import { ingestFile } from '@/lib/ingestion';
import { envOptional } from '@/config/env';
import { originOf } from '@/lib/http/origin';
import { stopwatch } from '@/lib/perf/stopwatch';

// Comfortably above the runner's 40s budget, so it yields on its own terms
// rather than being killed part way through a slice.
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  if (!isScheduler(request.headers.get('authorization'))) {
    // Deliberately indistinguishable from a missing route: an unauthenticated
    // caller learns nothing about whether this endpoint exists.
    return new NextResponse('Not found', { status: 404 });
  }

  const sql = openWorkerConnection();
  if (sql === null) {
    return NextResponse.json(
      { error: 'No worker identity is configured, so no import can be processed.' },
      { status: 503 },
    );
  }

  const watch = stopwatch();

  try {
    // Before touching a customer's data, prove the connection is the narrow
    // role and not something that merely happened to authenticate.
    await watch.phase('identity', () => assertLeastPrivilege(sql));

    const outcome = await watch.phase('job', () =>
      runIngestionJob({
        rpc: pgRpc(sql),

        // No storage credential: the URL was minted by the request that
        // accepted the upload, and covers exactly this one object.
        download: async (job: ClaimedJob) => {
          if (job.sourceUrl === null) {
            throw new Error('This import has no readable copy of its uploaded file.');
          }
          const response = await fetch(job.sourceUrl);
          if (!response.ok) {
            // A lapsed signed URL is a recoverable condition, not a lost
            // import: the file is still there and only permission to read it
            // expired. Named explicitly so the customer is offered the fix
            // rather than shown a transport error they cannot act on.
            if (response.status === 400 || response.status === 401 || response.status === 403) {
              throw new Error(
                'Access to the uploaded file has expired. The file is still stored — resume this import to renew access and continue from where it stopped.',
              );
            }
            throw new Error(
              `Could not read the uploaded file (HTTP ${response.status}). The stored copy may have been removed.`,
            );
          }
          return response.arrayBuffer();
        },

        // Re-parsed with the options recorded when the file was accepted, so
        // the worker reproduces the customer's reviewed mapping rather than
        // guessing at it again.
        parse: async (bytes, job: ClaimedJob) => {
          const options = job.parseOptions as {
            forceSource?: string;
            mappingOverrides?: Record<string, string>;
            sheetName?: string;
            dayFirst?: boolean;
          };
          const analysis = await ingestFile(bytes, {
            dataset: job.dataset,
            organizationId: job.organizationId,
            importId: job.importId,
            fileName: job.fileName,
            forceSource: options.forceSource as never,
            mappingOverrides: options.mappingOverrides,
            sheetName: options.sheetName,
            dayFirst: options.dayFirst,
          });
          return analysis.result as never;
        },
      }),
    );

    // ── THE ANALYSIS IS PART OF THE SAME JOB ──────────────────────────────
    //
    // Persistence and analysis are one promise to the customer: the numbers are
    // current. Splitting them across two schedulers would mean a tenant whose
    // rows are durable but whose analysis is owed depends on the next tick
    // noticing, which is the coupling this phase exists to remove.
    //
    // Run when ingestion has nothing left to do, so rows land before the
    // analysis that describes them, and a long build never starves the queue.
    let projection: Awaited<ReturnType<typeof runProjectionJob>> | null = null;
    if (outcome.status === 'idle') {
      projection = await watch.phase('projection', () => runProjectionJob(sql));
    }

    // ── KEEP GOING WHILE THERE IS PROGRESS TO MAKE ────────────────────────
    //
    // One invocation handles one job, so without this a four-file estate takes
    // four ticks and a seven-part one takes seven minutes -- almost all of it
    // spent waiting rather than working. Measured: a 67,267-row import
    // completed in about two seconds of work after thirty seconds of waiting
    // for the next tick.
    //
    // Chaining is limited to the two outcomes that represent forward progress.
    // `yielded` means this job has more to do; `complete` means it is done and
    // the queue may hold another. Both terminate -- each hop either finishes a
    // job or advances a checkpoint, and `idle` ends the chain. Chaining on
    // `failed` or `superseded` would spin on a job that is not moving.
    const moreToDo =
      outcome.status === 'yielded' ||
      outcome.status === 'complete' ||
      projection?.status === 'ready';
    if (moreToDo) {
      const site = originOf(request);
      const secret = envOptional('CRON_SECRET');
      if (site !== null && secret !== null) {
        after(async () => {
          try {
            await fetch(`${site}/api/jobs/ingestion`, {
              method: 'POST',
              headers: { authorization: `Bearer ${secret}` },
            });
          } catch {
            // The schedule is the backstop; a missed handoff costs one tick.
          }
        });
      }
    }

    return NextResponse.json({
      outcome,
      projection,
      timings: { totalMs: watch.totalMs(), phases: watch.phases() },
    });
  } finally {
    // Transaction-mode pooling gives out a backend per transaction, so holding
    // this open past the invocation would consume a slot for nothing.
    await sql.end({ timeout: 5 });
  }
}

/**
 * Readable without the secret, on purpose.
 *
 * Whether the queue is being drained is operational health, not customer data,
 * and it answers the only question that matters when imports look stuck: is
 * anything running at all. It names no tenant, no file and no row, and reports
 * only whether configuration is present -- never any part of its value.
 */
export async function GET(request: Request): Promise<NextResponse> {
  return NextResponse.json({
    worker: workerConfigured() ? 'configured' : 'not-configured',
    schedulerSecret: envOptional('CRON_SECRET') !== null ? 'configured' : 'not-configured',
    // The origin a finishing worker calls to wake its successor. Absent, every
    // job waits for the next scheduled tick instead of chaining -- which looks
    // like slowness rather than misconfiguration, so it is reported.
    wakeOrigin: originOf(request),
  });
}
