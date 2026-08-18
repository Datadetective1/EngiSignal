import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

/**
 * ── WHAT A THREE-SECOND POLL IS ALLOWED TO COST ─────────────────────────────
 *
 * The import-progress card polls this endpoint every three seconds for the
 * whole duration of an import. It used to also compute coverage, which reads
 * every canonical row a tenant has through a 1,000-row cursor — roughly 470
 * round trips at 466,000 rows, repeated every three seconds.
 *
 * Measured in production: 1,814 of those paged reads in a single run, mean
 * 1,347 ms and max 7,997 ms against an 8,000 ms statement timeout. It saturated
 * the database enough that other pages' integrity counts were cancelled, and
 * three of 96 page reads returned 500 while the customer watched their own
 * import progress.
 *
 * Nothing consumed it. This test exists so nothing can quietly put it back:
 * the cost of a poll is the thing that matters, not the shape of its response.
 */

const listImports = vi.fn(async () => []);
const getCoverage = vi.fn(async () => ({ usageRecords: 0 }));

vi.mock('@/lib/ingestion/session', () => ({
  resolveIngestionContext: async () => ({ ok: true, context: { organizationId: 'org-1' } }),
}));

vi.mock('@/lib/ingestion/store', () => ({
  getIngestionStore: () => ({ kind: 'supabase', listImports, getCoverage }),
  isEphemeralStore: () => false,
}));

beforeEach(() => {
  listImports.mockClear();
  getCoverage.mockClear();
  vi.resetModules();
});

describe('the endpoint the progress card polls', () => {
  it('lists imports without reading a single canonical row', async () => {
    const { GET } = await import('@/app/api/ingestion/imports/route');
    const response = await GET();

    expect(response.status).toBe(200);
    expect(listImports).toHaveBeenCalledTimes(1);
    // The whole point: no full-estate read on a path polled every three seconds.
    expect(getCoverage).not.toHaveBeenCalled();
  });

  it('still answers with the import list the card needs', async () => {
    listImports.mockResolvedValueOnce([
      { id: 'imp-1', fileName: 'usage.csv', status: 'importing', acceptedRows: 10, rowsPersisted: 4 },
    ] as never);

    const { GET } = await import('@/app/api/ingestion/imports/route');
    const body = await (await GET()).json();

    expect(body.imports).toHaveLength(1);
    expect(body.imports[0].rowsPersisted).toBe(4);
  });
});
