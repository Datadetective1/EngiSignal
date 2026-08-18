import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveIngestionContext } from '@/lib/ingestion/session';
import { getIngestionStore } from '@/lib/ingestion/store';
import { markOwnProjectionDirty } from '@/lib/data/supabase-provider';

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

  // Deleting an import changes every derived number that rested on its rows,
  // so the analysis is owed again. Saying exactly that -- and nothing about
  // when or by whom it is rebuilt -- is the whole of the application's part in
  // this. The worker owns the lifecycle; it already owns it for imports that
  // complete, and having deletion start its own build was the second writer
  // this phase set out to remove.
  //
  // Best effort. If it fails the evidence key no longer matches what is stored,
  // so a reader is told the analysis is not current, and the next change marks
  // the tenant again. The customer is never shown a stale number as a fresh one.
  try {
    await markOwnProjectionDirty(auth.context.organizationId);
  } catch {
    // Recorded by the reader as "not current" either way.
  }

  return NextResponse.json({ deleted: true, importId: parsed.data.importId });
}
