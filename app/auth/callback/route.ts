import { NextResponse, type NextRequest } from 'next/server';
import { supabaseEnabled } from '@/config/env';
import { userClient } from '@/lib/supabase/server';
import { ensureOrganization } from '@/app/signin/actions';

export const runtime = 'nodejs';

/**
 * Where Supabase auth links land.
 *
 * Email confirmation and password-reset messages both link back here. Without
 * this route those links resolve to a 404: the account is confirmed on
 * Supabase's side but the person is left on an error page with no session and
 * no explanation, which reads as "the product is broken".
 *
 * ── A GET MUST NEVER SPEND A CONFIRMATION TOKEN ──────────────────────────────
 *
 * Phase 2C split confirmation into two steps so that no automated GET could
 * consume a one-time token: the emailed link opens a page that reads the token
 * and does nothing, and only an explicit POST verifies it. That was true of
 * /auth/confirm and false of this route, which happily called verifyOtp on a
 * bare GET — so the protection could be walked straight around, and the
 * middleware's rescue of a misdirected token even routed callers here to do it.
 *
 * Reproduced against production during Phase 2D closure. One unauthenticated
 * request, no cookie, no session, no click:
 *
 *   GET /auth/callback?token_hash=<from the email>&type=email
 *     → 307 /app, email_confirmed_at set, session issued
 *
 * Anything that follows links — a scanner, a prefetcher, a preview generator,
 * a shared inbox, anyone who sees the URL over someone's shoulder — could
 * therefore confirm an address the recipient never acted on.
 *
 * So a `token_hash` is now HANDED ON rather than redeemed: it goes to the
 * two-step page, which shows a button, and the token is spent only by the POST
 * behind it.
 *
 * `code` is different and is still exchanged here. A PKCE code is worthless
 * without the `code_verifier` cookie held by the browser that began the flow,
 * so it cannot be redeemed by a third party who merely sees the URL. It is not
 * a bearer credential in the way a token_hash is.
 *
 * Nothing here trusts a redirect target from the query string beyond a relative
 * path — an open redirect on an auth callback is how phishing links get
 * laundered through a legitimate domain.
 */

/** Only same-site relative paths are honoured. */
function safeNext(raw: string | null): string {
  if (raw === null) return '/app';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/app';
  return raw;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get('next'));

  if (!supabaseEnabled()) {
    return NextResponse.redirect(new URL('/signin', url.origin));
  }

  // Supabase reports its own failures on the query string — an expired link
  // arrives here as an error, not as a code. Landing such a visitor on the
  // sign-in page with no explanation is how "it just didn't work" happens.
  const providerError = url.searchParams.get('error') ?? url.searchParams.get('error_code');
  if (providerError !== null) {
    const expired = /expired|otp_expired|access_denied/i.test(providerError);
    return NextResponse.redirect(
      new URL(`/signin?error=${expired ? 'linkexpired' : 'authfailed'}`, url.origin),
    );
  }

  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');

  // A bearer token arriving on a GET is handed to the two-step page unspent.
  // This is the whole fix: the token leaves this route exactly as it arrived,
  // and only the explicit POST behind the button can redeem it.
  if (tokenHash !== null && tokenHash.length > 0) {
    const forward = new URLSearchParams({ token_hash: tokenHash });
    forward.set('type', type !== null && type.length > 0 ? type : 'email');
    forward.set('next', next);
    return NextResponse.redirect(new URL(`/auth/confirm?${forward.toString()}`, url.origin));
  }

  const supabase = await userClient();

  if (code !== null) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error !== null) {
      return NextResponse.redirect(new URL('/signin?error=linkexpired', url.origin));
    }
  } else {
    // Reached with no credential at all — a bare visit, or a link that lost its
    // query string in a redirect. Not an expiry, and saying so would be a guess.
    return NextResponse.redirect(new URL('/signin?error=nocode', url.origin));
  }

  // A recovery link means the user still has to choose a new password; sending
  // them to the app instead would leave the old password in place.
  if (type === 'recovery') {
    return NextResponse.redirect(new URL('/auth/reset', url.origin));
  }

  // PROVISION THE WORKSPACE BEFORE SENDING THEM INTO IT.
  //
  // Confirming an email address is the first moment a signed-up customer holds
  // a session. Sign-up itself could not provision for them: with email
  // confirmation enabled there is no session at that point, so the call was
  // skipped. Sign-in provisions, but a confirmed user goes straight to the app
  // without signing in again.
  //
  // The gap showed up in production as a 404 on /app — loadWorkspace calls
  // notFound() when the user belongs to no organization, so a customer who did
  // everything right saw "This page could not be found" one click after
  // confirming their address.
  //
  // Idempotent: bootstrap_organization returns the existing membership when
  // there is one, so this can never create a second tenant.
  await ensureOrganization();

  return NextResponse.redirect(new URL(next, url.origin));
}
