import 'server-only';
import { emailAliases } from '@/config/email';
import { sendEmail, type SendResult } from './send';
import {
  renderPasswordChangedEmail,
  type PasswordChangedInput,
} from './templates/password-changed';

/**
 * Security notices sent to an account holder about their own account.
 *
 * Separate from invitation.ts because the audience is different in a way that
 * matters: an invitation is addressed to somebody who may not have an account
 * yet, while everything here is addressed to the account itself, at the address
 * already on it. Nothing in this file ever takes a recipient from a form.
 *
 * `Reply-To` is the security alias rather than the sender. Somebody replying to
 * one of these is usually replying because it alarmed them, and that reply
 * needs to reach the address that reads security mail.
 */
export async function sendPasswordChangedEmail(
  input: PasswordChangedInput,
): Promise<SendResult> {
  const { subject, html, text } = renderPasswordChangedEmail(input);
  return sendEmail({
    to: input.email,
    subject,
    text,
    html,
    replyTo: emailAliases.security,
  });
}
