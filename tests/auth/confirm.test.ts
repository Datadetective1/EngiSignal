import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * THE CONFIRMATION THAT COULD NOT COMPLETE.
 *
 * Production auth logs for the failing sign-up:
 *
 *   05:22:04  POST /signup  200  user_confirmation_requested
 *   05:22:41  GET  /verify  303  user_signedup      (one real browser, 37s later)
 *   05:22:42  POST /token   400  bad_code_verifier
 *
 * One GET, from a genuine Chrome/Windows agent, which SUCCEEDED. No prefetch,
 * no scanner, no duplicate — the popular hypothesis was wrong, and the logs say
 * so. The failure was the PKCE exchange after it: the code verifier lives in a
 * cookie in whichever browser began sign-up, and an email link is routinely
 * opened somewhere else.
 *
 * The flow below removes PKCE from email confirmation entirely, and as a
 * side-effect makes the token immune to the prefetching that Supabase's own
 * guidance warns about.
 */

const verifyOtp = vi.fn();
const getUser = vi.fn();
const ensureOrganization = vi.fn();
const redirect = vi.fn((path: string) => {
  // Next's redirect throws to unwind. Reproduce that so "did it redirect?" is
  // answerable and code after a redirect is provably unreachable.
  const error = new Error(`NEXT_REDIRECT:${path}`);
  (error as { digest?: string }).digest = `NEXT_REDIRECT;${path}`;
  throw error;
});

vi.mock('next/navigation', () => ({ redirect }));
vi.mock('@/lib/auth', () => ({ isSupabaseAuth: () => true }));
vi.mock('@/lib/supabase/server', () => ({
  userClient: async () => ({ auth: { verifyOtp, getUser } }),
}));
vi.mock('@/app/signin/actions', () => ({ ensureOrganization }));

const { confirmEmailAction } = await import('@/app/auth/confirm/actions');

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const TOKEN = 'a'.repeat(48);

async function submit(fields: Record<string, string>) {
  try {
    return { result: await confirmEmailAction(form(fields)), redirectedTo: null as string | null };
  } catch (error) {
    const digest = (error as { digest?: string }).digest ?? '';
    if (digest.startsWith('NEXT_REDIRECT;')) {
      return { result: null, redirectedTo: digest.slice('NEXT_REDIRECT;'.length) };
    }
    throw error;
  }
}

beforeEach(() => {
  verifyOtp.mockReset();
  getUser.mockReset();
  ensureOrganization.mockReset();
  redirect.mockClear();
  getUser.mockResolvedValue({ data: { user: null } });
});

// ─────────────────────────────────────────────────────────────────────────────
// A GET must never spend the token
// ─────────────────────────────────────────────────────────────────────────────

