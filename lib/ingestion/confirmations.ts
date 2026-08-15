/**
 * Customer-confirmed identity mappings.
 *
 * The only mechanism in EngiSignal that merges two strings the matching rules
 * would refuse to merge on their own. Everything else — normalized names, SKUs
 * vouched for by a name match, employee codes — is evidence. This is judgement,
 * and it is recorded as such.
 *
 * A confirmation changes every future number for that feature: demand curves
 * combine, entitlement and price attach, a renewal position appears where there
 * was an unmatched line. So it carries who decided, when, and what suggestion
 * they were acting on, and it is reversible — a merge that could not be undone
 * would leave a customer with a permanently wrong portfolio and no way back.
 */

import { userClient } from '@/lib/supabase/server';

export type ConfirmationKind = 'feature' | 'user';

/**
 * What a reviewer decided.
 *
 * `rejected` and `separate` both mean "do not merge", and they are kept apart
 * because they answer different future questions. `rejected` says a specific
 * suggestion was wrong and should stop being offered. `separate` says this is
 * a real distinct item in its own right — which is the answer for a genuinely
 * different SKU that happens to look similar.
 */
export type ConfirmationDecision = 'confirmed' | 'rejected' | 'separate';

export interface IdentityConfirmation {
  id: string;
  organizationId: string;
  kind: ConfirmationKind;
  rawValue: string;
  canonicalKey: string;
  decision: ConfirmationDecision;
  decidedByEmail: string | null;
  decidedAt: string;
  suggestedKey: string | null;
  note: string | null;
}

function normalize(raw: string): string {
  return raw.trim().toLowerCase();
}

function rowToConfirmation(row: Record<string, unknown>): IdentityConfirmation {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    kind: row.kind as ConfirmationKind,
    rawValue: row.raw_value as string,
    canonicalKey: row.canonical_key as string,
    decision: row.decision as ConfirmationDecision,
    decidedByEmail: (row.decided_by_email ?? null) as string | null,
    decidedAt: row.decided_at as string,
    suggestedKey: (row.suggested_key ?? null) as string | null,
    note: (row.note ?? null) as string | null,
  };
}

export async function listConfirmations(
  organizationId: string,
  kind?: ConfirmationKind,
): Promise<IdentityConfirmation[]> {
  const client = await userClient();
  let query = client
    .from('identity_confirmations')
    .select('*')
    .eq('organization_id', organizationId);
  if (kind !== undefined) query = query.eq('kind', kind);

  const { data, error } = await query;
  if (error !== null) throw new Error(error.message);
  return (data ?? []).map(rowToConfirmation);
}

/**
 * Alias maps the projection consumes.
 *
 * Only `confirmed` decisions produce a merge. `rejected` and `separate` are
 * recorded so the suggestion stops being offered, but they must never appear
 * here — an alias map is a list of things to combine, and putting a refusal in
 * it would do the exact opposite of what the reviewer decided.
 */
export async function confirmedAliasMaps(organizationId: string): Promise<{
  features: Map<string, string>;
  users: Map<string, string>;
}> {
  const all = await listConfirmations(organizationId);
  const features = new Map<string, string>();
  const users = new Map<string, string>();

  for (const entry of all) {
    if (entry.decision !== 'confirmed') continue;
    const target = entry.kind === 'feature' ? features : users;
    target.set(normalize(entry.rawValue), entry.canonicalKey);
  }

  return { features, users };
}

export interface RecordConfirmationInput {
  organizationId: string;
  kind: ConfirmationKind;
  rawValue: string;
  canonicalKey: string;
  decision: ConfirmationDecision;
  decidedBy: string | null;
  decidedByEmail: string | null;
  suggestedKey?: string | null;
  note?: string | null;
}

/**
 * Record a decision, replacing any previous one for the same raw value.
 *
 * Upsert rather than insert: a reviewer who changes their mind should end up
 * with one current answer and not two contradictory rows, and the unique index
 * enforces that at the database level regardless of what any caller does.
 */
export async function recordConfirmation(
  input: RecordConfirmationInput,
): Promise<IdentityConfirmation> {
  const client = await userClient();
  const { data, error } = await client
    .from('identity_confirmations')
    .upsert(
      {
        organization_id: input.organizationId,
        kind: input.kind,
        raw_value: normalize(input.rawValue),
        canonical_key: input.canonicalKey,
        decision: input.decision,
        decided_by: input.decidedBy,
        decided_by_email: input.decidedByEmail,
        decided_at: new Date().toISOString(),
        suggested_key: input.suggestedKey ?? null,
        note: input.note ?? null,
      },
      { onConflict: 'organization_id,kind,raw_value' },
    )
    .select()
    .single();

  if (error !== null) throw new Error(error.message);
  return rowToConfirmation(data as Record<string, unknown>);
}

/**
 * Undo a decision.
 *
 * Scoped by organization as well as id, so a crafted id from another tenant
 * cannot remove their mapping even before RLS is consulted.
 */
export async function removeConfirmation(
  organizationId: string,
  id: string,
): Promise<boolean> {
  const client = await userClient();
  const { data, error } = await client
    .from('identity_confirmations')
    .delete()
    .eq('organization_id', organizationId)
    .eq('id', id)
    .select('id');

  if (error !== null) throw new Error(error.message);
  return (data ?? []).length > 0;
}
