'use server';

import { redirect } from 'next/navigation';
import { userClient } from '@/lib/supabase/server';
import { destroySession } from '@/lib/auth';
import { membershipErrorMessage } from '@/lib/membership';

/**
 * Accepting an invitation.
 *
 * The whole operation is one RPC. Every check that matters — is the token real,
 * is it still live, has it been used, and above all does it belong to the
 * address this session is signed in as — happens inside
 * `accept_organization_invitation`, which is the only thing that may write a
 * membership row.
 *
 * A failure here is never fatal to the user's account. It sends them back to
 * the invitation page with an explanation, because "expired" and "wrong
 * account" are both recoverable and both need different advice.
 */
export async function acceptInvitationAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');
  if (token.length === 0) redirect('/app');

  const supabase = await userClient();
  const { error } = await supabase.rpc('accept_organization_invitation', { raw_token: token });

  if (error !== null) {
    const params = new URLSearchParams({ error: membershipErrorMessage(error.message) });
    redirect(`/invite/${encodeURIComponent(token)}?${params.toString()}`);
  }

  redirect('/app');
}

/** Accept from the pending list, where the original link is not to hand. */
export async function acceptPendingInvitationAction(formData: FormData): Promise<void> {
  const invitationId = String(formData.get('invitationId') ?? '');
  if (invitationId.length === 0) redirect('/app/invitations');

  const supabase = await userClient();
  const { error } = await supabase.rpc('accept_invitation_by_id', { invitation_id: invitationId });

  if (error !== null) {
    const params = new URLSearchParams({ error: membershipErrorMessage(error.message) });
    redirect(`/app/invitations?${params.toString()}`);
  }

  redirect('/app');
}

/**
 * Sign out and come straight back to the invitation.
 *
 * Without this, someone already signed in as the wrong account has to find the
 * sign-out control, sign in again, and then dig the original email back out to
 * re-open the link. The token is carried through so they land exactly here.
 */
export async function switchAccountAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');
  await destroySession();
  const next = token.length > 0 ? `/invite/${encodeURIComponent(token)}` : '/app';
  redirect(`/signin?invite=${encodeURIComponent(token)}&next=${encodeURIComponent(next)}`);
}
