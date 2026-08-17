import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * ── NO GET MAY SPEND A CONFIRMATION TOKEN ────────────────────────────────────
 *
 * Phase 2C split confirmation into two steps precisely so that an automated GET
 * could not consume a one-time token: the emailed link opens a page that reads
 * the token and does nothing with it, and only an explicit POST verifies.
 *
 * That was true of /auth/confirm and false of /auth/callback, which called
 * verifyOtp on a bare GET. The middleware that rescues a misdirected token even
 * forwarded callers there, so the protection could be walked around by a
 * request that had never seen the page, let alone the button.
 *
 * Proven against production before the fix, with one unauthenticated request —
 * no cookie, no session, no click:
 *
 *   POST /signin        acoul1692+authprobe1@gmail.com   12:24:05  unconfirmed
 *   GET  /auth/confirm  ×3, with the emailed token       12:24:2x  unconfirmed
 *   GET  /auth/callback?token_hash=…&type=email          12:24:39  CONFIRMED
 *                                                                  + session
 *
 * The account was confirmed 34 seconds after sign-up by a curl command. This
 * suite is the standing check that no route can do that again.
 *
 * The rule under test is deliberately about the METHOD and the ROUTE, not about
 * who made the request. Attributing it to a mail scanner would be a guess, and
 * the defect is the same whoever follows the link.
 */

const verifyOtp = vi.fn();
const exchangeCodeForSession = vi.fn();
const getUser = vi.fn();
const ensureOrganization = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  userClient: async () => ({
    auth: { verifyOtp, exchangeCodeForSession, getUser },
  }),
}));
vi.mock('@/app/signin/actions', () => ({ ensureOrganization }));
vi.mock('@/config/env', async () => {
  const actual = await vi.importActual<typeof import('@/config/env')>('@/config/env');
  return { ...actual, supabaseEnabled: () => true };
});

const { GET } = await import('@/app/auth/callback/route');

beforeEach(() => {
  verifyOtp.mockReset();
  exchangeCodeForSession.mockReset();
  ensureOrganization.mockReset();
  verifyOtp.mockResolvedValue({ error: null });
  exchangeCodeForSession.mockResolvedValue({ error: null });
});

async function get(url: string) {
  const response = await GET(new NextRequest(new URL(url)));
  return response.headers.get('location');
}

const TOKEN = 'pkce_695e8e80cbdc1c8faebfc1d349807e20aa1c407c9bbec21ded3b0b15';

describe('the callback route, given a confirmation token on a GET', () => {
  it('does not verify it', async () => {
    await get(`https://www.engisignal.com/auth/callback?token_hash=${TOKEN}&type=email`);
    // The single assertion the production defect would have failed.
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('does not provision a workspace off the back of it', async () => {
    await get(`https://www.engisignal.com/auth/callback?token_hash=${TOKEN}&type=email`);
    expect(ensureOrganization).not.toHaveBeenCalled();
  });

  it('hands the token to the two-step page instead, unspent', async () => {
    const location = await get(
      `https://www.engisignal.com/auth/callback?token_hash=${TOKEN}&type=email`,
    );
    expect(location).toContain('/auth/confirm');
    expect(location).toContain(`token_hash=${TOKEN}`);
    expect(location).toContain('type=email');
  });

  it('carries a recovery token to the page with its type intact', async () => {
    // Losing the type would send someone to the app with their old password
    // still live, instead of to the reset form.
    const location = await get(
      `https://www.engisignal.com/auth/callback?token_hash=${TOKEN}&type=recovery`,
    );
    expect(location).toContain('type=recovery');
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('defaults a missing type rather than dropping the token', async () => {
    const location = await get(`https://www.engisignal.com/auth/callback?token_hash=${TOKEN}`);
    expect(location).toContain('type=email');
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('keeps a safe next destination and refuses an off-site one', async () => {
    const kept = await get(
      `https://www.engisignal.com/auth/callback?token_hash=${TOKEN}&type=email&next=%2Fapp%2Fdata`,
    );
    expect(kept).toContain('next=%2Fapp%2Fdata');

    // An open redirect on an auth route is how phishing gets laundered through
    // a legitimate domain.
    const refused = await get(
      `https://www.engisignal.com/auth/callback?token_hash=${TOKEN}&type=email&next=https%3A%2F%2Fevil.example`,
    );
    expect(refused).not.toContain('evil.example');
    expect(refused).toContain('next=%2Fapp');
  });
});

describe('what the callback is still allowed to do on a GET', () => {
  it('exchanges a PKCE code, which a bystander cannot redeem', async () => {
    // A code is worthless without the code_verifier cookie held by the browser
    // that began the flow, so it is not a bearer credential the way a
    // token_hash is. Removing this would break same-device sign-up for no gain.
    await get('https://www.engisignal.com/auth/callback?code=abc123');
    expect(exchangeCodeForSession).toHaveBeenCalledWith('abc123');
  });

  it('prefers the token over a code when a link somehow carries both', async () => {
    await get(`https://www.engisignal.com/auth/callback?code=abc123&token_hash=${TOKEN}&type=email`);
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('still reports an expired link rather than a bare failure', async () => {
    const location = await get('https://www.engisignal.com/auth/callback?error=otp_expired');
    expect(location).toContain('linkexpired');
  });

  it('still says so when it was reached with no credential at all', async () => {
    const location = await get('https://www.engisignal.com/auth/callback');
    expect(location).toContain('nocode');
  });
});
