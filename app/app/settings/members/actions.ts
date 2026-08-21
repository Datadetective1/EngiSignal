'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { userClient } from '@/lib/supabase/server';
import { loadWorkspace } from '@/lib/workspace';
import { authOrigin } from '@/lib/auth/origin';
import { sendInvitationEmail } from '@/lib/email/invitation';
import { emailConfigured } from '@/lib/email/send';
import {
  createInvitationToken,
  membershipErrorMessage,
  type AssignableRole,
} from '@/lib/membership';

/**
 * Membership actions.
 *
 * ── WHAT THESE FUNCTIONS ARE AND ARE NOT ────────────────────────────────────
 *
 * They are a way to call five database functions and turn what comes back into
 * a sentence. They are NOT where authorization happens. Every rule — who may
 * invite, who may touch an Owner, whether a workspace still has one — is
 * enforced in Postgres, and would still be enforced if this file were deleted
 * and the RPCs called directly.
 *
 * That matters most for the organization id. It is never read from the form. It
 * comes from `loadWorkspace()`, which resolves it from the session's membership
 * — and even if a caller could get a forged id in here, `private.is_org_admin`
 * inside each function would refuse it. The parameter is not a trust boundary
 * in either direction.
 *
 * ── WHY OUTCOMES TRAVEL IN THE URL ──────────────────────────────────────────
 *
 * A server action that redirects loses any state it was holding, so the result
 * of an invitation is carried as a query parameter and rendered by the page.
 * Notices are short codes rather than prose so that nothing a caller supplies
 * is ever echoed back into the page.
 */

const TTL_DAYS = 7;

function back(notice: string, detail?: string): never {
  const params = new URLSearchParams({ notice });
  if (detail !== undefined && detail.length > 0) params.set('detail', detail);
  redirect(`/app/settings/members?${params.toString()}`);
}

/**
 * Resolve the workspace and the caller's role in it.
 *
 * The role is read back from the database rather than trusted from anywhere
 * else, so a stale page cannot act with authority it no longer has.
 */
async function currentContext() {
  const workspace = await loadWorkspace();
  const supabase = await userClient();
  const { data } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', workspace.organization.id)
    .eq('user_id', workspace.session.userId)
    .maybeSingle();

  return {
    organizationId: workspace.organization.id,
    organizationName: workspace.organization.name,
    inviterEmail: workspace.session.email,
    role: (data?.role ?? null) as string | null,
  };
}

export async function inviteMemberAction(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const roleRaw = String(formData.get('role') ?? 'member');
  const role: AssignableRole = roleRaw === 'admin' ? 'admin' : 'member';

  if (email.length === 0 || !email.includes('@')) back('invalid_email');

  const context = await currentContext();
  const token = createInvitationToken();
  const supabase = await userClient();

  const { error } = await supabase.rpc('invite_to_organization', {
    org_id: context.organizationId,
    invite_email: email,
    invite_role: role,
    raw_token: token,
    ttl_days: TTL_DAYS,
  });

  if (error !== null) back('error', membershipErrorMessage(error.message));

  const outcome = await deliver({
    token,
    email,
    role,
    organizationName: context.organizationName,
    inviterEmail: context.inviterEmail,
  });

  revalidatePath('/app/settings/members');
  back(outcome);
}

/**
 * Resend is the same operation as invite.
 *
 * `invite_to_organization` rotates the token on an address that already has a
 * live invitation, so "resend" is not a separate code path with its own bugs —
 * and the old link stops working the moment a new one is sent, which is the
 * behaviour anyone would assume from the word.
 */
export async function resendInvitationAction(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const roleRaw = String(formData.get('role') ?? 'member');
  const role: AssignableRole = roleRaw === 'admin' ? 'admin' : 'member';

  if (email.length === 0) back('error', 'No address to resend to.');

  const context = await currentContext();
  const token = createInvitationToken();
  const supabase = await userClient();

  const { error } = await supabase.rpc('invite_to_organization', {
    org_id: context.organizationId,
    invite_email: email,
    invite_role: role,
    raw_token: token,
    ttl_days: TTL_DAYS,
  });

  if (error !== null) back('error', membershipErrorMessage(error.message));

  const outcome = await deliver({
    token,
    email,
    role,
    organizationName: context.organizationName,
    inviterEmail: context.inviterEmail,
  });

  revalidatePath('/app/settings/members');
  back(outcome === 'invited' ? 'resent' : outcome);
}

/**
 * Send the mail and say plainly what happened.
 *
 * An invitation that exists but was not delivered is the failure mode that
 * wastes the most time, because from the Members table it looks exactly like
 * one the recipient has not got round to. So the three outcomes are kept
 * distinct all the way to the screen.
 */
async function deliver(input: {
  token: string;
  email: string;
  role: AssignableRole;
  organizationName: string;
  inviterEmail: string;
}): Promise<'invited' | 'invited_not_emailed' | 'invited_email_failed'> {
  if (!emailConfigured()) return 'invited_not_emailed';

  const origin = await authOrigin();
  const acceptUrl = `${origin}/invite/${encodeURIComponent(input.token)}`;
  const expiresAt = new Date(Date.now() + TTL_DAYS * 86_400_000).toISOString();

  const result = await sendInvitationEmail({
    to: input.email,
    organizationName: input.organizationName,
    role: input.role,
    invitedByEmail: input.inviterEmail,
    acceptUrl,
    expiresAt,
  });

  if (result.outcome === 'sent') return 'invited';
  if (result.outcome === 'skipped') return 'invited_not_emailed';
  return 'invited_email_failed';
}

export async function revokeInvitationAction(formData: FormData): Promise<void> {
  const invitationId = String(formData.get('invitationId') ?? '');
  if (invitationId.length === 0) back('error');

  const supabase = await userClient();
  const { error } = await supabase.rpc('revoke_organization_invitation', {
    invitation_id: invitationId,
  });

  if (error !== null) back('error', membershipErrorMessage(error.message));

  revalidatePath('/app/settings/members');
  back('revoked');
}

export async function removeMemberAction(formData: FormData): Promise<void> {
  const memberId = String(formData.get('memberId') ?? '');
  if (memberId.length === 0) back('error');

  const supabase = await userClient();
  const { error } = await supabase.rpc('remove_organization_member', { member_id: memberId });

  if (error !== null) back('error', membershipErrorMessage(error.message));

  revalidatePath('/app/settings/members');
  back('removed');
}

export async function changeRoleAction(formData: FormData): Promise<void> {
  const memberId = String(formData.get('memberId') ?? '');
  const roleRaw = String(formData.get('role') ?? '');
  if (memberId.length === 0) back('error');
  if (roleRaw !== 'admin' && roleRaw !== 'member' && roleRaw !== 'owner') back('error');

  const supabase = await userClient();
  const { error } = await supabase.rpc('set_organization_member_role', {
    member_id: memberId,
    new_role: roleRaw,
  });

  if (error !== null) back('error', membershipErrorMessage(error.message));

  revalidatePath('/app/settings/members');
  back('role_changed');
}
