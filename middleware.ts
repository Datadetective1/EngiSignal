import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Session refresh.
 *
 * Supabase access tokens are short-lived. Without a refresh on each request the
 * session silently expires mid-visit and the user is bounced to sign-in while
 * still holding a valid refresh token — which reads as "it logged me out for no
 * reason". Refreshing here, and writing the rotated cookies onto the response,
 * is the supported pattern.
 *
 * This does not authorize anything. It only keeps the session current; every
 * route still resolves its own session and every query is still governed by RLS.
 */
/**
 * An auth code that arrived at the wrong path.
 *
 * Supabase sends confirmation links to the project's Site URL when the caller
 * did not name a redirect target. Sign-up used to do exactly that, so live
 * confirmation links point at the site ROOT with `?code=…` attached — the
 * public marketing page, which has no way to exchange it. The person is
 * confirmed on Supabase's side and sees a brochure.
 *
 * Sign-up now names the callback explicitly, but links already in inboxes
 * cannot be recalled, and a future misconfiguration of Site URL would silently
 * reintroduce the same dead end. Forwarding the code to the callback makes the
 * flow correct regardless of which of the two the email points at.
 */
function misdirectedAuthCode(request: NextRequest): URL | null {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/auth/')) return null;

  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  if (code === null && tokenHash === null) return null;

  // A token_hash is a bearer credential: whoever holds the URL can spend it.
  // It goes to the two-step page, which shows a button and redeems nothing, so
  // rescuing a misdirected link can never also confirm the address on behalf of
  // whatever followed it. A PKCE code is safe to send to the callback because it
  // cannot be exchanged without the code_verifier cookie from the browser that
  // started the flow.
  //
  // This forwarded tokens to the callback until Phase 2E, which made the rescue
  // itself a way to confirm an account with one unauthenticated GET.
  const destination = tokenHash !== null ? '/auth/confirm' : '/auth/callback';

  const target = new URL(destination, url.origin);
  for (const key of ['code', 'token_hash', 'type', 'next']) {
    const value = url.searchParams.get(key);
    if (value !== null) target.searchParams.set(key, value);
  }
  return target;
}

export async function middleware(request: NextRequest) {
  // Before anything else: a valid auth code sitting on the wrong page is a
  // signed-out customer who believes the product is broken.
  const rescued = misdirectedAuthCode(request);
  if (rescued !== null) return NextResponse.redirect(rescued);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  // Blank-but-present variables are treated as absent, matching config/env.ts.
  if (url === undefined || url.length === 0 || key === undefined || key.length === 0) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options as never);
        }
      },
    },
  });

  // getUser() revalidates against the auth server; getSession() would trust the
  // cookie, which is exactly what must not be trusted here.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
