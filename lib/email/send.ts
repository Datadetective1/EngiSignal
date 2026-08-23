import 'server-only';

/**
 * ── ONE WAY OUT ─────────────────────────────────────────────────────────────
 *
 * EngiSignal sends exactly two kinds of mail: an operator alert when a pilot
 * request arrives, and a workspace invitation. Both go through Resend, and
 * before this module the first had its own copy of the transport with its own
 * timeout, its own error shaping and its own idea of what "not configured"
 * means. A second copy for invitations would have been a third opinion.
 *
 * The configuration is deliberately the SAME pair of variables the pilot
 * notifier already uses. That is not laziness about naming: those variables are
 * the ones set in production against a Resend account with a verified sender
 * domain. Introducing ENGISIGNAL_INVITE_FROM as a *requirement* would have
 * produced a build where invitations silently skipped — the one failure mode
 * this file is shaped to make impossible to miss — until somebody noticed and
 * set it.
 *
 * ENGISIGNAL_INVITE_FROM now exists, but only as an override that falls back to
 * PILOT_NOTIFY_FROM. That keeps the original guarantee — an unset variable can
 * never cause a skip — while letting an invitation be sent as
 * notifications@engisignal.com rather than as the pilot alias, which is what
 * the sender policy in config/email.ts asks for. An invitee has nothing to do
 * with the pilot programme, and mail from pilot@ inviting them to a workspace
 * reads as a mistake.
 *
 * Both addresses must be on a domain verified with the provider. They are both
 * @engisignal.com, so a domain-level verification covers each of them; a
 * single-address verification would not.
 *
 * PILOT_NOTIFY_TO stays out of here. It addresses the operator mailbox, and an
 * invitation goes to the invitee. Reusing it would have mailed every invitation
 * to ourselves.
 */

export type SendOutcome = 'sent' | 'skipped' | 'failed';

export interface SendResult {
  outcome: SendOutcome;
  /** The provider's own words on failure. Null when there is nothing to say. */
  detail: string | null;
}

interface MailerConfig {
  apiKey: string;
  from: string;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * Invitations are sent inside the request that answers the person clicking
 * "Send invitation", so the ceiling is generous enough for a normal send and
 * short enough that a provider outage does not hold a page open.
 */
const SEND_TIMEOUT_MS = 8_000;

const DETAIL_LIMIT = 300;

function readConfig(): MailerConfig | null {
  const apiKey = process.env.PILOT_NOTIFY_RESEND_API_KEY;
  // Override first, then the variable production already has set. Never a
  // hard-coded default: an address the provider has not verified fails every
  // send, and failing closed is better than failing at the provider.
  const from = process.env.ENGISIGNAL_INVITE_FROM?.trim() || process.env.PILOT_NOTIFY_FROM;
  if (!apiKey || !from) return null;
  return { apiKey, from };
}

/**
 * Whether this deployment can send mail at all.
 *
 * Reports presence, never values. The Members screen uses it to warn an owner
 * that an invitation was created but not delivered, because an invitation
 * nobody receives looks identical to one that is simply unopened.
 */
export function emailConfigured(): boolean {
  return readConfig() !== null;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  /** Optional HTML alternative. Plain text is always sent alongside. */
  html?: string;
  replyTo?: string;
}

/**
 * Send one email.
 *
 * Never throws. The caller decides what a failure means — for an invitation it
 * means telling the owner to copy the link by hand, which is a real fallback
 * rather than an apology.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendResult> {
  const config = readConfig();
  if (config === null) return { outcome: 'skipped', detail: null };

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        ...(input.html === undefined ? {} : { html: input.html }),
        ...(input.replyTo === undefined ? {} : { reply_to: input.replyTo }),
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (response.ok) return { outcome: 'sent', detail: null };

    const body = await response.text().catch(() => '');
    return {
      outcome: 'failed',
      detail: `HTTP ${response.status} ${body}`.trim().slice(0, DETAIL_LIMIT),
    };
  } catch (error) {
    return {
      outcome: 'failed',
      detail: (error instanceof Error ? error.message : 'send failed').slice(0, DETAIL_LIMIT),
    };
  }
}
