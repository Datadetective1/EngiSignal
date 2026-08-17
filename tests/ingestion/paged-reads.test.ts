import { describe, expect, it, vi } from 'vitest';
import {
  PAGE_SIZE,
  readAllRows,
  readAllRowsByCursor,
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

// ─────────────────────────────────────────────────────────────────────────────
// Reading a ceiling-sized estate in a time a person will wait
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Phase 2D imported an estate at the stated ceiling and timed the corrected
 * read in production: /app/renewals took 50.8 seconds. The analytics over the
 * same 67,267 rows take 668 ms — all of it was the read, and the read was
 * quadratic, because `range(60000, 60999)` makes the database walk 61,000 rows
 * to reach the ones it returns.
 *
 * Making those requests concurrent made it worse rather than better. Measured
 * against production, eight deep pages in flight exceeded Supabase's 8-second
 * statement timeout and returned 52,000 rows of 67,267. Faster truncation is
 * not an improvement.
 *
 * Keyset paging seeks straight to the rows after the last id it saw. Measured
 * on the same estate: 68 pages, all 67,267 rows, 8.6 seconds, no timeouts.
 */

/** A table that behaves the way PostgREST does, paged by cursor. */
function cursorTable(totalRows: number, cap = PAGE_SIZE) {
  const all = Array.from({ length: totalRows }, (_, index) => ({ id: index + 1 }));
  const calls: { afterId: number; size: number }[] = [];

  const fetchPage = (afterId: number, size: number) => {
    calls.push({ afterId, size });
    const found = all.findIndex((row) => row.id > afterId);
    const start = found === -1 ? all.length : found;
    return Promise.resolve({ data: all.slice(start, start + Math.min(size, cap)), error: null });
  };

  return { fetchPage, calls };
}

describe('reading every stored row by cursor', () => {
  it('returns all of them, in order, at ceiling volume', async () => {
    const table = cursorTable(67_267);
    const rows = await readAllRowsByCursor(table.fetchPage);

    expect(rows).toHaveLength(67_267);
    // Order matters: the analytics read dates out of these rows in sequence.
    expect(rows.every((row, index) => row.id === index + 1)).toBe(true);
  });

  it('never asks the database to count past rows it does not want', async () => {
    const table = cursorTable(67_267);
    await readAllRowsByCursor(table.fetchPage);

    // The quadratic term is gone: every page is a seek, not a scan-and-skip.
    expect(table.calls[0]).toEqual({ afterId: 0, size: PAGE_SIZE });
    expect(table.calls[1]).toEqual({ afterId: 1_000, size: PAGE_SIZE });
    expect(table.calls.at(-1)?.afterId).toBe(67_000);
  });

  it('does not lose a row when the total is an exact multiple of the page', async () => {
    const table = cursorTable(2_000);
    const rows = await readAllRowsByCursor(table.fetchPage);

    expect(rows).toHaveLength(2_000);
    expect(table.calls).toHaveLength(3);
  });

  it('handles an empty table without a second request', async () => {
    const table = cursorTable(0);
    expect(await readAllRowsByCursor(table.fetchPage)).toHaveLength(0);
    expect(table.calls).toHaveLength(1);
  });

  it('honours a caller-supplied limit without over-fetching', async () => {
    const table = cursorTable(67_267);
    const rows = await readAllRowsByCursor(table.fetchPage, { limit: 1_500 });

    expect(rows).toHaveLength(1_500);
    expect(table.calls).toHaveLength(2);
    expect(table.calls[1]).toEqual({ afterId: 1_000, size: 500 });
  });

  it('surfaces a timeout instead of returning a short estate', async () => {
    // 57014 is what production returned when deep pages ran concurrently. It
    // must never be mistaken for the end of the data.
    let call = 0;
    const fetchPage = (afterId: number, size: number) => {
      call += 1;
      if (call > 3) {
        return Promise.resolve({
          data: null,
          error: { message: 'canceling statement due to statement timeout' },
        });
      }
      return Promise.resolve({
        data: Array.from({ length: size }, (_, i) => ({ id: afterId + i + 1 })),
        error: null,
      });
    };

    await expect(readAllRowsByCursor(fetchPage)).rejects.toThrow('statement timeout');
  });

  it('refuses to spin forever on a page that cannot advance the cursor', async () => {
    // An unordered page re-reads the same rows until the request dies. Saying
    // so is better than a request that never returns.
    const fetchPage = (_afterId: number, size: number) =>
      Promise.resolve({ data: Array.from({ length: size }, () => ({ id: 7 })), error: null });

    await expect(readAllRowsByCursor(fetchPage)).rejects.toThrow('did not advance');
  });

  it('never asks for a page larger than the server will return', async () => {
    // Measured against production: range(0, 9999) returns exactly 1,000 rows,
    // silently. A page size above the server cap would read one page, see a
    // "short" page, and call it the whole estate.
    const table = cursorTable(67_267, PAGE_SIZE);
    expect(await readAllRowsByCursor(table.fetchPage)).toHaveLength(67_267);
    for (const call of table.calls) expect(call.size).toBeLessThanOrEqual(PAGE_SIZE);
  });
});
