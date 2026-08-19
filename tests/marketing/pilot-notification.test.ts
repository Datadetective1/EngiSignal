import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

import { composeNotification, notifyPilotRequest } from '@/lib/pilot/notify';
import type { PilotRequest } from '@/lib/domain/types';

/**
 * ── A LEAD NOBODY IS TOLD ABOUT ─────────────────────────────────────────────
 *
 * Pilot requests were stored and nothing announced them, so reading the queue
 * was a manual daily task and a request arriving on a Friday sat unread.
 *
 * The rule that matters most here is not that the notification works. It is
 * that the prospect never pays for it going wrong: their request is already
 * durably stored before this code runs, and returning an error afterwards would
 * tell somebody their enquiry was lost when it is safely in the database.
 *
 * These tests hold that line — every failure mode returns an outcome rather
 * than throwing — and hold the privacy line: one request per notification, so
 * a well-meaning summary can never leak another company's details.
 */

const request: PilotRequest = {
  id: '3f7c1e02-9b1a-4a4e-8c22-6f2b9c0f1a55',
  name: 'Dana Whitfield',
  workEmail: 'dana@example-aero.com',
  company: 'Example Aerostructures',
  jobTitle: 'Director of Engineering Systems',
  approximateEmployees: '1,000 – 5,000',
  engineeringEmployees: '500 – 2,000',
  softwareSpendRange: '$2M – $10M',
  majorVendors: 'Ansys, Siemens',
  renewalTiming: 'Within 90 days',
  primaryChallenge: 'We suspect we are over-licensed',
  message: 'Renewal is in March.',
  createdAt: '2026-08-19T09:15:00.000Z',
};

const configure = () => {
  process.env.PILOT_NOTIFY_RESEND_API_KEY = 'test-key';
  process.env.PILOT_NOTIFY_TO = 'pilot@engisignal.com';
  process.env.PILOT_NOTIFY_FROM = 'notifications@engisignal.com';
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

describe('what the operator is told', () => {
  it('names the company in the subject', () => {
    expect(composeNotification(request).subject).toContain('Example Aerostructures');
  });

  it('puts renewal timing in the subject, because it decides the reply speed', () => {
    expect(composeNotification(request).subject).toContain('within 90 days');
  });

  it('carries everything needed to follow up', () => {
    const { text } = composeNotification(request);
    expect(text).toContain('dana@example-aero.com');
    expect(text).toContain('Director of Engineering Systems');
    expect(text).toContain('$2M – $10M');
    expect(text).toContain('500 – 2,000');
    expect(text).toContain('Renewal is in March.');
    expect(text).toContain(request.id);
  });

  it('omits fields the prospect left blank rather than printing empty labels', () => {
    const sparse = { ...request, majorVendors: '', message: null, jobTitle: '' };
    const { text } = composeNotification(sparse);
    expect(text).not.toContain('Major vendors:');
    expect(text).not.toContain('Job title:');
    expect(text).not.toContain('Message:');
    // The parts that were supplied still arrive.
    expect(text).toContain('Example Aerostructures');
  });

  it('mentions exactly one request, so no other company can ride along', () => {
    const { text } = composeNotification(request);
    expect((text.match(/Request id:/g) ?? []).length).toBe(1);
    expect((text.match(/Work email:/g) ?? []).length).toBe(1);
  });
});

describe('sending it', () => {
  it('is skipped, not failed, when notification is not configured', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(notifyPilotRequest(request)).resolves.toMatchObject({ outcome: 'skipped' });
    // No configuration means no call at all, not a call that errors.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is skipped when the configuration is only half present', async () => {
    process.env.PILOT_NOTIFY_RESEND_API_KEY = 'test-key';
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(notifyPilotRequest(request)).resolves.toMatchObject({ outcome: 'skipped' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends when configured, and replies go to the prospect', async () => {
    configure();
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, text: async () => '' }) as unknown as Response);
    vi.stubGlobal('fetch', fetchSpy);

    await expect(notifyPilotRequest(request)).resolves.toMatchObject({ outcome: 'sent' });

    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.to).toEqual(['pilot@engisignal.com']);
    // So hitting reply reaches the prospect, which is the point of the alert.
    expect(body.reply_to).toBe('dana@example-aero.com');
    expect(body.subject).toContain('Example Aerostructures');
  });

  it('reports failure rather than throwing when the provider rejects it', async () => {
    configure();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 422,
      text: async () => 'validation_error: Invalid from field',
    }) as unknown as Response));

    // The request is already stored. This must never become the prospect's
    // problem -- but the reason must be recoverable, which it was not when
    // Resend rejected every send with "Invalid from field".
    const result = await notifyPilotRequest(request);
    expect(result.outcome).toBe('failed');
    expect(result.detail).toContain('422');
    expect(result.detail).toContain('Invalid from field');
  });

  it('reports failure rather than throwing when the provider is unreachable', async () => {
    configure();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));

    const result = await notifyPilotRequest(request);
    expect(result.outcome).toBe('failed');
    expect(result.detail).toContain('ECONNREFUSED');
  });

  it('reports failure rather than hanging when the provider times out', async () => {
    configure();
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });
    }));

    await expect(notifyPilotRequest(request)).resolves.toMatchObject({ outcome: 'failed' });
  });

  it('passes an abort signal, so a slow provider cannot hold the response open', async () => {
    configure();
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, text: async () => '' }) as unknown as Response);
    vi.stubGlobal('fetch', fetchSpy);

    await notifyPilotRequest(request);
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBeDefined();
  });
});
