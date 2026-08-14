import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/brand/logo';
import { brand } from '@/config/brand';
import { createSession, getSession, isSupabaseAuth } from '@/lib/auth';
import { DEMO_ORG } from '@/lib/synthetic/organization';

export const metadata: Metadata = { title: 'Sign in' };

async function signIn(formData: FormData) {
  'use server';

  const email = String(formData.get('email') ?? '').trim();
  if (email.length === 0 || !email.includes('@')) {
    redirect('/signin?error=email');
  }
  await createSession(email);
  redirect('/app');
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  if (session !== null) redirect('/app');

  const params = await searchParams;
  const supabaseAuth = isSupabaseAuth();

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
              Sign in to {brand.name}
            </h1>
            <p className="mt-3 max-w-md text-[14.5px] leading-relaxed text-fg-muted">
              {supabaseAuth
                ? 'Sign in with your work email to open your engineering software intelligence workspace.'
                : 'This deployment runs in evaluation mode against a synthetic demo organization. Enter any work email to open the workspace — no account is created and no password is stored.'}
            </p>

            <form action={signIn} className="mt-8 max-w-sm">
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
                aria-describedby={params.error === 'email' ? 'email-error' : undefined}
                className="mt-1.5 h-11 w-full rounded-md border border-border bg-surface px-3.5 text-[14px] text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none"
              />
              {params.error === 'email' && (
                <p id="email-error" className="mt-2 text-[12.5px] text-danger">
                  Enter a valid email address.
                </p>
              )}

              <button
                type="submit"
                className="mt-4 h-11 w-full rounded-md bg-accent text-[14px] font-medium text-accent-fg transition-[filter] hover:brightness-110"
              >
                Open workspace
              </button>
            </form>

            {!supabaseAuth && (
              <p className="mt-5 max-w-sm text-[12px] leading-relaxed text-fg-subtle">
                Evaluation mode is not an authentication system. Configure Supabase to enable real
                authentication, tenant isolation and row-level security — see{' '}
                <code className="rounded bg-surface-2 px-1 py-0.5 text-[11px]">.env.example</code>.
              </p>
            )}
          </div>

          <div className="rounded-xl border border-border bg-surface p-6">
            <p className="text-[11px] font-medium uppercase tracking-[0.13em] text-fg-subtle">
              Demo organization
            </p>
            <p className="mt-2 text-[17px] font-semibold tracking-[-0.02em]">{DEMO_ORG.name}</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">
              A fictional aerospace manufacturer, generated deterministically. Every employee, contract,
              price and usage record is invented.
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
        </main>
      </div>
    </div>
  );
}
