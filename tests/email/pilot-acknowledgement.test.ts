import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

import type { PilotRequest } from '@/lib/domain/types';
import {
  renderPilotAcknowledgementEmail,
  pilotAcknowledgementDoc,
  PILOT_ACKNOWLEDGEMENT_SUBJECT,
} from '@/lib/email/templates/pilot-acknowledgement';
import { acknowledgePilotRequest } from '@/lib/pilot/acknowledge';
import { escapeHtml } from '@/lib/email/design';
import { brand } from '@/config/brand';

/**
 * ── THE EMAIL A STRANGER RECEIVES ───────────────────────────────────────────
 *
 * This one leaves our control the moment it is sent. It lands in a corporate
 * mailbox, gets forwarded to a colleague, and sits in an archive somebody may
 * read a year later.
 *
 * So the tests here are mostly about what it must NOT carry: no request id, no
 * spend band, no headcount, no vendor list, no message echo, no response-time
 * promise, and no suggestion that a connector exists. Every one of those is
 * either an internal detail or a claim, and this file is the place they get
 * caught.
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
  message: 'Our renewal lands in March and finance wants a defensible number.',
  createdAt: '2026-08-23T09:15:00.000Z',
};

describe('what the acknowledgement says', () => {
  const { html, text, subject } = renderPilotAcknowledgementEmail(request);

  it('uses the agreed subject', () => {
    expect(subject).toBe('We received your EngiSignal pilot request');
    expect(subject).toBe(PILOT_ACKNOWLEDGEMENT_SUBJECT);
  });

  it('confirms receipt in the title', () => {
    expect(html).toContain('Pilot request received');
    expect(text).toContain('Pilot request received');
  });

  it('reflects back the company and contact', () => {
    expect(html).toContain(escapeHtml('Example Aerostructures'));
    expect(html).toContain('Dana Whitfield');
    expect(text).toContain('Example Aerostructures');
    expect(text).toContain('Dana Whitfield');
  });

  it('reflects back renewal timing and primary challenge when supplied', () => {
    expect(html).toContain('Within 90 days');
    expect(html).toContain('We suspect we are over-licensed');
    expect(text).toContain('Within 90 days');
    expect(text).toContain('We suspect we are over-licensed');
  });

  it('greets the contact by first name, and manages without one', () => {
    expect(text).toContain('Thank you, Dana');
    const anon = renderPilotAcknowledgementEmail({ ...request, name: '12345' });
    expect(anon.text).toContain('Thank you for your interest');
    expect(anon.text).not.toContain('Thank you, ');
  });

  it('explains that the information decides pilot fit', () => {
    expect(text.toLowerCase()).toContain('good fit');
    expect(text).toContain('30-day pilot');
  });

  it('offers the pilot alias and the site', () => {
    expect(html).toContain('pilot@engisignal.com');
    expect(text).toContain('pilot@engisignal.com');
    expect(text).toContain(brand.url.replace(/^https?:\/\//, ''));
  });
});

describe('what the acknowledgement must never carry', () => {
  const { html, text } = renderPilotAcknowledgementEmail(request);
  const both = [html, text];

  it('carries no request id or any other internal identifier', () => {
    for (const surface of both) {
      expect(surface).not.toContain(request.id);
      expect(surface.toLowerCase()).not.toContain('request id');
      // No bare UUID of any shape.
      expect(surface).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    }
  });

  it('does not restate spend, headcount or vendors back into their inbox', () => {
    for (const surface of both) {
      expect(surface).not.toContain('$2M');
      expect(surface).not.toContain('1,000 – 5,000');
      expect(surface).not.toContain('500 – 2,000');
      expect(surface).not.toContain('Ansys');
      expect(surface.toLowerCase()).not.toContain('software spend');
      expect(surface.toLowerCase()).not.toContain('employees');
    }
  });

  it('does not echo the message they typed', () => {
    for (const surface of both) {
      expect(surface).not.toContain('finance wants a defensible number');
    }
  });

  it('promises no response time', () => {
    for (const surface of both) {
      const lower = surface.toLowerCase();
      for (const promise of [
        'within 24 hours',
        'within 48 hours',
        'business day',
        'business days',
        'shortly',
        'as soon as possible',
        'immediately',
        'guarantee',
        'sla',
      ]) {
        expect(lower, `promised "${promise}"`).not.toContain(promise);
      }
    }
  });

  it('claims no connector or live integration', () => {
    for (const surface of both) {
      const lower = surface.toLowerCase();
      expect(lower).not.toContain('connector');
      expect(lower).not.toContain('connect your');
      expect(lower).not.toContain('real-time');
      expect(lower).not.toContain('automatically sync');
    }
    // And says the true thing instead.
    expect(text.toLowerCase()).toContain('no production-system integration is required');
  });

  it('exposes no configuration name, key or private mailbox', () => {
    for (const surface of both) {
      const lower = surface.toLowerCase();
      for (const needle of ['pilot_notify', 'resend', 'supabase', 'process.env', 'outlook.com']) {
        expect(lower).not.toContain(needle);
      }
      expect(surface).not.toMatch(/re_[A-Za-z0-9]{16,}/);
    }
  });

  it('carries no operator-only framing', () => {
    for (const surface of both) {
      const lower = surface.toLowerCase();
      expect(lower).not.toContain('new pilot request');
      expect(lower).not.toContain('reply to prospect');
      expect(lower).not.toContain('illustrative');
    }
  });
});

describe('fields the prospect left blank', () => {
  const sparse: PilotRequest = { ...request, renewalTiming: '', primaryChallenge: '' };
  const { html, text } = renderPilotAcknowledgementEmail(sparse);

  it('omits the rows rather than printing empty labels', () => {
    expect(html).not.toContain('>Renewal timing</td>');
    expect(text).not.toContain('Renewal timing');
    expect(text).not.toContain('Primary challenge');
  });

  it('never prints undefined or null', () => {
    expect(html).not.toMatch(/>\s*(undefined|null)\s*</);
    expect(text).not.toMatch(/\b(undefined|null)\b/);
  });

  it('still confirms receipt with the fields that were supplied', () => {
    expect(text).toContain('Pilot request received');
    expect(text).toContain('Example Aerostructures');
  });
});

describe('hostile input cannot become markup', () => {
  const hostile: PilotRequest = {
    ...request,
    company: '<script>alert(1)</script>Acme',
    name: '"><img src=x onerror=alert(1)>',
    primaryChallenge: 'A & B <b>bold</b>',
  };
  const { html, text } = renderPilotAcknowledgementEmail(hostile);

  it('escapes every tag', () => {
    expect(html).not.toContain('<script>a');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toMatch(/<[^>]+onerror=/i);
  });

  it('escapes ampersands and quotes', () => {
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');
  });

  it('leaves the plain-text part inert and unescaped', () => {
    expect(text).toContain('<script>alert(1)</script>Acme');
  });
});

describe('the rendering holds up in a mail client', () => {
  const { html, text } = renderPilotAcknowledgementEmail(request);

  it('ships a plain-text alternative alongside the HTML', () => {
    expect(text.length).toBeGreaterThan(200);
    expect(text).not.toMatch(/<[a-z/][^>]*>/i);
  });

  it('is fluid with a max width rather than a fixed one', () => {
    expect(html).toContain('width:100%;max-width:600px');
    expect(html).toContain('width="600"');
  });

  it('ships the narrow-screen stacking rules', () => {
    expect(html).toContain('@media only screen and (max-width:620px)');
    expect(html).toContain('.es-cell');
  });

  it('uses no flex, grid, script or form', () => {
    expect(html).not.toMatch(/display:\s*(flex|grid)/);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<form/i);
  });

  it('loads no third-party asset', () => {
    const sources = [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1] ?? '');
    expect(sources.length).toBeGreaterThan(0);
    for (const src of sources) expect(src.startsWith(brand.url)).toBe(true);
  });

  it('stays far inside the size at which Gmail clips a message', () => {
    expect(Buffer.byteLength(html, 'utf8')).toBeLessThan(102 * 1024);
  });

  it('has no badge — a customer receipt is not an urgency signal', () => {
    expect(pilotAcknowledgementDoc(request).badge).toBeUndefined();
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
    delete process.env.ENGISIGNAL_INVITE_FROM;
  };

  beforeEach(unconfigure);
  afterEach(() => {
    unconfigure();
    vi.unstubAllGlobals();
  });

  it('addresses the prospect, from the configured sender, replying to the pilot alias', async () => {
    configure();
    const fetchSpy = vi.fn(
      async () => ({ ok: true, status: 200, text: async () => '' }) as unknown as Response,
    );
    vi.stubGlobal('fetch', fetchSpy);

    await expect(acknowledgePilotRequest(request)).resolves.toMatchObject({ outcome: 'sent' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));

    expect(body.to).toEqual(['d.whitfield@example-aero.com']);
    expect(body.from).toBe('EngiSignal <pilot@engisignal.com>');
    // Explicit, not inherited: if the sender identity later moves to
    // notifications@, a reply must still reach somebody who can answer.
    expect(body.reply_to).toBe('pilot@engisignal.com');
    expect(body.subject).toBe(PILOT_ACKNOWLEDGEMENT_SUBJECT);
    expect(body.html).toContain('Pilot request received');
    expect(body.text).toContain('Example Aerostructures');
  });

  it('keeps the pilot reply-to even when the sender identity moves', async () => {
    configure();
    process.env.ENGISIGNAL_INVITE_FROM = 'EngiSignal <notifications@engisignal.com>';
    const fetchSpy = vi.fn(
      async () => ({ ok: true, status: 200, text: async () => '' }) as unknown as Response,
    );
    vi.stubGlobal('fetch', fetchSpy);

    await acknowledgePilotRequest(request);
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));

    expect(body.from).toBe('EngiSignal <notifications@engisignal.com>');
    expect(body.reply_to).toBe('pilot@engisignal.com');
  });

  it('is skipped rather than failed when mail is not configured', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(acknowledgePilotRequest(request)).resolves.toMatchObject({ outcome: 'skipped' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports failure rather than throwing when the provider rejects it', async () => {
    configure();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 422, text: async () => 'bad from' }) as unknown as Response),
    );

    const result = await acknowledgePilotRequest(request);
    expect(result.outcome).toBe('failed');
    expect(result.detail).toContain('422');
  });

  it('reports failure rather than throwing when the provider is unreachable', async () => {
    configure();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));

    await expect(acknowledgePilotRequest(request)).resolves.toMatchObject({ outcome: 'failed' });
  });

  it('sends nothing when there is no address to send to', async () => {
    configure();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(acknowledgePilotRequest({ ...request, workEmail: '' })).resolves.toMatchObject({
      outcome: 'skipped',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
