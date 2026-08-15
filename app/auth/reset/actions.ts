'use server';

import { redirect } from 'next/navigation';
import { isSupabaseAuth } from '@/lib/auth';
import { userClient } from '@/lib/supabase/server';
import { ensureOrganization } from '@/app/signin/actions';

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

  // A user who reset their password before ever signing in still needs a
  // workspace; this is idempotent and returns the existing one otherwise.
  await ensureOrganization();
  redirect('/app');
}
