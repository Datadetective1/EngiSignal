import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Card, CardHeader, Kpi, SectionHeading, TableShell, Td, Th } from '@/components/ui/primitives';
import { UserIdentityReview } from '@/components/app/user-identity-review';
import { buildUserReviewQueue } from '@/lib/analytics/user-review';
import { rollUpByManager } from '@/lib/analytics/manager-rollup';
import { formatCurrency, formatNumber } from '@/lib/analytics/financial';
import { listConfirmations } from '@/lib/ingestion/confirmations';
import { resolveIngestionContext } from '@/lib/ingestion/session';
import { resolveUsers } from '@/lib/ingestion/identity';
import { getIngestionStore } from '@/lib/ingestion/store';
import { loadWorkspace } from '@/lib/workspace';

export const metadata: Metadata = { title: 'Identity review' };

export default async function UserIdentityPage() {
  const { dataset, portfolio, options } = await loadWorkspace();
  const auth = await resolveIngestionContext();
  if (!auth.ok) return null;

  const store = getIngestionStore();
  const [usage, people, confirmations] = await Promise.all([
    store.listUsage(auth.context.organizationId),
    store.listPeople(auth.context.organizationId),
    listConfirmations(auth.context.organizationId, 'user'),
  ]);

  // Resolved WITHOUT the confirmed aliases, so a username a customer has
  // already decided about still shows its decision rather than vanishing from
  // the queue with no trace of what was done.
  const identities = resolveUsers(usage, people);

  const decisions = new Map(
    confirmations.map((entry) => [entry.rawValue, entry.decision] as const),
  );

  const queue = buildUserReviewQueue({
    identities,
    employees: dataset.employees,
    decisions,
  });

  const managers = rollUpByManager({
    employees: dataset.employees,
    activities: dataset.activities,
    portfolio,
    reclaimThresholdDays: options.reclaimThresholdDays,
    asOf: dataset.asOf,
  });

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-1.5 text-[12px] text-fg-subtle">
        <Link href="/app/data" className="hover:text-fg">
          Data
        </Link>
        <span>/</span>
        <span>Identity review</span>
        <span className="flex-1" />
        <Link href="/app/data/unmatched-users" className="hover:text-fg">
          Full username inventory →
        </Link>
      </nav>

      <SectionHeading
        eyebrow="Data / People"
        title="Usernames EngiSignal will not assign on its own"
        description="Every unresolved username is usage that cannot be attributed to a department, a manager or a cost centre — so its share of spend sits in the unallocated total instead of somebody's column."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi
          label="Unresolved"
          value={formatNumber(queue.unresolvedCount)}
          tone={queue.unresolvedCount > 0 ? 'warning' : 'neutral'}
          detail="No people record matched"
        />
        <Kpi
          label="Ambiguous"
          value={formatNumber(queue.ambiguousCount)}
          tone={queue.ambiguousCount > 0 ? 'danger' : 'neutral'}
          detail="More than one person claims the identifier"
        />
        <Kpi
          label="Observations affected"
          value={formatNumber(queue.unattributedObservations)}
          detail="Usage rows that cannot be attributed"
        />
      </div>

      {queue.users.length === 0 ? (
        <Card>
          <CardHeader
            title="Every username resolved"
            description="No usage is waiting on an identity decision."
          />
          <p className="px-5 pb-5 text-[13px] leading-relaxed text-fg-muted">
            EngiSignal matches a username to a person on an exact username, employee code, email, or
            a mapping you have confirmed. Display names are never used — two people called J. Smith
            are two people.
          </p>
        </Card>
      ) : (
        <UserIdentityReview users={queue.users} />
      )}

      {/* ── Manager rollup ─────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <CardHeader
          title="By manager"
          description="Grouped by the manager identifier in your people file, never by name. Two managers who share a name stay two managers."
        />

        {managers.groups.length === 0 ? (
          <p className="px-5 pb-5 text-[13px] text-fg-muted">
            No manager information was supplied in the people import.
          </p>
        ) : (
          <>
            <div className="es-scroll overflow-x-auto">
              <TableShell>
                <thead>
                  <tr>
                    <Th>Manager</Th>
                    <Th align="right">Reports</Th>
                    <Th align="right">Observed using software</Th>
                    <Th align="right">Named-user seats</Th>
                    <Th align="right">Reclaim candidates</Th>
                    <Th align="right">Value</Th>
                    <Th>Basis</Th>
                  </tr>
                </thead>
                <tbody>
                  {managers.groups.map((group) => (
                    <tr key={group.managerKey ?? `name:${group.managerName}`}>
                      <Td className="font-medium text-fg">{group.managerName ?? 'Not named'}</Td>
                      <Td align="right" className="tnum">{formatNumber(group.reportCount)}</Td>
                      <Td align="right" className="tnum">{formatNumber(group.activeReports)}</Td>
                      <Td align="right" className="tnum">{formatNumber(group.assignedSeats)}</Td>
                      <Td align="right" className="tnum">
                        {group.reclaimCandidates > 0 ? (
                          <span className="font-medium text-warning">
                            {formatNumber(group.reclaimCandidates)}
                          </span>
                        ) : (
                          '0'
                        )}
                      </Td>
                      <Td align="right" className="tnum">
                        {/* Null means unpriced, which is not zero value. */}
                        {group.reclaimValue === null ? (
                          <span className="text-fg-subtle">
                            {group.reclaimCandidates > 0 ? 'Not priced' : '—'}
                          </span>
                        ) : (
                          formatCurrency(group.reclaimValue)
                        )}
                      </Td>
                      <Td>
                        {group.linked ? (
                          <Badge tone="positive">Linked by ID</Badge>
                        ) : (
                          <Badge tone="neutral">Name only</Badge>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            </div>

            {(managers.unlinkedPeople > 0 || managers.peopleWithoutManager > 0) && (
              <div className="border-t border-border px-5 py-3.5">
                <ul className="space-y-1.5">
                  {managers.unlinkedPeople > 0 && (
                    <li className="text-[12px] leading-relaxed text-fg-subtle">
                      <span className="font-medium text-fg-muted">
                        {formatNumber(managers.unlinkedPeople)} people name a manager with no
                        identifier.
                      </span>{' '}
                      Those rows are grouped by the name as a label only. Map a manager ID or email
                      column to turn them into a reporting line.
                    </li>
                  )}
                  {managers.peopleWithoutManager > 0 && (
                    <li className="text-[12px] leading-relaxed text-fg-subtle">
                      {formatNumber(managers.peopleWithoutManager)} people have no manager
                      information at all and are not counted in any group above.
                    </li>
                  )}
                </ul>
              </div>
            )}
          </>
        )}
      </Card>

      {confirmations.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader
            title="Decision history"
            description="Who decided what, and when. Every entry can be undone."
          />
          <div className="es-scroll overflow-x-auto">
            <TableShell>
              <thead>
                <tr>
                  <Th>Username</Th>
                  <Th>Decision</Th>
                  <Th>Treated as</Th>
                  <Th>Decided by</Th>
                  <Th>When</Th>
                </tr>
              </thead>
              <tbody>
                {confirmations.map((entry) => (
                  <tr key={entry.id}>
                    <Td className="font-medium text-fg">{entry.rawValue}</Td>
                    <Td>
                      <Badge
                        tone={
                          entry.decision === 'confirmed'
                            ? 'positive'
                            : entry.decision === 'rejected'
                              ? 'neutral'
                              : 'accent'
                        }
                      >
                        {entry.decision === 'confirmed'
                          ? 'Confirmed'
                          : entry.decision === 'rejected'
                            ? 'Rejected'
                            : 'Kept separate'}
                      </Badge>
                    </Td>
                    <Td className="text-fg-muted">
                      {entry.decision === 'confirmed' ? entry.canonicalKey : '—'}
                    </Td>
                    <Td className="text-fg-muted">{entry.decidedByEmail ?? 'Unknown'}</Td>
                    <Td className="tnum text-fg-subtle">{entry.decidedAt.slice(0, 10)}</Td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          </div>
        </Card>
      )}
    </div>
  );
}
