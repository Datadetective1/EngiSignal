/**
 * ── BUILDING THE ANALYSIS WHERE NOBODY IS WATCHING ──────────────────────────
 *
 * The projection had a claim, a lease and a heartbeat since Phase 2F, and no
 * scheduler. It was started by whoever happened to render a page, so a customer
 * who imported a large estate and closed the tab had durable rows and no
 * analysis until somebody looked. This puts it on the same durable job
 * infrastructure ingestion already uses, and reuses the claim it already had
 * rather than inventing a second mechanism beside it.
 *
 * WHY THIS IS FASTER, AND WHY THAT IS A CONSEQUENCE RATHER THAN THE POINT
 *
 * Measured in production at 281,995 usage rows, the old build took 26,419 ms:
 *
 *   read:usage   24,356 ms   92.2%
 *   compute       1,867 ms    7.1%
 *   serialize       128 ms    0.5%
 *
 * Reading the rows was almost the whole thing -- 282 cursor pages at about
 * 86 ms each, which is the same pathology ingestion had. The worker holds a
 * direct connection, so it reads them in one statement. The point of moving the
 * build was that it should not depend on a reader; the collapse of that 24
 * seconds is what the move happens to make possible.
 *
 * WHAT AUTHORIZES IT
 *
 * The worker names no tenant anywhere. It asks what needs building, is given a
 * token, and every read is scoped by that token. Its reach is the claim it
 * currently holds rather than a standing grant, and it holds no privilege over
 * any table.
 */

import 'server-only';
import type { WorkerSql } from '@/lib/ingestion/job/worker-db';
import type { AnalyticsDataset } from '@/lib/domain/dataset';
import type { Organization } from '@/lib/domain/types';
import {
  asTimestampString,
  toContractRecord,
  toEntitlementRecord,
  toPersonRecord,
  toUsageRecord,
} from '@/lib/ingestion/store/row-read';
import { summarizeCoverage } from '@/lib/ingestion/store/types';
import { buildDatasetFromCanonical } from '@/lib/ingestion/dataset';
import { resolveUsers } from '@/lib/ingestion/identity';
import { aliasMapsFrom, rowToConfirmation } from '@/lib/ingestion/confirmations';
import {
  PROJECTION_VERSION,
  evidenceKeyFor,
  serializeDataset,
  type ProjectionPayload,
} from './projection';

export const PROJECTION_LEASE_SECONDS = 90;

export type ProjectionJobOutcome =
  /** Nothing owed, or nothing owed that is ready to be built yet. */
  | { status: 'idle'; imminent?: boolean }
  | { status: 'ready'; organizationId: string; buildMs: number; payloadBytes: number; usageRows: number }
  | { status: 'superseded'; organizationId: string }
  | { status: 'integrity-failed'; organizationId: string }
  | { status: 'failed'; organizationId: string; reason: string };

interface ClaimedProjection {
  organization_id: string;
  organization_name: string;
  token: string;
  attempt: number;
}

