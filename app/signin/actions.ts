'use server';

import { redirect } from 'next/navigation';
import { envOptional } from '@/config/env';
import { createSession, isSupabaseAuth } from '@/lib/auth';
import { userClient } from '@/lib/supabase/server';

/**
 * Sign-in actions.
 *
 * With Supabase configured this is real authentication: email and password,
 * verified by the auth server, establishing a session whose identity governs
 * every subsequent query through Row Level Security.
 *
 * Without it, the evaluation cookie path is used and says so in the UI.
 *
 * Organization provisioning happens through `bootstrap_organization`, a
 * SECURITY DEFINER function that derives the owner from auth.uid(). The client
 * never supplies an organization id, so a caller cannot provision into — or
 * join — somebody else's tenant.
 */

/**
 * Map an auth error to a message the user can act on.
 *
 * Order matters. A rate-limit response carries the word "email" in its text,
 * and an earlier version of this function matched that first — telling people
 * their address was invalid when the service was simply throttled. Specific
 * causes are therefore checked before the generic keyword fallbacks, and
 * anything unrecognized reports a neutral failure rather than blaming the
 * user's input for a server-side condition.
 */
function messageFor(error: { message: string; status?: number; code?: string }): string {
  const text = error.message.toLowerCase();
  const code = (error.code ?? '').toLowerCase();

  if (error.status === 429 || code.includes('rate_limit') || text.includes('rate limit')) {
    return 'ratelimited';
  }
  if (text.includes('invalid login credentials')) return 'invalid';
  if (text.includes('already registered') || text.includes('already been registered')) return 'exists';
  if (text.includes('not confirmed') || code.includes('email_not_confirmed')) return 'unconfirmed';
  if (text.includes('password')) return 'password';
  if (text.includes('invalid') && text.includes('email')) return 'email';
  return 'failed';
}

export async function signInAction(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (email.length === 0 || !email.includes('@')) redirect('/signin?error=email');

  if (!isSupabaseAuth()) {
    await createSession(email);
    redirect('/app');
  }

  if (password.length === 0) redirect('/signin?error=password');

  const supabase = await userClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error !== null) redirect(`/signin?error=${messageFor(error)}`);

  await ensureOrganization();
  redirect('/app');
}

export async function signUpAction(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const organization = String(formData.get('organization') ?? '').trim();

  if (email.length === 0 || !email.includes('@')) redirect('/signin?error=email&mode=signup');
  if (password.length < 8) redirect('/signin?error=weak&mode=signup');

  if (!isSupabaseAuth()) {
    await createSession(email);
    redirect('/app');
  }

  const supabase = await userClient();
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error !== null) redirect(`/signin?error=${messageFor(error)}&mode=signup`);

  // With email confirmation enabled there is no session yet, so the workspace
  // cannot be provisioned until the address is confirmed. Say that plainly
  // rather than dropping the user into an empty app.
  if (data.session === null) redirect('/signin?notice=confirm');

  await ensureOrganization(organization);
  redirect('/app');
}

/**
 * Ensure the signed-in user has an organization.
 *
 * Idempotent by construction: the function returns the existing membership
 * when there is one, so repeated sign-ins never create duplicate tenants.
 */
export async function ensureOrganization(name?: string): Promise<string | null> {
  if (!isSupabaseAuth()) return null;

  const supabase = await userClient();
  const { data, error } = await supabase.rpc('bootstrap_organization', {
    org_name: name !== undefined && name.length > 0 ? name : null,
  });

  if (error !== null) return null;
  return typeof data === 'string' ? data : null;
}

/**
 * Request a password-reset email.
 *
 * Always reports success, even for an address with no account: telling a
 * stranger which emails are registered is user enumeration.
 *
 * NOTE: delivery depends on the project's SMTP configuration. With Supabase's
 * built-in mailer this is rate-limited and not suitable for production volume.
 */
export async function requestPasswordResetAction(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  if (email.length === 0 || !email.includes('@')) redirect('/signin?error=email&mode=reset');

  if (!isSupabaseAuth()) redirect('/signin?notice=resetsent');

  const supabase = await userClient();
  const origin = envOptional('NEXT_PUBLIC_SITE_URL') ?? '';
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?type=recovery`,
  });

  redirect('/signin?notice=resetsent');
}

export async function signOutAction() {
  const supabase = isSupabaseAuth() ? await userClient() : null;
  if (supabase !== null) await supabase.auth.signOut();
  redirect('/signin');
}
