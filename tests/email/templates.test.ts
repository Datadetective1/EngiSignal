import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

import type { PilotRequest } from '@/lib/domain/types';
import { renderPilotRequestEmail, pilotRequestDoc } from '@/lib/email/templates/pilot-request';
import { renderInvitationEmail } from '@/lib/email/templates/invitation';
import { renderEmail, safeUrl, escapeHtml } from '@/lib/email/design';
import { notifyPilotRequest } from '@/lib/pilot/notify';
import { brand } from '@/config/brand';

/**
 * ── WHAT THESE EMAILS MUST NEVER DO ─────────────────────────────────────────
 *
 * The pilot alert renders text a stranger typed into a public form, and it is
 * read by the operator in a mail client. That makes it the one surface in the
 * product where somebody else's markup could end up inside our HTML, so the
 * escaping tests here are not hygiene — they are the reason the file exists.
 *
 * The rest holds three lines that are easy to break by accident: the plain-text
 * alternative must carry the same content as the HTML rather than drifting into
 * a summary; replies must keep reaching the prospect; and no internal
 * configuration name may ever appear in something a customer or a forwarded
 * recipient can read.
 */

const request: PilotRequest = {
  id: '3f7c1e02-9b1a-4a4e-8c22-6f2b9c0f1a55',
  name: 'Dana Whitfield',
  workEmail: 'd.whitfield@example-aero.com',
  company: 'Example Aerostructures',
  jobTitle: 'Director of Engineering Systems',
  approximateEmployees: '1,000 – 5,000',
  engineeringEmployees: '500 – 2,000',
  softwareSpendRange: '$2M – $10M',
  majorVendors: 'Ansys, Siemens NX',
  renewalTiming: 'Within 90 days',
  primaryChallenge: 'We suspect we are over-licensed',
  message: 'Renewal is in March.',
  createdAt: '2026-08-23T09:15:00.000Z',
};

const invitation = {
  to: 'colleague@northvane.example',
  organizationName: 'Northvane Aerospace',
  role: 'admin' as const,
  invitedByEmail: 'lead@northvane.example',
  acceptUrl: 'https://www.engisignal.com/invite/2f9c1a77b4e3',
  expiresAt: '2026-09-15T12:00:00.000Z',
};

describe('the pilot alert carries every submitted field', () => {
  const { html, text, subject } = renderPilotRequestEmail(request);

  it('names the company and the renewal window in the subject', () => {
    expect(subject).toContain('Example Aerostructures');
    expect(subject).toContain('within 90 days');
  });

  it.each([
    ['company', 'Example Aerostructures'],
    ['contact', 'Dana Whitfield'],
    ['job title', 'Director of Engineering Systems'],
    ['work email', 'd.whitfield@example-aero.com'],
    ['spend', '$2M – $10M'],
    ['employees', '1,000 – 5,000'],
    ['engineering employees', '500 – 2,000'],
    ['vendors', 'Ansys, Siemens NX'],
    ['primary challenge', 'We suspect we are over-licensed'],
    ['message', 'Renewal is in March.'],
    ['request id', '3f7c1e02-9b1a-4a4e-8c22-6f2b9c0f1a55'],
  ])('renders the %s in both parts', (_label, value) => {
    expect(html).toContain(escapeHtml(value));
    expect(text).toContain(value);
  });

  it('shows the received time as a date a person can read, not an ISO string', () => {
    expect(text).toContain('23 August 2026');
    expect(text).toContain('UTC');
    expect(text).not.toContain('2026-08-23T09:15:00.000Z');
  });

  it('offers a reply button addressed to the prospect', () => {
    expect(html).toContain('mailto:d.whitfield@example-aero.com');
    expect(html).toContain('Reply to prospect');
  });

  it('mentions exactly one request, so no other company can ride along', () => {
    expect((text.match(/Request ID/g) ?? []).length).toBe(1);
    expect((text.match(/Work email/g) ?? []).length).toBe(1);
  });
});

describe('content a stranger typed cannot become markup', () => {
  const hostile: PilotRequest = {
    ...request,
    company: '<script>alert(1)</script>Acme',
    name: '"><img src=x onerror=alert(1)>',
    message: 'Line one\n<b>bold</b> & <a href="https://evil.example">link</a>',
    jobTitle: "O'Brien <VP>",
  };

  const { html, text } = renderPilotRequestEmail(hostile);

  it('escapes tags rather than emitting them', () => {
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>bold</b>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;');
  });

  it('escapes the quote characters that would break out of an attribute', () => {
    expect(html).toContain('&quot;');
    expect(html).toContain('&#39;');
  });

  it('escapes ampersands so entities cannot be smuggled in', () => {
    expect(html).toContain('&amp;');
  });

  it('leaves no unescaped onerror handler anywhere in the document', () => {
    expect(html).not.toMatch(/<[^>]+onerror=/i);
  });

  it('keeps the raw characters in the plain-text part, where they are inert', () => {
    expect(text).toContain('<script>alert(1)</script>Acme');
  });

  it('turns newlines in a message into breaks rather than losing them', () => {
    expect(html).toContain('Line one<br>');
  });
});

