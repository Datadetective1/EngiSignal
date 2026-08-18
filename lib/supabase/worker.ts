/**
 * The ingestion worker's connection to the database.
 *
 * WHAT THIS IS NOT
 *
 * It is not a service-role client. DEPLOYMENT.md and SECURITY.md said this
 * product holds no key that bypasses Row Level Security, and that is still
 * true: the token below names `ingestion_worker`, a database role with EXECUTE
 * on six functions and no rights over any table in any schema. Asserted against
 * production rather than assumed -- the role's reads of both `imports` and
 * `ingestion_usage` are refused by Postgres itself.
 *
 * WHY A SEPARATE IDENTITY AT ALL
 *
 * Phase 2F ran background work as the customer, by capturing their access token
 * before the response and reusing it afterwards. That preserved RLS perfectly
 * and it is the right answer for work measured in seconds. It cannot be the
 * answer here: a token expires, a session ends, and an import that must survive
 * a deploy, a crash and a retry an hour later cannot depend on a person still
 * being signed in. Durability and borrowed credentials are incompatible, so the
 * job gets an identity of its own -- made as small as the database can express.
 *
 * WHY THE FUNCTIONS TAKE NO ORGANIZATION
 *
 * Every function this role can call takes an import id and reads the
 * organization from the import row. There is no argument anywhere in its
 * surface that names a tenant, so reaching another organization's data is not a
 * permission it is denied -- it is a request it has no way to phrase.
 */

import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { envOptional } from '@/config/env';
import { supabaseAnonKey, supabaseUrl } from '@/config/env';

/** Minted by scripts/mint-ingestion-worker-token.mjs. */
export function workerTokenConfigured(): boolean {
  return envOptional('INGESTION_WORKER_TOKEN') !== null;
}

/**
 * A client acting as `ingestion_worker`.
 *
 * Null when the token is absent, so a deployment without it degrades to "no
 * imports are processed" -- visible immediately in the queue -- rather than to
 * a worker running with whatever privileges it happens to have.
 */
export function workerClient(): SupabaseClient | null {
  const url = supabaseUrl();
  const anon = supabaseAnonKey();
  const token = envOptional('INGESTION_WORKER_TOKEN');
  if (url === null || anon === null || token === null) return null;

  return createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * Whether a request is genuinely the scheduler.
 *
 * The worker endpoint claims jobs and writes customer data, so an unauthenticated
 * caller must not be able to drive it. Compared in constant time: a plain
 * equality check on a secret leaks its prefix to anyone willing to time the
 * responses.
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
