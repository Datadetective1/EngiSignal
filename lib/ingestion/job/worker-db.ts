/**
 * ── THE WORKER'S IDENTITY ───────────────────────────────────────────────────
 *
 * The worker connects to Postgres as `ingestion_worker`, a role that owns a
 * password and nothing else worth having: EXECUTE on six job functions, USAGE
 * on one schema, and no privilege over any table anywhere. Verified against
 * production, where its reads of `imports`, `ingestion_usage`, `organizations`,
 * `auth.users`, `storage.objects` and `vault.decrypted_secrets` are all refused
 * by the database itself.
 *
 * WHY NOT A JWT
 *
 * The obvious alternative was a token naming this same role, signed with the
 * project's JWT secret. It would have worked and it would have been worse: any
 * key able to sign a JWT can sign one that says `service_role`, so the
 * credential's real authority would have been "everything", regardless of which
 * role we chose to write in it. A role password cannot escalate. Its authority
 * is exactly the grants attached to the role, and those are visible in the
 * database rather than implied by a claim inside a token.
 *
 * Supabase's own guidance points the same way from the other direction: the
 * legacy JWT secret is deprecated, no longer rotatable, and retires with the
 * legacy keys at the end of 2026.
 *
 * WHY IT CANNOT BECOME SOMETHING ELSE
 *
 * `SET ROLE` requires membership, and this role is a member of nothing. That is
 * the whole proof, and it is asserted at connection time below rather than
 * trusted -- a role that quietly gained a membership would otherwise be
 * indistinguishable from one that never had any.
 *
 * TRANSACTION POOLING
 *
 * Serverless invocations are many and short, so the connection goes through
 * Supabase's transaction-mode pooler. That mode cannot carry session state
 * between statements, which is why prepared statements are disabled: a prepared
 * statement created on one pooled backend is not there on the next.
 */

import 'server-only';
import postgres from 'postgres';
import { envOptional } from '@/config/env';

export type WorkerSql = postgres.Sql<Record<string, never>>;

export function workerConfigured(): boolean {
  return envOptional('INGESTION_WORKER_DATABASE_URL') !== null;
}

/**
 * Opens a connection for one invocation.
 *
 * Null when unconfigured, so a deployment without the credential degrades to
 * "no import is processed" -- visible immediately in the queue, which the
 * customer can see -- rather than to a worker running as something else.
 */
export function openWorkerConnection(): WorkerSql | null {
  const url = envOptional('INGESTION_WORKER_DATABASE_URL');
  if (url === null) return null;

  return postgres(url, {
    // The pooler hands out a different backend per transaction, so a prepared
    // statement from a previous one will not be found.
    prepare: false,
    // One invocation does one job. More connections than that is a leak, not
    // throughput, and the role itself is capped at ten server-side.
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    // Never interpolated into a query, and never logged: see assertLeastPrivilege.
    onnotice: () => {},
  });
}

/**
 * Refuses to work if the connection is not who it should be.
 *
 * Three things are checked, and all three have been wrong at least once in this
 * codebase's history: the credential could name the wrong role, the role could
 * have been granted a membership that lets it become another, and it could have
 * acquired the right to bypass Row Level Security. None of these is visible
 * from a successful connection alone.
 */
export async function assertLeastPrivilege(sql: WorkerSql): Promise<void> {
  const [row] = await sql<
    { current_user: string; bypassrls: boolean; memberships: number }[]
  >`
    select
      current_user,
      (select rolbypassrls from pg_roles where rolname = current_user) as bypassrls,
      (select count(*)::int
         from pg_auth_members m
         join pg_roles w on w.oid = m.member
        where w.rolname = current_user) as memberships
  `;

  if (row === undefined) throw new Error('The worker connection returned no identity.');
  if (row.current_user !== 'ingestion_worker') {
    throw new Error(
      `Refusing to run: the worker connected as "${row.current_user}", not ingestion_worker.`,
    );
  }
  if (row.bypassrls) {
    throw new Error('Refusing to run: the worker role can bypass Row Level Security.');
  }
  if (row.memberships > 0) {
    throw new Error(
      `Refusing to run: the worker role is a member of ${row.memberships} other role(s) and could assume them.`,
    );
  }
}

/**
 * Whether a request is genuinely the scheduler.
 *
 * Compared in constant time: a plain equality check on a secret leaks its
 * prefix to anyone willing to time the responses.
 */
export function isScheduler(header: string | null): boolean {
  const expected = envOptional('CRON_SECRET');
  if (expected === null || header === null) return false;

  const given = header.startsWith('Bearer ') ? header.slice(7) : header;
  if (given.length !== expected.length) return false;

  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= given.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}
