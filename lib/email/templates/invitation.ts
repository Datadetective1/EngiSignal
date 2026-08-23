import type { WorkspaceRole } from '@/lib/membership';
import { renderEmail, type Block, type EmailDoc } from '../design';

/**
 * ── THE WORKSPACE INVITATION ────────────────────────────────────────────────
 *
 * Written for someone who may never have heard of EngiSignal, because that is
 * the common case: an owner invites a colleague, and the colleague's first
 * contact with the product is this message. It therefore says who invited them,
 * what they are being invited to, what the product is in one line, what they
 * will be able to do, when the link stops working — and then gets out of the
 * way.
 *
 * The link is the only secret. It is never logged and never stored; the
 * database holds a SHA-256 of it and nothing else. Nothing about the token's
 * single-use behaviour, its expiry or its routing is decided here — this file
 * only describes how the message reads.
 *
 * It stays deliberately plain in tone. A layout-heavy newsletter from an
 * unknown sender asking somebody to click a link is what a phishing filter is
 * built to catch, and what a cautious engineer is built to ignore.
 */

export interface InvitationEmailInput {
  to: string;
  organizationName: string;
  role: WorkspaceRole;
  invitedByEmail: string;
  acceptUrl: string;
  expiresAt: string;
}

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  analyst: 'Analyst',
  viewer: 'Viewer',
};

function roleLabel(role: WorkspaceRole): string {
  return ROLE_LABEL[role] ?? 'Member';
}

function roleSentence(role: WorkspaceRole): string {
  if (role === 'owner') {
    return 'As an Owner you can use everything in the workspace, invite people and manage billing.';
  }
  if (role === 'admin') {
    return 'As an Admin you can use everything in the workspace and invite other people.';
  }
  return 'As a Member you can use everything in the workspace.';
}

function formatExpiry(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return 'in seven days';
  return `on ${when.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`;
}

export function invitationSubject(input: InvitationEmailInput): string {
  return `${input.invitedByEmail} invited you to ${input.organizationName} on EngiSignal`;
}

export function invitationDoc(input: InvitationEmailInput): EmailDoc {
  const blocks: Block[] = [
    {
      kind: 'paragraph',
      text: 'EngiSignal reads your existing engineering software licence exports and shows what is actually used, what is over-provisioned, and what is worth renegotiating before renewal.',
    },
    {
      kind: 'sections',
      label: 'Invitation',
      rows: [
        { label: 'Workspace', value: input.organizationName },
        { label: 'Invited by', value: input.invitedByEmail },
        { label: 'Your role', value: roleLabel(input.role) },
        { label: 'Sent to', value: input.to },
      ],
    },
    {
      kind: 'cta',
      label: 'Join workspace',
      href: input.acceptUrl,
      note: `This link works once and expires ${formatExpiry(input.expiresAt)}.`,
    },
    // A paragraph rather than a boxed notice, so the single boxed block below
    // is unmistakably the security one. Two stacked boxes read as equal weight
    // and the reader skips both.
    {
      kind: 'paragraph',
      text: `${roleSentence(input.role)}\nSign in with ${input.to}, or create an account using that address, to accept.`,
    },
    {
      kind: 'notice',
      text: 'This invitation was intended for you alone and grants access to another organization’s data. Do not forward it. If you were not expecting it you can ignore this email — nothing happens until you accept, and the person who invited you can revoke it at any time.',
    },
  ];

  return {
    preheader: `${input.invitedByEmail} invited you to ${input.organizationName} as ${roleLabel(input.role)}.`,
    title: 'You have been invited to EngiSignal',
    subtitle: `${input.invitedByEmail} has invited you to join the ${input.organizationName} workspace.`,
    blocks,
    footerContacts: ['support', 'security'],
    footerNote: 'If a link in this email looks wrong, do not click it — forward the message to the security address above.',
  };
}

export function renderInvitationEmail(input: InvitationEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const { html, text } = renderEmail(invitationDoc(input));
  return { subject: invitationSubject(input), html, text };
}
