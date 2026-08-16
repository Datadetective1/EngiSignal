/**
 * The host this deployment treats as canonical.
 *
 * Apex folds into www. An auth cookie set on www is not sent to the apex, so a
 * confirmation link that lands on the apex cannot complete a session even when
 * the code itself is perfectly valid.
 *
 * Pure and free of `server-only` so the rule can be tested directly rather than
 * only through a request.
 */
export function canonicalHost(host: string): string {
  const bare = host.trim().toLowerCase().replace(/:\d+$/, '');
  if (bare === 'engisignal.com') return 'www.engisignal.com';
  return host.trim();
}
