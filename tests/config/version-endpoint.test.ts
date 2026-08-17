import { afterEach, describe, expect, it } from 'vitest';
import { GET } from '@/app/api/version/route';

/**
 * "DEPLOYED" IS A CLAIM UNTIL SOMETHING ANSWERS WITH A COMMIT.
 *
 * Phase 2C pushed 984453c to main and Vercel's GitHub integration never built
 * it. Production kept serving the previous commit, main stayed green, and the
 * gap was found by re-reading a page and noticing the old behaviour.
 *
 * The endpoint under test exists so a closure report can name the commit it
 * verified against. These tests hold it to the same standard as everything else
 * here: absent evidence is reported as absent, never filled in.
 */

const KEYS = [
  'VERCEL_GIT_COMMIT_SHA',
  'VERCEL_GIT_COMMIT_REF',
  'VERCEL_GIT_COMMIT_MESSAGE',
  'VERCEL_ENV',
  'VERCEL_REGION',
];

const saved = new Map(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function body() {
  return (await GET().json()) as Record<string, unknown>;
}

describe('the deployment stamp', () => {
  it('reports the commit the running build was made from', async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = '35ad6e1f2c3b4a59687d0e1f2a3b4c5d6e7f8a9b';
    process.env.VERCEL_GIT_COMMIT_REF = 'main';
    process.env.VERCEL_ENV = 'production';

    const result = await body();
    expect(result.commit).toBe('35ad6e1f2c3b4a59687d0e1f2a3b4c5d6e7f8a9b');
    expect(result.commitShort).toBe('35ad6e1');
    expect(result.branch).toBe('main');
    expect(result.environment).toBe('production');
    expect(result.deployed).toBe(true);
  });

  it('says it does not know rather than inventing a commit', async () => {
    for (const key of KEYS) delete process.env[key];

    const result = await body();
    expect(result.commit).toBeNull();
    expect(result.commitShort).toBeNull();
    expect(result.deployed).toBe(false);
  });

  it('treats a blank platform variable as absent', async () => {
    // The same shape that broke the site URL and the upload limit before: a
    // variable that exists and is empty passes a null check and then reports a
    // deployment of "".
    process.env.VERCEL_GIT_COMMIT_SHA = '   ';
    process.env.VERCEL_ENV = '';

    const result = await body();
    expect(result.commit).toBeNull();
    expect(result.environment).toBeNull();
    expect(result.deployed).toBe(false);
  });

  it('does not publish the commit message', async () => {
    // "A build identifier is not a secret" is a statement about a SHA. It is
    // not a statement about whatever somebody wrote in a commit body, on an
    // endpoint that anybody can read.
    process.env.VERCEL_GIT_COMMIT_SHA = 'abc1234';
    process.env.VERCEL_GIT_COMMIT_MESSAGE = 'Fix the thing before the customer sees it';

    const result = await body();
    expect(Object.keys(result)).not.toContain('message');
    expect(JSON.stringify(result)).not.toContain('customer');
  });

  it('is never cached, or it would report the build it was first asked on', async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = 'abc1234';
    expect(GET().headers.get('Cache-Control')).toBe('no-store');
  });
});