describe('rendering the confirmation page', () => {
  it('does not verify anything, however many times it is fetched', async () => {
    const { default: ConfirmPage } = await import('@/app/auth/confirm/page');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await ConfirmPage({
        searchParams: Promise.resolve({ token_hash: TOKEN, type: 'email', next: '/app' }),
      });
    }

    // A scanner, a prefetcher and a curious proxy can all read this page.
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
    expect(ensureOrganization).not.toHaveBeenCalled();
  });

  it('forwards a PKCE code to the callback rather than failing', async () => {
    // The template may still emit {{ .ConfirmationURL }}; do not regress it.
    const { default: ConfirmPage } = await import('@/app/auth/confirm/page');
    await expect(
      ConfirmPage({ searchParams: Promise.resolve({ code: 'pkce_abc', next: '/app' }) }),
    ).rejects.toThrow(/NEXT_REDIRECT.*\/auth\/callback\?code=pkce_abc/);
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The explicit human submission
// ─────────────────────────────────────────────────────────────────────────────

describe('submitting the confirmation', () => {
  it('verifies once and lands on the app', async () => {
    verifyOtp.mockResolvedValue({ error: null });

    const { redirectedTo } = await submit({ token_hash: TOKEN, type: 'email', next: '/app' });

    expect(verifyOtp).toHaveBeenCalledTimes(1);
    expect(verifyOtp).toHaveBeenCalledWith({ type: 'email', token_hash: TOKEN });
    expect(redirectedTo).toBe('/app');
  });

  it('provisions the workspace exactly once', async () => {
    verifyOtp.mockResolvedValue({ error: null });
    await submit({ token_hash: TOKEN, type: 'email' });
    expect(ensureOrganization).toHaveBeenCalledTimes(1);
  });

  it('lets the company name come from sign-up metadata, not the form', async () => {
    // The name is captured at sign-up and read back inside ensureOrganization,
    // so it survives the round trip through the email. Nothing here supplies it.
    verifyOtp.mockResolvedValue({ error: null });
    await submit({ token_hash: TOKEN, type: 'email' });
    expect(ensureOrganization).toHaveBeenCalledWith();
  });

  it('sends a recovery link to set a new password, not into the app', async () => {
    verifyOtp.mockResolvedValue({ error: null });
    const { redirectedTo } = await submit({ token_hash: TOKEN, type: 'recovery' });
    expect(redirectedTo).toBe('/auth/reset');
  });

  it('refuses an off-site next destination', async () => {
    verifyOtp.mockResolvedValue({ error: null });
    const { redirectedTo } = await submit({
      token_hash: TOKEN,
      type: 'email',
      next: 'https://evil.example/steal',
    });
    expect(redirectedTo).toBe('/app');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Second submissions and failures
// ─────────────────────────────────────────────────────────────────────────────

describe('a second submission', () => {
  it('is safe: a spent token plus a live session goes to the app', async () => {
    verifyOtp.mockResolvedValue({ error: { code: 'otp_expired', message: 'Token has expired' } });
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });

    const { redirectedTo } = await submit({ token_hash: TOKEN, type: 'email' });

    // A double-click or a refresh, not a failure.
    expect(redirectedTo).toBe('/app');
  });

  it('does not create a second tenant', async () => {
    verifyOtp.mockResolvedValue({ error: { code: 'otp_expired', message: 'expired' } });
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    await submit({ token_hash: TOKEN, type: 'email' });
    expect(ensureOrganization).toHaveBeenCalledTimes(1);
  });
});

describe('telling the customer what actually went wrong', () => {
  it('distinguishes an expired link', async () => {
    verifyOtp.mockResolvedValue({ error: { code: 'otp_expired', message: 'Token has expired' } });
    const { result } = await submit({ token_hash: TOKEN, type: 'email' });
    expect(result?.reason).toBe('expired');
    expect(result?.message).toContain('expired');
  });

  it('distinguishes an address already confirmed', async () => {
    verifyOtp.mockResolvedValue({
      error: { code: 'user_already_confirmed', message: 'Email already confirmed' },
    });
    const { result } = await submit({ token_hash: TOKEN, type: 'email' });
    expect(result?.reason).toBe('used');
    expect(result?.message).toContain('already been confirmed');
  });

  it('distinguishes a missing token', async () => {
    const { result } = await submit({ type: 'email' });
    expect(result?.reason).toBe('missing');
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('distinguishes a truncated token', async () => {
    const { result } = await submit({ token_hash: 'abc', type: 'email' });
    expect(result?.reason).toBe('malformed');
    expect(result?.message).toContain('cut short');
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('rejects an unknown otp type without calling Supabase', async () => {
    const { result } = await submit({ token_hash: TOKEN, type: 'not_a_type' });
    expect(result?.reason).toBe('malformed');
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('does not claim expiry when the cause is unknown', async () => {
    verifyOtp.mockResolvedValue({ error: { code: 'unexpected', message: 'boom' } });
    const { result } = await submit({ token_hash: TOKEN, type: 'email' });
    expect(result?.reason).toBe('failed');
  });
});
