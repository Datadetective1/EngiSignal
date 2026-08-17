import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * ── WHICH COMMIT IS ACTUALLY SERVING? ────────────────────────────────────────
 *
 * Phase 2C pushed commit 984453c to main and Vercel's GitHub integration never
 * created a build for it. The fix was on main, the branch was green, and
 * production went on serving the previous commit. It was noticed only because
 * somebody re-read a page and saw the old behaviour, and the next commit exists
 * for no reason other than to force a build.
 *
 * That is a bad way to find out. "Deployed" is a claim, and this endpoint is
 * the evidence for it: a closure report can assert the commit it verified
 * against rather than inferring it from how a page happened to behave.
 *
 * Deliberately unauthenticated. A build identifier is not a secret, and a check
 * that needs a session is a check nobody runs from a deploy script.
 *
 * The values come from Vercel's system environment variables, which are set at
 * BUILD time — so they describe the build that is answering, which is exactly
 * the question. Locally they are absent and the endpoint says so rather than
 * inventing a value.
 */
export function GET() {
  const value = (name: string): string | null => {
    const raw = process.env[name];
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    return trimmed.length === 0 ? null : trimmed;
  };

  const sha = value('VERCEL_GIT_COMMIT_SHA');

  return NextResponse.json(
    {
      commit: sha,
      commitShort: sha === null ? null : sha.slice(0, 7),
      branch: value('VERCEL_GIT_COMMIT_REF'),
      message: value('VERCEL_GIT_COMMIT_MESSAGE'),
      environment: value('VERCEL_ENV'),
      region: value('VERCEL_REGION'),
      // Absent locally, and absent is reported as absent.
      deployed: sha !== null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
