import { NextResponse } from 'next/server';
import { resolveIngestionContext } from '@/lib/ingestion/session';
import { getIngestionStore, isEphemeralStore } from '@/lib/ingestion/store';

export const runtime = 'nodejs';

/** Import history for the caller's organization, plus what it can support. */
export async function GET() {
  const auth = await resolveIngestionContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const store = getIngestionStore();
  const imports = await store.listImports(auth.context.organizationId);

  // ── COVERAGE IS NOT COMPUTED HERE, AND MUST NOT BE ────────────────────────
  //
  // It used to be. `getCoverage` reads every canonical row a tenant has --
  // usage, entitlements, people and contracts -- through a 1,000-row cursor,
  // and this endpoint is polled every three seconds by the import-progress
  // card while an import is running. At 466,000 rows that is roughly 470 round
  // trips, repeated every three seconds, for the entire duration of the import.
  //
  // Measured: 1,814 of those paged reads in one run, mean 1,347 ms, max
  // 7,997 ms -- against an 8-second statement timeout. It saturated the
  // database enough that OTHER pages' integrity counts were cancelled, and
  // three of 96 page reads returned 500 while the customer watched their own
  // import. The progress display was breaking the thing it was reporting on.
  //
  // Nothing consumed it: the card reads `imports` only, and the Data page gets
  // its coverage from the analysis payload.
  return NextResponse.json({
    imports,
    // Stated rather than implied: an evaluation environment must not look
    // durable when it is not.
    storage: { kind: store.kind, ephemeral: isEphemeralStore() },
  });
}
