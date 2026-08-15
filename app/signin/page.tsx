import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/brand/logo';
import { brand } from '@/config/brand';
import { getSession, isSupabaseAuth } from '@/lib/auth';
import { DEMO_ORG } from '@/lib/synthetic/organization';
import { requestPasswordResetAction, signInAction, signUpAction } from './actions';

export const metadata: Metadata = { title: 'Sign in' };

const ERRORS: Record<string, string> = {
  email: 'Enter a valid email address.',
  password: 'Enter your password.',
  weak: 'Choose a password of at least 8 characters.',
  invalid: 'That email and password do not match an account.',
  linkexpired: 'That link has expired or was already used. Request a new one.',
  exists: 'An account already exists for that email. Sign in instead.',
  // Never reported as a problem with what the user typed.
  ratelimited: 'Too many attempts right now. Wait a minute and try again.',
  unconfirmed: 'Confirm your email address first, then sign in.',
  failed: 'Sign-in failed. Check the details and try again.',
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; mode?: string; notice?: string }>;
}) {
  const session = await getSession();
  if (session !== null) redirect('/app');

  const params = await searchParams;
  const supabaseAuth = isSupabaseAuth();
  const signup = params.mode === 'signup';
  const resetting = params.mode === 'reset';

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
              {signup ? `Create your ${brand.name} workspace` : `Sign in to ${brand.name}`}
            </h1>
            <p className="mt-3 max-w-md text-[14.5px] leading-relaxed text-fg-muted">
              {supabaseAuth
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

            <form
              action={resetting ? requestPasswordResetAction : signup ? signUpAction : signInAction}
              className="mt-8 max-w-sm"
            >
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
                    minLength={signup ? 8 : undefined}
                    autoComplete={signup ? 'new-password' : 'current-password'}
                    className="mt-1.5 h-11 w-full rounded-md border border-border bg-surface px-3.5 text-[14px] text-fg focus:border-accent focus:outline-none"
                  />

                  {signup && (
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
                    <Link href="/signin" className="text-accent underline underline-offset-2">
                      Sign in
                    </Link>
                  </>
                ) : (
                  <>
                    No account yet?{' '}
                    <Link href="/signin?mode=signup" className="text-accent underline underline-offset-2">
                      Create a workspace
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
                Your workspace
              </p>
              <p className="mt-2 text-[17px] font-semibold tracking-[-0.02em]">
                Starts empty, by design
              </p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">
                EngiSignal analyses the exports you import. Nothing is pre-populated and no figure is
                invented — every number traces back to a row in a file you supplied.
              </p>

              <ul className="mt-6 space-y-2.5">
                {[
                  'Import a FlexNet, RLM, DSLS or Sentinel export',
                  'Review every column mapping before it is committed',
                  'See exactly which analyses your data supports',
                ].map((item) => (
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
