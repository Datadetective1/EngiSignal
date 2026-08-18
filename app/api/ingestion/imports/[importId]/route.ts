import { NextResponse, after } from 'next/server';
import { z } from 'zod';
import { resolveIngestionContext } from '@/lib/ingestion/session';
import { getIngestionStore } from '@/lib/ingestion/store';
import { startProjectionBuild } from '@/lib/data/supabase-provider';
import { detachedUserClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

/**
 * Inspect or reverse a single import.
 *
 * Both operations are scoped by organization as well as by id. An import id is
 * never sufficient on its own to reach a record: a caller who guesses another
 * tenant's id gets 404, and cannot distinguish that from an id that does not
 * exist.
 */

const paramsSchema = z.object({ importId: z.string().uuid() });

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ importId: string }> },
) {
  const auth = await resolveIngestionContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const detail = await getIngestionStore().getImport(
    auth.context.organizationId,
    parsed.data.importId,
  );

  if (detail === null) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  return NextResponse.json({ import: detail });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ importId: string }> },
) {
  const auth = await resolveIngestionContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const removed = await getIngestionStore().deleteImport(
    auth.context.organizationId,
    parsed.data.importId,
  );

  if (!removed) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  // Deleting an import changes every derived number that rested on its rows.
  // Drop the projection before answering, so no reader can be served a summary
  // of an estate that no longer exists, then rebuild so the cost lands here
  // rather than on the next person to open the dashboard.
  //
  // The read path would catch this anyway — the evidence key no longer matches
  // once the rows are gone — but relying on that alone would mean the guarantee
  // rests on one mechanism instead of two.
  // The rows are gone, which is what the caller asked for and is now true. The
  // analysis that rested on them is rebuilt after the response, exactly as it
  // is after an import — the read path would notice the evidence key had moved
  // anyway, so this only decides who waits, not whether it happens.
  // Captured while the request is still alive: after the response there is no
  // cookie store to read a session from, and a client built then would have no
  // permissions at all.
  const detached = await detachedUserClient();
  if (detached !== null) {
    after(async () => {
      try {
        await startProjectionBuild(auth.context.organizationId, undefined, detached);
      } catch {
        // The runner records its own failures against the tenant.
      }
    });
  }

  return NextResponse.json({ deleted: true, importId: parsed.data.importId });
}
