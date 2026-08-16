import Link from 'next/link';
import { Sidebar } from '@/components/app/sidebar';
import { IntegrityBanner } from '@/components/app/data-integrity';
import { formatDate } from '@/lib/analytics/dates';
import { loadWorkspace } from '@/lib/workspace';

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
