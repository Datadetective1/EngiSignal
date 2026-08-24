import 'server-only';
import type { PilotRequest } from '@/lib/domain/types';
import { emailAliases } from '@/config/email';
import { sendEmail, type SendResult } from '@/lib/email/send';
import { renderPilotAcknowledgementEmail } from '@/lib/email/templates/pilot-acknowledgement';

/**
 * ── ACKNOWLEDGING THE PROSPECT ──────────────────────────────────────────────
 *
 * Deliberately a separate module from lib/pilot/notify.ts rather than a second
 * recipient inside it. The operator alert is a verified production path with
 * its own configuration, its own timeout and its own recorded outcome; adding a
 * branch to it would put a customer-facing email inside the one function whose
 * behaviour we have promised not to disturb. Two callers, one transport.
 *
 * `Reply-To` is set explicitly to the pilot alias rather than left to follow the
 * sender. Today the sender already resolves to pilot@engisignal.com so the two
 * agree, but the sender is configuration and the reply destination is a
 * decision: if the system identity later moves to notifications@, a reply to
 * this email must still reach a person who can answer it.
 *
 * Like the operator alert, this never throws and never blocks the prospect's
 * request. Their enquiry is already stored by the time this runs. An email that
 * fails to send is worth knowing about; it is not worth telling somebody their
 * request was lost when it was not.
 */

export type AcknowledgeOutcome = SendResult['outcome'];

export interface AcknowledgeResult {
  outcome: AcknowledgeOutcome;
  detail: string | null;
}

/**
 * Send the acknowledgement for one stored request.
 *
 * Returns what happened rather than throwing, so the route can log an outcome
 * without deciding what a failure means.
 */
export async function acknowledgePilotRequest(request: PilotRequest): Promise<AcknowledgeResult> {
  // No address, nothing to acknowledge. The schema requires one, so this is a
  // guard against a future caller rather than an expected state.
  if (!request.workEmail) return { outcome: 'skipped', detail: null };

  const { subject, html, text } = renderPilotAcknowledgementEmail(request);

  const result = await sendEmail({
    to: request.workEmail,
    subject,
    text,
    html,
    replyTo: emailAliases.pilot,
  });

  return { outcome: result.outcome, detail: result.detail };
}
