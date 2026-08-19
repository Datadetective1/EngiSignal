import type { Metadata } from 'next';
import Link from 'next/link';
import { RankedBars } from '@/components/charts';
import {
  Card,
  CardHeader,
  Kpi,
  MethodologyNote,
  SectionHeading,
  TableShell,
  Td,
  Th,
} from '@/components/ui/primitives';
import {
  ALLOCATION_METHODS,
  DIMENSION_LABELS,
  DRILL_PATH,
  allocateCost,
  allocateCostAutomatically,
  type AllocationMethod,
} from '@/lib/analytics/allocation';
import {
  COST_NOT_PROVIDED,
  costPerActiveUser,
  costPerEngineer,
  describeSpendHeadline,
  formatCurrency,
  formatNumber,
  formatPercent,
  hasCostEvidence,
} from '@/lib/analytics/financial';
import type { DimensionKey } from '@/lib/domain/types';
import { loadWorkspace } from '@/lib/workspace';
import { AnalyticsWithheld } from '@/components/app/data-integrity';
import { analyticsAvailable } from '@/lib/analytics/integrity';

export const metadata: Metadata = { title: 'Cost intelligence' };

/**
 * Every axis a customer's HR export might carry.
 *
 * A dimension the people file did not supply produces one "Unattributed" row
 * rather than a plausible-looking split, so offering all of them is safe: the
 * allocation reports what it could not attribute instead of distributing it.
 */
const DIMENSIONS: DimensionKey[] = [
  'organization',
  'businessUnit',
  'department',
  'program',
  'discipline',
  'competency',
  'location',
  'region',
  'employeeType',
  'managerName',
];

