/**
 * Render every email template to disk for review.
 *
 * Writes the HTML and the plain-text alternative side by side, so the two can
 * be compared rather than assumed equivalent. Nothing here is part of the
 * running application; it exists so a template change can be looked at before
 * it is sent to anybody.
 *
 *   npx tsx scripts/preview-emails.mts            (or: npm run preview:emails)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PilotRequest } from '../lib/domain/types';
import { renderPilotRequestEmail } from '../lib/email/templates/pilot-request';
import { renderInvitationEmail } from '../lib/email/templates/invitation';

const OUT = process.env.EMAIL_PREVIEW_DIR ?? join(process.cwd(), '.email-preview');
mkdirSync(OUT, { recursive: true });

const pilot: PilotRequest = {
  id: '3f7c1e02-9b1a-4a4e-8c22-6f2b9c0f1a55',
  name: 'Dana Whitfield',
  workEmail: 'd.whitfield@example-aero.com',
  company: 'Example Aerostructures',
  jobTitle: 'Director of Engineering Systems',
  approximateEmployees: '1,000 – 5,000',
  engineeringEmployees: '500 – 2,000',
  softwareSpendRange: '$2M – $10M',
  majorVendors: 'Ansys, Siemens NX, MATLAB',
  renewalTiming: 'Within 90 days',
  primaryChallenge: 'We suspect we are over-licensed',
  message:
    'Our Ansys HPC renewal lands in March and we have never been able to say what the right quantity is. Finance asked for a defensible number this year.',
  createdAt: '2026-08-23T09:15:00.000Z',
};

/** The same request with every optional field absent. */
const sparse: PilotRequest = {
  ...pilot,
  id: '9c2f4a71-0b53-4e77-9d18-2ab5c7e40f31',
  company: 'Northvane Systems',
  jobTitle: '',
  majorVendors: '',
  message: null,
  renewalTiming: 'Within 30 days',
};

const invitation = {
  to: 'colleague@northvane.example',
  organizationName: 'Northvane Aerospace',
  role: 'admin' as const,
  invitedByEmail: 'lead@northvane.example',
  acceptUrl: 'https://www.engisignal.com/invite/2f9c1a77b4e3',
  expiresAt: '2026-09-15T12:00:00.000Z',
};

const templates = [
  ['pilot-request', renderPilotRequestEmail(pilot)],
  ['pilot-request-sparse', renderPilotRequestEmail(sparse)],
  ['invitation', renderInvitationEmail(invitation)],
  ['invitation-member', renderInvitationEmail({ ...invitation, role: 'member' })],
] as const;

for (const [name, rendered] of templates) {
  writeFileSync(join(OUT, `${name}.html`), rendered.html, 'utf8');
  writeFileSync(join(OUT, `${name}.txt`), rendered.text, 'utf8');
  console.log(
    `${name.padEnd(22)} subject: ${rendered.subject}\n${' '.repeat(22)} html ${String(rendered.html.length).padStart(6)} bytes   text ${String(rendered.text.length).padStart(5)} bytes`,
  );
}

console.log(`\nwritten to ${OUT}`);
