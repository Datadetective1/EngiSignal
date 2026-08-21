import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/brand/logo';
import { brand } from '@/config/brand';
import { getSession, isSupabaseAuth } from '@/lib/auth';
import { MINIMUM_PASSWORD_LENGTH } from '@/lib/auth/password';
import { DEMO_ORG } from '@/lib/synthetic/organization';
import { previewInvitation } from '@/lib/membership';
import {
  requestPasswordResetAction,
  resendConfirmationAction,
  signInAction,
  signUpAction,
} from './actions';

export const metadata: Metadata = { title: 'Sign in' };

const ERRORS: Record<string, string> = {
  email: 'Enter a valid email address.',
  password: 'Enter your password.',
  weak: `Choose a password of at least ${MINIMUM_PASSWORD_LENGTH} characters.`,
  // Distinct from `weak`, because the fix is different: a longer version of a
  // breached password is still breached.
  breached:
    'That password appears in a known data breach, so it cannot be used here. Choose one you have not used on another site.',
  invalid: 'That email and password do not match an account.',
  linkexpired: 'That link has expired or was already used. Request a new one.',
  authfailed:
    'That sign-in link could not be completed. Request a new one, or sign in with your password.',
  nocode:
    'That link was missing the code needed to sign you in. Open the most recent email and use the link there.',
  exists: 'An account already exists for that email. Sign in instead.',
  // Never reported as a problem with what the user typed.
  ratelimited: 'Too many attempts right now. Wait a minute and try again.',
  // Two different limits return the same status: a short per-address cooldown
  // measured in seconds, and an hourly cap across the whole project. They are
  // not distinguishable from the response, so this says what is certainly true
  // -- the account is safe and the last email that was sent is still valid --
  // and is honest that the wait could be either.
  emaillimited:
    'Too many confirmation emails have been requested recently. Your account is safe and any email already sent still works. Wait a few minutes and use the resend box below; if it keeps refusing, an hourly limit has been reached and will clear within the hour.',
  unconfirmed: 'Confirm your email address first, then sign in.',
  failed: 'Sign-in failed. Check the details and try again.',
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; mode?: string; notice?: string; invite?: string }>;
}) {
  const params = await searchParams;
  const invite = (params.invite ?? '').trim();

  const session = await getSession();
  // Already signed in with an invitation in hand: go straight to it rather than
  // to the app, which is where an accepted invitation ends up anyway.
  if (session !== null) redirect(invite.length > 0 ? `/invite/${encodeURIComponent(invite)}` : '/app');

  const supabaseAuth = isSupabaseAuth();
  const signup = params.mode === 'signup';
  const resetting = params.mode === 'reset';

  // ── AN INVITED PERSON IS NOT CREATING A WORKSPACE ─────────────────────────
  //
  // Production QA caught this: the invited-signup screen still said "Create
  // your EngiSignal workspace" and offered a panel headed "Your workspace —
  // starts empty, by design". Both are true for a founder and actively wrong
  // for a colleague joining an existing estate, and the second one describes
  // the opposite of what is about to happen: they are joining a workspace with
  // data already in it.
  //
  // The name comes from the same token-gated preview the accept page uses, so
  // nothing is disclosed here that the invitation email did not already say.
  const invitedTo =
    invite.length > 0 ? (await previewInvitation(invite)).organizationName : null;

  /**
   * Whether this visitor is stuck waiting on a confirmation email.
   *
   * Four ways to arrive there: they have just signed up, they asked for another
   * and it was sent, they tried to sign in before confirming, or the hourly
   * email limit refused them.
   */
  const stuckOnConfirmation =
    params.notice === 'confirm' ||
    params.notice === 'confirmsent' ||
    params.error === 'unconfirmed' ||
    params.error === 'emaillimited';

  return (
    <div className="theme-dark min-h-dvh bg-bg text-fg">
      <div className="mx-auto flex min-h-dvh max-w-[1100px] flex-col px-6">
        <header className="py-6">
          <Link href="/" className="inline-flex text-fg">
            <Logo size={25} />
          </Link>
        </header>

        <main className="grid flex-1 items-center gap-14 pb-16 lg:grid-cols-2">
          <div>
            <h1 className="text-[32px] font-semibold leading-[1.15] tracking-[-0.03em]">
              {invitedTo !== null
                ? `Join ${invitedTo}`
                : signup
                  ? `Create your ${brand.name} workspace`
                  : `Sign in to ${brand.name}`}
            </h1>
            <p className="mt-3 max-w-md text-[14.5px] leading-relaxed text-fg-muted">
              {invitedTo !== null
                ? signup
                  ? `Create an account to join the ${invitedTo} workspace. Use the address the invitation was sent to.`
                  : `Sign in to accept your invitation to ${invitedTo}. Use the address the invitation was sent to.`
                : supabaseAuth
                  ? signup
                    ? 'Create an account to import your engineering software exports. Your data is isolated to your own organization.'
                    : 'Sign in with your work email to open your engineering software intelligence workspace.'
                  : 'This deployment runs in evaluation mode against a synthetic demo organization. Enter any work email to open the workspace — no account is created and no password is stored.'}
            </p>

            {params.notice === 'resetsent' && (
              <p className="mt-5 max-w-sm rounded-md border border-accent/40 bg-accent-soft px-3.5 py-2.5 text-[12.5px] leading-relaxed text-accent">
                If that address has an account, a reset link is on its way. The link expires after a
                short time.
              </p>
            )}

            {params.notice === 'confirm' && (
              <p className="mt-5 max-w-sm rounded-md border border-accent/40 bg-accent-soft px-3.5 py-2.5 text-[12.5px] leading-relaxed text-accent">
                Check your email to confirm the address, then sign in. Your workspace is created on
                first sign-in.
              </p>
            )}

            {params.notice === 'confirmsent' && (
              <p className="mt-5 max-w-sm rounded-md border border-accent/40 bg-accent-soft px-3.5 py-2.5 text-[12.5px] leading-relaxed text-accent">
                If that address has an account awaiting confirmation, another email is on its way.
              </p>
            )}

            <form
              action={resetting ? requestPasswordResetAction : signup ? signUpAction : signInAction}
              className="mt-8 max-w-sm"
            >
              {/* Carries the invitation through authentication, including the
                  round trip through a confirmation email. */}
              {invite.length > 0 && <input type="hidden" name="invite" value={invite} />}
              <label htmlFor="email" className="block text-[12.5px] font-medium text-fg-muted">
                Work email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@company.com"
                className="mt-1.5 h-11 w-full rounded-md border border-border bg-surface px-3.5 text-[14px] text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none"
              />

              {supabaseAuth && !resetting && (
                <>
                  <label
                    htmlFor="password"
                    className="mt-4 block text-[12.5px] font-medium text-fg-muted"
                  >
                    Password
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    required
                    minLength={signup ? MINIMUM_PASSWORD_LENGTH : undefined}
                    autoComplete={signup ? 'new-password' : 'current-password'}
                    className="mt-1.5 h-11 w-full rounded-md border border-border bg-surface px-3.5 text-[14px] text-fg focus:border-accent focus:outline-none"
                  />

                  {/* Not shown when joining by invitation: the workspace already
                      exists and naming another one here would be answered by a
                      field that does nothing. */}
                  {signup && invite.length === 0 && (
                    <>
                      <label
                        htmlFor="organization"
                        className="mt-4 block text-[12.5px] font-medium text-fg-muted"
                      >
                        Organization <span className="text-fg-subtle">Optional</span>
                      </label>
                      <input
                        id="organization"
                        name="organization"
                        type="text"
                        autoComplete="organization"
                        placeholder="Acme Aerospace"
                        className="mt-1.5 h-11 w-full rounded-md border border-border bg-surface px-3.5 text-[14px] text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none"
                      />
                    </>
                  )}
                </>
              )}

              {params.error !== undefined && (
                <p role="alert" className="mt-3 text-[12.5px] text-danger">
                  {ERRORS[params.error] ?? ERRORS.failed}
                </p>
              )}

              <button
                type="submit"
                className="mt-4 h-11 w-full rounded-md bg-accent text-[14px] font-medium text-accent-fg transition-[filter] hover:brightness-110"
              >
                {!supabaseAuth
                  ? 'Open workspace'
                  : resetting
                    ? 'Send reset link'
                    : signup
                      ? 'Create workspace'
                      : 'Sign in'}
              </button>
            </form>

            {supabaseAuth && !signup && !resetting && (
              <p className="mt-2 max-w-sm text-[12.5px]">
                <Link href="/signin?mode=reset" className="text-fg-muted underline underline-offset-2 hover:text-fg">
                  Forgot your password?
                </Link>
              </p>
            )}

            {/*
              The way out of a lost confirmation.
              Shown exactly when someone is stuck on one: they have just signed
              up, they asked for another and it was sent, they tried to sign in
              before confirming, or the hourly email limit refused them. Without
              this, signing up again answers "an account already exists" and
              signing in answers "confirm your email first", which is a loop
              with no exit.
            */}
            {supabaseAuth && stuckOnConfirmation && (
                <form action={resendConfirmationAction} className="mt-3 max-w-sm">
                  <label htmlFor="resend-email" className="block text-[12.5px] font-medium text-fg-muted">
                    Did not get the email?
                  </label>
                  <div className="mt-1.5 flex gap-2">
                    <input
                      id="resend-email"
                      name="email"
                      type="email"
                      required
                      autoComplete="email"
                      placeholder="you@company.com"
                      className="h-10 min-w-0 flex-1 rounded-md border border-border bg-surface px-3 text-[13.5px] text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="h-10 whitespace-nowrap rounded-md border border-border px-3 text-[12.5px] font-medium text-fg hover:bg-surface"
                    >
                      Resend
                    </button>
                  </div>
                </form>
              )}

            {supabaseAuth && (
              <p className="mt-4 max-w-sm text-[12.5px] text-fg-muted">
                {resetting ? (
                  <>
                    Remembered it?{' '}
                    <Link href="/signin" className="text-accent underline underline-offset-2">
                      Sign in
                    </Link>
                  </>
                ) : signup ? (
                  <>
                    Already have an account?{' '}
                    <Link
                      href={invite.length > 0 ? `/signin?invite=${encodeURIComponent(invite)}` : '/signin'}
                      className="text-accent underline underline-offset-2"
                    >
                      Sign in
                    </Link>
                  </>
                ) : (
                  <>
                    {invite.length > 0 ? 'No account yet?' : 'No account yet?'}{' '}
                    <Link
                      href={
                        invite.length > 0
                          ? `/signin?mode=signup&invite=${encodeURIComponent(invite)}`
                          : '/signin?mode=signup'
                      }
                      className="text-accent underline underline-offset-2"
                    >
                      {/* An invited person is joining a workspace, not creating
                          one. Offering to "create a workspace" here is how they
                          end up in a tenant of their own by accident. */}
                      {invite.length > 0 ? 'Create an account' : 'Create a workspace'}
                    </Link>
                  </>
                )}
              </p>
            )}

            {!supabaseAuth && (
              <p className="mt-5 max-w-sm text-[12px] leading-relaxed text-fg-subtle">
                Evaluation mode is not an authentication system. Configure Supabase to enable real
                authentication, tenant isolation and row-level security — see{' '}
                <code className="rounded bg-surface-2 px-1 py-0.5 text-[11px]">.env.example</code>.
              </p>
            )}
          </div>

          {!supabaseAuth && (
            <div className="rounded-xl border border-border bg-surface p-6">
              <p className="text-[11px] font-medium uppercase tracking-[0.13em] text-fg-subtle">
                Demo organization
              </p>
              <p className="mt-2 text-[17px] font-semibold tracking-[-0.02em]">{DEMO_ORG.name}</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">
                A fictional aerospace manufacturer, generated deterministically. Every employee,
                contract, price and usage record is invented.
              </p>

              <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4">
                {[
                  ['Technical employees', DEMO_ORG.technicalHeadcount.toLocaleString('en-US')],
                  ['Annual software spend', '$18.4M'],
                  ['Software features', '42'],
                  ['Vendors', '9'],
                  ['Usage history', '24 months'],
                  ['Analysis date', '30 June 2026'],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-[11px] uppercase tracking-[0.08em] text-fg-subtle">{label}</dt>
                    <dd className="tnum mt-1 text-[15px] font-medium text-fg">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {supabaseAuth && (
            <div className="rounded-xl border border-border bg-surface p-6">
              <p className="text-[11px] font-medium uppercase tracking-[0.13em] text-fg-subtle">
                {invitedTo !== null ? 'Your invitation' : 'Your workspace'}
              </p>
              <p className="mt-2 text-[17px] font-semibold tracking-[-0.02em]">
                {invitedTo !== null ? `Joining ${invitedTo}` : 'Starts empty, by design'}
              </p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">
                {invitedTo !== null
                  ? 'You will see the same data as everyone else in this workspace. EngiSignal analyses the exports your team has imported — no figure is invented, and every number traces back to a row in a file somebody supplied.'
                  : 'EngiSignal analyses the exports you import. Nothing is pre-populated and no figure is invented — every number traces back to a row in a file you supplied.'}
              </p>

              <ul className="mt-6 space-y-2.5">
                {(invitedTo !== null
                  ? [
                      'Use the address your invitation was sent to',
                      'Confirm your email, then accept the invitation',
                      'You join the shared workspace — nothing separate is created',
                    ]
                  : [
                      'Import a FlexNet, RLM, DSLS or Sentinel export',
                      'Review every column mapping before it is committed',
                      'See exactly which analyses your data supports',
                    ]
                ).map((item) => (
                  <li key={item} className="flex gap-2.5 text-[13px] leading-relaxed text-fg-muted">
                    <span className="mt-[7px] size-1 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