export default async function CostPage({
  searchParams,
}: {
  searchParams: Promise<{ dimension?: string; method?: string }>;
}) {
  const { integrity, dataset, portfolio, totals, unusedCapacity } = await loadWorkspace();
  // Every figure below is computed from usage. When the analysis did not
  // read all of it, there is no honest version of this page.
  if (!analyticsAvailable(integrity)) return <AnalyticsWithheld integrity={integrity} />;

  const params = await searchParams;

  const dimension = (DIMENSIONS.includes(params.dimension as DimensionKey)
    ? params.dimension
    : 'program') as DimensionKey;
  // No method in the URL means "use the strongest the evidence supports", which
  // is the difference between a duration-free export allocating correctly and
  // returning a column of zeroes. An explicit choice is still honoured, so a
  // customer can compare methods deliberately.
  const explicitMethod = Object.keys(ALLOCATION_METHODS).includes(params.method ?? '')
    ? (params.method as AllocationMethod)
    : null;

  const allocationInput = {
    dimension,
    features: portfolio.map((row) => ({
      featureId: row.featureId,
      licenseModel: row.licenseModel,
      annualCost: row.financial.currentAnnualCost,
      wasteAmount:
        row.licenseModel === 'concurrent' && row.unitPrice !== null && row.metrics !== null
          ? Math.max(0, row.entitled - row.metrics.p95) * row.unitPrice
          : (row.namedUser?.reclaimValue ?? 0),
    })),
    activities: dataset.activities,
    employees: dataset.employees,
  };

  const allocation =
    explicitMethod === null
      ? allocateCostAutomatically(allocationInput)
      : allocateCost({ ...allocationInput, method: explicitMethod });

  const method = allocation.method;

  const vendorSpend = new Map<string, number>();
  for (const row of portfolio) {
    vendorSpend.set(row.vendorName, (vendorSpend.get(row.vendorName) ?? 0) + (row.financial.currentAnnualCost ?? 0));
  }
  const vendorBars = [...vendorSpend.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  const perEngineer = costPerEngineer(totals.annualSpend, dataset.organization.technicalHeadcount);
  // What the headline figure actually measures. Served capacity and a signed
  // commitment are different numbers and must not share a label.
  const headline = describeSpendHeadline(totals);
  // People OBSERVED using the software, on the same evidence the allocation
  // engine uses. Counting only `totalSessions > 0` read this estate as zero
  // active users: a concurrency export records who held a licence and never
  // counts sessions, so every one of the 56 observed people scored zero and the
  // page divided the whole portfolio by one of them.
  const observedUsers = new Set(
    dataset.activities
      .filter((a) => a.totalSessions > 0 || a.totalHours > 0 || a.lastUsedDate !== null)
      .map((a) => a.employeeId),
  ).size;
  const perObservedUser = costPerActiveUser(totals.annualSpend, observedUsers);

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Engineering Cost Intelligence"
        title="Where engineering software money goes"
        description="Spend attributed to the organization that consumed it, using one declared methodology at a time."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label={headline.label}
          value={formatCurrency(headline.value)}
          detail={
            !hasCostEvidence(totals)
              ? COST_NOT_PROVIDED
              : headline.contrast === null
                ? `${totals.featureCount} features`
                : `${headline.contrast.label} ${formatCurrency(headline.contrast.value)}`
          }
        />
        <Kpi
          label="Cost per technical employee"
          value={formatCurrency(perEngineer)}
          detail={`${formatNumber(dataset.organization.technicalHeadcount)} employees`}
        />
        <Kpi
          label="Cost per observed user"
          // Null when nobody was observed. Dividing by one instead would print
          // the entire portfolio as a single person's cost.
          value={perObservedUser === null ? '—' : formatCurrency(perObservedUser)}
          detail={
            observedUsers === 0
              ? 'No usage attributed to a person yet'
              : `${formatNumber(observedUsers)} people observed using the software`
          }
        />
        <Kpi
          label="Vendor concentration"
          value={hasCostEvidence(totals) ? formatPercent(totals.vendorConcentration * 100, 0) : '—'}
          detail={
            hasCostEvidence(totals)
              ? `Largest vendor share of spend · ${vendorBars[0]?.label ?? '—'}`
              : COST_NOT_PROVIDED
          }
        />
      </div>

      {/* One sentence naming what the headline figure measures. A customer
          reading "$1.76M" needs to know whether that is what they signed for
          or what their licence servers happen to serve. */}
      <p className="text-[12.5px] leading-relaxed text-fg-muted">
        <span className="font-medium text-fg">{headline.label}:</span> {headline.basis}
      </p>

      {/* ── Methodology controls ────────────────────────────────────────── */}
      <Card>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-border px-5 py-4">
          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.1em] text-fg-subtle">
              Group by
            </p>
            <div className="flex flex-wrap gap-1.5">
              {DIMENSIONS.map((key) => (
                <Link
                  key={key}
                  href={`/app/cost?dimension=${key}&method=${method}`}
                  className={`rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors ${
                    dimension === key
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-border text-fg-muted hover:bg-surface-2 hover:text-fg'
                  }`}
                >
                  {DIMENSION_LABELS[key]}
                </Link>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.1em] text-fg-subtle">
              Allocation method
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(ALLOCATION_METHODS) as AllocationMethod[]).map((key) => (
                <Link
                  key={key}
                  href={`/app/cost?dimension=${dimension}&method=${key}`}
                  className={`rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors ${
                    method === key
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-border text-fg-muted hover:bg-surface-2 hover:text-fg'
                  }`}
                >
                  {ALLOCATION_METHODS[key].label}
                </Link>
              ))}
            </div>
          </div>
        </div>

        <div className="border-b border-border bg-surface-2 px-5 py-3">
          {/* The basis, before any number. A figure whose basis is unstated is
              the thing this product exists not to produce. */}
          <p className="text-[12.5px] leading-relaxed text-fg-muted">
            <span className="font-medium text-fg">Basis — {allocation.basisLabel}:</span>{' '}
            {allocation.methodology}
          </p>

          {explicitMethod === null && (
            <p className="mt-1.5 text-[12px] leading-relaxed text-accent">
              {allocation.selectionReason}
            </p>
          )}

          {!allocation.available && (
            <p className="mt-1.5 text-[12px] leading-relaxed text-warning">
              Cost is known but cannot be divided between groups from what has been imported. This
              is not $0 of spend — it is spend with no safe way to attribute it.
            </p>
          )}

          {allocation.unallocated > 0 && (
            <p className="mt-1.5 text-[12px] text-warning">
              {formatCurrency(allocation.unallocated)} of {formatCurrency(allocation.allocatableCost)}{' '}
              could not be attributed ({allocation.unallocatedReason}). It is reported here rather
              than redistributed, because spreading it across the groups that happen to be
              identifiable would inflate every one of them by the size of the gap.
            </p>
          )}

          {allocation.unresolvedIdentityCount > 0 && (
            <p className="mt-1.5 text-[12px] leading-relaxed text-fg-muted">
              {formatCurrency(allocation.unresolvedIdentityCost)} of that belongs to{' '}
              {allocation.unresolvedIdentityCount} unresolved{' '}
              {allocation.unresolvedIdentityCount === 1 ? 'username' : 'usernames'}.{' '}
              <Link href="/app/data/users" className="text-accent underline underline-offset-2">
                Resolve them
              </Link>{' '}
              to attribute this spend.
            </p>
          )}

          {!allocation.reconciles && (
            <p className="mt-1.5 text-[12px] text-danger">
              Allocated and unallocated do not sum to the allocatable total. Treat these figures as
              unreliable and report this.
            </p>
          )}
        </div>

        <TableShell>
          <thead>
            <tr>
              <Th>{DIMENSION_LABELS[dimension]}</Th>
              <Th align="right">Allocated spend</Th>
              <Th align="right">Share</Th>
              <Th align="right">Headcount</Th>
              <Th align="right">Cost per engineer</Th>
              <Th align="right">Observed users</Th>
              <Th align="right">Assigned seats</Th>
              <Th align="right">Usage hours</Th>
              <Th align="right">Potential waste</Th>
            </tr>
          </thead>
          <tbody>
            {allocation.rows.map((row) => (
              <tr key={row.key} className="hover:bg-surface-2">
                <Td>
                  <Link
                    href={`/app/users?q=${encodeURIComponent(row.key)}`}
                    className="font-medium hover:text-accent"
                  >
                    {row.key}
                  </Link>
                </Td>
                <Td align="right" className="font-medium">
                  {formatCurrency(row.allocatedSpend)}
                </Td>
                <Td align="right" className="text-fg-muted">
                  {formatPercent(row.sharePct, 1)}
                </Td>
                <Td align="right">{formatNumber(row.headcount)}</Td>
                <Td align="right">{formatCurrency(row.costPerEngineer)}</Td>
                <Td align="right">{formatNumber(row.observedUsers)}</Td>
                <Td align="right">{formatNumber(row.assignedLicenses)}</Td>
                <Td align="right" className="text-fg-muted">
                  {formatNumber(row.usageHours)}
                </Td>
                <Td align="right" className="text-warning">
                  {formatCurrency(row.potentialWaste)}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableShell>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
          <p className="tnum text-[12px] text-fg-muted">
            {hasCostEvidence(totals)
              ? `Allocated ${formatCurrency(allocation.totalAllocated)} of ${formatCurrency(totals.annualSpend)} total spend`
              : COST_NOT_PROVIDED}
          </p>
          <a
            href={`/api/export/cost?dimension=${dimension}&method=${method}`}
            className="inline-flex h-8 items-center rounded-md border border-border px-2.5 text-[12px] font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            Export CSV
          </a>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Spend by vendor" description="Concentration is a negotiation variable." />
          <div className="px-5 py-4">
            <RankedBars data={vendorBars} formatValue={(v) => formatCurrency(v)} />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Where the waste is"
            description="Capacity above demand, valued at contract price and attributed on the same basis as spend."
          />
          <div className="px-5 py-4">
            <RankedBars
              data={allocation.rows
                .filter((row) => row.potentialWaste > 0)
                .slice(0, 8)
                .map((row) => ({
                  label: row.key,
                  value: row.potentialWaste,
                  sub: `${formatPercent((row.potentialWaste / Math.max(1, row.allocatedSpend)) * 100, 1)} of allocated spend`,
                }))}
              formatValue={(v) => formatCurrency(v)}
            />
            <MethodologyNote>
              {unusedCapacity.methodology} Named-user waste uses idle assigned seats instead, and the two
              are never summed into a single figure without saying so.
            </MethodologyNote>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Drill-through"
          description="Follow the money from the enterprise down to the individual."
        />
        <div className="es-scroll overflow-x-auto px-5 py-4">
          <ol className="flex min-w-[620px] items-center gap-2 text-[12.5px]">
            <li className="rounded-md border border-border px-3 py-1.5 text-fg-muted">Enterprise</li>
            {DRILL_PATH.map((key) => (
              <li key={key} className="flex items-center gap-2">
                <span className="text-fg-subtle">→</span>
                <Link
                  href={`/app/cost?dimension=${key}&method=${method}`}
                  className={`rounded-md border px-3 py-1.5 font-medium transition-colors ${
                    dimension === key
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-border text-fg-muted hover:bg-surface-2 hover:text-fg'
                  }`}
                >
                  {DIMENSION_LABELS[key]}
                </Link>
              </li>
            ))}
            <li className="flex items-center gap-2">
              <span className="text-fg-subtle">→</span>
              <Link
                href="/app/users"
                className="rounded-md border border-border px-3 py-1.5 font-medium text-fg-muted hover:bg-surface-2 hover:text-fg"
              >
                User
              </Link>
            </li>
          </ol>
        </div>
      </Card>
    </div>
  );
}
