import type { Metadata } from 'next';
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
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
import { formatCurrency, formatCurrencyExact, formatNumber } from '@/lib/analytics/financial';
import { buildReclaimCandidates, reclaimValue } from '@/lib/analytics/named-user';
import { getDataProvider } from '@/lib/data';
import type { ReclaimStatus } from '@/lib/domain/types';
import { employeeIndex, loadWorkspace } from '@/lib/workspace';
import { AnalyticsWithheld } from '@/components/app/data-integrity';
import { analyticsAvailable } from '@/lib/analytics/integrity';
import { encodeRouteId, featureHref } from '@/lib/routes';

export const metadata: Metadata = { title: 'Reclaim campaigns' };

const STATUS_LABELS: Record<ReclaimStatus, string> = {
  pending_review: 'Pending review',
  manager_review: 'Manager review',
  keep: 'Keep',
  reclaim: 'Reclaim',
  reassign: 'Reassign',
  complete: 'Complete',
};

const STATUS_TONE: Record<ReclaimStatus, 'neutral' | 'accent' | 'positive' | 'warning' | 'danger'> = {
  pending_review: 'neutral',
  manager_review: 'accent',
  keep: 'positive',
  reclaim: 'warning',
  reassign: 'accent',
  complete: 'positive',
};

async function updateStatus(formData: FormData) {
  'use server';

  const candidateId = String(formData.get('candidateId') ?? '');
  const status = String(formData.get('status') ?? 'pending_review') as ReclaimStatus;
  const owner = String(formData.get('owner') ?? '') || null;
  const organizationId = String(formData.get('organizationId') ?? '');
  if (candidateId.length === 0 || organizationId.length === 0) return;

  await getDataProvider().setReclaimOverride(organizationId, candidateId, {
    status,
    owner,
    notes: null,
    updatedAt: new Date().toISOString(),
  });

  revalidatePath('/app/reclaim');
}

