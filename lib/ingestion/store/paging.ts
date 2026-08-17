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
 * ── AND READING THEM IN A TIME A PERSON WILL WAIT ────────────────────────────
 *
 * Phase 2D measured the fix at the stated ceiling. A 67,267-row estate is 68
 * pages, and every page was a separate round trip taken one after another:
 * the Renewals page took 50.8 seconds to render in production. The analytics
 * over those rows take under a second — the entire cost was the queue of
 * sequential requests.
 *
 * Pages are now issued in parallel batches. The caller usually already knows
 * the exact row count (the integrity check counts it server-side with
 * `head: true`), so it can say how many pages to expect and the whole read
 * becomes a handful of waves instead of a queue.
 *
 * The expected count is used ONLY to decide how many requests to have in flight.
 * It is never used to decide when to stop. Trusting a count taken at a
 * different instant to end the read would put the truncation defect back, just
 * with a more convincing justification for it.
 *
 * Lives in its own module, free of `server-only`, so the paging logic can be
 * tested directly rather than only through a live database.
 */

export const PAGE_SIZE = 1000;

/**
 * How many page requests may be in flight at once.
 *
 * Bounded rather than unlimited: an estate at the ceiling is 68 pages, and
 * opening 68 simultaneous connections to Postgres from a serverless function
 * trades a slow page for an exhausted connection pool.
 */
export const MAX_CONCURRENT_PAGES = 8;

/** The only part of a PostgREST query builder this needs. */
export interface RangeableQuery<T> {
  range(
    from: number,
    to: number,
  ): PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
}

export interface ReadAllOptions {
  /** Stop after this many rows. Used by the deliberately capped rejection list. */
  limit?: number;
  /**
   * Exact row count from a server-side count, when the caller has one.
   * A hint for parallelism only — never a termination condition.
   */
  expected?: number;
}

/**
 * Read every row a query matches.
 *
 * `build` is called per page so the same filters are reapplied; PostgREST
 * builders are single-use. An error on any page throws rather than returning
 * what arrived so far — a partial read that looks like a complete one is the
 * defect this exists to prevent.
 */
export async function readAllRows<T>(
  build: () => RangeableQuery<T>,
  options?: number | ReadAllOptions,
): Promise<T[]> {
  const { limit, expected } = typeof options === 'number' ? { limit: options, expected: undefined } : (options ?? {});

  const rows: T[] = [];
  let offset = 0;
  // Pages the caller's count suggests are worth requesting up front. Only the
  // first batch can use it; after that the data itself decides.
  let plannedPages =
    expected === undefined ? 1 : Math.max(1, Math.ceil(Math.min(expected, limit ?? expected) / PAGE_SIZE));

  for (;;) {
    // Never ask for more than the caller wanted, when they capped it.
    const budget = limit === undefined ? Infinity : limit - rows.length;
    if (budget <= 0) break;

    const maxPages = budget === Infinity ? Infinity : Math.ceil(budget / PAGE_SIZE);
    const batchSize = Math.max(1, Math.min(MAX_CONCURRENT_PAGES, plannedPages, maxPages));

    const requests: Promise<T[]>[] = [];
    for (let page = 0; page < batchSize; page++) {
      const from = offset + page * PAGE_SIZE;
      const width =
        limit === undefined ? PAGE_SIZE : Math.max(0, Math.min(PAGE_SIZE, limit - (from - 0)));
      if (width <= 0) break;
      requests.push(
        Promise.resolve(build().range(from, from + width - 1)).then(({ data, error }) => {
          if (error !== null) throw new Error(error.message);
          return data ?? [];
        }),
      );
    }
    if (requests.length === 0) break;

    // Promise.all rejects on the first failure, so a page that errored can
    // never be mistaken for the end of the data.
    const pages = await Promise.all(requests);

    let ended = false;
    for (const [index, page] of pages.entries()) {
      const from = offset + index * PAGE_SIZE;
      const requested = limit === undefined ? PAGE_SIZE : Math.min(PAGE_SIZE, limit - from);

      if (ended) {
        // Rows after a short page mean the range we just assembled has a hole
        // in it. Returning it would be a silent partial read wearing the shape
        // of a complete one, which is the whole thing this module exists to
        // prevent.
        if (page.length > 0) {
          throw new Error(
            `Paged read returned ${page.length} rows after a short page at offset ${from - PAGE_SIZE}. The result would have a gap in it.`,
          );
        }
        continue;
      }

      rows.push(...page);
      // A short page means there is nothing after it. This is the only
      // end-of-data signal PostgREST gives without a separate count request.
      if (page.length < requested) ended = true;
    }

    if (ended) break;

    offset += requests.length * PAGE_SIZE;
    plannedPages = Math.max(1, plannedPages - requests.length);
  }

  return limit === undefined ? rows : rows.slice(0, limit);
}
