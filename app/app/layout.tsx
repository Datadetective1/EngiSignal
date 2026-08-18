import Link from 'next/link';
import { Sidebar } from '@/components/app/sidebar';
import { IntegrityBanner } from '@/components/app/data-integrity';
import { formatDate } from '@/lib/analytics/dates';
import { loadWorkspace } from '@/lib/workspace';

/**
 * ── HOW LONG A PAGE MAY TAKE WHILE AN IMPORT IS RUNNING ─────────────────────
 *
 * Every page in this segment verifies that stored rows equal accepted rows
 * before showing anything, and that verification counts the tenant's canonical
 * rows in the database rather than trusting a cached number. At rest the count
 * is about 75 ms, served by an index-only scan.
 *
 * While a large import is being written it is much slower: the visibility map
 * is not set for freshly inserted pages, so the same scan falls back to reading
 * the heap for nearly every row. Measured during a 466,000-row import, one page
 * read in 87 took 9,832 ms and was cut off by the platform's ten-second
 * default -- the customer saw a 500 while their own import was running.
 *
 * The count is not something to cache away: it is the evidence that the numbers
 * on screen describe the rows that actually exist, and a remembered count would
 * be exactly the assumption it exists to replace. So the page is given room to
 * finish instead.
 */
export const maxDuration = 60;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const workspace = await loadWorkspace();

  const upcomingRenewals = workspace.renewals.filter(
    (renewal) => renewal.daysRemaining >= 0 && renewal.daysRemaining <= 180,
  ).length;

  return (
    <div className="min-h-dvh lg:flex">
      <Sidebar
        organizationName={workspace.organization.name}
        asOf={formatDate(workspace.dataset.asOf)}
        signalCount={workspace.signals.length}
        renewalCount={upcomingRenewals}
        decisionCount={workspace.signals.filter((s) => s.urgencyDays !== null && s.urgencyDays <= 90).length}
        userName={workspace.session.displayName}
        userEmail={workspace.session.email}
      />

      <div className="min-w-0 flex-1">
        {workspace.organization.isDemo && (
          <div className="border-b border-border bg-surface-2 px-5 py-2 text-[11.5px] text-fg-muted">
            <span className="font-medium text-fg">Demo organization.</span>{' '}
            {workspace.organization.name} is entirely synthetic — invented employees, usage, contracts and
            prices, generated deterministically so every figure reproduces. Analysis date is fixed at{' '}
            {formatDate(workspace.dataset.asOf)}.{' '}
            <Link href="/app/settings" className="underline decoration-border underline-offset-2 hover:text-fg">
              How this data was made
            </Link>
          </div>
        )}

        <main className="mx-auto w-full max-w-[1360px] px-5 py-6 lg:px-8 lg:py-8">
          {/* Carried by every page in the app, not just the analytical ones:
              the condition means the whole workspace is reporting on an
              unknown fraction of the estate. */}
          {!workspace.integrity.complete && (
            <div className="mb-6">
              <IntegrityBanner integrity={workspace.integrity} />
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
