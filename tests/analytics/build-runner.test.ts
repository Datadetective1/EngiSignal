import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { runProjectionBuild, type BuildClient } from '@/lib/analytics/build-runner';
import { buildNeeded, BUILD_LEASE_SECONDS } from '@/lib/analytics/projection';
import type { ProjectionPayload } from '@/lib/analytics/projection';
import type { AnalyticsDataset } from '@/lib/domain/dataset';

/**
 * ── A BUILD THAT RUNS WHERE NOBODY IS WATCHING ──────────────────────────────
 *
 * Phase 2F moved the analysis off the request that commits an import. Three
 * things become possible that were impossible while it ran inline, and each of
 * them can corrupt what a customer sees:
 *
 *   two workers build the same tenant at once
 *   a worker finishes after a newer build has already published
 *   a worker dies halfway and leaves the tenant marked BUILDING forever
 *
 * The database decides all three — the claim is one conditional UPDATE and the
 * publish is another — so these tests drive the runner against a fake that
 * behaves the way those statements do, and assert what it sends rather than
 * what it intended.
 */

const counts = { usage: 100, people: 10, entitlements: 2, contracts: 2 };

const payload = (): ProjectionPayload => ({
  dataset: { analyzedRows: { ...counts } } as unknown as AnalyticsDataset,
  coverage: {} as ProjectionPayload['coverage'],
  userIdentities: [],
});

/** Records calls and answers the way the migration's functions do. */
function fakeClient(overrides: Partial<Record<string, unknown>> = {}) {
  const calls: { name: string; params: Record<string, unknown> }[] = [];
  const client: BuildClient = {
    rpc(name, params) {
      calls.push({ name, params });
      if (name in overrides) {
        return Promise.resolve(overrides[name] as { data: unknown; error: null });
      }
      if (name === 'claim_projection_build') return Promise.resolve({ data: 'token-1', error: null });
      if (name === 'publish_projection_build') return Promise.resolve({ data: 'ready', error: null });
      return Promise.resolve({ data: true, error: null });
    },
  };
  return { client, calls, named: (n: string) => calls.filter((c) => c.name === n) };
}

const deps = (client: BuildClient, over: Record<string, unknown> = {}) => ({
  client,
  organizationId: 'org-1',
  evidenceKey: 'v3|u100',
  build: async () => payload(),
  countStoredRows: async () => ({ ...counts }),
  // No real timers: a heartbeat that actually fired would make these flaky.
  setInterval: (() => 0) as unknown as typeof setInterval,
  clearInterval: (() => undefined) as unknown as typeof clearInterval,
  ...over,
});

describe('claiming before working', () => {
  it('claims, builds and publishes', async () => {
    const fake = fakeClient();
    const outcome = await runProjectionBuild(deps(fake.client));

    expect(outcome.status).toBe('ready');
    expect(fake.named('claim_projection_build')).toHaveLength(1);
    expect(fake.named('publish_projection_build')).toHaveLength(1);
  });

  it('does nothing at all when somebody else holds the claim', async () => {
    // Null is the ordinary answer when a live build already exists. It must not
    // be an error, and it must not build anyway.
    const fake = fakeClient({ claim_projection_build: { data: null, error: null } });
    const build = vi.fn(async () => payload());

    const outcome = await runProjectionBuild(deps(fake.client, { build }));

    expect(outcome).toEqual({ status: 'not-claimed' });
    expect(build).not.toHaveBeenCalled();
    expect(fake.named('publish_projection_build')).toHaveLength(0);
  });

  it('publishes under the token it claimed with', async () => {
    // The token is what stops a superseded worker overwriting a newer result.
    const fake = fakeClient({ claim_projection_build: { data: 'token-abc', error: null } });
    await runProjectionBuild(deps(fake.client));

    expect(fake.named('publish_projection_build')[0]!.params.token).toBe('token-abc');
  });

  it('names the evidence it built, so a moved estate cannot be published over', async () => {
    const fake = fakeClient();
    await runProjectionBuild(deps(fake.client));

    expect(fake.named('publish_projection_build')[0]!.params.built_evidence_key).toBe('v3|u100');
  });
});