/** Runs one projection build, if one is owed. */
export async function runProjectionJob(sql: WorkerSql): Promise<ProjectionJobOutcome> {
  const claimed = await sql<ClaimedProjection[]>`
    select * from public.claim_projection_job(${PROJECTION_LEASE_SECONDS}::integer)
  `;
  const job = claimed[0];
  if (job === undefined) {
    // Nothing claimable. That is not the same as nothing to do: a tenant whose
    // last import landed seconds ago is deliberately left to settle, and
    // returning plain `idle` would send the worker away for a whole tick.
    const [pending] = await sql<{ projection_work_imminent: boolean }[]>`
      select public.projection_work_imminent() as projection_work_imminent
    `;
    return { status: 'idle', imminent: pending?.projection_work_imminent === true };
  }

  const token = job.token;
  const phases: Record<string, { ms: number; detail?: Record<string, number> }> = {};
  const time = async <T>(name: string, work: () => Promise<T>, size?: (v: T) => number) => {
    const from = performance.now();
    const value = await work();
    phases[name] = {
      ms: Math.round(performance.now() - from),
      detail: size ? { rows: size(value) } : undefined,
    };
    return value;
  };

  // Say we are alive at a third of the lease, so a slow build is never mistaken
  // for a dead one and reclaimed while it is still working.
  const heartbeat = setInterval(() => {
    void sql`select public.heartbeat_projection_job(${token}::uuid)`.catch(() => undefined);
  }, Math.floor((PROJECTION_LEASE_SECONDS * 1000) / 3));

  const startedAt = performance.now();

  try {
    // ── READ SEQUENTIALLY, ON PURPOSE ──────────────────────────────────
    //
    // The first version ran these in Promise.all. The connection pool holds one
    // connection, so the driver serialised them anyway -- and every timer then
    // included waiting for the others. It reported 10,253 ms for a read of ZERO
    // confirmation rows, which is not a measurement, it is the queue.
    //
    // Awaiting them in turn costs nothing that was not already being paid, and
    // makes each number mean what it says.
    const usageRows = await time('read:usage', () =>
      sql<Record<string, unknown>[]>`select * from public.projection_usage(${token}::uuid)`,
      (r) => r.length);
    const entitlementRows = await time('read:entitlements', () =>
      sql<Record<string, unknown>[]>`select * from public.projection_entitlements(${token}::uuid)`,
      (r) => r.length);
    const peopleRows = await time('read:people', () =>
      sql<Record<string, unknown>[]>`select * from public.projection_people(${token}::uuid)`,
      (r) => r.length);
    const contractRows = await time('read:contracts', () =>
      sql<Record<string, unknown>[]>`select * from public.projection_contracts(${token}::uuid)`,
      (r) => r.length);
    const importRows = await time('read:imports', () =>
      sql<Record<string, unknown>[]>`select * from public.projection_imports(${token}::uuid)`,
      (r) => r.length);
    const confirmationRows = await time('read:confirmations', () =>
      sql<Record<string, unknown>[]>`select * from public.projection_confirmations(${token}::uuid)`,
      (r) => r.length);

    const computeFrom = performance.now();

    const usage = usageRows.map(toUsageRecord);
    const entitlements = entitlementRows.map(toEntitlementRecord);
    const people = peopleRows.map(toPersonRecord);
    const contracts = contractRows.map(toContractRecord);

    // ── THE WORKER DOES NOT KNOW THE ORGANIZATION ───────────────────────────
    //
    // It holds zero table privileges by design, so it cannot read
    // `organizations`. Only `id` and `name` travel on the job row.
    //
    // This used to be written as `{ id, name } as Organization`, and the cast
    // was the whole defect: every remaining field was `undefined` at runtime
    // while the type claimed otherwise. `technicalHeadcount: undefined` slipped
    // past a `=== null` guard, `spend / undefined` produced NaN, and `round`
    // turned that into a real-looking zero -- so a $5.7M portfolio reported
    // "Cost per technical employee $0" next to "— employees".
    //
    // Every field is now stated explicitly, so absent means null rather than
    // undefined, and adding a column to Organization breaks this line loudly
    // instead of shipping another undefined. The reader replaces this wholesale
    // with the authoritative row -- see `withAuthoritativeOrganization`.
    const organization: Organization = {
      id: job.organization_id,
      name: job.organization_name,
      slug: '',
      industry: null,
      technicalHeadcount: null,
      headcountGrowthRate: null,
      currency: 'USD',
      isDemo: false,
      createdAt: new Date(0).toISOString(),
    };

    // Customer-confirmed merges, applied by exactly the same rules the reader
    // uses -- the `confirmed` filter and the key normalization are both
    // load-bearing, and a second reading of them is how approved merges
    // silently stop applying.
    const confirmations = confirmationRows.map(rowToConfirmation);
    const { features: featureAliases, users: userAliases } = aliasMapsFrom(confirmations);

    const dataset = buildDatasetFromCanonical({
      organization,
      usage,
      entitlements,
      people,
      contracts,
      featureAliases,
      userAliases,
    }) as AnalyticsDataset;

    const withImports = {
      ...dataset,
      imports: importRows.map((i) => {
        return {
          id: i.id as string,
          organizationId: i.organization_id as string,
          kind:
            i.dataset === 'people'
              ? ('employees' as const)
              : i.dataset === 'entitlements' || i.dataset === 'contracts'
                ? ('contracts' as const)
                : ('usage' as const),
          fileName: i.file_name as string,
          fileBytes: Number(i.file_bytes ?? 0),
          rowCount: Number(i.row_count ?? 0),
          acceptedRows: Number(i.accepted_rows ?? 0),
          rejectedRows: Number(i.rejected_rows ?? 0),
          status: (i.status === 'complete' ? 'complete' : 'failed') as 'complete' | 'failed',
          createdAt: asTimestampString(i.uploaded_at ?? i.created_at) as string,
          createdBy: null,
          mappingId: null,
          notes: null,
        };
      }),
    };

    const payload: ProjectionPayload = {
      dataset: withImports as AnalyticsDataset,
      coverage: summarizeCoverage(usage, entitlements, people, contracts),
      userIdentities: resolveUsers(usage, people),
    };
    phases.compute = { ms: Math.round(performance.now() - computeFrom) };

    // Re-read the counts AFTER building. If the estate moved while we worked,
    // this is what catches it: the analysis describes rows that are no longer
    // what is stored, and it must not be published as current.
    const countFrom = performance.now();
    const [countRow] = await sql<{ projection_stored_counts: Record<string, number> }[]>`
      select public.projection_stored_counts(${token}::uuid) as projection_stored_counts
    `;
    const storedRows = countRow?.projection_stored_counts as
      | { usage: number; entitlements: number; people: number; contracts: number }
      | undefined;
    phases.countStoredRows = { ms: Math.round(performance.now() - countFrom) };

    if (storedRows === undefined || storedRows === null) {
      return { status: 'superseded', organizationId: job.organization_id };
    }

    // The evidence key is computed here exactly as the reader computes it, from
    // the same inputs. Reimplementing that hash in SQL would create a second
    // definition of the same fact.
    const evidenceKey = evidenceKeyFor({
      storedRows,
      imports: importRows
        .filter((i) => i.status === 'complete')
        .map((i) => ({ id: i.id as string, fingerprint: String(Number(i.accepted_rows ?? 0)) })),
      confirmations: {
        count: confirmations.length,
        latest: confirmations.reduce<string | null>(
          (newest, c) => (newest === null || c.decidedAt > newest ? c.decidedAt : newest),
          null,
        ),
      },
    });

    const serializeFrom = performance.now();
    const serialized = serializeDataset(payload);
    phases.serialize = {
      ms: Math.round(performance.now() - serializeFrom),
      detail: { bytes: serialized.bytes },
    };

    const buildMs = Math.round(performance.now() - startedAt);

    const [published] = await sql<{ publish_projection_job: string }[]>`
      select public.publish_projection_job(
        ${token}::uuid,
        ${evidenceKey},
        ${serialized.payload},
        ${serialized.bytes}::integer,
        ${PROJECTION_VERSION}::integer,
        ${sql.json(storedRows as never)}::jsonb,
        ${sql.json(payload.dataset.analyzedRows as never)}::jsonb,
        ${buildMs}::integer,
        ${sql.json(phases as never)}::jsonb
      ) as publish_projection_job
    `;

    const verdict = published?.publish_projection_job;
    if (verdict === 'integrity_failed') {
      return { status: 'integrity-failed', organizationId: job.organization_id };
    }
    if (verdict !== 'ready') return { status: 'superseded', organizationId: job.organization_id };

    return {
      status: 'ready',
      organizationId: job.organization_id,
      buildMs,
      payloadBytes: serialized.bytes,
      usageRows: usage.length,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'The analysis could not be built.';
    await sql`select public.fail_projection_job(${token}::uuid, ${reason})`.catch(() => undefined);
    return { status: 'failed', organizationId: job.organization_id, reason };
  } finally {
    clearInterval(heartbeat);
  }
}
