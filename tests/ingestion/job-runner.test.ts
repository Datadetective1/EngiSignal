import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { runIngestionJob, type RunnerDeps } from '@/lib/ingestion/job/runner';

/**
 * ── EVERY WAY A WORKER CAN BE INTERRUPTED ───────────────────────────────────
 *
 * The runner's whole design assumes it will be stopped without warning, so the
 * interesting behaviour is almost entirely in what it does when something goes
 * wrong. None of that is reachable through the happy path, and none of it can
 * be verified by reading the code -- a claim like "a superseded worker cannot
 * advance the checkpoint" is either demonstrated or it is a hope.
 *
 * The database decides most of these, through one conditional UPDATE per call.
 * So the fake below answers the way those statements do -- -1 for a claim that
 * is gone, -2 for a checkpoint that moved -- and the tests assert what the
 * runner SENDS, not what it meant to.
 */

const ROWS = 1200;

function claimRow(over: Record<string, unknown> = {}) {
  return {
    import_id: 'imp-1',
    organization_id: 'org-1',
    dataset: 'usage',
    file_name: 'usage.csv',
    source_path: 'org-1/imp-1',
    source_url: 'https://storage.example/signed/org-1/imp-1',
    rows_persisted: 0,
    accepted_rows: ROWS,
    parse_options: { dayFirst: true },
    token: 'token-1',
    attempt: 1,
    ...over,
  };
}

/** Parsed rows carry a distinct source_row so slices are identifiable. */
function parsedUsage(count: number) {
  return {
    usage: Array.from({ length: count }, (_, index) => ({
      date: '2026-01-01',
      hour: 9,
      user: `u${index}`,
      feature: 'f',
      provenance: {
        organizationId: 'org-1',
        sourceSystem: 'generic',
        sourceFile: 'usage.csv',
        sourceSheet: null,
        sourceRow: index + 2,
      },
    })),
    entitlements: [],
    people: [],
    contracts: [],
  };
}

interface Harness {
  deps: RunnerDeps;
  calls: { name: string; params: Record<string, unknown> }[];
  named: (name: string) => Record<string, unknown>[];
}

function harness(
  answers: Record<string, unknown | ((params: Record<string, unknown>, index: number) => unknown)> = {},
  over: Partial<RunnerDeps> = {},
  rowCount = ROWS,
): Harness {
  const calls: { name: string; params: Record<string, unknown> }[] = [];
  // The checkpoint the fake database holds, so slices must arrive in order.
  let mark = 0;
  const seen = new Set<number>();

  const deps: RunnerDeps = {
    rpc: async (name, params) => {
      const index = calls.filter((c) => c.name === name).length;
      calls.push({ name, params });

      if (name in answers) {
        const answer = answers[name];
        const value = typeof answer === 'function' ? answer(params, index) : answer;
        if (value !== undefined) return { data: value, error: null };
      }

      if (name === 'claim_import_job') return { data: [claimRow()], error: null };
      if (name === 'persist_import_slice') {
        const from = Number(params.expected_from);
        if (from !== mark) return { data: -2, error: null };
        const sent = (params.rows as unknown[]).length;
        // Records which rows were written, so double-writes are detectable.
        for (let i = from; i < from + sent; i += 1) {
          if (seen.has(i)) throw new Error(`row ${i} written twice`);
          seen.add(i);
        }
        mark = from + sent;
        return { data: mark, error: null };
      }
      if (name === 'complete_import_job') return { data: 'complete', error: null };
      return { data: true, error: null };
    },
    download: async () => new ArrayBuffer(8),
    parse: async () => parsedUsage(rowCount) as never,
    sliceSize: 400,
    ...over,
  };

  return { deps, calls, named: (n) => calls.filter((c) => c.name === n).map((c) => c.params) };
}

describe('an ordinary run', () => {
  it('claims, writes every row in slices, and asks the database to finish it', async () => {
    const h = harness();
    const outcome = await runIngestionJob(h.deps);

    expect(outcome).toEqual({
      status: 'complete',
      importId: 'imp-1',
      rowsPersisted: ROWS,
      sliceCount: 3,
    });
    expect(h.named('persist_import_slice').map((p) => p.expected_from)).toEqual([0, 400, 800]);
    expect(h.named('complete_import_job')).toHaveLength(1);
  });

  it('does nothing when the queue is empty', async () => {
    const h = harness({ claim_import_job: [] });
    expect(await runIngestionJob(h.deps)).toEqual({ status: 'idle' });
    expect(h.named('persist_import_slice')).toHaveLength(0);
  });

  it('never decides for itself that the import is finished', async () => {
    // The database counts the rows. The worker only asks.
    const h = harness({ complete_import_job: 'integrity_failed' });
    const outcome = await runIngestionJob(h.deps);
    expect(outcome.status).toBe('integrity-failed');
  });
});

describe('resuming after an interruption', () => {
  it('starts from the checkpoint rather than from zero', async () => {
    // A previous worker died having written 800 rows.
    const h = harness({ claim_import_job: [claimRow({ rows_persisted: 800 })] });
    // Its fake checkpoint must agree, or the -2 guard fires.
    const outcome = await runIngestionJob({
      ...h.deps,
      rpc: async (name, params) => {
        if (name === 'claim_import_job') {
          return { data: [claimRow({ rows_persisted: 800 })], error: null };
        }
        if (name === 'persist_import_slice') {
          return { data: Number(params.expected_from) + (params.rows as unknown[]).length, error: null };
        }
        if (name === 'complete_import_job') return { data: 'complete', error: null };
        return { data: true, error: null };
      },
    });

    expect(outcome).toEqual({
      status: 'complete',
      importId: 'imp-1',
      rowsPersisted: ROWS,
      sliceCount: 1,
    });
  });

  it('yields cleanly when its time is nearly up, leaving the checkpoint durable', async () => {
    // A worker killed mid-slice costs an attempt; one that stops on its own
    // costs nothing, so it must stop first.
    let clock = 0;
    const h = harness({}, { now: () => (clock += 30_000), budgetMs: 40_000 });
    const outcome = await runIngestionJob(h.deps);

    expect(outcome.status).toBe('yielded');
    if (outcome.status === 'yielded') expect(outcome.rowsPersisted).toBeLessThan(ROWS);
    expect(h.named('complete_import_job')).toHaveLength(0);
  });
});

