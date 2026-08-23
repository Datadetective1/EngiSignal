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

/**
 * Titles that are not a first name, so "Reply to Dr" never goes out.
 * Compared without the trailing full stop.
 */
const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'prof', 'sir', 'eng', 'ing']);

/**
 * The prospect's first name, when one can be taken safely.
 *
 * Presentation only — this never touches the reply address. Returns null
 * rather than guessing, because "Reply to prospect" is a perfectly good button
 * and "Reply to d.whitfield@example-aero.com" is not.
 *
 * The value is whatever the prospect typed into a public form, so it is capped,
 * required to contain a letter, and rejected if it looks like an address. Case
 * is left exactly as submitted: correcting "van der Berg" or a name in another
 * script does more harm than the tidiness is worth.
 */
export function contactFirstName(name: string | null | undefined): string | null {
  if (typeof name !== 'string') return null;

  const tokens = name
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/[.,;:]+$/, ''))
    .filter((token) => token.length > 0);

  // Skip a leading honorific, but only if something follows it.
  const first = HONORIFICS.has((tokens[0] ?? '').toLowerCase()) ? tokens[1] : tokens[0];
  if (first === undefined) return null;

  if (first.length > 40) return null;
  if (first.includes('@')) return null;
  if (!/\p{L}/u.test(first)) return null;

  return first;
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

  // Primary challenge leaves the row list and becomes the section's highlight:
  // it is the reason the prospect made contact, not another attribute of them.
  const environment = rows([
    ['Major vendors', request.majorVendors],
    ['Renewal timing', request.renewalTiming],
  ]);
  const challenge =
    request.primaryChallenge === null || request.primaryChallenge === undefined || request.primaryChallenge === ''
      ? undefined
      : { label: 'Primary challenge', value: request.primaryChallenge };

  /**
   * The decision strip. Values are the prospect's own, verbatim — a shortened
   * "Over-licensed" would read better in three columns but it would be our
   * words attributed to them, and every other number in this product carries
   * its provenance.
   */
  const summary = [
    { label: 'Renewal', value: request.renewalTiming },
    { label: 'Software spend', value: request.softwareSpendRange },
    { label: 'Primary concern', value: request.primaryChallenge },
  ].filter((item): item is { label: string; value: string } => {
    return item.value !== null && item.value !== undefined && item.value !== '';
  });

  const blocks: Block[] = [
    ...(summary.length === 0 ? [] : [{ kind: 'summary' as const, items: summary }]),
    ...section('Contact', contact),
    ...section('Organization', organization),
    // The section survives on the highlight alone if both rows are blank.
    ...(environment.length === 0 && challenge === undefined
      ? []
      : [{ kind: 'sections' as const, label: 'Software environment', rows: environment, highlight: challenge }]),
  ];

  if (request.message !== null && request.message !== '') {
    blocks.push({ kind: 'message', label: 'Message', body: request.message });
  }

  // The reply button. `safeUrl` in the renderer drops anything that is not
  // plainly mailto: or http(s), so a malformed address yields no button rather
  // than a broken one — and the message still carries the address as text in
  // the Contact section either way.
  if (request.workEmail) {
    const firstName = contactFirstName(request.name);
    blocks.push({
      kind: 'cta',
      // Presentation only. The address below is unchanged either way.
      label: firstName === null ? 'Reply to prospect' : `Reply to ${firstName}`,
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
