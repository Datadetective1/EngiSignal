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

// ─────────────────────────────────────────────────────────────────────────────
// Reading a full estate in a time a person will wait
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ── WHY OFFSET PAGING IS NOT ENOUGH ──────────────────────────────────────────
 *
 * Phase 2D imported an estate at the ceiling the import page states — 68,008
 * rows — and measured the corrected read in production:
 *
 *     /app/renewals   50.8 seconds
 *
 * The analytics are not the cost. The same 67,267 rows parse, project and build
 * a full portfolio in 668 ms in-process. The cost is the read, and it is
 * quadratic: `range(60000, 60999)` makes Postgres walk 61,000 rows to reach the
 * ones it returns. Measured on the production table, page 61 took 141 ms of
 * database time against 10 ms for page 1, and the shape only gets worse as a
 * customer's history grows.
 *
 * Issuing those pages concurrently makes it worse rather than better. Measured
 * against production with eight requests in flight, the deep pages exceeded
 * Supabase's 8-second `statement_timeout` and came back
 * `57014: canceling statement due to statement timeout` — 52,000 rows of 67,267,
 * with errors. Faster truncation is not an improvement.
 *
 * Keyset paging removes the offset entirely: each page asks for the rows AFTER
 * the last id it saw, which the index can seek to directly. Measured on the
 * same estate: 68 pages, 67,267 rows, 8.6 seconds, no timeouts. It is
 * deliberately sequential — each page needs the previous page's last key — and
 * sequential-and-complete beats concurrent-and-truncated every time.
 *
 * The page size stays at 1,000 because that is what the server will give.
 * Requesting more was measured too: `range(0, 9999)` returns exactly 1,000
 * rows, silently. Asking for a bigger page is the truncation defect with extra
 * steps.
 */

/** A row that can be paged by cursor. Every canonical table has a bigint id. */
export interface CursorRow {
  id: number;
}

export interface CursorReadOptions {
  /** Stop after this many rows. Used by the deliberately capped rejection list. */
  limit?: number;
}

/**
 * Read every row a query matches, seeking by id rather than counting past rows.
 *
 * `fetchPage` is called per page so the same filters are reapplied; PostgREST
 * builders are single-use. It must apply `.gt('id', afterId)`, `.order('id')`
 * ascending and `.limit(size)` — the ordering is what makes the cursor
 * meaningful, and a page returned in another order would skip rows.
 *
 * An error on any page throws rather than returning what arrived so far. A
 * partial read that looks like a complete one is the defect this module exists
 * to prevent, and a statement timeout on page 40 is exactly that.
 */
export async function readAllRowsByCursor<T extends CursorRow>(
  fetchPage: (
    afterId: number,
    size: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  options?: CursorReadOptions,
): Promise<T[]> {
  const limit = options?.limit;
  const rows: T[] = [];
  let afterId = 0;

  for (;;) {
    // Never ask for more than the caller wanted, when they capped it.
    const size = limit === undefined ? PAGE_SIZE : Math.min(PAGE_SIZE, limit - rows.length);
    if (size <= 0) break;

    const { data, error } = await fetchPage(afterId, size);
    if (error !== null) throw new Error(error.message);

    const page = data ?? [];
    rows.push(...page);

    // A short page means there is nothing after it. Because `size` is never
    // above the server's own row cap, a full page can only mean "there may be
    // more" and never "the server truncated this".
    if (page.length < size) break;

    const last = page[page.length - 1];
    // Defensive: a page that cannot advance the cursor would loop forever,
    // re-reading the same rows until the request died. Better to say so.
    if (last === undefined || last.id <= afterId) {
      throw new Error(
        `Paged read did not advance past id ${afterId}. The page is not ordered by id ascending.`,
      );
    }
    afterId = last.id;
  }

  return rows;
}
