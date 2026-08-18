/**
 * Renew a stalled import's access to its own file and return it to the queue.
 *
 * The worker reads uploads through a short-lived signed URL, because a bearer
 * capability to a customer's file should expire. The cost of that choice is
 * this route: if an import fails and then sits failed for longer than the URL
 * lives, the file is still there and the import is still recoverable, but the
 * permission to read it is gone.
 *
 * Nothing here is privileged. It runs as the signed-in customer, so Row Level
 * Security decides which imports exist -- an id belonging to another tenant is
 * not found rather than refused, which is also what stops this being an
 * enumeration oracle.
 */

import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { resolveIngestionContext } from '@/lib/ingestion/session';
import { getIngestionStore } from '@/lib/ingestion/store';
import { decodeRouteId } from '@/lib/routes';
import { envOptional } from '@/config/env';

export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  context: { params: Promise<{ importId: string }> },
): Promise<NextResponse> {
  const auth = await resolveIngestionContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { importId } = await context.params;
  const outcome = await getIngestionStore().resumeImport(
    auth.context.organizationId,
    decodeRouteId(importId),
  );

  if (outcome.status === 'not-found') {
    return NextResponse.json({ error: 'That import could not be found.' }, { status: 404 });
  }
  if (outcome.status === 'not-resumable') {
    return NextResponse.json({ error: outcome.reason }, { status: 409 });
  }

  // The scheduler would find it within a minute anyway; this only removes the
  // wait. Failure here costs one tick and nothing else.
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
        // The schedule is the mechanism. This is only impatience.
      }
    });
  }

  return NextResponse.json({ status: 'queued' });
}
