/**
 * Generate the Supabase Auth email templates in EngiSignal's house style.
 *
 * These are the only two EngiSignal emails that are NOT sent by this codebase:
 * Supabase sends them, from templates stored in the Supabase dashboard. So this
 * script produces HTML to paste there rather than anything the app renders.
 *
 * The link expression is left as a sentinel — {{LINK}} — on purpose. The app
 * routes confirmations to /auth/confirm (a two-step page) rather than to the
 * token-consuming callback, because the PKCE code verifier lives in a cookie in
 * whichever browser started sign-up and email links get opened somewhere else.
 * Guessing at that URL from here would risk breaking sign-up for everybody, so
 * the operator pastes their existing expression in.
 *
 *   npm run templates:supabase
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderEmail, type EmailDoc } from '../lib/email/design';

const OUT = join(process.cwd(), 'docs', 'supabase-auth-templates');
mkdirSync(OUT, { recursive: true });

/** Stand-in that survives safeUrl(), swapped for the sentinel after rendering. */
const HREF_PLACEHOLDER = 'https://engisignal.invalid/__LINK__';

const confirmSignup: EmailDoc = {
  preheader: 'Confirm your email address to finish setting up your EngiSignal account.',
  title: 'Confirm your email address',
  subtitle: 'One step left before you can sign in to EngiSignal.',
  blocks: [
    {
      kind: 'paragraph',
      text: 'EngiSignal turns your engineering software usage, licences and contracts into renewal, cost and capacity decisions you can defend.',
    },
    { kind: 'cta', label: 'Confirm email address', href: HREF_PLACEHOLDER },
    {
      kind: 'notice',
      text: 'If you did not create an EngiSignal account, you can ignore this email — no account is active until this link is used.',
    },
  ],
  footerContacts: ['support', 'security'],
};

const resetPassword: EmailDoc = {
  preheader: 'Reset the password on your EngiSignal account.',
  title: 'Reset your password',
  subtitle: 'Use the link below to choose a new password.',
  blocks: [
    { kind: 'cta', label: 'Choose a new password', href: HREF_PLACEHOLDER },
    {
      kind: 'notice',
      text: 'If you did not ask to reset your password, you can ignore this email — your current password stays active and nothing changes until this link is used.\n\nIf you receive these repeatedly and did not request them, tell us at the security address below.',
    },
  ],
  footerContacts: ['support', 'security'],
};

const templates = [
  ['confirm-signup', confirmSignup],
  ['reset-password', resetPassword],
] as const;

for (const [name, doc] of templates) {
  const { html, text } = renderEmail(doc);
  const withSentinel = (value: string) => value.split(HREF_PLACEHOLDER).join('{{LINK}}');
  writeFileSync(join(OUT, `${name}.html`), withSentinel(html), 'utf8');
  writeFileSync(join(OUT, `${name}.txt`), withSentinel(text), 'utf8');
  console.log(`${name.padEnd(16)} ${String(withSentinel(html).length).padStart(6)} bytes html`);
}

console.log(`\nwritten to ${OUT}`);
console.log('Replace {{LINK}} with the href expression already in your Supabase template.');
