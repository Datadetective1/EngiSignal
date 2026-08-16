import { describe, expect, it } from 'vitest';
import { analyticsAvailable, checkIntegrity, type StoredRowCounts } from '@/lib/analytics/integrity';
import { PAGE_SIZE, readAllRows, type RangeableQuery } from '@/lib/ingestion/store/paging';

/**
 * THE PHASE 2C DEFECT, MADE IMPOSSIBLE TO SHIP AGAIN.
 *
 * PostgREST capped reads at 1,000 rows. The query succeeded, returned a page,
 * and the application analysed 24% of an estate while presenting the result as
 * finished. The paging fix removed that cause; this removes the class, by
 * refusing to treat "the read succeeded" as evidence the read was complete.
 */

const zero: StoredRowCounts = { usage: 0, people: 0, entitlements: 0, contracts: 0 };
const counts = (over: Partial<StoredRowCounts>): StoredRowCounts => ({ ...zero, ...over });

describe('the integrity check', () => {
  it('passes when all three counts agree', () => {
    const report = checkIntegrity({
      accepted: counts({ usage: 61_759, people: 403, entitlements: 12, contracts: 12 }),
      stored: counts({ usage: 61_759, people: 403, entitlements: 12, contracts: 12 }),
      analyzed: counts({ usage: 61_759, people: 403, entitlements: 12, contracts: 12 }),
    });

    expect(report.complete).toBe(true);
    expect(report.incomplete).toEqual([]);
    expect(analyticsAvailable(report)).toBe(true);
    expect(report.headline).toContain('62,186');
  });

  it('catches the exact Phase 2C failure: stored more than analyzed', () => {
    const report = checkIntegrity({
      accepted: counts({ usage: 4_116 }),
      stored: counts({ usage: 4_116 }),
      analyzed: counts({ usage: 1_000 }),
    });

    expect(report.complete).toBe(false);
    expect(report.incomplete).toEqual(['usage']);
    expect(report.usageIncomplete).toBe(true);

    const usage = report.datasets.find((entry) => entry.dataset === 'usage')!;
    expect(usage.missingFromAnalysis).toBe(3_116);
    expect(usage.statement).toContain('3,116 of 4,116');
  });

  it('withholds analytics when usage is short', () => {
    const report = checkIntegrity({
      accepted: counts({ usage: 4_116 }),
      stored: counts({ usage: 4_116 }),
      analyzed: counts({ usage: 1_000 }),
    });
    // The whole point: no percentile, no recommendation, no dollar figure.
    expect(analyticsAvailable(report)).toBe(false);
  });

  it('catches a partially failed commit: accepted more than stored', () => {
    const report = checkIntegrity({
      accepted: counts({ usage: 5_000 }),
      stored: counts({ usage: 4_800 }),
      analyzed: counts({ usage: 4_800 }),
    });

    const usage = report.datasets.find((entry) => entry.dataset === 'usage')!;
    expect(usage.complete).toBe(false);
    expect(usage.missingFromStorage).toBe(200);
    expect(usage.statement).toContain('partially failed');
  });

  it('reports an impossible over-read rather than clamping it', () => {
    const report = checkIntegrity({
      accepted: counts({ usage: 100 }),
      stored: counts({ usage: 100 }),
      analyzed: counts({ usage: 140 }),
    });
    const usage = report.datasets.find((entry) => entry.dataset === 'usage')!;
    expect(usage.statement).toContain('should be impossible');
    expect(usage.complete).toBe(false);
  });

  it('does not withhold demand analytics when only contracts are short', () => {
    // Contract trouble is real and reported, but it does not make a percentile
    // over usage wrong.
    const report = checkIntegrity({
      accepted: counts({ usage: 500, contracts: 12 }),
      stored: counts({ usage: 500, contracts: 12 }),
      analyzed: counts({ usage: 500, contracts: 9 }),
    });

    expect(report.complete).toBe(false);
    expect(report.incomplete).toEqual(['contracts']);
    expect(analyticsAvailable(report)).toBe(true);
  });

  it('treats an empty workspace as complete, not as broken', () => {
    const report = checkIntegrity({ accepted: zero, stored: zero, analyzed: zero });
    expect(report.complete).toBe(true);
    expect(analyticsAvailable(report)).toBe(true);
    expect(report.datasets[0]!.statement).toContain('No usage data imported');
  });

  it('names every dataset that failed in the headline', () => {
    const report = checkIntegrity({
      accepted: counts({ usage: 10, people: 10 }),
      stored: counts({ usage: 10, people: 10 }),
      analyzed: counts({ usage: 4, people: 4 }),
    });
    expect(report.headline).toContain('Usage');
    expect(report.headline).toContain('People');
    expect(report.headline).toContain('withheld');
  });
});

/**
 * Paging boundaries, at the sizes Phase 2D calls out by name.
 *
 * The dangerous ones are the exact multiples: at 1,000 and 2,000 a full final
 * page looks identical to "there may be more", and an off-by-one in the
 * stop condition drops the last page silently.
 */
describe('paging at every boundary', () => {
  function table(total: number) {
    const all = Array.from({ length: total }, (_, index) => ({ n: index }));
    const calls: number[] = [];
    const build = (): RangeableQuery<{ n: number }> => ({
      range(from, to) {
        calls.push(from);
        // PostgREST behaviour: never return more than the server cap.
        const width = Math.min(to - from + 1, PAGE_SIZE);
        return Promise.resolve({ data: all.slice(from, from + width), error: null });
      },
    });
    return { build, calls };
  }

  for (const total of [0, 1, 999, 1_000, 1_001, 1_999, 2_000, 2_001, 10_000, 10_001, 61_759]) {
    it(`returns exactly ${total.toLocaleString('en-US')} rows`, async () => {
      const t = table(total);
      const rows = await readAllRows(t.build);

      expect(rows).toHaveLength(total);
      // Not just the count — the right rows, in order, with no gap in the middle.
      expect(rows[0]?.n ?? null).toBe(total === 0 ? null : 0);
      expect(rows[total - 1]?.n ?? null).toBe(total === 0 ? null : total - 1);
      expect(new Set(rows.map((row) => row.n)).size).toBe(total);
    });
  }

  it('cannot silently drop the final page at an exact multiple', async () => {
    // 2,000 rows arrive as two full pages. A stop condition of
    // "page.length < PAGE_SIZE" is correct only if the loop then asks once
    // more and gets nothing; anything cleverer loses rows 1,001-2,000 or
    // reports 2,000 when the table holds 2,001.
    for (const total of [1_000, 2_000, 10_000]) {
      const t = table(total);
      const rows = await readAllRows(t.build);
      expect(rows).toHaveLength(total);
      // One extra request beyond the full pages, which returns empty.
      expect(t.calls).toHaveLength(total / PAGE_SIZE + 1);
      expect(t.calls.at(-1)).toBe(total);
    }
  });

  it('integrity would catch a regression that reintroduced the cap', async () => {
    // Simulate the old behaviour: a single capped read.
    const t = table(61_759);
    const truncated = (await t.build().range(0, PAGE_SIZE - 1)).data ?? [];

    const report = checkIntegrity({
      accepted: counts({ usage: 61_759 }),
      stored: counts({ usage: 61_759 }),
      analyzed: counts({ usage: truncated.length }),
    });

    expect(truncated).toHaveLength(1_000);
    expect(report.complete).toBe(false);
    expect(analyticsAvailable(report)).toBe(false);
  });
});
