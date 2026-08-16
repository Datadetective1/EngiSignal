import 'server-only';
import { headers } from 'next/headers';
import { envOptional } from '@/config/env';
import { canonicalHost } from './canonical';

export { canonicalHost };

/**
 * ── WHERE AUTH EMAILS MUST POINT ─────────────────────────────────────────────
 *
 * Supabase sends confirmation and recovery links to whatever the caller passed
 * as a redirect target, and falls back to the project's Site URL when the
 * caller passes nothing.
 *
 * Sign-up passed nothing. Every confirmation email therefore linked to the
 * project's Site URL — the apex host, at the site root — so a new customer
 * clicked "Confirm email address", landed on the public marketing page with
 * `?code=…` still in the address bar, and was never signed in. The account was
 * confirmed on Supabase's side, which made it look like the product had simply
 * dropped them.
 *
 * Deriving the origin needs care in three ways:
 *
 *   1. NEXT_PUBLIC_SITE_URL is a build-time value and drifts. It is
 *      `http://localhost:3010` in the local env file. If a deployment is ever
 *      missing it, a relative redirect target would be rejected by Supabase and
 *      sign-up would break for everyone.
 *   2. The request host is the ground truth at runtime, so it is preferred when
 *      it looks like a real host.
 *   3. The apex and www hosts must resolve to ONE canonical origin. An auth
 *      cookie set on www is not sent to the apex, so a link that lands on the
 *      apex cannot complete a session even if the code is valid.
 */

/**
 * The absolute origin auth emails should link back to.
 *
 * Prefers the live request host, because that is what the person is actually
 * using, and falls back to the configured site URL for contexts without a
 * request.
 */
export async function authOrigin(): Promise<string> {
  const configured = envOptional('NEXT_PUBLIC_SITE_URL');

  try {
    const headerList = await headers();
    const forwardedHost = headerList.get('x-forwarded-host');
    const host = forwardedHost ?? headerList.get('host');

    if (host !== null && host.length > 0) {
      const proto =
        headerList.get('x-forwarded-proto') ??
        (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
      return `${proto}://${canonicalHost(host)}`;
    }
  } catch {
    // No request context. Fall through to the configured value.
  }

  if (configured !== null && configured.length > 0) {
    try {
      const url = new URL(configured);
      url.host = canonicalHost(url.host);
      return url.origin;
    } catch {
      // A malformed value is not usable.
    }
  }

  return '';
}

/** The absolute URL Supabase should send an auth link to. */
export async function authCallbackUrl(params?: Record<string, string>): Promise<string> {
  const origin = await authOrigin();
  const query = params === undefined ? '' : `?${new URLSearchParams(params).toString()}`;
  return `${origin}/auth/callback${query}`;
}
