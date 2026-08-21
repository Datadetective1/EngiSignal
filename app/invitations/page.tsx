import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/primitives';
import { getSession } from '@/lib/auth';
import { ROLE_LABELS, myPendingInvitations } from '@/lib/membership';
import { acceptPendingInvitationAction } from '@/app/invite/[token]/actions';

export const metadata: Metadata = { title: 'Your invitations' };
export const dynamic = 'force-dynamic';

/**
 * Where an invited person lands when they arrive without their link.
 *
 * This is the other half of the fix in `bootstrap_organization`. That function
 * refuses to mint a private workspace for someone who has a pending invitation,
 * which correctly stops them being stranded — but "you belong to no
 * organization" is not an answer anybody can act on. This page is the answer:
 * here is what you were invited to, press the button.
 *
 * It exists deliberately OUTSIDE the /app segment. Everything under /app
 * resolves a workspace first, and the whole point of this page is that there is
 * not one yet.
 */
export default async function InvitationsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const session = await getSession();
  if (session === null) redirect('/signin?next=/invitations');

  const invitations = await myPendingInvitations();

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
      <div className="rounded-xl border border-border bg-surface p-8">
        {invitations.length === 0 ? (
          <>
            <h1 className="text-[19px] font-semibold text-fg">No invitations waiting</h1>
            <p className="mt-3 text-[14px] leading-relaxed text-fg-muted">
              There are no pending invitations for{' '}
              <strong className="text-fg">{session.email}</strong>. If a colleague invited you,
              check that they used this exact address — invitations are tied to the address they
              were sent to.
            </p>
            <div className="mt-6">
              <Link href="/app">
                <Button variant="primary">Continue to EngiSignal</Button>
              </Link>
            </div>
          </>
        ) : (
          <>
            <h1 className="text-[19px] font-semibold text-fg">
              {invitations.length === 1 ? 'You have an invitation' : 'You have invitations'}
            </h1>
            <p className="mt-3 text-[14px] leading-relaxed text-fg-muted">
              Accepting joins the shared workspace and its data. You are signed in as{' '}
              <strong className="text-fg">{session.email}</strong>.
            </p>

            {error !== undefined && (
              <p
                role="status"
                className="mt-4 rounded-lg border border-red-600/30 bg-red-500/10 px-4 py-3 text-[13px] leading-relaxed text-red-200"
              >
                {error}
              </p>
            )}

            <ul className="mt-6 space-y-3">
              {invitations.map((invitation) => (
                <li
                  key={invitation.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3"
                >
                  <div>
                    <div className="text-[14px] font-medium text-fg">
                      {invitation.organizationName}
                    </div>
                    <div className="text-[12px] text-fg-muted">
                      {ROLE_LABELS[invitation.role]} · invited by {invitation.invitedByEmail}
                    </div>
                  </div>
                  <form action={acceptPendingInvitationAction}>
                    <input type="hidden" name="invitationId" value={invitation.id} />
                    <Button type="submit" variant="primary">
                      Accept
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <p className="mt-6 text-center text-[12px] text-fg-muted">EngiSignal</p>
    </main>
  );
}
