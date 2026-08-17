import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Badge,
  Card,
  Kpi,
  MethodologyNote,
  SectionHeading,
  TableShell,
  Td,
  Th,
} from '@/components/ui/primitives';
import { formatDate } from '@/lib/analytics/dates';
import { formatCurrencyExact, formatNumber } from '@/lib/analytics/financial';
import { daysInactive } from '@/lib/analytics/named-user';
import { employeeIndex, loadWorkspace } from '@/lib/workspace';
import { AnalyticsWithheld } from '@/components/app/data-integrity';
import { analyticsAvailable } from '@/lib/analytics/integrity';
import { encodeRouteId, featureHref } from '@/lib/routes';

export const metadata: Metadata = { title: 'Users' };

const ROW_LIMIT = 250;

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ feature?: string; q?: string; inactive?: string }>;
}) {
  const { integrity, dataset, portfolio, options } = await loadWorkspace();
  // Every figure below is computed from usage. When the analysis did not
  // read all of it, there is no honest version of this page.
  if (!analyticsAvailable(integrity)) return <AnalyticsWithheld integrity={integrity} />;

  const params = await searchParams;
  const employees = employeeIndex(dataset);

  const featureById = new Map(portfolio.map((row) => [row.featureId, row]));
  const needle = (params.q ?? '').trim().toLowerCase();
  const inactiveOnly = params.inactive === '1';

  const rows = dataset.activities
    .filter((activity) => {
      if (params.feature !== undefined && activity.featureId !== params.feature) return false;
      const idle = daysInactive(activity.lastUsedDate, dataset.asOf);
      if (inactiveOnly && (idle === null ? false : idle < options.reclaimThresholdDays)) {
        if (activity.lastUsedDate !== null) return false;
      }
      if (needle.length > 0) {
        const employee = employees.get(activity.employeeId);
        const feature = featureById.get(activity.featureId);
        const haystack =
          `${employee?.fullName ?? ''} ${employee?.username ?? ''} ${employee?.department ?? ''} ${employee?.program ?? ''} ${feature?.productName ?? ''}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    })
    .sort((a, b) => b.totalHours - a.totalHours);

  const visible = rows.slice(0, ROW_LIMIT);
  const distinctUsers = new Set(rows.map((r) => r.employeeId)).size;
  const assignedRows = rows.filter((r) => r.assigned);
  const idleAssigned = assignedRows.filter((r) => {
    const idle = daysInactive(r.lastUsedDate, dataset.asOf);
    return r.lastUsedDate === null || (idle !== null && idle >= options.reclaimThresholdDays);
  });

  const selectedFeature = params.feature === undefined ? undefined : featureById.get(params.feature);

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Users"
        title="Who is using engineering software"
        description="User-level detail behind every demand figure. Filter to a product, then drill into the people generating the load."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Distinct users" value={formatNumber(distinctUsers)} detail="Matching the current filter" />
        <Kpi label="Activity records" value={formatNumber(rows.length)} detail="User × product combinations" />
        <Kpi label="Assigned seats" value={formatNumber(assignedRows.length)} detail="Named-user licenses held" />
        <Kpi
          label="Idle assigned seats"
          value={formatNumber(idleAssigned.length)}
          tone={idleAssigned.length > 0 ? 'warning' : 'neutral'}
          detail={`No activity for ${options.reclaimThresholdDays}+ days`}
        />
      </div>

      <Card>
        <form className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3" method="get">
          <input
            type="search"
            name="q"
            defaultValue={params.q ?? ''}
            placeholder="Search person, department, program or product"
            aria-label="Search users"
            className="h-8 w-full min-w-0 rounded-md border border-border bg-surface px-3 text-[12.5px] text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none sm:w-72"
          />
          <select
            name="feature"
            defaultValue={params.feature ?? ''}
            aria-label="Product"
            className="h-8 rounded-md border border-border bg-surface px-2 text-[12.5px] text-fg focus:border-accent focus:outline-none"
          >
            <option value="">All products</option>
            {portfolio.map((row) => (
              <option key={row.featureId} value={row.featureId}>
                {row.productName} — {row.featureName}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-[12.5px] text-fg-muted">
            <input type="checkbox" name="inactive" value="1" defaultChecked={inactiveOnly} className="accent-[var(--es-accent)]" />
            Idle seats only
          </label>
          <button
            type="submit"
            className="h-8 rounded-md bg-accent px-3 text-[12.5px] font-medium text-accent-fg hover:brightness-110"
          >
            Apply
          </button>
          <a
            href={`/api/export/users${params.feature === undefined ? '' : `?feature=${encodeRouteId(params.feature)}`}`}
            className="ml-auto inline-flex h-8 items-center rounded-md border border-border px-2.5 text-[12px] font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            Export CSV
          </a>
        </form>

        {selectedFeature !== undefined && (
          <div className="border-b border-border bg-surface-2 px-4 py-2.5 text-[12px] text-fg-muted">
            Showing <span className="font-medium text-fg">{selectedFeature.productName}</span> ·{' '}
            {selectedFeature.featureName} ·{' '}
            <Link href={featureHref(selectedFeature.featureId)} className="text-accent hover:underline">
              open feature detail
            </Link>
          </div>
        )}

        <TableShell>
          <thead>
            <tr>
              <Th>User</Th>
              <Th>Manager</Th>
              <Th>Department</Th>
              <Th>Program</Th>
              <Th>Discipline</Th>
              <Th>Product</Th>
              <Th>Last used</Th>
              <Th align="right">Sessions</Th>
              <Th align="right">Hours</Th>
              <Th align="right">Days idle</Th>
              <Th align="right">Annual value</Th>
              <Th>Recommendation</Th>
            </tr>
          </thead>
          <tbody>
            {visible.map((activity, index) => {
              const employee = employees.get(activity.employeeId);
              const feature = featureById.get(activity.featureId);
              const idle = daysInactive(activity.lastUsedDate, dataset.asOf);
              const isIdleSeat =
                activity.assigned &&
                (activity.lastUsedDate === null || (idle !== null && idle >= options.reclaimThresholdDays));

              return (
                <tr key={`${activity.featureId}-${activity.employeeId}-${index}`} className="hover:bg-surface-2">
                  <Td>
                    <span className="block truncate font-medium">{employee?.fullName ?? activity.employeeId}</span>
                    <span className="block truncate text-[11px] text-fg-subtle">
                      {employee?.username}
                      {employee?.employeeType === 'contractor' && (
                        <span className="ml-1.5 text-warning">contractor</span>
                      )}
                    </span>
                  </Td>
                  <Td className="text-fg-muted">{employee?.managerName ?? '—'}</Td>
                  <Td className="text-fg-muted">{employee?.department ?? '—'}</Td>
                  <Td className="text-fg-muted">{employee?.program ?? '—'}</Td>
                  <Td className="text-fg-muted">{employee?.discipline ?? '—'}</Td>
                  <Td>
                    <Link
                      href={featureHref(activity.featureId)}
                      className="block truncate hover:text-accent"
                    >
                      {feature?.productName ?? activity.featureId}
                    </Link>
                  </Td>
                  <Td className="whitespace-nowrap text-fg-muted">
                    {activity.lastUsedDate === null ? (
                      <span className="text-danger">Never</span>
                    ) : (
                      formatDate(activity.lastUsedDate)
                    )}
                  </Td>
                  <Td align="right">{formatNumber(activity.totalSessions)}</Td>
                  <Td align="right">{formatNumber(activity.totalHours)}</Td>
                  <Td align="right" className={isIdleSeat ? 'font-medium text-warning' : 'text-fg-muted'}>
                    {idle === null ? '—' : formatNumber(idle)}
                  </Td>
                  <Td align="right">
                    {activity.assigned ? formatCurrencyExact(feature?.unitPrice ?? null) : '—'}
                  </Td>
                  <Td>
                    {isIdleSeat ? (
                      <Badge tone="warning">Reclaim candidate</Badge>
                    ) : activity.assigned ? (
                      <Badge tone="positive">Keep</Badge>
                    ) : (
                      <Badge>Concurrent use</Badge>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </TableShell>

        {rows.length > ROW_LIMIT && (
          <p className="border-t border-border px-4 py-3 text-[12px] text-fg-muted">
            Showing the {ROW_LIMIT} highest-usage records of {formatNumber(rows.length)}. Narrow the filter
            or export to CSV for the complete set.
          </p>
        )}

        {rows.length === 0 && (
          <p className="px-4 py-10 text-center text-[13px] text-fg-muted">No activity matches these filters.</p>
        )}
      </Card>

      <MethodologyNote>
        Annual value is shown only for assigned named-user seats, where a single person holds a license that
        can be reclaimed. Concurrent usage is shared and cannot be attributed to one person as a recoverable
        cost, so it is deliberately left blank rather than estimated.
      </MethodologyNote>
    </div>
  );
}
