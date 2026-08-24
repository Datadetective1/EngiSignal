import type { PilotRequest } from '@/lib/domain/types';
import { emailAliases } from '@/config/email';
import { renderEmail, type Block, type EmailDoc } from '../design';
import { contactFirstName } from './pilot-request';

/**
 * ── WHAT THE PROSPECT GETS ──────────────────────────────────────────────────
 *
 * A director hands over their renewal date and spend band through a form on a
 * website they found this week, and until now received nothing in writing. The
 * on-screen confirmation vanishes the moment they close the tab; there is no
 * record to forward to a colleague and nothing to point at if the reply takes a
 * few days.
 *
 * This is the counterpart to the operator alert, and it is deliberately NOT the
 * same email with a different recipient:
 *
 *   The operator alert is an internal working document. It carries the request
 *   id, the spend band, the employee counts, the vendor list and the message,
 *   because the person reading it is deciding whether to reply today.
 *
 *   This one is a customer communication. It confirms receipt, reflects back
 *   only what the prospect would expect to see, and says what happens next. It
 *   carries no request id, no internal reference, no scoring and nothing about
 *   their estate beyond the two fields they would recognise as their own.
 *
 * Three things it must never do:
 *
 *   Promise a response time. We have not committed to one, and a date in an
 *   automated email becomes a commitment the moment somebody reads it.
 *
 *   Imply a connector exists. No connector is implemented (BRAND.md §9). The
 *   pilot genuinely runs on exports, so saying so is both true and reassuring —
 *   it is the honest version of "you do not need to integrate anything".
 *
 *   Restate their whole submission. Echoing spend, headcount and vendor names
 *   back into an inbox we do not control adds exposure and tells them nothing
 *   they did not just type.
 */

export const PILOT_ACKNOWLEDGEMENT_SUBJECT = 'We received your EngiSignal pilot request';

export function pilotAcknowledgementDoc(request: PilotRequest): EmailDoc {
  const firstName = contactFirstName(request.name);

  // Only what the prospect would recognise as their own, and only when they
  // supplied it. Spend, headcount, vendors and their message stay out.
  const received: Array<{ label: string; value: string }> = [
    { label: 'Company', value: request.company },
    { label: 'Contact', value: request.name },
  ];
  if (request.renewalTiming) received.push({ label: 'Renewal timing', value: request.renewalTiming });
  if (request.primaryChallenge) {
    received.push({ label: 'Primary challenge', value: request.primaryChallenge });
  }

  const blocks: Block[] = [
    {
      kind: 'sections',
      label: 'What we received',
      rows: received,
    },
    {
      kind: 'paragraph',
      // "We will read it and come back to you" without a date. Anything more
      // specific is a commitment nobody made.
      text: 'We will review what you have told us to work out whether a 30-day pilot is a good fit for your organization, and come back to you either way.',
    },
    {
      kind: 'paragraph',
      text: 'A pilot runs against your own usage and contract data. Exports from the license managers you already run are enough to begin — no production-system integration is required.',
    },
    {
      kind: 'notice',
      text: `If you would like to add anything in the meantime, reply to this email or write to ${emailAliases.pilot}.`,
    },
  ];

  return {
    preheader: `We have your pilot request for ${request.company}.`,
    title: 'Pilot request received',
    subtitle:
      firstName === null
        ? 'Thank you for your interest in an EngiSignal pilot.'
        : `Thank you, ${firstName} — your request is with us.`,
    blocks,
    footerContacts: ['pilot'],
  };
}

export function renderPilotAcknowledgementEmail(request: PilotRequest): {
  subject: string;
  html: string;
  text: string;
} {
  const { html, text } = renderEmail(pilotAcknowledgementDoc(request));
  return { subject: PILOT_ACKNOWLEDGEMENT_SUBJECT, html, text };
}