export default async function ReclaimPage({
  searchParams,
}: {
  searchParams: Promise<{ feature?: string; status?: string }>;
}) {
  const workspace = await loadWorkspace();
  // Every figure below is computed from usage. When the analysis did not
  // read all of it, there is no honest version of this page.
  if (!analyticsAvailable(workspace.integrity)) return <AnalyticsWithheld integrity={workspace.integrity} />;

  const params = await searchParams;
  const { dataset, portfolio, organization, options } = workspace;

  const employees = employeeIndex(dataset);
  const employeeContext = new Map(
    [...employees.entries()].map(([id, employee]) => [
      id,
      {
        fullName: employee.fullName,
        managerName: employee.managerName,
        department: employee.department,
        program: employee.program,
      },
    ]),
  );

  const overrides = await getDataProvider().getReclaimOverrides(organization.id);

  const candidates = portfolio
    .filter((row) => row.namedUser !== null && row.namedUser.reclaimCandidates > 0)
    .filter((row) => params.feature === undefined || row.featureId === params.feature)
    .flatMap((row) =>
      buildReclaimCandidates(dataset.activities, {
        organizationId: organization.id,
        featureId: row.featureId,
        featureName: row.featureName,
        productName: row.productName,
        vendorName: row.vendorName,
        unitPrice: row.unitPrice,
        asOf: dataset.asOf,
        reclaimThresholdDays: options.reclaimThresholdDays,
        employees: employeeContext,
      }),
    )
    .map((candidate) => {
      const override = overrides.get(candidate.id);
      return override === undefined
        ? candidate
        : { ...candidate, status: override.status, owner: override.owner ?? candidate.owner };
    })
    .filter((candidate) => params.status === undefined || candidate.status === params.status);

  const totalValue = reclaimValue(candidates);
  const decided = candidates.filter((c) => c.status !== 'pending_review').length;
  const toReclaim = candidates.filter((c) => c.status === 'reclaim' || c.status === 'complete');
  const namedFeatures = portfolio.filter((row) => (row.namedUser?.reclaimCandidates ?? 0) > 0);

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Reclaim campaigns"
        title="Turn idle seats into a decision someone owns"
        description={`Named-user licenses with no recorded activity for ${options.reclaimThresholdDays}+ days. Each row routes to the holder's manager rather than being reclaimed automatically.`}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Candidates" value={formatNumber(candidates.length)} detail="Across named-user products" />
        <Kpi label="Annual value" value={formatCurrency(totalValue)} tone="positive" detail="If every candidate is reclaimed" />
        <Kpi
          label="Reviewed"
          value={`${formatNumber(decided)} / ${formatNumber(candidates.length)}`}
          detail="Candidates with a decision recorded"
        />
        <Kpi
          label="Marked for reclaim"
          value={formatCurrency(reclaimValue(toReclaim))}
          tone="accent"
          detail={`${toReclaim.length} seats`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilterLink href="/app/reclaim" active={params.feature === undefined && params.status === undefined}>
          All products
        </FilterLink>
        {namedFeatures.map((row) => (
          <FilterLink
            key={row.featureId}
            href={`/app/reclaim?feature=${encodeRouteId(row.featureId)}`}
            active={params.feature === row.featureId}
          >
            {row.productName}{' '}
            <span className="tnum opacity-60">{row.namedUser?.reclaimCandidates}</span>
          </FilterLink>
        ))}
      </div>

      <Card>
        <TableShell>
          <thead>
            <tr>
              <Th>Employee</Th>
              <Th>Manager</Th>
              <Th>Department</Th>
              <Th>Program</Th>
              <Th>Product</Th>
              <Th>Last used</Th>
              <Th align="right">Days idle</Th>
              <Th align="right">Annual cost</Th>
              <Th>Recommendation</Th>
              <Th>Decision</Th>
            </tr>
          </thead>
          <tbody>
            {candidates.slice(0, 200).map((candidate) => (
              <tr key={candidate.id} className="hover:bg-surface-2">
                <Td>
                  <span className="block truncate font-medium">{candidate.employeeName}</span>
                </Td>
                <Td className="text-fg-muted">{candidate.managerName ?? '—'}</Td>
                <Td className="text-fg-muted">{candidate.department ?? '—'}</Td>
                <Td className="text-fg-muted">{candidate.program ?? '—'}</Td>
                <Td>
                  <Link href={featureHref(candidate.featureId)} className="hover:text-accent">
                    {candidate.productName}
                  </Link>
                </Td>
                <Td className="whitespace-nowrap text-fg-muted">
                  {candidate.lastUsedDate === null ? (
                    <span className="text-danger">Never</span>
                  ) : (
                    formatDate(candidate.lastUsedDate)
                  )}
                </Td>
                <Td align="right" className="font-medium text-warning">
                  {candidate.daysInactive === null ? '—' : formatNumber(candidate.daysInactive)}
                </Td>
                <Td align="right">{formatCurrencyExact(candidate.annualCost)}</Td>
                <Td className="max-w-[230px] text-[11.5px] text-fg-muted">{candidate.recommendation}</Td>
                <Td>
                  <form action={updateStatus} className="flex items-center gap-1.5">
                    <input type="hidden" name="candidateId" value={candidate.id} />
                    <input type="hidden" name="organizationId" value={organization.id} />
                    <input type="hidden" name="owner" value={candidate.owner ?? ''} />
                    <select
                      name="status"
                      defaultValue={candidate.status}
                      aria-label={`Decision for ${candidate.employeeName}`}
                      className="h-7 rounded-md border border-border bg-surface px-1.5 text-[11.5px] text-fg focus:border-accent focus:outline-none"
                    >
                      {Object.entries(STATUS_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      className="h-7 rounded-md border border-border px-2 text-[11.5px] font-medium text-fg-muted hover:bg-surface-2 hover:text-fg"
                    >
                      Save
                    </button>
                    {candidate.status !== 'pending_review' && (
                      <Badge tone={STATUS_TONE[candidate.status]}>{STATUS_LABELS[candidate.status]}</Badge>
                    )}
                  </form>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableShell>

        {candidates.length === 0 && (
          <p className="px-4 py-10 text-center text-[13px] text-fg-muted">
            No reclaim candidates match this filter.
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
          <p className="text-[12px] text-fg-muted">
            {candidates.length > 200
              ? `Showing 200 of ${formatNumber(candidates.length)} candidates.`
              : `${formatNumber(candidates.length)} candidates.`}
          </p>
          <a
            href={`/api/export/reclaim${params.feature === undefined ? '' : `?feature=${encodeRouteId(params.feature)}`}`}
            className="inline-flex h-8 items-center rounded-md border border-border px-2.5 text-[12px] font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            Export campaign CSV
          </a>
        </div>
      </Card>

      <MethodologyNote>
        A seat becomes a candidate after {options.reclaimThresholdDays} days without recorded activity, or
        immediately if it has never been used since assignment. Nothing is reclaimed automatically —
        EngiSignal produces the queue and the evidence; the decision stays with the manager who owns the
        person&rsquo;s work.
        {' '}
        {/* Days idle counts to the end of the evidence, not to today. Anything
            after the export ended is unobserved, and counting it would report
            idleness nobody measured. Stated here because the difference is
            invisible in the number itself. */}
        <strong className="font-medium text-fg">Days idle is counted to {formatDate(dataset.asOf)}</strong>
        , the last date your imported usage covers — not to today. Time after the export ends is
        unobserved, so it is not counted as idle.
        {workspace.usingMockData && ' Decisions recorded here persist for this session only.'}
      </MethodologyNote>
    </div>
  );
}

function FilterLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[12.5px] font-medium transition-colors ${
        active ? 'border-accent bg-accent-soft text-accent' : 'border-border text-fg-muted hover:bg-surface-2 hover:text-fg'
      }`}
    >
      {children}
    </Link>
  );
}
