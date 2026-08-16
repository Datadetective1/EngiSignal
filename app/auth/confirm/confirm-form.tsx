'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { confirmEmailAction, type ConfirmResult } from './actions';

/**
 * The explicit human action.
 *
 * A submission, never a navigation. The token travels in the form body, so no
 * amount of GET traffic against this page can spend it.
 *
 * On success the action redirects, so nothing here renders afterwards. Only a
 * failure returns, and it returns a reason rather than a shrug.
 */
export function ConfirmForm({
  tokenHash,
  type,
  next,
}: {
  tokenHash: string;
  type: string;
  next: string;
}) {
  const [failure, setFailure] = useState<ConfirmResult | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (formData: FormData) => {
    startTransition(async () => {
      const result = await confirmEmailAction(formData);
      // Only failures come back; success redirects out of this component.
      if (result !== undefined) setFailure(result);
    });
  };

  return (
    <div className="mt-7">
      <form action={submit}>
        <input type="hidden" name="token_hash" value={tokenHash} />
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="next" value={next} />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-10 items-center rounded-md bg-accent px-5 text-[13.5px] font-medium text-accent-fg transition-[filter] hover:brightness-110 disabled:opacity-60"
        >
          {pending ? 'Confirming…' : 'Confirm my email'}
        </button>
      </form>

      {failure !== null && (
        <div
          role="alert"
          className="mt-5 rounded-md border border-danger/50 bg-danger-soft px-4 py-3"
        >
          <p className="text-[12.5px] leading-relaxed text-fg">{failure.message}</p>
          <Link
            href={failure.reason === 'used' ? '/signin' : '/signin?mode=signup'}
            className="mt-2 inline-block text-[12.5px] font-medium text-accent underline underline-offset-2"
          >
            {failure.reason === 'used' ? 'Go to sign in' : 'Request a new link'}
          </Link>
        </div>
      )}
    </div>
  );
}
