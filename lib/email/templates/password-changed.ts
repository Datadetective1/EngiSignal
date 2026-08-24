import { emailAliases } from '@/config/email';
import { renderEmail, type EmailDoc } from '../design';

/**
 * ── YOUR PASSWORD WAS CHANGED ───────────────────────────────────────────────
 *
 * This is a security control, not a courtesy. Without it, an attacker who
 * completes a password reset leaves the account's real owner with no signal at
 * all — the first thing they notice is that their own password stopped working,
 * by which time the session is someone else's.
 *
 * It goes to the address on the account, which is the address the reset link
 * was sent to. That is the point: if the reset was not you, the mail lands
 * where you can see it.
 *
 * It carries no link. A "wasn't me?" button in an email about unauthorised
 * access is a phishing template, and anyone who receives this while alarmed is
 * exactly the person who should be typing a known address rather than clicking
 * whatever arrived. The security alias is given as text.
 */

export const PASSWORD_CHANGED_SUBJECT = 'Your EngiSignal password was changed';

export interface PasswordChangedInput {
  /** The account the change was applied to. */
  email: string;
  /** When it happened, ISO. Rendered in UTC and labelled as such. */
  changedAt: string;
}

function formatWhen(iso: string): string | null {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;
  const date = when.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const time = when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  return `${date} at ${time} UTC`;
}

export function passwordChangedDoc(input: PasswordChangedInput): EmailDoc {
  const when = formatWhen(input.changedAt);

  return {
    preheader: 'The password on your EngiSignal account was changed.',
    title: 'Your password was changed',
    subtitle: 'This is a confirmation that the password on your EngiSignal account was just changed.',
    blocks: [
      {
        kind: 'sections',
        label: 'Account',
        rows: [
          { label: 'Email', value: input.email },
          ...(when === null ? [] : [{ label: 'Changed', value: when }]),
        ],
      },
      {
        kind: 'paragraph',
        text: 'If this was you, there is nothing to do. You can sign in with your new password.',
      },
      {
        kind: 'notice',
        // No link, deliberately. See the note at the top of this file.
        text: `If this was not you, your account may be compromised. Write to ${emailAliases.security} straight away, and do not use any link in an email you were not expecting.`,
      },
    ],
    footerContacts: ['support', 'security'],
  };
}

export function renderPasswordChangedEmail(input: PasswordChangedInput): {
  subject: string;
  html: string;
  text: string;
} {
  const { html, text } = renderEmail(passwordChangedDoc(input));
  return { subject: PASSWORD_CHANGED_SUBJECT, html, text };
}
