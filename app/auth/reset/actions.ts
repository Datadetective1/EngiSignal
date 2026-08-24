'use server';

import { redirect } from 'next/navigation';
import { isSupabaseAuth } from '@/lib/auth';
import { userClient } from '@/lib/supabase/server';
import { ensureOrganization } from '@/app/signin/actions';
import { sendPasswordChangedEmail } from '@/lib/email/security-notice';

/**
 * Apply a new password.
 *
 * Authorized by the recovery session established by /auth/callback. The user
 * id comes from that session, never from the form, so this cannot be used to
 * change somebody else's password.
 */
export async function updatePasswordAction(formData: FormData) {
  if (!isSupabaseAuth()) redirect('/signin');

  const password = String(formData.get('password') ?? '');
  if (password.length < 8) redirect('/auth/reset?error=weak');

  const supabase = await userClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error !== null) redirect('/auth/reset?error=failed');

  // ── TELL THE ACCOUNT ITS PASSWORD CHANGED ──────────────────────────────
  //
  // A security control rather than a courtesy: without it, somebody who
  // completes a reset they did not start leaves the real owner with no signal
  // at all, and the first thing that owner notices is their own password
  // failing.
  //
  // Sent before the redirect, because `redirect()` throws to unwind, and
  // guarded so that a mail failure cannot undo a password change that has
  // already been applied. The address comes from the session, never the form.
  try {
    const { data } = await supabase.auth.getUser();
    const address = data.user?.email;
    if (address !== undefined && address.length > 0) {
      await sendPasswordChangedEmail({ email: address, changedAt: new Date().toISOString() });
    }
  } catch {
    // The password is changed. Failing to confirm it is not a reason to tell
    // somebody the change did not happen.
  }

  // A user who reset their password before ever signing in still needs a
  // workspace; this is idempotent and returns the existing one otherwise.
  await ensureOrganization();
  redirect('/app');
}
