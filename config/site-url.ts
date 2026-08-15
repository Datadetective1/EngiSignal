/**
 * Site URL resolution.
 *
 * This exists because `new URL('')` throws `ERR_INVALID_URL`, and an empty
 * string is exactly what an environment variable yields when it is *defined
 * but blank* — the normal state of a Vercel project variable that has been
 * created without a value. A `??` fallback does not catch it, because `''` is
 * neither null nor undefined, so the empty string reaches the URL constructor
 * and fails the build while collecting page metadata.
 *
 * Every candidate is therefore validated by actually parsing it, and any
 * candidate that is blank, malformed, or not http(s) is skipped rather than
 * trusted. The resolver always returns a usable absolute URL.
 */

/** Local development fallback of last resort. */
export const LOCAL_SITE_URL = 'http://localhost:3000';

/**
 * Validate and normalize one candidate.
 * Returns null — never throws — when the candidate cannot be used.
 */
export function normalizeSiteUrl(value: string | undefined | null): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  // Detect an existing scheme before deciding whether to add one. Blindly
  // prefixing would turn `ftp://example.com` into `https://ftp//example.com`,
  // which parses successfully as a URL with hostname `ftp` — a silently wrong
  // canonical URL is worse than a rejected one.
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)?.[1]?.toLowerCase();
  if (scheme !== undefined && scheme !== 'http' && scheme !== 'https') return null;

  // Vercel supplies bare hostnames (`my-app.vercel.app`), not full URLs.
  const withProtocol = scheme === undefined ? `https://${trimmed}` : trimmed;

  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.hostname.length === 0) return null;
    // Strip the trailing slash so callers can concatenate paths predictably.
    return parsed.href.replace(/\/$/, '');
  } catch {
    return null;
  }
}

/**
 * Resolve the canonical site URL, in order of preference:
 *
 *   1. NEXT_PUBLIC_SITE_URL      — explicit configuration always wins
 *   2. VERCEL_PROJECT_PRODUCTION_URL — the stable production domain on Vercel
 *   3. VERCEL_URL                — the per-deployment domain (previews)
 *   4. http://localhost:3000     — local development only
 *
 * `process.env.NEXT_PUBLIC_SITE_URL` is referenced literally rather than
 * through a variable, because Next inlines `NEXT_PUBLIC_*` at build time by
 * static analysis and a dynamic lookup would not be replaced.
 */
export function resolveSiteUrl(): string {
  return (
    normalizeSiteUrl(process.env.NEXT_PUBLIC_SITE_URL) ??
    normalizeSiteUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL) ??
    normalizeSiteUrl(process.env.VERCEL_URL) ??
    LOCAL_SITE_URL
  );
}

/**
 * The site URL as a parsed `URL`, for `metadataBase`.
 *
 * Safe by construction: `resolveSiteUrl` only ever returns a string that has
 * already been parsed successfully.
 */
export function siteUrlObject(): URL {
  return new URL(resolveSiteUrl());
}
