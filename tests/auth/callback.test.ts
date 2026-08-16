import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { canonicalHost } from '@/lib/auth/canonical';

/**
 * THE CONFIRMATION LINK THAT SIGNED NOBODY IN.
 *
 * Sign-up called `supabase.auth.signUp({ email, password })` with no options,
 * so Supabase fell back to the project's Site URL for the confirmation link.
 * Every new customer confirmed their address, landed on the public marketing
 * page with `?code=…` still in the address bar, and was never signed in — while
 * Supabase considered the account confirmed. Password reset was unaffected,
 * because it had always passed an explicit `redirectTo`. That asymmetry is what
 * hid the bug.
 *
 * These tests cover the recovery path in middleware and the origin derivation.
 * The route handler's exchange is exercised against production, not mocked
 * here: a stubbed `exchangeCodeForSession` proves only that the stub was
 * called, which is exactly the kind of green test that missed this.
 */

// The middleware's forwarding rule, imported through the module under test.
async function forwardOf(url: string): Promise<string | null> {
  const { middleware } = await import('@/middleware');
  const response = await middleware(new NextRequest(new URL(url)));
  const location = response?.headers.get('location') ?? null;
  return location;
}

describe('an auth code that arrived at the wrong path', () => {
  it('forwards a code left on the site root to the callback', async () => {
    const location = await forwardOf('https://www.engisignal.com/?code=abc123');
    expect(location).toBe('https://www.engisignal.com/auth/callback?code=abc123');
  });

  it('forwards a one-time token and keeps its type', async () => {
    const location = await forwardOf(
      'https://www.engisignal.com/?token_hash=xyz&type=recovery',
    );
    expect(location).toBe(
      'https://www.engisignal.com/auth/callback?token_hash=xyz&type=recovery',
    );
  });

  it('preserves an explicit next destination', async () => {
    const location = await forwardOf('https://www.engisignal.com/?code=abc&next=%2Fapp%2Fdata');
    expect(location).toContain('next=%2Fapp%2Fdata');
  });

  it('does not intercept the callback itself', async () => {
    // Forwarding the callback to itself would loop forever.
    const location = await forwardOf('https://www.engisignal.com/auth/callback?code=abc123');
    expect(location).toBeNull();
  });

  it('leaves an ordinary page request alone', async () => {
    expect(await forwardOf('https://www.engisignal.com/')).toBeNull();
    expect(await forwardOf('https://www.engisignal.com/signin')).toBeNull();
  });

  it('ignores an unrelated query parameter named like a code', async () => {
    expect(await forwardOf('https://www.engisignal.com/?promo=code')).toBeNull();
  });
});

describe('the canonical host for auth links', () => {
  it('folds the apex into www', () => {
    // An auth cookie set on www is not sent to the apex, so a link that lands
    // on the apex cannot complete a session even with a valid code.
    expect(canonicalHost('engisignal.com')).toBe('www.engisignal.com');
    expect(canonicalHost('ENGISIGNAL.COM')).toBe('www.engisignal.com');
  });

  it('leaves the canonical host unchanged', () => {
    expect(canonicalHost('www.engisignal.com')).toBe('www.engisignal.com');
  });

  it('leaves other hosts alone, including previews and localhost', () => {
    expect(canonicalHost('engi-signal.vercel.app')).toBe('engi-signal.vercel.app');
    expect(canonicalHost('localhost:3010')).toBe('localhost:3010');
  });
});