describe('a URL that is not plainly http or mailto never becomes a link', () => {
  it.each([
    'javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox',
    ' javascript:alert(1)',
  ])('rejects %s', (candidate) => {
    expect(safeUrl(candidate)).toBeNull();
  });

  it.each(['https://www.engisignal.com/invite/abc', 'mailto:someone@example.com'])(
    'accepts %s',
    (candidate) => {
      expect(safeUrl(candidate)).not.toBeNull();
    },
  );

  it('drops the button entirely rather than rendering a dead one', () => {
    const { html, text } = renderEmail({
      preheader: 'p',
      title: 'T',
      blocks: [{ kind: 'cta', label: 'Do the thing', href: 'javascript:alert(1)' }],
    });
    expect(html).not.toContain('Do the thing');
    expect(text).not.toContain('Do the thing');
  });
});

describe('optional fields the prospect left blank', () => {
  const sparse: PilotRequest = {
    ...request,
    jobTitle: '',
    majorVendors: '',
    message: null,
    renewalTiming: '',
  };
  const { html, text } = renderPilotRequestEmail(sparse);

  it('omits the labels rather than printing them empty', () => {
    expect(html).not.toContain('Job title');
    expect(html).not.toContain('Major vendors');
    expect(text).not.toContain('Job title');
  });

  it('never prints the words undefined or null', () => {
    expect(html).not.toMatch(/>\s*(undefined|null)\s*</);
    expect(text).not.toMatch(/\b(undefined|null)\b/);
  });

  it('drops the Message section when there is no message', () => {
    expect(text).not.toContain('MESSAGE');
  });

  it('drops the badge when renewal timing is absent', () => {
    expect(pilotRequestDoc(sparse).badge).toBeUndefined();
  });

  it('still renders the fields that were supplied', () => {
    expect(text).toContain('Example Aerostructures');
    expect(text).toContain('Dana Whitfield');
  });
});

describe('unusually long values', () => {
  const long: PilotRequest = {
    ...request,
    company: 'A'.repeat(180),
    name: 'B'.repeat(160),
    workEmail: `${'c'.repeat(120)}@example-aero.com`,
    message: 'D'.repeat(4000),
  };
  const { html, text, subject } = renderPilotRequestEmail(long);

  it('renders without truncating the message body', () => {
    expect(html).toContain('D'.repeat(4000));
    expect(text).toContain('D'.repeat(4000));
  });

  it('lets long unbroken values wrap instead of stretching the layout', () => {
    expect(html).toContain('word-break:break-word');
  });

  it('keeps the subject on one line', () => {
    expect(subject).not.toContain('\n');
  });

  it('stays well inside the size at which Gmail clips a message', () => {
    // Gmail truncates around 102KB and appends a "View entire message" link,
    // which would cut the metadata off the bottom of the alert.
    expect(Buffer.byteLength(html, 'utf8')).toBeLessThan(102 * 1024);
  });
});

describe('the plain-text alternative is a peer of the HTML, not a summary', () => {
  const { html, text } = renderPilotRequestEmail(request);

  it('exists and is substantial', () => {
    expect(text.length).toBeGreaterThan(200);
  });

  it('carries no HTML tags', () => {
    expect(text).not.toMatch(/<[a-z/][^>]*>/i);
  });

  it('carries every value the HTML row set carries', () => {
    for (const block of pilotRequestDoc(request).blocks) {
      if (block.kind !== 'sections' && block.kind !== 'meta') continue;
      for (const row of block.rows) {
        expect(text, `${row.label} missing from text`).toContain(row.value);
      }
    }
  });

  it('includes the reply address as a usable mailto line', () => {
    // The text part shows the bare address; the HTML part carries the mailto:
    expect(text).toContain('Reply to prospect: d.whitfield@example-aero.com');
    expect(text).not.toContain('%20');
  });

  it('does not leave runs of blank lines where a block rendered nothing', () => {
    expect(text).not.toMatch(/\n{3,}/);
    expect(html).toContain('<!doctype html>');
  });
});

describe('nothing internal leaks into a message somebody may forward', () => {
  const surfaces = [
    renderPilotRequestEmail(request).html,
    renderPilotRequestEmail(request).text,
    renderInvitationEmail(invitation).html,
    renderInvitationEmail(invitation).text,
  ];

  it.each([
    'PILOT_NOTIFY_TO',
    'PILOT_NOTIFY_FROM',
    'PILOT_NOTIFY_RESEND_API_KEY',
    'ENGISIGNAL_INVITE_FROM',
    'RESEND',
    'CRON_SECRET',
    'SUPABASE',
    'process.env',
    'outlook.com',
  ])('never mentions %s', (needle) => {
    for (const surface of surfaces) {
      expect(surface.toLowerCase()).not.toContain(needle.toLowerCase());
    }
  });

  it('carries no api key shaped string', () => {
    for (const surface of surfaces) {
      expect(surface).not.toMatch(/re_[A-Za-z0-9]{16,}/);
      expect(surface).not.toMatch(/eyJhbGciOi/);
    }
  });

  it('uses no verification or test language', () => {
    for (const surface of surfaces) {
      expect(surface.toLowerCase()).not.toContain('disposable');
      expect(surface.toLowerCase()).not.toContain('safe to delete');
    }
  });
});

