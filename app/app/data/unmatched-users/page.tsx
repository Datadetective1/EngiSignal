import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Badge,
  Card,
  CardHeader,
  Kpi,
  MethodologyNote,
  SectionHeading,
  TableShell,
  Td,
  Th,
} from '@/components/ui/primitives';
import { formatDate } from '@/lib/analytics/dates';
import { formatNumber } from '@/lib/analytics/financial';
import { normalizeHeader } from '@/lib/import/mapping';
import { loadWorkspace } from '@/lib/workspace';

export const metadata: Metadata = { title: 'Unmatched users' };

/**
 * Identity resolution queue.
 *
 * Usernames are never auto-assigned to an employee. A wrong match silently
 * attributes demand to the wrong department and program, which corrupts cost
 * allocation in a way that is very hard to detect later.
 */
export default async function UnmatchedUsersPage() {
  const { dataset } = await loadWorkspace();
  const open = dataset.unmatchedUsers.filter((user) => user.status === 'open');
  const totalOccurrences = open.reduce((acc, user) => acc + user.occurrences, 0);

  // Cheap suggestion: a normalized username that closely resembles an employee's.
  const employeesByNormalized = new Map(
    dataset.employees.map((employee) => [normalizeHeader(employee.username), employee]),
  );

  const rows = open.map((user) => {
    const normalized = normalizeHeader(user.rawUsername);
    const exact = employeesByNormalized.get(normalized);
    const stripped = normalized.replace(/_(old|tmp|temp|test|\d+)$/, '');
    const suggestion = exact ?? employeesByNormalized.get(stripped);
    const looksLikeService = /^(svc|service|batch|jenkins|hpc|lab|testrig|sim_farm|nx_|legacy|eng_intern)/.test(
      normalized,
    );

    return { user, suggestion, looksLikeService };
  });

  const serviceAccounts = rows.filter((row) => row.looksLikeService).length;
  const withSuggestion = rows.filter((row) => row.suggestion !== undefined).length;

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-1.5 text-[12px] text-fg-subtle">
        <Link href="/app/data" className="hover:text-fg">
          Data
        </Link>
        <span>/</span>
        <span>Unmatched users</span>
        <span className="flex-1" />
        <Link href="/app/data/users" className="hover:text-fg">
          Resolve these →
        </Link>
      </nav>

      <SectionHeading
        eyebrow="Identity resolution"
        title="Usernames with no employee record"
        description="Until these are resolved, their usage cannot be attributed to a department, program or manager — which limits cost allocation and reclaim accuracy. This page is the inventory; identity review is where you decide."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi label="Unmatched usernames" value={formatNumber(open.length)} tone="warning" />
        <Kpi label="Affected usage records" value={formatNumber(totalOccurrences)} detail="Cannot be attributed organizationally" />
        <Kpi
          label="Likely service accounts"
          value={formatNumber(serviceAccounts)}
          detail="Named like automation rather than people"
        />
      </div>

      <Card>
        <CardHeader
          title="Resolution queue"
          description={`${withSuggestion} of ${open.length} have a plausible match. EngiSignal proposes; it never assigns automatically.`}
        />
        <TableShell>
          <thead>
            <tr>
              <Th>Raw username</Th>
              <Th align="right">Occurrences</Th>
              <Th>First seen</Th>
              <Th>Last seen</Th>
              <Th>Assessment</Th>
              <Th>Suggested match</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ user, suggestion, looksLikeService }) => (
              <tr key={user.id} className="hover:bg-surface-2">
                <Td>
                  <code className="text-[12px] font-medium text-fg">{user.rawUsername}</code>
                </Td>
                <Td align="right">{formatNumber(user.occurrences)}</Td>
                <Td className="whitespace-nowrap text-fg-muted">{formatDate(user.firstSeen)}</Td>
                <Td className="whitespace-nowrap text-fg-muted">{formatDate(user.lastSeen)}</Td>
                <Td>
                  {looksLikeService ? (
                    <Badge tone="neutral">Likely service account</Badge>
                  ) : (
                    <Badge tone="warning">Likely a person</Badge>
                  )}
                </Td>
                <Td>
                  {suggestion === undefined ? (
                    <span className="text-[12px] text-fg-subtle">No confident match</span>
                  ) : (
                    <span className="text-[12px] text-fg">
                      {suggestion.fullName}
                      <span className="ml-1.5 text-fg-subtle">({suggestion.username})</span>
                    </span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </Card>

      <MethodologyNote>
        Resolution order is employee ID, then exact username, then normalized username, then email
        local-part. Anything that does not resolve lands here rather than being guessed. Service accounts
        are worth identifying separately: their usage is real demand but has no person or department behind
        it, so attributing it to someone would distort chargeback.
      </MethodologyNote>
    </div>
  );
}
