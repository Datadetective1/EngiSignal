import 'server-only';
import type { PilotRequest } from '@/lib/domain/types';

/**
 * ── TELLING THE OPERATOR A PILOT REQUEST ARRIVED ────────────────────────────
 *
 * Requests are stored and nothing announces them. Until this existed, reading
 * the queue was a manual daily task, and a lead that arrived on a Friday sat
 * unread until somebody thought to look.
 *
 * Three rules shape everything below.
 *
 * The prospect's form must never fail because of this. Their request is already
 * durably stored by the time we get here; returning an error afterwards would
 * tell somebody their enquiry was lost when it is safely in the database, and
 * they would either give up or submit it again. Every failure path here is
 * swallowed and reported as an outcome, never thrown.
 *
 * It must never hang. This runs inside the request that answers the prospect,
 * so the provider gets a hard timeout — a notification that takes eight seconds
 * to fail has already cost more than it is worth.
 *
 * It carries one request only. The operator is told about the enquiry that just
 * arrived and nothing else: no digest, no recent-requests list, no counts. The
 * `pilot_requests` table holds other companies' contact details, and the way
 * that leaks is a well-meaning summary line.
 */

export type NotifyOutcome = 'sent' | 'skipped' | 'failed';

/**
 * What happened, in enough detail to act on.
 *
 * `detail` carries the provider's own status and message on failure. Resend
 * rejected every send for a day with `422 validation_error: Invalid from
 * field`, and none of that reached anyone: the outcome was a console line in a
 * log nobody was reading, so the product's answer to "was this lead announced?"
 * was silence. It is recorded against the request now.
 */
export interface NotifyResult {
  outcome: NotifyOutcome;
  detail: string | null;
}

/**
 * Whether operator notification is configured in this environment.
 *
 * Reports presence, never values. Vercel applies an environment change only on
 * a new deployment, so "I set the variables" and "the running build can see
 * them" are different facts -- and the difference is invisible from outside,
 * because an unconfigured send is skipped silently by design. This is how an
 * operator tells the two apart without reading logs.
 */
export function pilotNotificationConfigured(): boolean {
  return readConfig() !== null;
}

/** Hard ceiling on how long a prospect waits for our own bookkeeping. */
const SEND_TIMEOUT_MS = 4_000;

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

interface NotifyConfig {
  apiKey: string;
  to: string;
  from: string;
}

/**
 * Configuration, or null when notification is not set up.
 *
 * Absent configuration is a supported state, not an error: the product works
 * without it and every environment except production runs without it. It must
 * be distinguishable from a failure, which is why `skipped` exists.
 */
function readConfig(): NotifyConfig | null {
  const apiKey = process.env.PILOT_NOTIFY_RESEND_API_KEY;
  const to = process.env.PILOT_NOTIFY_TO;
  const from = process.env.PILOT_NOTIFY_FROM;
  if (!apiKey || !to || !from) return null;
  return { apiKey, to, from };
}

/** Everything an operator needs to decide whether to reply, and how. */
export function composeNotification(request: PilotRequest): { subject: string; text: string } {
  const line = (label: string, value: string | null | undefined) =>
    value === null || value === undefined || value === '' ? null : `${label}: ${value}`;

  const body = [
    line('Company', request.company),
    line('Contact', request.name),
    line('Job title', request.jobTitle),
    line('Work email', request.workEmail),
    '',
    line('Annual software spend', request.softwareSpendRange),
    line('Renewal timing', request.renewalTiming),
    line('Employees', request.approximateEmployees),
    line('Engineering employees', request.engineeringEmployees),
    line('Major vendors', request.majorVendors),
    line('Primary challenge', request.primaryChallenge),
    request.message === null || request.message === '' ? null : `\nMessage:\n${request.message}`,
    '',
    `Received: ${request.createdAt}`,
    `Request id: ${request.id}`,
  ]
    .filter((entry): entry is string => entry !== null)
    .join('\n');

  return {
    // Renewal timing is in the subject because it is the one field that decides
    // whether this is answered today or this week.
    subject: `Pilot request — ${request.company}${
      request.renewalTiming ? ` (renewal ${request.renewalTiming.toLowerCase()})` : ''
    }`,
    text: body,
  };
}

/** Provider errors can be long; keep enough to diagnose, not enough to bloat. */
const DETAIL_LIMIT = 300;

/**
 * Notify the operator that a pilot request was stored.
 *
 * Never throws. Returns what happened, and why when it failed, so the caller
 * can record it rather than having to decide what a failure means.
 */
export async function notifyPilotRequest(request: PilotRequest): Promise<NotifyResult> {
  const config = readConfig();
  if (config === null) return { outcome: 'skipped', detail: null };

  const { subject, text } = composeNotification(request);

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.from,
        to: [config.to],
        // So a reply goes to the prospect rather than to the notification
        // mailbox, which is the whole point of receiving this.
        reply_to: request.workEmail,
        subject,
        text,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (response.ok) return { outcome: 'sent', detail: null };

    // The provider's own words. This is what "Invalid from field" would have
    // said on day one, next to the lead it silently failed to announce.
    const body = await response.text().catch(() => '');
    return {
      outcome: 'failed',
      detail: `HTTP ${response.status} ${body}`.trim().slice(0, DETAIL_LIMIT),
    };
  } catch (error) {
    // Timeout, DNS, TLS, provider outage. The request is already stored; none
    // of this is the prospect's problem.
    return {
      outcome: 'failed',
      detail: (error instanceof Error ? error.message : 'send failed').slice(0, DETAIL_LIMIT),
    };
  }
}
