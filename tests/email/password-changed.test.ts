import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  renderPasswordChangedEmail,
  PASSWORD_CHANGED_SUBJECT,
} from '@/lib/email/templates/password-changed';
import { sendPasswordChangedEmail } from '@/lib/email/security-notice';
import { brand } from '@/config/brand';

/**
 * ── THE EMAIL THAT SAYS SOMETHING CHANGED ───────────────────────────────────
 *
 * This exists for the case where the person reading it did NOT make the change.
 * Everything asserted below follows from that: it must name the account, say
 * when, give an address to write to, and carry no link at all — because a
 * "wasn't me?" button in an email about unauthorised access is indistinguishable
 * from the phishing it warns about.
 */

const input = { email: 'dana@example-aero.com', changedAt: '2026-08-23T09:15:00.000Z' };

describe('what it says', () => {
  const { html, text, subject } = renderPasswordChangedEmail(input);

  it('says what happened in the subject', () => {
    expect(subject).toBe('Your EngiSignal password was changed');
    expect(subject).toBe(PASSWORD_CHANGED_SUBJECT);
  });

  it('names the account it applies to', () => {
    expect(html).toContain('dana@example-aero.com');
    expect(text).toContain('dana@example-aero.com');
  });

  it('says when, in a stated timezone', () => {
    expect(text).toContain('23 August 2026');
    expect(text).toContain('UTC');
  });

  it('tells someone who did not do this where to write', () => {
    expect(text).toContain('security@engisignal.com');
    expect(text.toLowerCase()).toContain('if this was not you');
  });

  it('reassures the person who did do it', () => {
    expect(text.toLowerCase()).toContain('if this was you');
  });

  it('survives an unparseable timestamp rather than printing Invalid Date', () => {
    const { text: t } = renderPasswordChangedEmail({ ...input, changedAt: 'not-a-date' });
    expect(t).not.toContain('Invalid Date');
    expect(t).toContain('dana@example-aero.com');
  });
});

describe('what it must never do', () => {
  const { html, text } = renderPasswordChangedEmail(input);

  it('contains no link of any kind', () => {
    // The only permitted hrefs are the footer's own site and mailto contacts.
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1] ?? '');
    for (const href of hrefs) {
      expect(href.startsWith('mailto:') || href.startsWith(brand.url)).toBe(true);
    }
    // And no action button at all.
    expect(html.toLowerCase()).not.toContain('reset password');
    expect(html.toLowerCase()).not.toContain('secure my account');
    expect(html.toLowerCase()).not.toContain('wasn&#39;t me');
  });

  it('never carries a password, a token or a secret', () => {
    for (const surface of [html, text]) {
      expect(surface.toLowerCase()).not.toContain('your new password is');
      expect(surface).not.toMatch(/token/i);
      expect(surface).not.toMatch(/re_[A-Za-z0-9]{16,}/);
      expect(surface).not.toMatch(/eyJhbGciOi/);
    }
  });

  it('exposes no configuration name or private mailbox', () => {
    for (const surface of [html, text]) {
      const lower = surface.toLowerCase();
      for (const needle of ['supabase', 'pilot_notify', 'resend', 'process.env', 'outlook.com']) {
        expect(lower).not.toContain(needle);
      }
    }
  });
});

describe('the rendering holds up in a mail client', () => {
  const { html, text } = renderPasswordChangedEmail(input);

  it('ships a plain-text alternative', () => {
    expect(text.length).toBeGreaterThan(150);
    expect(text).not.toMatch(/<[a-z/][^>]*>/i);
  });

  it('is fluid with a max width', () => {
    expect(html).toContain('width:100%;max-width:600px');
    expect(html).toContain('width="600"');
  });

  it('ships the narrow-screen stacking rules', () => {
    expect(html).toContain('@media only screen and (max-width:620px)');
  });

  it('uses no flex, grid, script or form', () => {
    expect(html).not.toMatch(/display:\s*(flex|grid)/);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<form/i);
  });
});

describe('sending it', () => {
  const configure = () => {
    process.env.PILOT_NOTIFY_RESEND_API_KEY = 'test-key';
    process.env.PILOT_NOTIFY_FROM = 'EngiSignal <pilot@engisignal.com>';
  };
  const unconfigure = () => {
    delete process.env.PILOT_NOTIFY_RESEND_API_KEY;
    delete process.env.PILOT_NOTIFY_FROM;
  };

  beforeEach(unconfigure);
  afterEach(() => {
    unconfigure();
    vi.unstubAllGlobals();
  });

  it('goes to the account, replying to the security alias', async () => {
    configure();
    const fetchSpy = vi.fn(
      async () => ({ ok: true, status: 200, text: async () => '' }) as unknown as Response,
    );
    vi.stubGlobal('fetch', fetchSpy);

    await expect(sendPasswordChangedEmail(input)).resolves.toMatchObject({ outcome: 'sent' });

    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));

    expect(body.to).toEqual(['dana@example-aero.com']);
    // A reply to this is usually an alarmed one, and it must reach the address
    // that reads security mail rather than the sender.
    expect(body.reply_to).toBe('security@engisignal.com');
    expect(body.subject).toBe(PASSWORD_CHANGED_SUBJECT);
    expect(body.html).toContain('Your password was changed');
    expect(body.text).toContain('dana@example-aero.com');
  });

  it('is skipped rather than failed when mail is not configured', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(sendPasswordChangedEmail(input)).resolves.toMatchObject({ outcome: 'skipped' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports failure rather than throwing when the provider rejects it', async () => {
    configure();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, text: async () => 'nope' }) as unknown as Response),
    );

    await expect(sendPasswordChangedEmail(input)).resolves.toMatchObject({ outcome: 'failed' });
  });
});
