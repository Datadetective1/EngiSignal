'use server';

import { redirect } from 'next/navigation';
import { createSession, isSupabaseAuth } from '@/lib/auth';
import { authCallbackUrl, emailConfirmUrl } from '@/lib/auth/origin';
import { userClient } from '@/lib/supabase/server';
import { MINIMUM_PASSWORD_LENGTH } from '@/lib/auth/password';

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
    // Two different limits wear the same status code, and the advice for one is
    // wrong for the other. A per-request throttle clears in seconds; the email
    // send limit is measured in hours, so telling someone to "wait a minute"
    // sends them round a loop that cannot succeed.
    if (code.includes('over_email_send_rate_limit') || text.includes('email rate limit')) {
      return 'emaillimited';
    }
    return 'ratelimited';
  }
  // ── SPECIFIC PASSWORD FAULTS BEFORE THE GENERIC ONE ───────────────────────
  //
  // Supabase reports both "this password is in a breach corpus" and "this
  // password is too short" through the same weak_password code, and both
  // messages contain the word "password" -- which the generic branch below
  // used to swallow, telling someone who had just typed a password to "enter
  // your password". Verified in production: signing up with Password123! was
  // correctly refused and then explained with the one message that could not
  // help, so the only way forward was to guess.
  if (
    text.includes('known to be weak') ||
    text.includes('easy to guess') ||
    text.includes('pwned') ||
    text.includes('leaked') ||
    text.includes('data breach')
  ) {
    return 'breached';
  }
  if (text.includes('at least') || code.includes('weak_password')) return 'weak';

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
  if (password.length < MINIMUM_PASSWORD_LENGTH) redirect('/signin?error=weak&mode=signup');

  if (!isSupabaseAuth()) {
    await createSession(email);
    redirect('/app');
  }

  const supabase = await userClient();
  // WITHOUT THIS the link in the confirmation email points at the project's
  // Site URL — the apex host, at the site root — so a new customer confirms
  // their address, lands on the public marketing page with `?code=…` still in
  // the address bar, and is never signed in.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // The two-step confirmation page, not the callback. This is also the
      // fallback target if the email template is ever reverted to
      // {{ .ConfirmationURL }} — the link would then consume the token at
      // Supabase and land here with a code, which the page handles.
      emailRedirectTo: await emailConfirmUrl({ next: '/app' }),
      // Carried on the user record so it survives the confirmation round trip.
      // With email confirmation enabled there is no session here, so the
      // provisioning call below never runs — and the name the customer typed
      // was silently discarded, leaving every workspace named after the email
      // domain. "Acme Aerospace" became "Acme Com".
      data: organization.length > 0 ? { organization_name: organization } : undefined,
    },
  });
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

  // Fall back to the name captured at sign-up. Every path that provisions
  // after confirmation reaches here without one, and the email domain is a
  // poor substitute for what the customer actually called their company.
  let organizationName = name;
  if (organizationName === undefined || organizationName.length === 0) {
    const { data: userData } = await supabase.auth.getUser();
    const stored = userData.user?.user_metadata?.organization_name;
    if (typeof stored === 'string' && stored.trim().length > 0) {
      organizationName = stored.trim();
    }
  }
  const { data, error } = await supabase.rpc('bootstrap_organization', {
    org_name:
      organizationName !== undefined && organizationName.length > 0 ? organizationName : null,
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
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: await authCallbackUrl({ type: 'recovery' }),
  });

  redirect('/signin?notice=resetsent');
}

/**
 * Send the confirmation email again.
 *
 * Without this there was no way out of a lost confirmation. Signing up again
 * answered "an account already exists", signing in answered "confirm your email
 * first", and the customer was left holding an account they could not reach.
 * That is survivable for one person who can be helped by hand; it is not
 * survivable for a pilot cohort that signs up together and meets the hourly
 * email limit.
 *
 * Always reports success, even for an address with no account: telling a
 * stranger which emails are registered is user enumeration.
 */
export async function resendConfirmationAction(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  if (email.length === 0 || !email.includes('@')) redirect('/signin?error=email');

  if (!isSupabaseAuth()) redirect('/signin?notice=confirmsent');

  const supabase = await userClient();
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    // The same two-step confirmation page signup points at. Sending this to
    // the callback instead would hand back a link that confirms on being
    // opened -- exactly the property the two-step design exists to remove.
    options: { emailRedirectTo: await emailConfirmUrl({ next: '/app' }) },
  });

  // The one exception to reporting success regardless: being throttled is a
  // fact about the service, not about whether the address exists, and hiding it
  // would leave someone waiting for mail that was never sent.
  if (error !== null && (error.status === 429 || (error.code ?? '').includes('rate_limit'))) {
    redirect('/signin?error=emaillimited');
  }

  redirect('/signin?notice=confirmsent');
}

export async function signOutAction() {
  const supabase = isSupabaseAuth() ? await userClient() : null;
  if (supabase !== null) await supabase.auth.signOut();
  redirect('/signin');
}
