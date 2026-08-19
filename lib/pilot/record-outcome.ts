import 'server-only';
import { userClient } from '@/lib/supabase/server';
import type { NotifyResult } from './notify';

/**
 * ── THE DELIVERY RECEIPT ────────────────────────────────────────────────────
 *
 * Stamps how the operator notification for one request turned out.
 *
 * The submitter is `anon`, which holds INSERT on `pilot_requests` and, now,
 * UPDATE on exactly three columns — the grant is column-scoped, so this
 * privilege cannot reach the contact details the table exists to protect. The
 * row policy additionally allows the stamp only while it is unset, so learning
 * a request id does not let anyone rewrite what happened to it.
 *
 * Nothing here is allowed to matter to the prospect. Their request is already
 * durably stored; a failure to record its receipt is bookkeeping, and the
 * caller swallows it.
 */
export async function recordNotificationOutcome(
  requestId: string,
  result: NotifyResult,
): Promise<void> {
  const { error } = await (await userClient())
    .from('pilot_requests')
    .update({
      notify_outcome: result.outcome,
      notify_detail: result.detail,
      notified_at: new Date().toISOString(),
    })
    .eq('id', requestId);

  if (error !== null) {
    // Logged, never thrown: see above.
    console.error(`Could not record notification outcome for ${requestId}: ${error.message}`);
  }
}
