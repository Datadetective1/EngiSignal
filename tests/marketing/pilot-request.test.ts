import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

/**
 * ── THE FORM AT THE TOP OF THE FUNNEL ───────────────────────────────────────
 *
 * Everyone who fills in the pilot request form is signed out. `anon` holds
 * INSERT on `pilot_requests` and nothing else, deliberately: the table holds
 * other companies' contact details, and a public SELECT policy would publish
 * the sales pipeline to anyone who asked.
 *
 * The provider used to finish the insert with `.select().single()`. That
 * RETURNING clause requires SELECT, so Postgres refused it, the insert rolled
 * back, and every prospect saw "The request could not be recorded." The
 * landing page's primary call to action was dead for precisely the people it
 * exists for -- and invisible to testing, because a signed-in caller holds
 * SELECT and succeeds.
 *
 * These tests hold the shape of the query, not just its result: a read-back
 * added here later fails loudly instead of silently in production.
 */

type Row = Record<string, unknown>;
const insert = vi.fn((_row: Row) => ({ error: null as { message: string } | null }));
const select = vi.fn();
const from = vi.fn(() => ({ insert, select }));

vi.mock('@/lib/supabase/server', () => ({
  userClient: async () => ({ from }),
}));

beforeEach(() => {
  insert.mockClear();
  select.mockClear();
  from.mockClear();
  insert.mockReturnValue({ error: null } as never);
  vi.resetModules();
});

const aRequest = {
  name: 'Dana Whitfield',
  workEmail: 'dana@example.com',
  company: 'Example Aerostructures',
  jobTitle: 'Director of Engineering Systems',
  approximateEmployees: '1,000 – 5,000',
  engineeringEmployees: '500 – 2,000',
  softwareSpendRange: '$2M – $10M',
  majorVendors: 'Ansys, Siemens',
  renewalTiming: 'Within 90 days',
  primaryChallenge: 'We suspect we are over-licensed',
  message: null,
};

describe('recording a pilot request as a signed-out visitor', () => {
  it('never reads the row back, because anon cannot select it', async () => {
    const { supabaseProvider } = await import('@/lib/data/supabase-provider');
    await supabaseProvider.createPilotRequest(aRequest);

    expect(insert).toHaveBeenCalledTimes(1);
    // The regression: any RETURNING here is refused for anon and rolls the
    // whole insert back.
    expect(select).not.toHaveBeenCalled();
  });

  it('supplies the id itself, so the row is known without being read', async () => {
    const { supabaseProvider } = await import('@/lib/data/supabase-provider');
    const created = await supabaseProvider.createPilotRequest(aRequest);

    const row = insert.mock.calls[0]![0];
    expect(row.id).toBe(created.id);
    expect(String(created.id)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('carries every answer the prospect gave', async () => {
    const { supabaseProvider } = await import('@/lib/data/supabase-provider');
    await supabaseProvider.createPilotRequest(aRequest);

    const row = insert.mock.calls[0]![0];
    expect(row.work_email).toBe('dana@example.com');
    expect(row.company).toBe('Example Aerostructures');
    // Asked on the form, and the one figure the workspace still cannot store.
    expect(row.engineering_employees).toBe('500 – 2,000');
    expect(row.renewal_timing).toBe('Within 90 days');
  });

  it('reports a genuine failure rather than pretending it was recorded', async () => {
    insert.mockReturnValueOnce({ error: { message: 'permission denied' } } as never);
    const { supabaseProvider } = await import('@/lib/data/supabase-provider');

    await expect(supabaseProvider.createPilotRequest(aRequest)).rejects.toThrow(/pilot request/i);
  });
});
