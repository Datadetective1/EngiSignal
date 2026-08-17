import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveIngestionContext } from '@/lib/ingestion/session';
import { getIngestionStore } from '@/lib/ingestion/store';
import { getDataProvider } from '@/lib/data';

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
  try {
    await getIngestionStore().clearProjection(auth.context.organizationId);
    await getDataProvider().getDatasetWithProjection(auth.context.organizationId);
  } catch {
    // A projection that could not be rebuilt is a slow next page. The delete
    // itself has already succeeded and the rows are gone.
  }

  return NextResponse.json({ deleted: true, importId: parsed.data.importId });
}
