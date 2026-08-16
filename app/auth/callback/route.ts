import { NextResponse, type NextRequest } from 'next/server';
import { supabaseEnabled } from '@/config/env';
import { userClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

/**
 * Where Supabase auth links land.
 *
 * Email confirmation and password-reset messages both link back here. Without
 * this route those links resolve to a 404: the account is confirmed on
 * Supabase's side but the person is left on an error page with no session and
 * no explanation, which reads as "the product is broken".
 *
 * Two link formats are handled because Supabase uses both depending on how the
 * email template and client flow are configured:
 *
 *   ?code=…                     PKCE, exchanged for a session
 *   ?token_hash=…&type=…        one-time token, verified directly
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

  const supabase = await userClient();

  if (code !== null) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error !== null) {
      return NextResponse.redirect(new URL('/signin?error=linkexpired', url.origin));
    }
  } else if (tokenHash !== null && type !== null) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as 'email' | 'recovery' | 'invite' | 'email_change',
    });
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

  return NextResponse.redirect(new URL(next, url.origin));
}
