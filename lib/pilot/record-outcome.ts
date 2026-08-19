import 'server-only';
import { userClient } from '@/lib/supabase/server';
import type { NotifyResult } from './notify';

/**
 * ── THE DELIVERY RECEIPT ────────────────────────────────────────────────────
 *
 * Stamps how the operator notification for one request turned out.
 *
 * This goes through a definer function rather than an UPDATE, and the reason is
 * worth stating because it is not obvious: a WHERE clause makes SELECT policies
 * apply to an UPDATE. `pilot_requests` has no SELECT policy at all -- it holds
 * other companies' contact details -- so `update ... where id = $1` matches
 * zero rows for `anon` regardless of UPDATE policies or column grants. That was
 * measured, not assumed: the statement was permitted and affected 0 rows.
 *
 * Adding a SELECT policy to make an UPDATE work would expose the sales pipeline
 * to anyone who asked, which is the exact thing this table is shaped to
 * prevent. The function can see the row, writes three columns, refuses any
 * outcome outside the three known ones, and stamps only while unset.
 *
 * Nothing here is allowed to matter to the prospect. Their request is already
 * durably stored; a failure to record its receipt is bookkeeping, and the
 * caller swallows it.
 */
export async function recordNotificationOutcome(
  requestId: string,
  result: NotifyResult,
): Promise<void> {
  const { error } = await (await userClient()).rpc('record_pilot_notification', {
    request_id: requestId,
    outcome: result.outcome,
    detail: result.detail,
  });

  if (error !== null) {
    // Logged, never thrown: see above.
    console.error(`Could not record notification outcome for ${requestId}: ${error.message}`);
  }
}
