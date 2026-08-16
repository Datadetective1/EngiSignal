/**
 * ── READING ALL THE ROWS, NOT THE FIRST PAGE OF THEM ─────────────────────────
 *
 * PostgREST caps every response at `db-max-rows`, which Supabase defaults to
 * 1,000. A plain `.select('*')` therefore SUCCEEDS and returns a truncated
 * result with no error, no warning, and no indication that anything is missing.
 *
 * Found in the Phase 2C production acceptance test. 4,116 usage rows were
 * stored correctly across four features; the app read the first 1,000, which
 * were all ANSYS. Three features with six months of real usage were reported as
 * "usage evidence not supplied", and ANSYS's P95 — along with the $240,000
 * recommendation resting on it — was computed from under a quarter of the
 * evidence, presented with no hint that the rest existed.
 *
 * That is the worst failure this product can have: not an error, but a
 * confident answer derived from a fraction of the data.
 *
 * Lives in its own module, free of `server-only`, so the paging logic can be
 * tested directly rather than only through a live database.
 */

export const PAGE_SIZE = 1000;

/** The only part of a PostgREST query builder this needs. */
export interface RangeableQuery<T> {
  range(
    from: number,
    to: number,
  ): PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
}

/**
 * Read every row a query matches, one page at a time.
 *
 * `build` is called per page so the same filters are reapplied; PostgREST
 * builders are single-use. An error on any page throws rather than returning
 * what arrived so far — a partial read that looks like a complete one is the
 * defect this exists to prevent.
 */
export async function readAllRows<T>(
  build: () => RangeableQuery<T>,
  limit?: number,
): Promise<T[]> {
  const rows: T[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    // Never ask for more than the caller wanted, when they capped it.
    const remaining = limit === undefined ? PAGE_SIZE : Math.min(PAGE_SIZE, limit - rows.length);
    if (remaining <= 0) break;

    const { data, error } = await build().range(offset, offset + remaining - 1);
    if (error !== null) throw new Error(error.message);

    const page = data ?? [];
    rows.push(...page);

    // A short page means there is nothing after it. This is the only
    // end-of-data signal PostgREST gives without a separate count request.
    if (page.length < remaining) break;
  }

  return rows;
}
