import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ConfirmForm } from './confirm-form';

export const metadata: Metadata = { title: 'Confirm your email' };

/**
 * The page an email confirmation link opens.
 *
 * THIS RENDER MUST NOT VERIFY ANYTHING.
 *
 * It reads the token out of the query string and puts it straight into a form.
 * No Supabase call, no session, no workspace, no side effect of any kind — a
 * mail scanner, a link prefetcher or a curious proxy can GET this as often as
 * it likes and the token stays unspent.
 *
 * Verification happens only in the server action behind the button, which
 * cannot be triggered by a GET.
 */

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{
    token_hash?: string;
    type?: string;
    next?: string;
    code?: string;
  }>;
}

export default async function ConfirmPage({ searchParams }: Props) {
  const params = await searchParams;

  // A PKCE code rather than a token hash means the email template still emits
  // {{ .ConfirmationURL }}, so Supabase consumed the token at /verify and sent
  // the caller here with a code. Nothing on this page can use that. Hand it to
  // the callback, which can — this keeps same-device sign-up working until the
  // template is switched to {{ .TokenHash }}, rather than regressing it.
  if ((params.code ?? '').length > 0 && (params.token_hash ?? '').length === 0) {
    const forward = new URLSearchParams({ code: params.code as string });
    if (params.next !== undefined) forward.set('next', params.next);
    redirect(`/auth/callback?${forward.toString()}`);
  }

  const tokenHash = params.token_hash ?? '';
  const type = params.type ?? 'email';
  const next = params.next ?? '/app';

  const hasToken = tokenHash.length > 0;

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6 py-16">
      <div className="mb-8 flex items-center gap-2.5">
        <span className="text-[15px] font-semibold tracking-[-0.01em] text-fg">EngiSignal</span>
      </div>

      {hasToken ? (
        <>
          <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-fg">
            Confirm your email address
          </h1>
          <p className="mt-3 text-[13.5px] leading-relaxed text-fg-muted">
            One more step. Click the button below to finish setting up your workspace.
          </p>

          <ConfirmForm tokenHash={tokenHash} type={type} next={next} />

          <p className="mt-6 text-[12px] leading-relaxed text-fg-subtle">
            EngiSignal asks you to click rather than confirming automatically. Corporate mail
            filters open every link in a message to scan it, and a link that confirms on being
            opened would be spent before you ever saw it.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-fg">
            This link is missing its token
          </h1>
          <p className="mt-3 text-[13.5px] leading-relaxed text-fg-muted">
            Nothing here identifies which address to confirm. Some email clients shorten long
            links; opening the message in a browser and clicking the button usually works.
          </p>
          <Link
            href="/signin"
            className="mt-6 inline-flex h-9 items-center rounded-md bg-accent px-4 text-[13px] font-medium text-accent-fg hover:brightness-110"
          >
            Back to sign in
          </Link>
        </>
      )}
    </main>
  );
}
