/**
 * Authentication.
 *
 * Two modes behind one interface:
 *
 *  - Local (default): a signed evaluation session held in an httpOnly cookie.
 *    Any work email signs in. This exists so EngiSignal can be evaluated with
 *    zero setup; it is NOT an authentication system and says so in the UI.
 *
 *  - Supabase: real Supabase Auth, activated by environment configuration.
 *
 * Authorization — which organizations a session may read — is enforced by the
 * data provider and by Row Level Security, never by this module alone.
 */

import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { hasSupabaseEnv } from './data/supabase-provider';

const SESSION_COOKIE = 'engisignal.session';
const MAX_AGE_SECONDS = 60 * 60 * 12;

export interface AppSession {
  userId: string;
  email: string;
  displayName: string;
  /** True when this is the local evaluation session rather than real auth. */
  isEvaluation: boolean;
}

export function isSupabaseAuth(): boolean {
  return process.env.ENGISIGNAL_DATA_PROVIDER === 'supabase' && hasSupabaseEnv();
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

function displayNameFor(email: string): string {
  const local = email.split('@')[0] ?? 'Analyst';
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export async function getSession(): Promise<AppSession | null> {
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
      isEvaluation: !isSupabaseAuth(),
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

export async function createSession(email: string): Promise<void> {
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
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
