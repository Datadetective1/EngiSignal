'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { resolveIngestionContext } from '@/lib/ingestion/session';
import { recordConfirmation, removeConfirmation } from '@/lib/ingestion/confirmations';

/**
 * Identity review actions.
 *
 * SECURITY: the organization is resolved server-side from the caller's own
 * membership, exactly as the ingestion routes do. It is never read from the
 * form, so a crafted payload cannot write a mapping into another tenant — which
 * would be a way to change a competitor's portfolio.
 *
 * Every decision is recorded with who made it and when. A confirmation changes
 * every future number for that feature, and a customer defending a renewal
 * position needs to be able to say who decided that two things were the same.
 */

const decisionSchema = z.object({
  kind: z.enum(['feature', 'user']),
  rawValue: z.string().min(1).max(400),
  canonicalKey: z.string().min(1).max(400),
  decision: z.enum(['confirmed', 'rejected', 'separate']),
  suggestedKey: z.string().max(400).optional(),
  note: z.string().max(1000).optional(),
});

export interface ActionResult {
  ok: boolean;
  message: string;
}

export async function decideIdentityAction(formData: FormData): Promise<ActionResult> {
  const auth = await resolveIngestionContext();
  if (!auth.ok) return { ok: false, message: auth.error };

  const parsed = decisionSchema.safeParse({
    kind: formData.get('kind'),
    rawValue: formData.get('rawValue'),
    canonicalKey: formData.get('canonicalKey'),
    decision: formData.get('decision'),
    suggestedKey: formData.get('suggestedKey') ?? undefined,
    note: formData.get('note') ?? undefined,
  });

  if (!parsed.success) return { ok: false, message: 'That decision could not be read.' };

  try {
    await recordConfirmation({
      organizationId: auth.context.organizationId,
      kind: parsed.data.kind,
      rawValue: parsed.data.rawValue,
      canonicalKey: parsed.data.canonicalKey,
      decision: parsed.data.decision,
      decidedBy: auth.context.userId ?? null,
      decidedByEmail: auth.context.email ?? null,
      suggestedKey: parsed.data.suggestedKey ?? null,
      note: parsed.data.note ?? null,
    });
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? `Could not save the decision: ${error.message}` : 'Could not save the decision.',
    };
  }

  // Every analytical surface reads the alias map, so all of them change.
  revalidatePath('/app', 'layout');

  return {
    ok: true,
    message:
      parsed.data.decision === 'confirmed'
        ? 'Confirmed. This position now shares a demand curve with the feature you chose.'
        : parsed.data.decision === 'rejected'
          ? 'Rejected. That suggestion will not be offered again.'
          : 'Kept separate. This remains its own position.',
  };
}

export async function undoIdentityDecisionAction(formData: FormData): Promise<ActionResult> {
  const auth = await resolveIngestionContext();
  if (!auth.ok) return { ok: false, message: auth.error };

  const id = String(formData.get('id') ?? '');
  if (id.length === 0) return { ok: false, message: 'No decision was specified.' };

  try {
    // Scoped by organization as well as id, so a crafted id from another tenant
    // cannot remove their mapping even before RLS is consulted.
    const removed = await removeConfirmation(auth.context.organizationId, id);
    if (!removed) return { ok: false, message: 'That decision no longer exists.' };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? `Could not undo the decision: ${error.message}` : 'Could not undo the decision.',
    };
  }

  revalidatePath('/app', 'layout');
  return { ok: true, message: 'Undone. The position is unresolved again.' };
}
