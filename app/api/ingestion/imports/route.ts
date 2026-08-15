import { NextResponse } from 'next/server';
import { resolveIngestionContext } from '@/lib/ingestion/session';
import { getIngestionStore, isEphemeralStore } from '@/lib/ingestion/store';

export const runtime = 'nodejs';

/** Import history for the caller's organization, plus what it can support. */
export async function GET() {
  const auth = await resolveIngestionContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const store = getIngestionStore();
  const [imports, coverage] = await Promise.all([
    store.listImports(auth.context.organizationId),
    store.getCoverage(auth.context.organizationId),
  ]);

  return NextResponse.json({
    imports,
    coverage,
    // Stated rather than implied: an evaluation environment must not look
    // durable when it is not.
    storage: { kind: store.kind, ephemeral: isEphemeralStore() },
  });
}