describe('what a build sends for the integrity gate', () => {
  it('re-reads the stored counts after building, not before', async () => {
    // If the estate changed while the build ran, this is what notices. Reusing
    // the counts from the start of the build would prove only that they matched
    // themselves.
    const order: string[] = [];
    const fake = fakeClient();
    await runProjectionBuild(
      deps(fake.client, {
        build: async () => {
          order.push('build');
          return payload();
        },
        countStoredRows: async () => {
          order.push('count');
          return { ...counts };
        },
      }),
    );

    expect(order).toEqual(['build', 'count']);
  });

  it('sends both counts so the database can refuse to publish a mismatch', async () => {
    const fake = fakeClient();
    await runProjectionBuild(deps(fake.client));

    const params = fake.named('publish_projection_build')[0]!.params;
    expect(params.new_stored_rows).toEqual(counts);
    expect(params.new_analyzed_rows).toEqual(counts);
  });

  it('reports an integrity refusal rather than treating it as success', async () => {
    const fake = fakeClient({
      publish_projection_build: { data: 'integrity_failed', error: null },
    });
    expect(await runProjectionBuild(deps(fake.client))).toEqual({ status: 'integrity-failed' });
  });

  it('reports being superseded without writing anything', async () => {
    const fake = fakeClient({ publish_projection_build: { data: 'superseded', error: null } });
    const outcome = await runProjectionBuild(deps(fake.client));

    expect(outcome).toEqual({ status: 'superseded' });
    // Not a failure: a newer build already has the claim and the right answer.
    expect(fake.named('fail_projection_build')).toHaveLength(0);
  });
});

describe('when a build goes wrong', () => {
  it('records the failure against the tenant', async () => {
    // Without this the tenant sits at `building` until the lease expires, with
    // nothing anywhere saying what happened.
    const fake = fakeClient();
    const outcome = await runProjectionBuild(
      deps(fake.client, {
        build: async () => {
          throw new Error('out of memory');
        },
      }),
    );

    expect(outcome).toEqual({ status: 'failed', error: 'out of memory' });
    const failed = fake.named('fail_projection_build');
    expect(failed).toHaveLength(1);
    expect(failed[0]!.params.reason).toBe('out of memory');
    expect(failed[0]!.params.token).toBe('token-1');
  });

  it('stops the heartbeat whatever happens', async () => {
    // A heartbeat left running would keep a dead claim alive and block every
    // retry until the process died.
    const cleared: number[] = [];
    const fake = fakeClient();
    await runProjectionBuild(
      deps(fake.client, {
        build: async () => {
          throw new Error('boom');
        },
        setInterval: (() => 42) as unknown as typeof setInterval,
        clearInterval: ((id: number) => cleared.push(id)) as unknown as typeof clearInterval,
      }),
    );

    expect(cleared).toEqual([42]);
  });

  it('surfaces a refused claim as a failure rather than silence', async () => {
    const fake = fakeClient({
      claim_projection_build: { data: null, error: { message: 'not permitted' } },
    });
    expect(await runProjectionBuild(deps(fake.client))).toEqual({
      status: 'failed',
      error: 'not permitted',
    });
  });
});

describe('deciding whether a build is needed at all', () => {
  const base = {
    state: 'building' as const,
    buildingEvidenceKey: 'key-a',
    heartbeatAt: new Date().toISOString(),
  };

  it('needs one when nothing has ever been built', () => {
    expect(buildNeeded(null, 'key-a')).toBe(true);
  });

  it('does not start a second build alongside a live one', () => {
    expect(buildNeeded(base, 'key-a')).toBe(false);
  });

  it('starts one when the live build is for evidence that has since moved', () => {
    // The estate changed again mid-build. What is being built is already stale.
    expect(buildNeeded(base, 'key-b')).toBe(true);
  });

  it('takes over a claim whose worker has gone quiet', () => {
    const dead = {
      ...base,
      heartbeatAt: new Date(Date.now() - (BUILD_LEASE_SECONDS + 30) * 1000).toISOString(),
    };
    expect(buildNeeded(dead, 'key-a')).toBe(true);
  });

  it('takes over a claim that never beat at all', () => {
    expect(buildNeeded({ ...base, heartbeatAt: null }, 'key-a')).toBe(true);
  });

  it('rebuilds after a failure rather than leaving the tenant stuck', () => {
    expect(buildNeeded({ ...base, state: 'failed' }, 'key-a')).toBe(true);
  });

  it('rebuilds when the last build finished for different evidence', () => {
    expect(buildNeeded({ ...base, state: 'ready' }, 'key-a')).toBe(true);
  });
});
