import { describe, expect, it } from 'vitest';
import { costPerEngineer, formatCurrency, formatNumber } from '@/lib/analytics/financial';
import { round } from '@/lib/analytics/stats';

/**
 * ── A NUMBER NOBODY COMPUTED ────────────────────────────────────────────────
 *
 * Found on the cost page of a real tenant during pilot-readiness testing:
 *
 *     COST PER TECHNICAL EMPLOYEE
 *     $0
 *     — employees
 *
 * against a $5.7M portfolio. The headcount was correctly reported as unknown
 * one line below the figure derived from it.
 *
 * Three things had to line up, and each is pinned here:
 *
 *   1. The projection worker holds no table privileges, so it cannot read
 *      `organizations`. It built the dataset's organization as
 *      `{ id, name } as Organization` -- a cast that told the compiler the
 *      other fields existed while leaving them `undefined` at runtime.
 *   2. `costPerEngineer` guarded with `=== null`, which `undefined` does not
 *      satisfy, so the division ran anyway and produced NaN.
 *   3. `round` returns 0 for any non-finite input, converting that NaN into a
 *      figure indistinguishable from a computed one.
 *
 * A missing number that prints as "—" costs a customer nothing. A missing
 * number that prints as "$0" tells a CFO their engineering software is free.
 */

describe('an unknown headcount never becomes a currency figure', () => {
  it('returns null when headcount is null', () => {
    expect(costPerEngineer(5_700_000, null)).toBeNull();
  });

  it('returns null when headcount is undefined, which is how the bug arrived', () => {
    // The runtime value the `as Organization` cast allowed through. Typed as
    // never happening, so the cast is deliberate -- this is the regression.
    expect(costPerEngineer(5_700_000, undefined as unknown as number)).toBeNull();
  });

  it('returns null rather than zero for a non-finite headcount', () => {
    expect(costPerEngineer(5_700_000, NaN as unknown as number)).toBeNull();
    expect(costPerEngineer(5_700_000, Infinity)).toBeNull();
  });

  it('returns null for zero and negative headcount', () => {
    expect(costPerEngineer(5_700_000, 0)).toBeNull();
    expect(costPerEngineer(5_700_000, -5)).toBeNull();
  });

  it('still divides when the headcount is real', () => {
    expect(costPerEngineer(5_700_000, 1_200)).toBe(4750);
  });

  it('prints as an em dash, matching the headcount shown beside it', () => {
    // The two cells must agree. This is the assertion that would have failed
    // while the page was live: value "$0", detail "—".
    const headcount = undefined as unknown as number;
    expect(formatCurrency(costPerEngineer(5_700_000, headcount))).toBe('—');
    expect(formatNumber(headcount)).toBe('—');
  });
});

/**
 * `round` is used at 88 call sites, nearly all of which guard their denominator
 * before calling it. Its non-finite branch is retained deliberately -- changing
 * a shared numeric contract on the eve of a pilot is the riskier act -- but the
 * behaviour is documented here rather than left to be rediscovered.
 *
 * The rule this encodes: never hand `round` a value that could be non-finite
 * and treat the result as computed. Guard first, as costPerEngineer now does.
 */
describe('round launders non-finite values into zero', () => {
  it('turns NaN into a number that looks computed', () => {
    expect(round(NaN, 2)).toBe(0);
    expect(round(Infinity, 2)).toBe(0);
  });

  it('which is why every caller must guard its denominator first', () => {
    expect(round(5_700_000 / (undefined as unknown as number), 2)).toBe(0);
  });
});
