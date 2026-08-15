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
export async function middleware(request: NextRequest) {
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
