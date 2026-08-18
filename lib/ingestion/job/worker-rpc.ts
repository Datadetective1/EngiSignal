/**
 * The six calls the worker is allowed to make, over a direct connection.
 *
 * This exists so the change of credential stayed a change of credential. The
 * runner still asks for `claim_import_job` and reads snake_case columns exactly
 * as it did when the transport was PostgREST; only the wire underneath moved.
 * The job's lifecycle, checkpointing and idempotency are untouched.
 *
 * The allow-list is not decoration. The worker's grants already make anything
 * else fail at the database, but a name arriving here that is not on this list
 * means the runner asked for something nobody designed it to ask for, and that
 * is worth an error rather than a query.
 */

import 'server-only';
import type { WorkerSql } from './worker-db';

type RpcResult = { data: unknown; error: { message: string } | null };

export function pgRpc(sql: WorkerSql) {
  return async function rpc(name: string, params: Record<string, unknown>): Promise<RpcResult> {
    try {
      switch (name) {
        case 'claim_import_job': {
          const rows = await sql`
            select * from public.claim_import_job(${params.lease_seconds as number}::integer)
          `;
          return { data: Array.from(rows), error: null };
        }

        case 'heartbeat_import_job': {
          const [row] = await sql<{ v: boolean | null }[]>`
            select public.heartbeat_import_job(
              ${params.job as string}::uuid,
              ${params.token as string}::uuid,
              ${(params.lease_seconds as number) ?? 60}::integer
            ) as v
          `;
          return { data: row?.v ?? null, error: null };
        }

        case 'persist_import_slice': {
          const [row] = await sql<{ v: number }[]>`
            select public.persist_import_slice(
              ${params.job as string}::uuid,
              ${params.token as string}::uuid,
              ${sql.json(params.rows as never)}::jsonb,
              ${params.expected_from as number}::integer
            ) as v
          `;
          return { data: row?.v ?? null, error: null };
        }

        case 'complete_import_job': {
          const [row] = await sql<{ v: string }[]>`
            select public.complete_import_job(
              ${params.job as string}::uuid,
              ${params.token as string}::uuid
            ) as v
          `;
          return { data: row?.v ?? null, error: null };
        }

        case 'fail_import_job': {
          const [row] = await sql<{ v: string }[]>`
            select public.fail_import_job(
              ${params.job as string}::uuid,
              ${params.token as string}::uuid,
              ${params.reason as string}
            ) as v
          `;
          return { data: row?.v ?? null, error: null };
        }

        case 'reap_stale_import_jobs': {
          const [row] = await sql<{ v: number }[]>`
            select public.reap_stale_import_jobs() as v
          `;
          return { data: row?.v ?? 0, error: null };
        }

        default:
          return { data: null, error: { message: `The worker may not call ${name}.` } };
      }
    } catch (error) {
      // Returned rather than thrown, because the runner distinguishes a failed
      // call from a refused one and records the reason against the job.
      return {
        data: null,
        error: { message: error instanceof Error ? error.message : 'The database call failed.' },
      };
    }
  };
}
