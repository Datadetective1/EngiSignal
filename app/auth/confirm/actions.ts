'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { isSupabaseAuth } from '@/lib/auth';
import { userClient } from '@/lib/supabase/server';
import { ensureOrganization } from '@/app/signin/actions';

/**
 * ── CONFIRMING AN EMAIL ADDRESS WITHOUT LETTING A ROBOT DO IT ────────────────
 *
 * Two separate failures led here, and this flow answers both.
 *
 * THE ONE WE MEASURED. Production auth logs for the failing sign-up show a
 * single GET to /auth/v1/verify from a real browser, 37 seconds after sign-up,
 * returning 303 with `user_signedup` — the token was consumed correctly by the
 * human. The failure was the request after it:
 *
 *     POST /token?grant_type=pkce → 400 bad_code_verifier
 *     "code challenge does not match previously saved code verifier"
 *
 * @supabase/ssr defaults to PKCE, which stores a `code_verifier` cookie in the
 * browser that began sign-up. An email link is routinely opened somewhere else
 * — a phone, a different browser, a webmail client's in-app browser — where
 * that cookie does not exist. PKCE cannot complete there, by construction. No
 * expiry setting fixes it.
 *
 * THE ONE WE ARE PREVENTING. Supabase's own troubleshooting guidance warns that
 * corporate mail scanners and link prefetchers issue GETs to every URL in a
 * message, consuming one-time tokens before the recipient clicks. We did not
 * observe that here, but the estate this product sells into is exactly the kind
 * that runs such scanners, and the fix for it is free once the flow is split.
 *
 * So: verification is never performed by a GET. The link in the email opens a
 * page that reads a token and does nothing with it. Only an explicit human
 * submission verifies, and it does so with `token_hash` + `verifyOtp`, which
 * needs no code verifier and therefore works across devices.
 */

const schema = z.object({
  tokenHash: z.string().min(16).max(512),
  type: z.enum(['email', 'signup', 'magiclink', 'invite', 'recovery', 'email_change']),
  next: z.string().max(200).optional(),
});

export type ConfirmFailure =
  | 'missing'
  | 'malformed'
  | 'expired'
  | 'used'
  | 'failed'
  | 'unconfigured';

export interface ConfirmResult {
  ok: false;
  reason: ConfirmFailure;
  message: string;
}

/** Only same-site relative paths are honoured. */
function safeNext(raw: string | undefined): string {
  if (raw === undefined || !raw.startsWith('/') || raw.startsWith('//')) return '/app';
  return raw;
}

const MESSAGES: Record<ConfirmFailure, string> = {
  missing: 'This link is missing its confirmation token. Open the most recent email from EngiSignal and use the link there.',
  malformed: 'This confirmation link is not readable. It may have been cut short by your email client — try opening the message in a browser and clicking the button directly.',
  expired: 'This confirmation link has expired. Request a new one from the sign-in page and it will arrive within a minute.',
  used: 'This address has already been confirmed. Sign in with your email and password.',
  failed: 'That confirmation could not be completed. Request a new link from the sign-in page.',
  unconfigured: 'Email confirmation is not available on this deployment.',
};

function classify(error: { code?: string; message?: string; status?: number }): ConfirmFailure {
  const code = (error.code ?? '').toLowerCase();
  const message = (error.message ?? '').toLowerCase();

  // Distinct states, not one generic failure: "already confirmed" needs a
  // sign-in link, while "expired" needs a new email. Telling someone to
  // request a new link when their account is already live wastes their time
  // and makes the product look broken.
  if (code.includes('expired') || message.includes('expired')) return 'expired';
  if (code.includes('already') || message.includes('already confirmed')) return 'used';
  if (message.includes('invalid') || message.includes('not found')) return 'expired';
  return 'failed';
}

/**
 * Verify a confirmation token. Only ever reached from an explicit submission.
 *
 * Idempotent: if the token has already been spent but the caller now holds a
 * valid session, this is a refresh or a double submit, and the right answer is
 * the app rather than an error page.
 */
export async function confirmEmailAction(formData: FormData): Promise<ConfirmResult> {
  if (!isSupabaseAuth()) {
    return { ok: false, reason: 'unconfigured', message: MESSAGES.unconfigured };
  }

  const parsed = schema.safeParse({
    tokenHash: formData.get('token_hash'),
    type: formData.get('type'),
    next: formData.get('next') ?? undefined,
  });

  if (!parsed.success) {
    const raw = formData.get('token_hash');
    const reason: ConfirmFailure = raw === null || String(raw).length === 0 ? 'missing' : 'malformed';
    return { ok: false, reason, message: MESSAGES[reason] };
  }

  const supabase = await userClient();
  const { error } = await supabase.auth.verifyOtp({
    type: parsed.data.type,
    token_hash: parsed.data.tokenHash,
  });

  if (error !== null) {
    // A spent token plus a live session is a second submission, not a failure.
    const { data } = await supabase.auth.getUser();
    if (data.user !== null) {
      await ensureOrganization();
      redirect(safeNext(parsed.data.next));
    }

    const reason = classify(error);
    return { ok: false, reason, message: MESSAGES[reason] };
  }

  // A recovery link still owes the user a new password; sending them to the app
  // would leave the old one in place.
  if (parsed.data.type === 'recovery') redirect('/auth/reset');

  // Provision exactly once. bootstrap_organization returns any existing
  // membership rather than creating a second tenant, and reads the company name
  // captured as sign-up metadata so it survives the round trip through email.
  await ensureOrganization();

  redirect(safeNext(parsed.data.next));
}
