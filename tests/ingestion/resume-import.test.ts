import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

/**
 * ── EXPIRY MUST BE RECOVERABLE, NOT TERMINAL ────────────────────────────────
 *
 * The worker reads uploads through a signed URL that lasts a day, because a
 * bearer capability to a customer's file should expire. The cost of that is a
 * failure mode that did not exist when the URL was effectively permanent: an
 * import left failed for longer than the URL lives cannot be retried, even
 * though the file is still sitting in storage untouched.
 *
 * So resuming has to renew access, requeue, and keep the checkpoint -- and it
 * has to refuse the cases where requeueing would be wrong. The most important
 * of those is a completed import: requeueing one would re-run a job whose rows
 * are already stored.
 */

const state: {
  removedPaths: string[];
  record: Record<string, unknown> | null;
  signed: { data: { signedUrl: string } | null; error: { message: string } | null };
  updateFilters: Record<string, unknown>;
  updatePayload: Record<string, unknown> | null;
  updateReturns: unknown[];
} = {
  removedPaths: [],
  record: null,
  signed: { data: { signedUrl: 'https://storage.example/fresh' }, error: null },
  updateFilters: {},
  updatePayload: null,
  updateReturns: [{ id: 'imp-1' }],
};

vi.mock('@/lib/supabase/server', () => {
  /**
   * One chainable builder for both statements the store issues: a read that
   * ends in maybeSingle, and an update that ends in select('id'). Filters are
   * only recorded once `update` has been called, so the assertions describe the
   * write rather than the read that preceded it.
   */
  function builder() {
    let writing = false;
    const self: Record<string, unknown> = {
      select: () => self,
      update: (payload: Record<string, unknown>) => {
        writing = true;
        state.updatePayload = payload;
        return self;
      },
      delete: () => {
        writing = true;
        return self;
      },
      eq: (column: string, value: unknown) => {
        if (writing) state.updateFilters[column] = value;
        return self;
      },
      maybeSingle: async () => ({ data: state.record, error: null }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: state.updateReturns, error: null }).then(resolve),
    };
    return self;
  }
  return {
    userClient: async () => ({
      from: () => builder(),
      storage: {
        from: () => ({
          createSignedUrl: async () => state.signed,
          remove: async (paths: string[]) => {
            state.removedPaths.push(...paths);
            return { error: null };
          },
        }),
      },
    }),
    hasSupabaseEnv: () => true,
  };
});

async function resume() {
  const { supabaseIngestionStore } = await import('@/lib/ingestion/store/supabase-store');
  return supabaseIngestionStore.resumeImport('org-1', 'imp-1');
}

beforeEach(() => {
  vi.resetModules();
  state.record = {
    id: 'imp-1',
    status: 'failed',
    source_path: 'org-1/imp-1',
    accepted_rows: 1000,
    rows_persisted: 400,
  };
  state.signed = { data: { signedUrl: 'https://storage.example/fresh' }, error: null };
  state.updateFilters = {};
  state.updatePayload = null;
  state.updateReturns = [{ id: 'imp-1' }];
  state.removedPaths = [];
});

describe('resuming a stalled import', () => {
  it('renews access and returns it to the queue', async () => {
    expect(await resume()).toEqual({ status: 'requeued' });
    expect(state.updatePayload).toMatchObject({
      source_url: 'https://storage.example/fresh',
      status: 'queued',
      failure_reason: null,
    });
  });

  it('keeps the checkpoint, so it continues rather than restarting', async () => {
    // Resetting rows_persisted would re-send 400 rows that are already stored.
    // They would be discarded on conflict, but the work would be repeated and
    // the customer would watch the progress bar go backwards.
    await resume();
    expect(state.updatePayload).not.toHaveProperty('rows_persisted');
  });

  it('resets the attempt counter, because the cause was addressed', async () => {
    await resume();
    expect(state.updatePayload).toMatchObject({ attempt: 0 });
  });

  it('releases any claim the dead worker still nominally held', async () => {
    await resume();
    expect(state.updatePayload).toMatchObject({ worker_token: null, lease_expires_at: null });
  });

  it('scopes the write by organization, id and failed status', async () => {
    // The status filter is what stops a requeue racing an import that finished
    // between the read and the write.
    await resume();
    expect(state.updateFilters).toEqual({
      organization_id: 'org-1',
      id: 'imp-1',
      status: 'failed',
    });
  });
});

describe('when resuming would be wrong', () => {
  it('refuses a completed import', async () => {
    state.record = { ...state.record!, status: 'complete' };
    expect(await resume()).toEqual({
      status: 'not-resumable',
      reason: 'This import already finished. Every accepted row is stored.',
    });
    expect(state.updatePayload).toBeNull();
  });

  it('refuses one that is already queued or being written', async () => {
    for (const status of ['queued', 'importing']) {
      state.record = { ...state.record!, status };
      const outcome = await resume();
      expect(outcome.status).toBe('not-resumable');
    }
  });

  it('refuses one whose uploaded file was never kept', async () => {
    state.record = { ...state.record!, source_path: null };
    const outcome = await resume();
    expect(outcome).toMatchObject({ status: 'not-resumable' });
    if (outcome.status === 'not-resumable') expect(outcome.reason).toMatch(/Import the file again/);
  });

  it('reports a storage failure rather than requeueing without access', async () => {
    state.signed = { data: null, error: { message: 'object not found' } };
    const outcome = await resume();
    expect(outcome).toMatchObject({ status: 'not-resumable' });
    if (outcome.status === 'not-resumable') expect(outcome.reason).toMatch(/object not found/);
    expect(state.updatePayload).toBeNull();
  });

  it('reports an import that changed underneath the resume', async () => {
    state.updateReturns = [];
    expect(await resume()).toEqual({
      status: 'not-resumable',
      reason: 'This import changed while it was being resumed.',
    });
  });

  it('does not confirm whether an id it cannot see exists', async () => {
    // RLS makes another tenant's import invisible; reporting "not found" rather
    // than "forbidden" keeps this from answering questions about other tenants.
    state.record = null;
    expect(await resume()).toEqual({ status: 'not-found' });
  });
});

describe('deleting an import', () => {
  it('removes the uploaded file, not just the rows', async () => {
    // A customer who deletes their data expects it gone. Removing the import
    // row cascades the canonical rows, but the original export lives in
    // storage -- and leaving it there means the data is still held,
    // indefinitely and invisibly, after the customer removed it.
    const { supabaseIngestionStore } = await import('@/lib/ingestion/store/supabase-store');
    const removed = await supabaseIngestionStore.deleteImport('org-1', 'imp-1');

    expect(removed).toBe(true);
    expect(state.removedPaths).toEqual(['org-1/imp-1']);
  });

  it('does not touch storage when nothing was deleted', async () => {
    // A wrong id, or another tenant's id, must not reach into storage at all.
    state.updateReturns = [];
    const { supabaseIngestionStore } = await import('@/lib/ingestion/store/supabase-store');
    const removed = await supabaseIngestionStore.deleteImport('org-1', 'imp-1');

    expect(removed).toBe(false);
    expect(state.removedPaths).toEqual([]);
  });
});
