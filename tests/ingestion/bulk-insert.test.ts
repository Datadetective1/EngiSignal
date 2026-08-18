import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

/**
 * ── THE LOADER MUST NOT LOSE ROWS QUIETLY ───────────────────────────────────
 *
 * Persistence now sends rows as one jsonb argument and trusts a count that
 * comes back over the network to say how many landed. That is faster, and it
 * moves the one number the whole product depends on -- stored equals accepted
 * -- onto the far side of an RPC boundary.
 *
 * Postgres will not insert fewer rows than the statement asked for, so the
 * mismatch these tests describe should never happen in practice. That is
 * exactly why it needs a test: an assertion nobody ever sees fire is worth
 * nothing unless it has been shown to fire.
 */

const rpc = vi.fn();

/**
 * A chainable stand-in for the query builder. Every method returns the builder
 * and the builder resolves to an empty success, which is enough for the
 * bookkeeping around the loader -- the import row, the rollback delete and the
 * finalize -- without modelling PostgREST.
 */
function builder(): Record<string, unknown> {
  const result = { data: null, error: null };
  const self: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
    maybeSingle: async () => result,
  };
  for (const method of ['insert', 'select', 'update', 'delete', 'eq', 'order', 'limit']) {
    self[method] = () => self;
  }
  return self;
}

vi.mock('@/lib/supabase/server', () => ({
  userClient: async () => ({ rpc, from: () => builder() }),
  hasSupabaseEnv: () => true,
}));

async function loadStore() {
  const mod = await import('@/lib/ingestion/store/supabase-store');
  return mod.supabaseIngestionStore;
}

/** Reaches the loader through the only door it has: a commit. */
async function commitUsage(rowCount: number) {
  const store = await loadStore();
  const usage = Array.from({ length: rowCount }, (_, index) => ({
    date: '2026-01-01',
    hour: 9,
    user: `user${index}`,
    feature: 'feat',
    provenance: {
      organizationId: 'org-1',
      sourceSystem: 'generic',
      sourceFile: 'f.csv',
      sourceSheet: null,
      sourceRow: index + 2,
    },
  }));
  return store.commitImport({
    organizationId: 'org-1',
    importId: 'imp-1',
    fileName: 'f.csv',
    fileBytes: 10,
    dataset: 'usage',
    detectionEvidence: [],
    detectionConfidence: 1,
    detectionFellBack: false,
    sourceSheets: [],
    mappingUsed: {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result: {
      sourceSystem: 'generic',
      totalRows: rowCount,
      acceptedRows: rowCount,
      rejectedRows: 0,
      duplicateRows: 0,
      usage,
      entitlements: [],
      people: [],
      contracts: [],
      rejections: [],
      warnings: [],
      quality: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  });
}

beforeEach(() => {
  rpc.mockReset();
  vi.resetModules();
});
afterEach(() => vi.unstubAllEnvs());

describe('what the loader sends', () => {
  it('names the tenant and import as arguments rather than trusting the rows', async () => {
    // A row that carried its own organization_id could place data in another
    // tenant wherever RLS happened to allow it. The column is overwritten by
    // the database from these arguments, so the payload cannot decide it.
    rpc.mockImplementation((_fn, params) =>
      Promise.resolve({ data: (params.rows as unknown[]).length, error: null }),
    );
    await commitUsage(3);

    const call = rpc.mock.calls.find(([fn]) => fn === 'bulk_insert_usage');
    expect(call).toBeDefined();
    expect(call![1].org).toBe('org-1');
    expect(call![1].imp).toBe('imp-1');
    expect(call![1].rows[0]).not.toHaveProperty('organization_id');
    expect(call![1].rows[0]).not.toHaveProperty('import_id');
  });

  it('splits the rows into batches of the configured size', async () => {
    vi.stubEnv('ENGISIGNAL_INSERT_CHUNK', '2');
    vi.resetModules();
    rpc.mockImplementation((_fn, params) =>
      Promise.resolve({ data: (params.rows as unknown[]).length, error: null }),
    );
    await commitUsage(5);

    const usageCalls = rpc.mock.calls.filter(([fn]) => fn === 'bulk_insert_usage');
    expect(usageCalls.map((c) => c[1].rows.length)).toEqual([2, 2, 1]);
  });
});

describe('when the database writes fewer rows than were sent', () => {
  it('refuses the import rather than reporting a short write as success', async () => {
    rpc.mockImplementation((fn, params) =>
      fn === 'bulk_insert_usage'
        ? Promise.resolve({ data: (params.rows as unknown[]).length - 1, error: null })
        : Promise.resolve({ data: 0, error: null }),
    );

    await expect(commitUsage(10)).rejects.toThrow(/sent 10 rows but the database recorded 9/);
  });

  it('surfaces a database error instead of continuing to the next batch', async () => {
    rpc.mockImplementation((fn) =>
      fn === 'bulk_insert_usage'
        ? Promise.resolve({ data: null, error: { message: 'permission denied' } })
        : Promise.resolve({ data: 0, error: null }),
    );

    await expect(commitUsage(4)).rejects.toThrow(/permission denied/);
  });
});
