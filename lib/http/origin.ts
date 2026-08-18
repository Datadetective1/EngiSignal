import { envOptional } from '@/config/env';

/**
 * The origin this deployment is actually reachable on.
 *
 * The worker wakes its successor by calling its own endpoint, which means it
 * needs to know its own address. That was read from NEXT_PUBLIC_SITE_URL, and
 * in production that variable is not set -- so the wake was skipped silently
 * and every import waited for the next scheduled tick. Thirty seconds of
 * waiting per job, presenting as slowness rather than as configuration.
 *
 * A request already carries the answer. Deriving it from the request removes
 * the dependency instead of documenting it: there is nothing to set, and
 * nothing to get wrong on a new deployment or a preview URL.
 *
 * The forwarded headers come first because the request URL inside a serverless
 * function is the internal one, not the address a client used to reach it.
 */
export function originOf(request: Request): string | null {
  const headers = request.headers;

  const forwardedHost = headers.get('x-forwarded-host') ?? headers.get('host');
  if (forwardedHost !== null && forwardedHost.length > 0) {
    const protocol = headers.get('x-forwarded-proto') ?? 'https';
    return `${protocol}://${forwardedHost}`;
  }

  // Configured value next: still honoured where it is set, and it is the
  // right answer when a deployment is reached through a canonical domain that
  // differs from the host that served this particular request.
  const configured = envOptional('NEXT_PUBLIC_SITE_URL');
  if (configured !== null) return configured.replace(/\/+$/, '');

  try {
    return new URL(request.url).origin;
  } catch {
    return null;
  }
}
