import type { PilotRequest } from '@/lib/domain/types';
import { renderEmail, type Block, type EmailDoc, type Row, type Tone } from '../design';

/**
 * ── THE PILOT REQUEST ALERT ─────────────────────────────────────────────────
 *
 * This is read on a phone, usually within a minute of arriving, and the only
 * question it has to answer immediately is "do I reply to this now or later?".
 * So the renewal timing is a badge at the top rather than a line in the middle
 * of a list, and the reply action is a button rather than something the reader
 * assembles by copying an address.
 *
 * It carries ONE request. `pilot_requests` holds other companies' contact
 * details, and the way that leaks is a well-meaning "recent requests" summary.
 * Nothing here reaches for a second row.
 *
 * It is an internal alert, but it is not internal-looking: it goes to an alias
 * that forwards to a real mailbox, may be forwarded on to a colleague, and may
 * be read in front of somebody. No environment-variable names, no diagnostic
 * notes, no test language.
 */

/**
 * How loudly the badge should read.
 *
 * Urgency here is operator urgency — how fast this needs an answer — which is
 * exactly what renewal timing decides. An unrecognised value falls back to
 * neutral rather than guessing.
 */
function renewalTone(timing: string | null | undefined): Tone {
  switch (timing) {
    case 'Within 30 days':
      return 'danger';
    case 'Within 90 days':
      return 'warning';
    case 'Within 6 months':
      return 'accent';
    default:
      return 'neutral';
  }
}

/**
 * A timestamp a person can read.
 *
 * The stored value is an ISO string. Printing it raw is the single clearest
 * tell that an email is unedited database output, and this one is read by
 * directors and procurement leads. UTC is stated rather than converted,
 * because the server's timezone is not the reader's and a silently localised
 * time is worse than an explicit one.
 */
function formatReceived(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return iso;
  const date = when.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const time = when.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
  return `${date} at ${time} UTC`;
}

/** Drop rows the prospect left blank rather than printing empty labels. */
function rows(entries: Array<[label: string, value: string | null | undefined, mono?: boolean]>): Row[] {
  return entries
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([label, value, mono]) => ({ label, value: String(value), mono }));
}

/** Only include a section when something survived the filter. */
function section(label: string, sectionRows: Row[]): Block[] {
  return sectionRows.length === 0 ? [] : [{ kind: 'sections', label, rows: sectionRows }];
}

export function pilotRequestSubject(request: PilotRequest): string {
  return `Pilot request — ${request.company}${
    request.renewalTiming ? ` (renewal ${request.renewalTiming.toLowerCase()})` : ''
  }`;
}

export function pilotRequestDoc(request: PilotRequest): EmailDoc {
  const contact = rows([
    ['Company', request.company],
    ['Contact', request.name],
    ['Job title', request.jobTitle],
    ['Work email', request.workEmail],
  ]);

  const organization = rows([
    ['Annual software spend', request.softwareSpendRange],
    ['Employees', request.approximateEmployees],
    ['Engineering employees', request.engineeringEmployees],
  ]);

  const environment = rows([
    ['Major vendors', request.majorVendors],
    ['Renewal timing', request.renewalTiming],
    ['Primary challenge', request.primaryChallenge],
  ]);

  const blocks: Block[] = [
    ...section('Contact', contact),
    ...section('Organization', organization),
    ...section('Software environment', environment),
  ];

  if (request.message !== null && request.message !== '') {
    blocks.push({ kind: 'message', label: 'Message', body: request.message });
  }

  // The reply button. `safeUrl` in the renderer drops anything that is not
  // plainly mailto: or http(s), so a malformed address yields no button rather
  // than a broken one — and the message still carries the address as text in
  // the Contact section either way.
  if (request.workEmail) {
    blocks.push({
      kind: 'cta',
      label: 'Reply to prospect',
      href: `mailto:${request.workEmail}?subject=${encodeURIComponent(
        `EngiSignal — your pilot enquiry (${request.company})`,
      )}`,
      note: 'Replying to this email reaches the prospect directly.',
    });
  }

  blocks.push({
    kind: 'meta',
    rows: rows([
      ['Received', formatReceived(request.createdAt)],
      ['Request ID', request.id, true],
    ]),
  });

  return {
    preheader: `${request.company}${request.renewalTiming ? ` · renewal ${request.renewalTiming.toLowerCase()}` : ''}`,
    title: 'New pilot request',
    subtitle: `${request.company} asked to be scoped for a 30-day pilot.`,
    badge: request.renewalTiming
      ? { label: `Renewal ${request.renewalTiming.toLowerCase()}`, tone: renewalTone(request.renewalTiming) }
      : undefined,
    blocks,
    footerContacts: ['pilot'],
  };
}

export function renderPilotRequestEmail(request: PilotRequest): {
  subject: string;
  html: string;
  text: string;
} {
  const { html, text } = renderEmail(pilotRequestDoc(request));
  return { subject: pilotRequestSubject(request), html, text };
}
