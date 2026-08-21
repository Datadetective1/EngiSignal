import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  MethodologyNote,
  SectionHeading,
  TableShell,
  Td,
  Th,
} from '@/components/ui/primitives';
import { loadWorkspace } from '@/lib/workspace';
import { userClient } from '@/lib/supabase/server';
import { emailConfigured } from '@/lib/email/send';
import { isSupabaseAuth } from '@/lib/auth';
import {
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  canManageMembers,
  isOwner,
  listInvitations,
  listMembers,
  type WorkspaceRole,
} from '@/lib/membership';
import {
  changeRoleAction,
  inviteMemberAction,
  removeMemberAction,
  resendInvitationAction,
  revokeInvitationAction,
} from './actions';

export const metadata: Metadata = { title: 'Members' };
export const dynamic = 'force-dynamic';

const NOTICES: Record<string, { tone: 'good' | 'warn' | 'bad'; message: string }> = {
  invited: { tone: 'good', message: 'Invitation sent.' },
  resent: { tone: 'good', message: 'Invitation resent. The previous link no longer works.' },
  invited_not_emailed: {
    tone: 'warn',
    message:
      'Invitation created, but this deployment cannot send email, so nothing was delivered. Set PILOT_NOTIFY_RESEND_API_KEY and PILOT_NOTIFY_FROM, then resend.',
  },
  invited_email_failed: {
    tone: 'warn',
    message:
      'Invitation created, but the email could not be delivered. Use Resend to try again.',
  },
  revoked: { tone: 'good', message: 'Invitation revoked. That link can no longer be used.' },
  removed: { tone: 'good', message: 'Member removed. Their access ended immediately.' },
  role_changed: { tone: 'good', message: 'Role updated.' },
  invalid_email: { tone: 'bad', message: 'That does not look like an email address.' },
  error: { tone: 'bad', message: 'That did not work. Nothing was changed.' },
};

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function daysUntil(iso: string): number {
  return Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000);
}

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; detail?: string }>;
}) {
  const params = await searchParams;
  const workspace = await loadWorkspace();
  const { organization, session } = workspace;

  const supabase = isSupabaseAuth() ? await userClient() : null;
  const { data: myRow } = supabase
    ? await supabase
        .from('organization_members')
        .select('role')
        .eq('organization_id', organization.id)
        .eq('user_id', session.userId)
        .maybeSingle()
    : { data: null };

  const myRole = (myRow?.role ?? null) as WorkspaceRole | null;
  const canManage = canManageMembers(myRole);
  const owner = isOwner(myRole);

  const members = await listMembers(organization.id, session.userId);
  const invitations = canManage ? await listInvitations(organization.id) : [];

  const notice = params.notice ? NOTICES[params.notice] : undefined;
  const detail = params.detail;

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Settings · Workspace"
        title="Members"
        description={`Everyone with access to ${organization.name}. Membership decides what a person can see — not who created the account.`}
      />

      {!isSupabaseAuth() && (
        <Card>
          <div className="px-5 py-4 text-[13px] leading-relaxed text-fg-muted">
            This deployment is running in evaluation mode with the local synthetic dataset, so there
            is no real account system and nobody to invite. Configure Supabase to use multi-user
            workspaces.
          </div>
        </Card>
      )}

      {notice !== undefined && (
        <div
          role="status"
          className={[
            'rounded-lg border px-4 py-3 text-[13px] leading-relaxed',
            notice.tone === 'good'
              ? 'border-emerald-600/30 bg-emerald-500/10 text-emerald-200'
              : notice.tone === 'warn'
                ? 'border-amber-600/30 bg-amber-500/10 text-amber-200'
                : 'border-red-600/30 bg-red-500/10 text-red-200',
          ].join(' ')}
        >
          {detail ?? notice.message}
        </div>
      )}

      {isSupabaseAuth() && canManage && !emailConfigured() && (
        <div
          role="status"
          className="rounded-lg border border-amber-600/30 bg-amber-500/10 px-4 py-3 text-[13px] leading-relaxed text-amber-200"
        >
          Email is not configured in this deployment, so invitations will be created but not
          delivered. Set <code>PILOT_NOTIFY_RESEND_API_KEY</code> and <code>PILOT_NOTIFY_FROM</code>{' '}
          to send them.
        </div>
      )}

      {isSupabaseAuth() && canManage && (
        <Card>
          <CardHeader
            title="Invite someone"
            description="They receive an email with a single-use link that expires in seven days."
          />
          <form action={inviteMemberAction} className="space-y-4 px-5 py-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-fg-muted">
                  Work email
                </span>
                <input
                  type="email"
                  name="email"
                  required
                  autoComplete="off"
                  placeholder="colleague@company.com"
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-[14px] text-fg outline-none focus:border-fg-muted"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-fg-muted">Role</span>
                <select
                  name="role"
                  defaultValue="member"
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-[14px] text-fg outline-none focus:border-fg-muted sm:w-40"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              <Button type="submit">Send invitation</Button>
            </div>
            <MethodologyNote>
              <strong>Member</strong> — {ROLE_DESCRIPTIONS.member} <strong>Admin</strong> —{' '}
              {ROLE_DESCRIPTIONS.admin} Only an Owner can promote someone to Owner, and a workspace
              always keeps at least one.
            </MethodologyNote>
          </form>
        </Card>
      )}

      <Card>
        <CardHeader
          title={`Members (${members.length})`}
          description="Everyone who can sign in and see this workspace."
        />
        <TableShell>
          <thead>
            <tr>
              <Th>Person</Th>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th>Joined</Th>
              {canManage && <Th align="right">Manage</Th>}
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              // An Admin may manage Members and other Admins, never an Owner.
              const targetIsOwner = member.role === 'owner';
              const mayManageThisRow = canManage && (!targetIsOwner || owner) && !member.isYou;

              return (
                <tr key={member.id}>
                  <Td>
                    <div className="font-medium text-fg">
                      {member.displayName ?? member.email.split('@')[0]}
                      {member.isYou && <span className="ml-2 text-[12px] text-fg-muted">(you)</span>}
                    </div>
                    <div className="text-[12px] text-fg-muted">{member.email}</div>
                  </Td>
                  <Td>
                    <Badge>{ROLE_LABELS[member.role]}</Badge>
                  </Td>
                  <Td>
                    <span className="text-emerald-300">Active</span>
                  </Td>
                  <Td>{formatDate(member.joinedAt)}</Td>
                  {canManage && (
                    <Td align="right">
                      {mayManageThisRow ? (
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <form action={changeRoleAction} className="flex items-center gap-1.5">
                            <input type="hidden" name="memberId" value={member.id} />
                            <select
                              name="role"
                              defaultValue={member.role}
                              aria-label={`Role for ${member.email}`}
                              className="rounded-md border border-border bg-surface px-2 py-1 text-[12px] text-fg"
                            >
                              <option value="member">Member</option>
                              <option value="admin">Admin</option>
                              {owner && <option value="owner">Owner</option>}
                            </select>
                            <Button type="submit" variant="secondary">
                              Save
                            </Button>
                          </form>
                          <form action={removeMemberAction}>
                            <input type="hidden" name="memberId" value={member.id} />
                            <Button type="submit" variant="secondary">
                              Remove
                            </Button>
                          </form>
                        </div>
                      ) : (
                        <span className="text-[12px] text-fg-muted">
                          {member.isYou
                            ? '—'
                            : targetIsOwner
                              ? 'Owner — only an Owner can change this'
                              : '—'}
                        </span>
                      )}
                    </Td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      </Card>

      {canManage && (
        <Card>
          <CardHeader
            title={`Pending invitations (${invitations.length})`}
            description="Sent but not yet accepted. Revoking one makes its link stop working immediately."
          />
          {invitations.length === 0 ? (
            <EmptyState
              title="No pending invitations"
              description="Invite someone above and they will appear here until they accept."
            />
          ) : (
            <TableShell>
              <thead>
                <tr>
                  <Th>Email</Th>
                  <Th>Role</Th>
                  <Th>Status</Th>
                  <Th>Invited</Th>
                  <Th>Expires</Th>
                  <Th align="right">Manage</Th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((invitation) => {
                  const remaining = daysUntil(invitation.expiresAt);
                  return (
                    <tr key={invitation.id}>
                      <Td>
                        <div className="font-medium text-fg">{invitation.email}</div>
                        <div className="text-[12px] text-fg-muted">
                          by {invitation.invitedByEmail}
                        </div>
                      </Td>
                      <Td>
                        <Badge>{ROLE_LABELS[invitation.role]}</Badge>
                      </Td>
                      <Td>
                        {invitation.status === 'expired' ? (
                          <span className="text-amber-300">Expired</span>
                        ) : (
                          <span className="text-fg-muted">Pending</span>
                        )}
                      </Td>
                      <Td>{formatDate(invitation.createdAt)}</Td>
                      <Td>
                        {formatDate(invitation.expiresAt)}
                        {invitation.status === 'pending' && (
                          <span className="ml-1.5 text-[12px] text-fg-muted">
                            ({remaining} {remaining === 1 ? 'day' : 'days'})
                          </span>
                        )}
                      </Td>
                      <Td align="right">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <form action={resendInvitationAction}>
                            <input type="hidden" name="email" value={invitation.email} />
                            <input type="hidden" name="role" value={invitation.role} />
                            <Button type="submit" variant="secondary">
                              Resend
                            </Button>
                          </form>
                          <form action={revokeInvitationAction}>
                            <input type="hidden" name="invitationId" value={invitation.id} />
                            <Button type="submit" variant="secondary">
                              Revoke
                            </Button>
                          </form>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </TableShell>
          )}
        </Card>
      )}

      {!canManage && isSupabaseAuth() && (
        <MethodologyNote>
          You are a {ROLE_LABELS[myRole ?? 'member']} in this workspace, so you can use everything in
          the product but cannot invite or remove people. An Owner or Admin can change that.
        </MethodologyNote>
      )}

      <div className="text-[13px] text-fg-muted">
        <Link href="/app/settings" className="underline underline-offset-4 hover:text-fg">
          Back to settings
        </Link>
      </div>
    </div>
  );
}
