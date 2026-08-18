import 'server-only';
import {
  BUILD_LEASE_SECONDS,
  PROJECTION_VERSION,
  serializeDataset,
  type ProjectionPayload,
} from './projection';
import type { StoredRowCounts } from './integrity';

/**
 * ── RUNNING A BUILD OUT OF BAND ──────────────────────────────────────────────
 *
 * Phase 2E moved the analytical computation off the read path and onto the
 * import that caused it. Measured in production, that import then took 21.9
 * seconds at 282k rows, inside the HTTP request that accepted the upload — and
 * that number grows with the estate while the function timeout does not.
 *
 * So the request now returns as soon as the canonical rows are DURABLE, and the
 * build runs after the response. Nothing about the analysis changed; what
 * changed is who waits for it.
 *
 * WHY THERE IS NO SEPARATE WORKER SERVICE
 *
 * The smallest thing that works here is `after()`: the same invocation
 * continues past the response, on the same platform, with the same deployment,
 * and — the part that matters most — with THE CALLER'S OWN SESSION. The build
 * therefore runs with exactly the permissions of the person who imported, under
 * the same Row Level Security as every other statement in the product. A
 * separate worker would have needed a service-role key, which is a standing
 * capability to read every tenant's data, introduced to solve a latency
 * problem. That trade is not worth making.
 *
 * The cost of that choice is honest and stated: `after()` is best-effort. If
 * the platform kills the invocation the build does not finish. That is why the
 * claim carries a lease and a heartbeat, and why any later request that finds
 * an expired claim may take it over. Nothing waits for a human to notice.
 *
 * WHAT MAKES A DUPLICATE RUN SAFE
 *
 * Every build must claim before it works, and the claim is a single conditional
 * UPDATE in the database, so two callers cannot both hold it. A build may only
 * publish while it still holds its token AND while the evidence it built is
 * still the evidence being built. A superseded worker finishing late writes
 * nothing.
 */

/** Records how long a named stage of the build took. */
export type PhaseRecorder = (name: string, ms: number, detail?: Record<string, number>) => void;

/** The narrow slice of the Supabase client this needs. */
export interface BuildClient {
  rpc(name: string, params: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export interface BuildDeps {
  client: BuildClient;
  organizationId: string;
  evidenceKey: string;
  /**
   * Builds the payload from canonical rows. The slow part.
   *
   * Given a recorder so it can report where its own time went. A build that
   * reports only a total cannot be optimised without guessing, and guessing
   * about where time goes has been wrong every time it has been tried here.
   */
  build: (onPhase: PhaseRecorder) => Promise<ProjectionPayload>;
  /** Exact counts, re-read after the build to prove nothing moved underneath it. */
  countStoredRows: () => Promise<StoredRowCounts>;
  /** Injectable for tests. */
  now?: () => number;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
}

export type BuildOutcome =
  /** Somebody else holds a live claim. Not an error. */
  | { status: 'not-claimed' }
  | { status: 'ready'; buildMs: number; payloadBytes: number }
  /** Finished, but a newer build had already taken the claim. Nothing written. */
  | { status: 'superseded' }
  /** Built, but analysed rows did not equal stored rows. Never published. */
  | { status: 'integrity-failed' }
  | { status: 'failed'; error: string };

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Claim, build, publish.
 *
 * Returns rather than throws for every outcome a caller can do nothing about —
 * losing a race is normal, and an exception would turn it into noise in the
 * logs of an otherwise healthy system.
 */
export async function runProjectionBuild(deps: BuildDeps): Promise<BuildOutcome> {
  const { client, organizationId, evidenceKey } = deps;
  const startInterval = deps.setInterval ?? setInterval;
  const stopInterval = deps.clearInterval ?? clearInterval;
  const now = deps.now ?? Date.now;

  const claim = await client.rpc('claim_projection_build', {
    org: organizationId,
    target_evidence_key: evidenceKey,
    lease_seconds: BUILD_LEASE_SECONDS,
  });
  if (claim.error !== null) return { status: 'failed', error: claim.error.message };

  const token = typeof claim.data === 'string' ? claim.data : null;
  // Null is the ordinary "somebody else is already building this" answer.
  if (token === null) return { status: 'not-claimed' };

  // Say we are alive at a third of the lease, so a slow build is never mistaken
  // for a dead one and reclaimed while it is still working.
  const heartbeat = startInterval(
    () => {
      void client.rpc('heartbeat_projection_build', { org: organizationId, token });
    },
    Math.floor((BUILD_LEASE_SECONDS * 1000) / 3),
  );

  const startedAt = now();
  const phases: Record<string, { ms: number; detail?: Record<string, number> }> = {};
  const record: PhaseRecorder = (name, ms, detail) => {
    phases[name] = { ms: Math.round(ms), detail };
  };

  try {
    const payload = await deps.build(record);

    // Re-read the counts AFTER building. If the estate moved while we worked,
    // this is what catches it: the analysis describes rows that are no longer
    // what is stored, and it must not be published as current.
    const countFrom = now();
    const storedRows = await deps.countStoredRows();
    record('countStoredRows', now() - countFrom);

    const serializeFrom = now();
    const serialized = serializeDataset(payload);
    record('serialize', now() - serializeFrom, { bytes: serialized.bytes });

    const buildMs = now() - startedAt;

    const published = await client.rpc('publish_projection_build', {
      org: organizationId,
      token,
      built_evidence_key: evidenceKey,
      new_payload: serialized.payload,
      new_payload_bytes: serialized.bytes,
      new_version: PROJECTION_VERSION,
      new_stored_rows: storedRows,
      new_analyzed_rows: payload.dataset.analyzedRows,
      build_ms: buildMs,
      new_build_phases: phases,
    });

    if (published.error !== null) {
      await client.rpc('fail_projection_build', {
        org: organizationId,
        token,
        reason: published.error.message,
      });
      return { status: 'failed', error: published.error.message };
    }

    if (published.data === 'integrity_failed') return { status: 'integrity-failed' };
    if (published.data === 'superseded') return { status: 'superseded' };
    return { status: 'ready', buildMs, payloadBytes: serialized.bytes };
  } catch (error) {
    // A failure has to be recorded, or the tenant sits at `building` until the
    // lease expires with nothing anywhere saying what went wrong.
    await client.rpc('fail_projection_build', {
      org: organizationId,
      token,
      reason: message(error),
    });
    return { status: 'failed', error: message(error) };
  } finally {
    stopInterval(heartbeat);
  }
}
