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
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
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
