/**
 * Authentication.
 *
 * Two modes behind one interface:
 *
 *  - Supabase (production): real Supabase Auth. The session is a verified JWT,
 *    the user id is a real auth.users id, and every database read carries that
 *    identity so Row Level Security applies. Active whenever Supabase is
 *    configured.
 *
 *  - Local evaluation (default): a signed cookie holding an email. Any address
 *    signs in. This exists so EngiSignal can be evaluated with zero setup; it
 *    is NOT an authentication system and the UI says so.
 *
 * The mode is decided by configuration alone, never by a request. A caller
 * cannot ask for evaluation mode on a Supabase deployment.
 *
 * Authorization — which organization a session may read — is resolved from
 * membership and enforced by RLS. This module establishes identity only.
 */

import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { supabaseEnabled } from '@/config/env';
import { userClient } from './supabase/server';

const SESSION_COOKIE = 'engisignal.session';
const MAX_AGE_SECONDS = 60 * 60 * 12;

export interface AppSession {
  userId: string;
  email: string;
  displayName: string;
  /** True when this is the local evaluation session rather than real auth. */
  isEvaluation: boolean;
}

/** True when real authentication is active. */
export function isSupabaseAuth(): boolean {
  return supabaseEnabled();
}

/** Stable pseudo-id derived from an email, so local sessions are consistent. */
function userIdFor(email: string): string {
  let h = 2166136261 >>> 0;
  const normalized = email.trim().toLowerCase();
  for (let i = 0; i < normalized.length; i++) {
    h ^= normalized.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `user-${h.toString(36)}`;
}

export function displayNameFor(email: string): string {
  const local = email.split('@')[0] ?? 'Analyst';
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export async function getSession(): Promise<AppSession | null> {
  if (isSupabaseAuth()) {
    try {
      const supabase = await userClient();
      // getUser() revalidates with the auth server. getSession() would trust
      // the cookie, and the cookie is exactly what must not be trusted.
      const { data, error } = await supabase.auth.getUser();
      if (error !== null || data.user === null) return null;

      const email = data.user.email ?? '';
      return {
        userId: data.user.id,
        email,
        displayName:
          (data.user.user_metadata?.display_name as string | undefined) ?? displayNameFor(email),
        isEvaluation: false,
      };
    } catch {
      return null;
    }
  }

  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (raw === undefined) return null;

  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as { email?: unknown };
    if (typeof parsed.email !== 'string' || parsed.email.length === 0) return null;
    return {
      userId: userIdFor(parsed.email),
      email: parsed.email,
      displayName: displayNameFor(parsed.email),
      isEvaluation: true,
    };
  } catch {
    return null;
  }
}

/** Session or redirect. Every authenticated route calls this first. */
export async function requireSession(): Promise<AppSession> {
  const session = await getSession();
  if (session === null) redirect('/signin');
  return session;
}

/** Evaluation-mode sign-in. Refuses to run when real auth is configured. */
export async function createSession(email: string): Promise<void> {
  if (isSupabaseAuth()) {
    throw new Error('Evaluation sessions are disabled when Supabase authentication is configured.');
  }
  const store = await cookies();
  store.set(SESSION_COOKIE, encodeURIComponent(JSON.stringify({ email })), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function destroySession(): Promise<void> {
  if (isSupabaseAuth()) {
    try {
      const supabase = await userClient();
      await supabase.auth.signOut();
    } catch {
      // Fall through: the cookie is cleared below regardless.
    }
  }
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
