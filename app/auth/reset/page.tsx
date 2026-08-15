import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/brand/logo';
import { brand } from '@/config/brand';
import { getSession, isSupabaseAuth } from '@/lib/auth';
import { updatePasswordAction } from './actions';

export const metadata: Metadata = { title: 'Choose a new password' };

/**
 * Set a new password.
 *
 * Reached only from a recovery link, which the callback route has already
 * exchanged for a session. That session is what authorizes the change — there
 * is no separate token handled here, and no way to change another account's
 * password by editing a form field.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (!isSupabaseAuth()) redirect('/signin');

  const session = await getSession();
  // No session means the link was never opened, or it expired.
  if (session === null) redirect('/signin?error=linkexpired');

  const params = await searchParams;

  return (
    <div className="theme-dark min-h-dvh bg-bg text-fg">
      <div className="mx-auto flex min-h-dvh max-w-[620px] flex-col px-6">
        <header className="py-6">
          <Link href="/" className="inline-flex text-fg" aria-label={`${brand.name} home`}>
            <Logo size={25} />
          </Link>
        </header>

        <main className="flex-1 pb-16">
          <h1 className="text-[28px] font-semibold leading-[1.15] tracking-[-0.03em]">
            Choose a new password
          </h1>
          <p className="mt-3 max-w-md text-[14.5px] leading-relaxed text-fg-muted">
            Signed in as {session.email}. Setting a new password will keep you signed in on this
            device.
          </p>

          <form action={updatePasswordAction} className="mt-8 max-w-sm">
            <label htmlFor="password" className="block text-[12.5px] font-medium text-fg-muted">
              New password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="mt-1.5 h-11 w-full rounded-md border border-border bg-surface px-3.5 text-[14px] text-fg focus:border-accent focus:outline-none"
            />
            <p className="mt-1.5 text-[11.5px] text-fg-subtle">At least 8 characters.</p>

            {params.error !== undefined && (
              <p role="alert" className="mt-3 text-[12.5px] text-danger">
                {params.error === 'weak'
                  ? 'Choose a password of at least 8 characters.'
                  : 'The password could not be updated. Try the link again.'}
              </p>
            )}

            <button
              type="submit"
              className="mt-4 h-11 w-full rounded-md bg-accent text-[14px] font-medium text-accent-fg transition-[filter] hover:brightness-110"
            >
              Update password
            </button>
          </form>
        </main>
      </div>
    </div>
  );
}
