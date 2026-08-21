import 'server-only';
import { sendEmail, type SendResult } from './send';
import type { WorkspaceRole } from '@/lib/membership';

/**
 * The invitation email.
 *
 * Written for someone who may never have heard of EngiSignal, because that is
 * the common case: an owner invites a colleague, and the colleague's first
 * contact with the product is this message. It therefore says who invited them,
 * what they are being invited to, what the product is in one line, and when the
 * link stops working — and then gets out of the way.
 *
 * The link is the only secret. It is never logged and never stored; the
 * database holds a SHA-256 of it and nothing else.
 */

export interface InvitationEmailInput {
  to: string;
  organizationName: string;
  role: WorkspaceRole;
  invitedByEmail: string;
  acceptUrl: string;
  expiresAt: string;
}

function roleSentence(role: WorkspaceRole): string {
  if (role === 'admin') {
    return 'You will be an Admin, so you can use everything in the workspace and invite other people.';
  }
  return 'You will be a Member, so you can use everything in the workspace.';
}

function formatExpiry(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return 'in seven days';
  return `on ${when.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`;
}

export function composeInvitation(input: InvitationEmailInput): { subject: string; text: string; html: string } {
  const subject = `${input.invitedByEmail} invited you to ${input.organizationName} on EngiSignal`;

  const text = [
    `${input.invitedByEmail} has invited you to join the ${input.organizationName} workspace on EngiSignal.`,
    '',
    'EngiSignal reads your existing engineering software licence exports and shows what is',
    'actually used, what is over-provisioned, and what is worth renegotiating before renewal.',
    '',
    roleSentence(input.role),
    '',
    'Accept the invitation:',
    input.acceptUrl,
    '',
    `This link works once and expires ${formatExpiry(input.expiresAt)}.`,
    '',
    `It was sent to ${input.to}. You will need to sign in with that address, or create an`,
    'account using it, to accept.',
    '',
    'If you were not expecting this, you can ignore this email. Nothing happens until you',
    'accept, and the person who invited you can revoke it at any time.',
  ].join('\n');

  // Deliberately plain. A layout-table newsletter from an unknown sender asking
  // someone to click a link is exactly what a phishing filter is looking for.
  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:540px">
  <p><strong>${escapeHtml(input.invitedByEmail)}</strong> has invited you to join the
     <strong>${escapeHtml(input.organizationName)}</strong> workspace on EngiSignal.</p>
  <p style="color:#555">EngiSignal reads your existing engineering software licence exports and shows what is
     actually used, what is over-provisioned, and what is worth renegotiating before renewal.</p>
  <p>${escapeHtml(roleSentence(input.role))}</p>
  <p style="margin:28px 0">
    <a href="${escapeAttr(input.acceptUrl)}"
       style="background:#111;color:#fff;text-decoration:none;padding:11px 20px;border-radius:6px;display:inline-block">
      Accept invitation
    </a>
  </p>
  <p style="color:#555;font-size:13px">
    This link works once and expires ${escapeHtml(formatExpiry(input.expiresAt))}.
    It was sent to ${escapeHtml(input.to)} — you will need to sign in with that address,
    or create an account using it, to accept.
  </p>
  <p style="color:#777;font-size:13px">
    If you were not expecting this you can ignore this email. Nothing happens until you accept,
    and the person who invited you can revoke it at any time.
  </p>
  <p style="color:#999;font-size:12px;word-break:break-all">${escapeHtml(input.acceptUrl)}</p>
</div>`.trim();

  return { subject, text, html };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

export async function sendInvitationEmail(input: InvitationEmailInput): Promise<SendResult> {
  const { subject, text, html } = composeInvitation(input);
  return sendEmail({
    to: input.to,
    subject,
    text,
    html,
    // So a confused invitee replies to the colleague who invited them rather
    // than to a no-reply address.
    replyTo: input.invitedByEmail,
  });
}
