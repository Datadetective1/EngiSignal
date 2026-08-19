import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

/**
 * ── THE FORM AT THE TOP OF THE FUNNEL, END TO END ───────────────────────────
 *
 * The prospect-facing contract, asserted at the route rather than at its parts:
 *
 *   - an anonymous submission is stored and answered 200;
 *   - a notification failure changes nothing the prospect sees, because their
 *     request is already stored and telling them otherwise would make them
 *     believe it was lost;
 *   - the rate limit still refuses a flood, and refusing is not the same as
 *     storing.
 */

type NotifyOutcome = 'sent' | 'skipped' | 'failed';
type NotifyResult = { outcome: NotifyOutcome; detail: string | null };

const createPilotRequest = vi.fn(async (input: Record<string, unknown>) => ({
  ...input,
  id: 'req-1',
  createdAt: '2026-08-19T09:15:00.000Z',
}));

const notifyPilotRequest = vi.fn(
  async (_request: unknown): Promise<NotifyResult> => ({ outcome: 'sent', detail: null }),
);
const recordNotificationOutcome = vi.fn(async (_id: string, _result: NotifyResult) => undefined);

vi.mock('@/lib/data', () => ({
  getDataProvider: () => ({ createPilotRequest }),
}));

vi.mock('@/lib/pilot/notify', () => ({
  notifyPilotRequest,
}));

vi.mock('@/lib/pilot/record-outcome', () => ({
  recordNotificationOutcome,
}));

const VALID = {
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
  message: '',
};

/** Each test gets its own IP so the module-level rate limiter stays isolated. */
let ip = 0;
const submit = async (body: unknown, forwardedFor = `10.0.0.${++ip}`) => {
  const { POST } = await import('@/app/api/pilot/route');
  return POST(
    new Request('https://www.engisignal.com/api/pilot', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': forwardedFor },
      body: JSON.stringify(body),
    }),
  );
};

beforeEach(() => {
  createPilotRequest.mockClear();
  notifyPilotRequest.mockClear();
  recordNotificationOutcome.mockClear();
  notifyPilotRequest.mockResolvedValue({ outcome: 'sent', detail: null });
  vi.resetModules();
});

describe('an anonymous prospect submitting the form', () => {
  it('is answered 200 and the request is stored', async () => {
    const response = await submit(VALID);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    expect(createPilotRequest).toHaveBeenCalledTimes(1);
  });

  it('triggers exactly one notification, carrying that request', async () => {
    await submit(VALID);
    expect(notifyPilotRequest).toHaveBeenCalledTimes(1);
    expect(notifyPilotRequest.mock.calls[0]![0] as Record<string, unknown>).toMatchObject({
      company: 'Example Aerostructures',
      workEmail: 'dana@example-aero.com',
    });
  });

  it('is notified only after the request is safely stored', async () => {
    await submit(VALID);
    expect(createPilotRequest.mock.invocationCallOrder[0]!).toBeLessThan(
      notifyPilotRequest.mock.invocationCallOrder[0]!,
    );
  });
});

describe('when the notification cannot be sent', () => {
  it('still tells the prospect their request was received', async () => {
    notifyPilotRequest.mockResolvedValue({ outcome: 'failed', detail: 'HTTP 422 Invalid from field' });

    const response = await submit(VALID);
    // The regression this prevents: a stored lead reported to the prospect as
    // a failure, prompting them to give up or submit again.
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    expect(createPilotRequest).toHaveBeenCalledTimes(1);
  });

  it('still succeeds when notification is not configured at all', async () => {
    notifyPilotRequest.mockResolvedValue({ outcome: 'skipped', detail: null });
    const response = await submit(VALID);
    expect(response.status).toBe(200);
  });

  it('does not retry, because a retry would double-notify a stored lead', async () => {
    notifyPilotRequest.mockResolvedValue({ outcome: 'failed', detail: 'HTTP 422 Invalid from field' });
    await submit(VALID);
    expect(notifyPilotRequest).toHaveBeenCalledTimes(1);
  });
});

describe('what is refused', () => {
  it('rejects an invalid submission without storing or notifying', async () => {
    const response = await submit({ ...VALID, workEmail: 'not-an-email' });
    expect(response.status).toBe(400);
    expect(createPilotRequest).not.toHaveBeenCalled();
    expect(notifyPilotRequest).not.toHaveBeenCalled();
  });

  it('rate-limits a flood from one address, and refusing is not storing', async () => {
    const flood = '10.9.9.9';
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 7; attempt += 1) {
      statuses.push((await submit(VALID, flood)).status);
    }

    expect(statuses.filter((status) => status === 200).length).toBe(5);
    expect(statuses.filter((status) => status === 429).length).toBe(2);
    // Exactly the stored ones were announced: a refused attempt is not a lead.
    expect(createPilotRequest).toHaveBeenCalledTimes(5);
    expect(notifyPilotRequest).toHaveBeenCalledTimes(5);
  });

  it('reports a storage failure as a failure, unlike a notification failure', async () => {
    createPilotRequest.mockRejectedValueOnce(new Error('permission denied'));
    const response = await submit(VALID);

    expect(response.status).toBe(500);
    expect(notifyPilotRequest).not.toHaveBeenCalled();
  });
});
