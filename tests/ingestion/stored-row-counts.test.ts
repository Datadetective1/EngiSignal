import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * ── THE COUNT THE INTEGRITY GATE RESTS ON ───────────────────────────────────
 *
 * Every analytical page is allowed to show a figure only when the rows the
 * analytics consumed equal the rows the database holds. The second half of that
 * comparison has to come FROM the database — counting the length of a read that
 * might itself have been truncated is the Phase 2C defect reproduced inside its
 * own detector.
 *
 * Phase 2E moved that count into count_canonical_rows, because Row Level
 * Security was evaluating the membership predicate once per row and an exact
 * count over 67,267 usage rows cost 1,464 ms in production — the entire
 * remaining cost of a page view. The function asks the membership question once
 * and then counts.
 *
 * The risk that swap introduces is a missing or malformed answer being read as
 * zero, which would report a truncated estate as a healthy empty one. These
 * tests exist for that.
 */

const rpc = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  userClient: async () => ({ rpc }),
  hasSupabaseEnv: () => true,
}));
vi.mock('server-only', () => ({}));

const { supabaseIngestionStore } = await import('@/lib/ingestion/store/supabase-store');

beforeEach(() => rpc.mockReset());

const ORG = '4359ceb6-d886-4019-8c5a-b8f973eee472';

describe('exact stored row counts', () => {
  it('asks the database for one organization and returns what it said', async () => {
    rpc.mockResolvedValue({
      data: { usage: 67_267, people: 403, entitlements: 12, contracts: 11 },
      error: null,
    });

    expect(await supabaseIngestionStore.countStoredRows(ORG)).toEqual({
      usage: 67_267,
      people: 403,
      entitlements: 12,
      contracts: 11,
    });
    expect(rpc).toHaveBeenCalledWith('count_canonical_rows', { org: ORG });
    // One round trip, not four. This is the change.
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('reports a genuinely empty estate as zero', async () => {
    rpc.mockResolvedValue({
      data: { usage: 0, people: 0, entitlements: 0, contracts: 0 },
      error: null,
    });
    expect(await supabaseIngestionStore.countStoredRows(ORG)).toEqual({
      usage: 0,
      people: 0,
      entitlements: 0,
      contracts: 0,
    });
  });

  it('throws rather than reading a missing count as zero', async () => {
    // The failure that would matter: a truncated estate reported as a healthy
    // empty one, with every analytical page happily showing nothing wrong.
    rpc.mockResolvedValue({ data: { people: 403, entitlements: 12, contracts: 11 }, error: null });
    await expect(supabaseIngestionStore.countStoredRows(ORG)).rejects.toThrow(/no usage count/);
  });

  it('throws when the answer is not a number', async () => {
    rpc.mockResolvedValue({
      data: { usage: null, people: 403, entitlements: 12, contracts: 11 },
      error: null,
    });
    await expect(supabaseIngestionStore.countStoredRows(ORG)).rejects.toThrow(/no usage count/);
  });

  it('throws when the database refuses, instead of guessing', async () => {
    // What a caller who is not a member of the organization gets.
    rpc.mockResolvedValue({ data: null, error: { message: 'not a member of this organization' } });
    await expect(supabaseIngestionStore.countStoredRows(ORG)).rejects.toThrow(/not a member/);
  });

  it('throws when nothing comes back at all', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(supabaseIngestionStore.countStoredRows(ORG)).rejects.toThrow(/no usage count/);
  });
});
