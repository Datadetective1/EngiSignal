import 'server-only';
import { randomBytes } from 'node:crypto';
import { userClient } from '@/lib/supabase/server';

/**
 * Membership and invitations, read side.
 *
 * Every read here is an ordinary RLS-governed SELECT made with the caller's own
 * session. There is no elevated client in this file and no organization id
 * arrives from a form — it comes from the resolved workspace. If a policy is
 * wrong, these reads return nothing rather than somebody else's data.
 *
 * The invitation list is readable only by owners and admins, which the database
 * enforces. A Member calling `listInvitations` gets an empty array, not an
 * error, so the page degrades to "you cannot manage membership" rather than
 * breaking.
 */

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'analyst' | 'viewer';

/** The roles this release actually hands out. */
export const ASSIGNABLE_ROLES = ['admin', 'member'] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export interface WorkspaceMember {
  id: string;
  userId: string;
  email: string;
  displayName: string | null;
  role: WorkspaceRole;
  joinedAt: string;
  /** True for the row describing the signed-in user. */
  isYou: boolean;
}

export interface WorkspaceInvitation {
  id: string;
  email: string;
  role: WorkspaceRole;
  invitedByEmail: string;
  createdAt: string;
  expiresAt: string;
  /** Derived, not stored: an invitation past its window is still a row. */
  status: 'pending' | 'expired';
}

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  // Retained from the original schema. No new membership is created with
  // either, and both are labelled honestly rather than being folded into
  // "Member" — a viewer genuinely cannot do what a member can.
  analyst: 'Analyst (legacy)',
  viewer: 'Viewer (legacy)',
};

export const ROLE_DESCRIPTIONS: Record<AssignableRole, string> = {
  admin: 'Full access to the product, and can invite and manage members.',
  member: 'Full access to the product. Cannot manage membership.',
};

/** Roles permitted to manage membership. Mirrors private.is_org_admin(). */
export function canManageMembers(role: WorkspaceRole | null): boolean {
  return role === 'owner' || role === 'admin';
}

export function isOwner(role: WorkspaceRole | null): boolean {
  return role === 'owner';
}

/**
 * A cryptographically secure, single-use invitation secret.
 *
 * 32 bytes from the platform CSPRNG, base64url so it survives a URL and an
 * email client without escaping. 43 characters, comfortably above the 32 the
 * database insists on. Only its SHA-256 is ever stored.
 */
export function createInvitationToken(): string {
  return randomBytes(32).toString('base64url');
}

interface MemberRow {
  id: string;
  user_id: string;
  email: string;
  display_name: string | null;
  role: WorkspaceRole;
  created_at: string;
}

export async function listMembers(
  organizationId: string,
  currentUserId: string,
): Promise<WorkspaceMember[]> {
  const supabase = await userClient();
  const { data, error } = await supabase
    .from('organization_members')
    .select('id, user_id, email, display_name, role, created_at')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: true });

  if (error !== null || data === null) return [];

  return (data as MemberRow[]).map((row) => ({
    id: row.id,
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    joinedAt: row.created_at,
    isYou: row.user_id === currentUserId,
  }));
}

interface InvitationRow {
  id: string;
  email: string;
  role: WorkspaceRole;
  invited_by_email: string;
  created_at: string;
  expires_at: string;
}

/**
 * Live invitations — neither accepted nor revoked.
 *
 * Expired ones are included and labelled. Hiding them would leave an owner
 * wondering why re-inviting an address appears to do nothing, when in fact the
 * row is right there having quietly timed out.
 */
export async function listInvitations(organizationId: string): Promise<WorkspaceInvitation[]> {
  const supabase = await userClient();
  const { data, error } = await supabase
    .from('organization_invitations')
    .select('id, email, role, invited_by_email, created_at, expires_at')
    .eq('organization_id', organizationId)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });

  if (error !== null || data === null) return [];

  const now = Date.now();
  return (data as InvitationRow[]).map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    invitedByEmail: row.invited_by_email,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    status: Date.parse(row.expires_at) <= now ? 'expired' : 'pending',
  }));
}

