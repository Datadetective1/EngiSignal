import { describe, expect, it, vi, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));
import { assertLeastPrivilege, isScheduler } from '@/lib/ingestion/job/worker-db';
import type { WorkerSql } from '@/lib/ingestion/job/worker-db';

/**
 * ── THE WORKER MUST CHECK WHO IT IS ─────────────────────────────────────────
 *
 * A connection string is a claim, not a fact. It can be pointed at a different
 * role by an environment variable, and the role it names can be granted a
 * membership months later by someone solving an unrelated problem. Neither
 * shows up as a connection failure -- the worker would simply start running
 * with more authority than it was designed to have, and everything would keep
 * working, which is the worst possible symptom.
 *
 * So the connection asserts its own privileges before touching a customer's
 * data, and these tests prove the assertion actually refuses.
 */

/** Answers a single row, the way the identity query returns one. */
function connection(row: Record<string, unknown> | undefined): WorkerSql {
  return (() => Promise.resolve(row === undefined ? [] : [row])) as unknown as WorkerSql;
}

afterEach(() => vi.unstubAllEnvs());

describe('proving the connection is the narrow role', () => {
  it('accepts the worker role with no memberships and no RLS bypass', async () => {
    await expect(
      assertLeastPrivilege(
        connection({ current_user: 'ingestion_worker', bypassrls: false, memberships: 0 }),
      ),
    ).resolves.toBeUndefined();
  });

  it('refuses to run as postgres even though the connection succeeded', async () => {
    // The credential was pointed somewhere far more privileged. Connecting
    // proves nothing about authority.
    await expect(
      assertLeastPrivilege(
        connection({ current_user: 'postgres', bypassrls: false, memberships: 0 }),
      ),
    ).rejects.toThrow(/connected as "postgres", not ingestion_worker/);
  });

  it('refuses a role that can bypass Row Level Security', async () => {
    await expect(
      assertLeastPrivilege(
        connection({ current_user: 'ingestion_worker', bypassrls: true, memberships: 0 }),
      ),
    ).rejects.toThrow(/bypass Row Level Security/);
  });

  it('refuses a role that has been granted membership of another', async () => {
    // SET ROLE requires membership. A role with none cannot become anything;
    // one that gained a membership could, and this is the only place that
    // would notice.
    await expect(
      assertLeastPrivilege(
        connection({ current_user: 'ingestion_worker', bypassrls: false, memberships: 1 }),
      ),
    ).rejects.toThrow(/member of 1 other role/);
  });

  it('refuses a connection that answers nothing at all', async () => {
    await expect(assertLeastPrivilege(connection(undefined))).rejects.toThrow(/no identity/);
  });
});

describe('recognising the scheduler', () => {
  it('accepts the configured secret, with or without the Bearer prefix', () => {
    vi.stubEnv('CRON_SECRET', 'correct-horse-battery-staple');
    expect(isScheduler('Bearer correct-horse-battery-staple')).toBe(true);
    expect(isScheduler('correct-horse-battery-staple')).toBe(true);
  });

  it('rejects a wrong secret, a missing header, and an unconfigured deployment', () => {
    vi.stubEnv('CRON_SECRET', 'correct-horse-battery-staple');
    expect(isScheduler('Bearer wrong')).toBe(false);
    expect(isScheduler(null)).toBe(false);

    vi.stubEnv('CRON_SECRET', '');
    // Unconfigured must not mean "let everybody in".
    expect(isScheduler('Bearer anything')).toBe(false);
  });

  it('rejects a value that merely starts with the secret', () => {
    // The length check has to come first, or a prefix comparison would pass.
    vi.stubEnv('CRON_SECRET', 'abcdef');
    expect(isScheduler('abcdefghij')).toBe(false);
    expect(isScheduler('abc')).toBe(false);
  });
});
