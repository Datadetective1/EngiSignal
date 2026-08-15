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
 * Two clients, deliberately distinct:
 *
 *  - `userClient()` carries the signed-in user's session. RLS applies. This is
 *    what every request path uses, so the database enforces isolation even if
 *    application code has a bug.
 *
 *  - `adminClient()` uses the service role and BYPASSES RLS. It exists only for
 *    operations that genuinely cannot be done as a user. It is server-only, is
 *    never constructed unless the key is present, and must never be reachable
 *    from a request whose tenant came from user input.
 */

import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { envOptional, supabaseAnonKey, supabaseUrl } from '@/config/env';

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
export async function userClient(): Promise<SupabaseClient> {
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

/** Service-role client. Bypasses RLS. Returns null when not configured. */
export function adminClient(): SupabaseClient | null {
  const url = supabaseUrl();
  const key = envOptional('SUPABASE_SERVICE_ROLE_KEY');
  if (url === null || key === null) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
