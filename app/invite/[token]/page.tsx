import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/primitives';
import { getSession } from '@/lib/auth';
import { ROLE_LABELS, previewInvitation } from '@/lib/membership';
import { acceptInvitationAction, switchAccountAction } from './actions';

export const metadata: Metadata = { title: 'Workspace invitation' };
export const dynamic = 'force-dynamic';

/**
 * The page an invitation link lands on.
 *
 * It has to work for a stranger who has never heard of EngiSignal and is not
 * signed in, for someone who already has an account, and for someone signed in
 * as the wrong person — and it must not become an oracle for any of them. What
 * it shows about the invitation comes from `preview_invitation`, which answers
 * only to a caller already holding the token and reveals nothing the emailed
 * invitation did not already say.
 *
 * Every terminal state gets its own sentence. "Invalid", "revoked", "expired"
 * and "already accepted" need four different next actions, and collapsing them
 * into "something went wrong" leaves the person with nothing to do but email
 * support.
 */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
      <div className="rounded-xl border border-border bg-surface p-8">{children}</div>
      <p className="mt-6 text-center text-[12px] text-fg-muted">EngiSignal</p>
    </main>
  );
}

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;

  const [preview, session] = await Promise.all([previewInvitation(token), getSession()]);

  if (preview.status !== 'pending') {
    const explanation: Record<string, string> = {
      invalid:
        'This invitation link is not valid. It may have been mistyped, or a newer invitation may have replaced it — check for a more recent email.',
      revoked:
        'This invitation was revoked by the workspace. If you think that was a mistake, ask whoever invited you to send a new one.',
      expired:
        'This invitation has expired. Invitations last seven days. Ask whoever invited you to send a new one.',
      accepted:
        'This invitation has already been used. If that was you, just sign in — you are already a member.',
    };

    return (
      <Shell>
        <h1 className="text-[19px] font-semibold text-fg">Invitation unavailable</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-fg-muted">
          {explanation[preview.status] ?? explanation.invalid}
        </p>
        <div className="mt-6">
          <Link href="/signin">
            <Button variant="primary">Go to sign in</Button>
          </Link>
        </div>
      </Shell>
    );
  }

  const invitedEmail = preview.invitedEmail ?? '';
  const workspace = preview.organizationName ?? 'a workspace';
  const roleLabel = preview.role ? ROLE_LABELS[preview.role] : 'Member';

  // ── Not signed in ────────────────────────────────────────────────────────
  // Both routes carry the token so the accept step is reached automatically
  // after authenticating, including across the email-confirmation round trip.
  if (session === null) {
    const q = `invite=${encodeURIComponent(token)}`;
    return (
      <Shell>
        <h1 className="text-[19px] font-semibold text-fg">
          You have been invited to {workspace}
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed text-fg-muted">
          You will join as <strong className="text-fg">{roleLabel}</strong>. This invitation was
          sent to <strong className="text-fg">{invitedEmail}</strong>, so you will need to use that
          address.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href={`/signin?mode=signup&${q}`}>
            <Button variant="primary">Create an account</Button>
          </Link>
          <Link href={`/signin?${q}`}>
            <Button variant="secondary">I already have an account</Button>
          </Link>
        </div>
        <p className="mt-6 text-[12.5px] leading-relaxed text-fg-muted">
          EngiSignal reads your existing licence exports and shows what is actually used, what is
          over-provisioned, and what is worth renegotiating before renewal.
        </p>
      </Shell>
    );
  }

  // ── Signed in as the wrong person ────────────────────────────────────────
  const signedInAs = session.email.trim().toLowerCase();
  if (signedInAs !== invitedEmail.trim().toLowerCase()) {
    return (
      <Shell>
        <h1 className="text-[19px] font-semibold text-fg">This invitation is for another account</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-fg-muted">
          It was sent to <strong className="text-fg">{invitedEmail}</strong>, but you are signed in
          as <strong className="text-fg">{session.email}</strong>. Invitations are tied to the
          address they were sent to, so this one cannot be accepted by a different account.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <form action={switchAccountAction}>
            <input type="hidden" name="token" value={token} />
            <Button type="submit" variant="primary">
              Sign in as {invitedEmail}
            </Button>
          </form>
          <Link href="/app">
            <Button variant="secondary">Stay where I am</Button>
          </Link>
        </div>
      </Shell>
    );
  }

  // ── Ready to accept ──────────────────────────────────────────────────────
  return (
    <Shell>
      <h1 className="text-[19px] font-semibold text-fg">Join {workspace}</h1>
      <p className="mt-3 text-[14px] leading-relaxed text-fg-muted">
        You are signed in as <strong className="text-fg">{session.email}</strong> and will join as{' '}
        <strong className="text-fg">{roleLabel}</strong>. You will see the same data as everyone
        else in this workspace.
      </p>

      {error !== undefined && (
        <p
          role="status"
          className="mt-4 rounded-lg border border-red-600/30 bg-red-500/10 px-4 py-3 text-[13px] leading-relaxed text-red-200"
        >
          {error}
        </p>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <form action={acceptInvitationAction}>
          <input type="hidden" name="token" value={token} />
          <Button type="submit" variant="primary">
            Accept invitation
          </Button>
        </form>
        <Link href="/app">
          <Button variant="secondary">Not now</Button>
        </Link>
      </div>
    </Shell>
  );
}
