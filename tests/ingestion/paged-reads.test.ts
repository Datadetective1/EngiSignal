import { describe, expect, it, vi } from 'vitest';
import {
  MAX_CONCURRENT_PAGES,
  PAGE_SIZE,
  readAllRows,
  type RangeableQuery,
} from '@/lib/ingestion/store/paging';

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


/**
 * ── AND READING THEM QUICKLY ─────────────────────────────────────────────────
 *
 * Phase 2D measured the corrected read at the stated ceiling: 67,267 rows is 68
 * pages, taken one after another, and the Renewals page took 50.8 seconds to
 * render in production. The analytics over those same rows take under a second.
 *
 * Pages are now requested in parallel batches, sized from the exact count the
 * integrity check already takes server-side. The count decides CONCURRENCY and
 * nothing else — the read still ends on a short page, so a count captured a
 * moment earlier can never shorten a read.
 */

/** Records how many requests were open at the same moment. */
function concurrentTable(totalRows: number) {
  const all = Array.from({ length: totalRows }, (_, index) => ({ n: index }));
  const calls: { from: number; to: number }[] = [];
  let open = 0;
  let peak = 0;

  const build = (): RangeableQuery<{ n: number }> => ({
    range(from, to) {
      calls.push({ from, to });
      open += 1;
      peak = Math.max(peak, open);
      return new Promise((resolve) => {
        setTimeout(() => {
          open -= 1;
          resolve({ data: all.slice(from, to + 1), error: null });
        }, 1);
      });
    },
  });

  return { build, calls, peak: () => peak };
}

describe('reading a ceiling-sized estate without a queue of round trips', () => {
  it('returns exactly the same rows as the sequential read', async () => {
    const table = concurrentTable(67_267);
    const rows = await readAllRows(table.build, { expected: 67_267 });

    expect(rows).toHaveLength(67_267);
    expect(rows[0]!.n).toBe(0);
    expect(rows[67_266]!.n).toBe(67_266);
    // Order matters: the analytics read dates out of these rows in sequence.
    expect(rows.every((row, index) => row.n === index)).toBe(true);
  });

  it('overlaps requests instead of waiting for each page', async () => {
    const table = concurrentTable(67_267);
    await readAllRows(table.build, { expected: 67_267 });
    expect(table.peak()).toBeGreaterThan(1);
    expect(table.peak()).toBeLessThanOrEqual(MAX_CONCURRENT_PAGES);
  });

  it('never opens more connections than the bound allows', async () => {
    // 68 simultaneous connections from a serverless function exhausts the pool.
    const table = concurrentTable(5_000_000 / PAGE_SIZE);
    await readAllRows(table.build, { expected: 5_000_000 });
    expect(table.peak()).toBeLessThanOrEqual(MAX_CONCURRENT_PAGES);
  });

  it('reads past a count that was taken before rows were added', async () => {
    // The count is a hint. If the estate grew between counting and reading,
    // the read must not stop at the stale number.
    const table = concurrentTable(9_500);
    const rows = await readAllRows(table.build, { expected: 4_000 });
    expect(rows).toHaveLength(9_500);
  });

  it('does not use a stale high count to claim rows that are not there', async () => {
    const table = concurrentTable(2_300);
    const rows = await readAllRows(table.build, { expected: 40_000 });
    // Short read, reported as a short read. The integrity check compares this
    // against the stored count and withholds the analytics; it is not padded,
    // and it does not throw.
    expect(rows).toHaveLength(2_300);
  });

  it('refuses to assemble a result with a hole in it', async () => {
    // A page that comes back short followed by a page with rows in it means
    // the range we assembled is not contiguous. Returning it would be a
    // partial read wearing the shape of a complete one.
    const build = (): RangeableQuery<{ n: number }> => ({
      range(from, to) {
        const width = from === PAGE_SIZE ? 10 : to - from + 1;
        return Promise.resolve({
          data: Array.from({ length: width }, (_, i) => ({ n: from + i })),
          error: null,
        });
      },
    });

    await expect(readAllRows(build, { expected: 8_000 })).rejects.toThrow(/gap in it/);
  });

  it('still honours a caller-supplied limit when a count is available', async () => {
    const table = concurrentTable(67_267);
    const rows = await readAllRows(table.build, { limit: 200, expected: 67_267 });
    expect(rows).toHaveLength(200);
    expect(table.calls).toHaveLength(1);
  });
});