describe('the layout survives a phone', () => {
  const { html } = renderPilotRequestEmail(request);

  it('declares a viewport', () => {
    expect(html).toContain('name="viewport"');
  });

  it('sizes the container fluidly with a max rather than a fixed width', () => {
    expect(html).toContain('width:100%;max-width:600px');
    // A fixed inline width would beat the media query and push the card off
    // the side of a phone screen. This is the bug that shipped once.
    expect(html).not.toContain('style="border-collapse:collapse;width:600px');
  });

  it('ships the stacking rules for narrow screens', () => {
    expect(html).toContain('@media only screen and (max-width:620px)');
    expect(html).toContain('.es-cell');
  });

  it('keeps the Outlook width attribute, which ignores max-width', () => {
    expect(html).toContain('width="600"');
  });

  it('uses tables rather than flex or grid, which Word cannot render', () => {
    expect(html).not.toMatch(/display:\s*(flex|grid)/);
  });

  it('carries no script, form or external stylesheet', () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<form/i);
    expect(html).not.toMatch(/<link[^>]+stylesheet/i);
  });

  it('loads no third-party asset', () => {
    // The invariant is same-origin, not a literal domain: the logo URL follows
    // NEXT_PUBLIC_SITE_URL, which is localhost here and engisignal.com in
    // production. Hard-coding the domain would pass for the wrong reason.
    const sources = [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1] ?? '');
    expect(sources.length).toBeGreaterThan(0);
    for (const src of sources) {
      expect(src.startsWith(brand.url), `${src} is not served by EngiSignal`).toBe(true);
    }
  });
});

describe('the invitation states the terms of the invitation', () => {
  const { html, text, subject } = renderInvitationEmail(invitation);

  it('names the inviter and workspace in the subject', () => {
    expect(subject).toContain('lead@northvane.example');
    expect(subject).toContain('Northvane Aerospace');
  });

  it('renders the workspace, inviter, role and recipient', () => {
    for (const value of ['Northvane Aerospace', 'lead@northvane.example', 'Admin', 'colleague@northvane.example']) {
      expect(html).toContain(escapeHtml(value));
      expect(text).toContain(value);
    }
  });

  it.each([
    ['owner', 'Owner'],
    ['admin', 'Admin'],
    ['member', 'Member'],
  ])('renders the %s role as %s', (role, label) => {
    const rendered = renderInvitationEmail({ ...invitation, role: role as typeof invitation.role });
    expect(rendered.text).toContain(label);
  });

  it('carries the accept link in both parts', () => {
    expect(html).toContain(invitation.acceptUrl);
    expect(text).toContain(invitation.acceptUrl);
  });

  it('says the link is single use and when it expires', () => {
    expect(text).toContain('works once');
    expect(text).toContain('15 September 2026');
  });

  it('warns that the invitation is meant for the recipient alone', () => {
    expect(text).toContain('intended for you alone');
    expect(text).toContain('Do not forward');
  });

  it('survives an unparseable expiry rather than printing Invalid Date', () => {
    const { text: t } = renderInvitationEmail({ ...invitation, expiresAt: 'not-a-date' });
    expect(t).not.toContain('Invalid Date');
    expect(t).toContain('in seven days');
  });

  it('escapes a workspace name so it cannot inject markup', () => {
    const { html: h } = renderInvitationEmail({
      ...invitation,
      organizationName: '<script>alert(1)</script>Acme',
    });
    expect(h).not.toContain('<script>a');
    expect(h).toContain('&lt;script&gt;');
  });
});

describe('sending still addresses the prospect on reply', () => {
  const configure = () => {
    process.env.PILOT_NOTIFY_RESEND_API_KEY = 'test-key';
    process.env.PILOT_NOTIFY_TO = 'pilot@engisignal.com';
    process.env.PILOT_NOTIFY_FROM = 'EngiSignal <pilot@engisignal.com>';
  };
  const unconfigure = () => {
    delete process.env.PILOT_NOTIFY_RESEND_API_KEY;
    delete process.env.PILOT_NOTIFY_TO;
    delete process.env.PILOT_NOTIFY_FROM;
  };

  beforeEach(unconfigure);
  afterEach(() => {
    unconfigure();
    vi.unstubAllGlobals();
  });

  it('sends both parts, to the alias, replying to the prospect', async () => {
    configure();
    const fetchSpy = vi.fn(
      async () => ({ ok: true, status: 200, text: async () => '' }) as unknown as Response,
    );
    vi.stubGlobal('fetch', fetchSpy);

    await expect(notifyPilotRequest(request)).resolves.toMatchObject({ outcome: 'sent' });

    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));

    expect(body.to).toEqual(['pilot@engisignal.com']);
    expect(body.from).toBe('EngiSignal <pilot@engisignal.com>');
    // The whole point of the alert: hitting reply answers the lead.
    expect(body.reply_to).toBe('d.whitfield@example-aero.com');
    expect(body.html).toContain('New pilot request');
    expect(body.text).toContain('Example Aerostructures');
  });
});
