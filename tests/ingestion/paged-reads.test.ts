import { describe, expect, it, vi } from 'vitest';
import { PAGE_SIZE, readAllRows, type RangeableQuery } from '@/lib/ingestion/store/paging';

/**
 * PostgREST truncates silently.
 *
 * `db-max-rows` (1,000 on Supabase) caps every response. A plain select
 * SUCCEEDS, returns the first page, and reports no error — so an analytics
 * engine reading it computes a confident answer from a fraction of the estate.
 *
 * The Phase 2C production acceptance test hit exactly this: 4,116 usage rows
 * stored, 1,000 read, three of four features reported as having no usage at
 * all, and a $240,000 recommendation resting on the ANSYS rows that happened
 * to come first.
 */

/** A table that behaves the way PostgREST does. */
function fakeTable(totalRows: number, cap = PAGE_SIZE) {
  const all = Array.from({ length: totalRows }, (_, index) => ({ n: index }));
  const calls: { from: number; to: number }[] = [];

  const build = (): RangeableQuery<{ n: number }> => ({
    range(from, to) {
      calls.push({ from, to });
      const width = Math.min(to - from + 1, cap);
      return Promise.resolve({ data: all.slice(from, from + width), error: null });
    },
  });

  return { build, calls };
}

describe('reading every stored row', () => {
  it('returns all of them when there are more than one page', async () => {
    const table = fakeTable(4_116);
    const rows = await readAllRows(table.build);

    expect(rows).toHaveLength(4_116);
    expect(rows[0]!.n).toBe(0);
    expect(rows[4_115]!.n).toBe(4_115);
  });

  it('asks for the pages it needs and then stops', async () => {
    const table = fakeTable(4_116);
    await readAllRows(table.build);

    // 4 full pages plus the short final one. Not a page more.
    expect(table.calls).toHaveLength(5);
    expect(table.calls[0]).toEqual({ from: 0, to: 999 });
    expect(table.calls[4]).toEqual({ from: 4_000, to: 4_999 });
  });

  it('does not lose a row when the total is an exact multiple of the page', async () => {
    // The classic off-by-one: a full last page looks like there may be more,
    // so one extra empty request is correct and losing rows is not.
    const table = fakeTable(2_000);
    const rows = await readAllRows(table.build);

    expect(rows).toHaveLength(2_000);
    expect(table.calls).toHaveLength(3);
  });

  it('handles an empty table without a second request', async () => {
    const table = fakeTable(0);
    expect(await readAllRows(table.build)).toHaveLength(0);
    expect(table.calls).toHaveLength(1);
  });

  it('honours a caller-supplied limit without over-fetching', async () => {
    const table = fakeTable(4_116);
    const rows = await readAllRows(table.build, 1_500);

    expect(rows).toHaveLength(1_500);
    expect(table.calls).toHaveLength(2);
    expect(table.calls[1]).toEqual({ from: 1_000, to: 1_499 });
  });

  it('stops at the data when the limit exceeds it', async () => {
    const table = fakeTable(30);
    expect(await readAllRows(table.build, 5_000)).toHaveLength(30);
  });

  it('surfaces an error instead of returning a short result', async () => {
    // A failed page must never look like the end of the data.
    const build = (): RangeableQuery<{ n: number }> => ({
      range: () => Promise.resolve({ data: null, error: { message: 'connection reset' } }),
    });

    await expect(readAllRows(build)).rejects.toThrow('connection reset');
  });

  it('fails rather than truncating when a later page errors', async () => {
    let call = 0;
    const build = (): RangeableQuery<{ n: number }> => ({
      range(from, to) {
        call += 1;
        if (call > 1) return Promise.resolve({ data: null, error: { message: 'timeout' } });
        return Promise.resolve({
          data: Array.from({ length: to - from + 1 }, (_, i) => ({ n: from + i })),
          error: null,
        });
      },
    });

    await expect(readAllRows(build)).rejects.toThrow('timeout');
  });
});
