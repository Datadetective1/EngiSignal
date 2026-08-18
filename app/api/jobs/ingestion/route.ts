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
 */

import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { isScheduler, workerClient } from '@/lib/supabase/worker';
import { runIngestionJob } from '@/lib/ingestion/job/runner';
import type { ClaimedJob } from '@/lib/ingestion/job/runner';
import { ingestFile } from '@/lib/ingestion';
import { envOptional } from '@/config/env';
import { stopwatch } from '@/lib/perf/stopwatch';

// Comfortably above the runner's 40s budget, so it yields on its own terms
// rather than being killed part way through a slice.
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const BUCKET = 'ingestion-sources';

export async function POST(request: Request): Promise<NextResponse> {
  if (!isScheduler(request.headers.get('authorization'))) {
    // Deliberately indistinguishable from a missing route: an unauthenticated
    // caller learns nothing about whether this endpoint exists.
    return new NextResponse('Not found', { status: 404 });
  }

  const client = workerClient();
  if (client === null) {
    return NextResponse.json(
      { error: 'No worker identity is configured, so no import can be processed.' },
      { status: 503 },
    );
  }

  const watch = stopwatch();

  const outcome = await watch.phase('job', () =>
    runIngestionJob({
      rpc: async (name, params) => client.rpc(name, params),

      download: async (path) => {
        const { data, error } = await client.storage.from(BUCKET).download(path);
        if (error !== null || data === null) {
          throw new Error(`Could not read the uploaded file: ${error?.message ?? 'missing'}`);
        }
        return data.arrayBuffer();
      },

      // Re-parsed with the options recorded when the file was accepted, so the
      // worker reproduces the customer's reviewed mapping rather than guessing
      // at it again.
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

  // Keep going without waiting for the next tick. Only on `yielded`: every
  // other outcome is terminal for this job, and chaining on them would spin.
  if (outcome.status === 'yielded') {
    const site = envOptional('NEXT_PUBLIC_SITE_URL');
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
    timings: { totalMs: watch.totalMs(), phases: watch.phases() },
  });
}

/**
 * Readable without the secret, on purpose.
 *
 * Whether the queue is being drained is operational health, not customer data,
 * and it answers the only question that matters when imports look stuck: is
 * anything running at all. It reveals no tenant, no file and no row.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    worker: workerClient() !== null ? 'configured' : 'not-configured',
    schedulerSecret: envOptional('CRON_SECRET') !== null ? 'configured' : 'not-configured',
  });
}