export interface PendingInvitation {
  id: string;
  organizationName: string;
  role: WorkspaceRole;
  invitedByEmail: string;
  expiresAt: string;
}

/**
 * Invitations addressed to the signed-in user, wherever they came from.
 *
 * This is what rescues someone who confirmed their email in a different browser
 * from the one holding the invitation link. The database resolves "who is
 * asking" from auth.uid(); no address is passed in.
 */
export async function myPendingInvitations(): Promise<PendingInvitation[]> {
  const supabase = await userClient();
  const { data, error } = await supabase.rpc('my_pending_invitations');
  if (error !== null || data === null) return [];

  return (
    data as {
      id: string;
      organization_name: string;
      invited_role: WorkspaceRole;
      invited_by_email: string;
      expires_at: string;
    }[]
  ).map((row) => ({
    id: row.id,
    organizationName: row.organization_name,
    role: row.invited_role,
    invitedByEmail: row.invited_by_email,
    expiresAt: row.expires_at,
  }));
}

export interface InvitationPreview {
  status: 'pending' | 'invalid' | 'revoked' | 'expired' | 'accepted';
  organizationName: string | null;
  role: WorkspaceRole | null;
  invitedEmail: string | null;
}

/** What the holder of a token is being offered. Safe before sign-in. */
export async function previewInvitation(token: string): Promise<InvitationPreview> {
  const supabase = await userClient();
  const { data, error } = await supabase.rpc('preview_invitation', { raw_token: token });

  if (error !== null || data === null || (Array.isArray(data) && data.length === 0)) {
    return { status: 'invalid', organizationName: null, role: null, invitedEmail: null };
  }

  const row = (Array.isArray(data) ? data[0] : data) as {
    status: InvitationPreview['status'];
    organization_name: string | null;
    invited_role: WorkspaceRole | null;
    invited_email: string | null;
  };

  return {
    status: row.status,
    organizationName: row.organization_name,
    role: row.invited_role,
    invitedEmail: row.invited_email,
  };
}

/**
 * Turn a Postgres error into something a person can act on.
 *
 * The functions raise short machine-readable tokens on purpose — a message
 * written for a database log is the wrong thing to render on a settings page,
 * and the mapping belongs somewhere it can be read next to the UI that shows
 * it. Anything unrecognized falls through to a neutral failure rather than
 * leaking a raw SQLSTATE at a customer.
 */
export function membershipErrorMessage(raw: string | null | undefined): string {
  const text = (raw ?? '').toLowerCase();
  if (text.includes('already_member')) {
    return 'That person is already a member of this workspace.';
  }
  if (text.includes('not_authorized')) {
    return 'You do not have permission to do that.';
  }
  if (text.includes('owner_protected')) {
    return 'Only an Owner can change or remove another Owner.';
  }
  if (text.includes('last_owner')) {
    return 'A workspace must always have at least one Owner. Promote someone else first.';
  }
  if (text.includes('invitation_revoked')) {
    return 'That invitation was revoked. Ask for a new one.';
  }
  if (text.includes('invitation_expired')) {
    return 'That invitation has expired. Ask for a new one.';
  }
  if (text.includes('invitation_already_used')) {
    return 'That invitation has already been used.';
  }
  if (text.includes('invitation_email_mismatch')) {
    return 'This invitation was sent to a different email address than the one you are signed in with.';
  }
  if (text.includes('invalid_invitation')) {
    return 'That invitation link is not valid.';
  }
  if (text.includes('invalid_email')) {
    return 'That does not look like an email address.';
  }
  if (text.includes('invalid_role')) {
    return 'Invitations can grant Admin or Member only.';
  }
  return 'That did not work. Nothing was changed.';
}
