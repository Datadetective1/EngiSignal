import 'server-only';
import { sendEmail, type SendResult } from './send';
import {
  invitationDoc,
  invitationSubject,
  renderInvitationEmail,
  type InvitationEmailInput,
} from './templates/invitation';

/**
 * Sending the workspace invitation.
 *
 * The message itself is described in lib/email/templates/invitation.ts and
 * rendered by the shared design system, so an invitation and a pilot alert
 * look like they came from the same company. This file is the transport seam
 * and nothing else.
 */

export type { InvitationEmailInput };
export { invitationDoc, invitationSubject };

/** Subject, plain text and HTML for one invitation. */
export function composeInvitation(input: InvitationEmailInput): {
  subject: string;
  text: string;
  html: string;
} {
  return renderInvitationEmail(input);
}

export async function sendInvitationEmail(input: InvitationEmailInput): Promise<SendResult> {
  const { subject, text, html } = composeInvitation(input);
  return sendEmail({
    to: input.to,
    subject,
    text,
    html,
    // So a confused invitee replies to the colleague who invited them rather
    // than to a sender address nobody reads. Unchanged.
    replyTo: input.invitedByEmail,
  });
}