describe('two workers on one import', () => {
  it('stops without writing when the claim has been taken away', async () => {
    // -1 is what the database answers when the lease expired or the token no
    // longer matches. Continuing here would write a second copy of the rows.
    const h = harness({ persist_import_slice: -1 });
    const outcome = await runIngestionJob(h.deps);

    expect(outcome).toEqual({ status: 'superseded', importId: 'imp-1' });
    expect(h.named('complete_import_job')).toHaveLength(0);
    expect(h.named('fail_import_job')).toHaveLength(0);
  });

  it('stops when the checkpoint moved underneath it', async () => {
    // -2: another worker advanced the import, so this slice was computed
    // against a state that no longer exists and is at the wrong offset.
    const h = harness({ persist_import_slice: -2 });
    expect(await runIngestionJob(h.deps)).toEqual({ status: 'superseded', importId: 'imp-1' });
  });

  it('carries the token it claimed with on every write', async () => {
    const h = harness({ claim_import_job: [claimRow({ token: 'token-xyz' })] });
    await runIngestionJob(h.deps);

    for (const params of h.named('persist_import_slice')) {
      expect(params.token).toBe('token-xyz');
    }
    expect(h.named('complete_import_job')[0]!.token).toBe('token-xyz');
  });

  it('writes each row exactly once across the whole run', async () => {
    // The harness throws if a row index is written twice.
    const h = harness();
    await expect(runIngestionJob(h.deps)).resolves.toMatchObject({ status: 'complete' });
  });
});

describe('when the evidence no longer says what it said', () => {
  it('refuses an import whose file now parses to a different number of rows', async () => {
    // Same bytes must mean the same rows. A different count means something
    // between the upload and now is not deterministic, and storing a quantity
    // the customer never approved is worse than failing.
    const h = harness({}, {}, ROWS - 5);
    const outcome = await runIngestionJob(h.deps);

    expect(outcome.status).toBe('integrity-failed');
    expect(h.named('persist_import_slice')).toHaveLength(0);
    expect(h.named('fail_import_job')[0]!.reason).toMatch(/1195 rows, but 1200/);
  });

  it('records a failure when the stored file cannot be read at all', async () => {
    const h = harness({}, {
      download: async () => {
        throw new Error('object not found');
      },
    });
    const outcome = await runIngestionJob(h.deps);

    expect(outcome).toMatchObject({ status: 'failed', reason: 'object not found' });
    // Recorded against the job, so the customer sees a reason and the attempt
    // counter decides whether it is retried.
    expect(h.named('fail_import_job')[0]!.reason).toBe('object not found');
  });

  it('records a failure when the file is malformed', async () => {
    const h = harness({}, {
      parse: async () => {
        throw new Error('The file could not be read.');
      },
    });
    expect(await runIngestionJob(h.deps)).toMatchObject({ status: 'failed' });
  });

  it('reports a database error rather than continuing to the next slice', async () => {
    const h = harness({}, {
      rpc: async (name) => {
        if (name === 'claim_import_job') return { data: [claimRow()], error: null };
        if (name === 'persist_import_slice') return { data: null, error: { message: 'deadlock' } };
        return { data: true, error: null };
      },
    });
    expect(await runIngestionJob(h.deps)).toMatchObject({ status: 'failed', reason: 'deadlock' });
  });
});

describe('what the worker is allowed to ask for', () => {
  it('never names an organization in any call it makes', async () => {
    // Cross-tenant access is not a permission the worker is denied, it is a
    // request it has no way to phrase. This is the test that keeps it that way.
    const h = harness();
    await runIngestionJob(h.deps);

    for (const call of h.calls) {
      expect(Object.keys(call.params)).not.toContain('org');
      expect(Object.keys(call.params)).not.toContain('organization_id');
    }
  });

  it('re-parses with the options recorded when the file was accepted', async () => {
    // Guessing at the mapping would produce the same row COUNT with different
    // values, which reconciles perfectly and is wrong.
    let seenOptions: unknown;
    const h = harness(
      {},
      {
        parse: async (_bytes, job) => {
          seenOptions = job.parseOptions;
          return parsedUsage(ROWS) as never;
        },
      },
    );
    await runIngestionJob(h.deps);

    expect(seenOptions).toEqual({ dayFirst: true });
  });

  it('reads the file through the signed URL it was given, not a storage path', async () => {
    let fetched: string | null = null;
    const h = harness(
      {},
      {
        download: async (job) => {
          fetched = job.sourceUrl;
          return new ArrayBuffer(8);
        },
      },
    );
    await runIngestionJob(h.deps);

    expect(fetched).toBe('https://storage.example/signed/org-1/imp-1');
  });

  it('fails with a usable reason when the import has no readable file', async () => {
    const h = harness({ claim_import_job: [claimRow({ source_url: null })] }, {
      download: async (job) => {
        if (job.sourceUrl === null) throw new Error('This import has no readable copy of its uploaded file.');
        return new ArrayBuffer(8);
      },
    });
    const outcome = await runIngestionJob(h.deps);

    expect(outcome).toMatchObject({ status: 'failed' });
    expect(h.named('fail_import_job')[0]!.reason).toMatch(/no readable copy/);
  });
});
