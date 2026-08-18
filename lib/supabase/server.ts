/**
 * Server-side Supabase clients.
 *
 * WHY THIS EXISTS
 *
 * The original provider used the anon key with no user session. Row Level
 * Security is written against `auth.uid()`, so an unauthenticated anon client
 * sees nothing at all — every policy evaluates false. Real multi-tenant access
 * needs the caller's own JWT attached to every request, which is what these
 * clients do.
 *
 * There is exactly ONE client, and it carries the signed-in user's session, so
 * RLS applies to every statement and the database enforces isolation even if
 * application code has a bug.
 *
 * A service-role helper previously lived here and was never called. It has been
 * removed rather than left available: an unused function that bypasses Row
 * Level Security is a capability waiting to be picked up by a future change
 * under time pressure, and nothing in Phase 1 needs it. If an operation ever
 * genuinely requires it, reintroduce it deliberately with its own review.
 */

import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAnonKey, supabaseUrl } from '@/config/env';

export function hasSupabaseEnv(): boolean {
  return supabaseUrl() !== null && supabaseAnonKey() !== null;
}

/**
 * A client bound to the caller's session cookies.
 *
 * Cookie writes are wrapped: Next.js forbids setting cookies from a Server
 * Component render, and Supabase attempts a refresh write opportunistically.
 * Swallowing that specific failure is safe because middleware refreshes the
 * session on every request, which is the supported pattern.
 */
/**
 * A client that outlives the request it was created in.
 *
 * `userClient()` reads cookies lazily through Next's cookie store, which is only
 * valid while the request is being handled. Work scheduled with `after()` runs
 * AFTER the response, and the store is gone by then — the client silently has
 * no session, every policy evaluates false, and the work fails without ever
 * having been permitted to start.
 *
 * Phase 2F hit exactly that: the import committed 67,267 rows durably, returned
 * 200, and no build ever ran, because the background half could no longer see
 * who it was.
 *
 * So the token is captured EAGERLY, inside the request, and attached as a plain
 * Authorization header. It is still the caller's own JWT and still governed by
 * the same Row Level Security — no service-role key, no elevated worker.
 */
export async function detachedUserClient(): Promise<SupabaseClient | null> {
  const url = supabaseUrl();
  const key = supabaseAnonKey();
  if (url === null || key === null) return null;

  const session = await (await userClient()).auth.getSession();
  const token = session.data.session?.access_token;
  if (typeof token !== 'string' || token.length === 0) return null;

  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    // Nothing to persist or refresh: this client exists for one piece of work
    // and is discarded.
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * The client to use for work that has outlived its request.
 *
 * Everything below `startProjectionBuild` — the store, the counts, the reads
 * that feed the projection — reaches for `userClient()`, and after the response
 * that would try to read a cookie store that no longer exists. Rather than
 * thread a client through every one of those call sites, the detached client is
 * bound for the duration of the build and `userClient()` prefers it.
 *
 * AsyncLocalStorage rather than a module variable: two requests can be in
 * flight in the same isolate, and a shared mutable "current client" would hand
 * one tenant's work another tenant's session. That is the one mistake this
 * whole design exists to avoid.
 */
const detachedClient = new AsyncLocalStorage<SupabaseClient>();

export function withDetachedClient<T>(client: SupabaseClient, fn: () => Promise<T>): Promise<T> {
  return detachedClient.run(client, fn);
}

export async function userClient(): Promise<SupabaseClient> {
  const detached = detachedClient.getStore();
  if (detached !== undefined) return detached;

  const url = supabaseUrl();
  const key = supabaseAnonKey();
  if (url === null || key === null) {
    throw new Error('Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and ANON_KEY.');
  }

  const store = await cookies();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            store.set(name, value, options as never);
          }
        } catch {
          // Server Component render — middleware owns the refresh.
        }
      },
    },
  });
}
