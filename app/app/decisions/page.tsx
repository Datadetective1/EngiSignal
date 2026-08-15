import type { Metadata } from 'next';
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import {
  Badge,
  Card,
  ConfidenceBadge,
  Kpi,
  MethodologyNote,
  RiskBadge,
  SectionHeading,
  TableShell,
  Td,
  Th,
} from '@/components/ui/primitives';
import { formatCurrency, formatNumber } from '@/lib/analytics/financial';
import { getDataProvider } from '@/lib/data';
import { getDecisionOverrides } from '@/lib/data/mock-provider';
import { DECISION_STATUS_LABELS, DECISION_TYPE_LABELS, buildDecisions } from '@/lib/decisions';
import type { DecisionStatus, DecisionType } from '@/lib/domain/types';
import { loadWorkspace } from '@/lib/workspace';

export const metadata: Metadata = { title: 'Decisions' };

const STATUS_TONE: Record<DecisionStatus, 'neutral' | 'accent' | 'positive' | 'warning' | 'danger'> = {
  open: 'neutral',
  in_review: 'accent',
  approved: 'positive',
  rejected: 'danger',
  complete: 'positive',
};

async function updateDecision(formData: FormData) {
  'use server';

  const organizationId = String(formData.get('organizationId') ?? '');
  const decisionId = String(formData.get('decisionId') ?? '');
  const status = String(formData.get('status') ?? 'open') as DecisionStatus;
  const owner = String(formData.get('owner') ?? '') || null;
  if (organizationId.length === 0 || decisionId.length === 0) return;

  await getDataProvider().setDecisionStatus(organizationId, decisionId, status, owner);
  revalidatePath('/app/decisions');
}

export default async function DecisionsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; status?: string }>;
}) {
  const workspace = await loadWorkspace();
  const params = await searchParams;
  const { organization, signals } = workspace;

  const overrides = getDecisionOverrides(organization.id);
  const all = buildDecisions(organization.id, signals, overrides);

  const decisions = all.filter((decision) => {
    if (params.type !== undefined && decision.type !== params.type) return false;
    if (params.status !== undefined && decision.status !== params.status) return false;
    return true;
  });

  const totalImpact = all.reduce((acc, d) => acc + Math.abs(d.impact ?? 0), 0);
  const urgent = all.filter((d) => d.urgencyDays !== null && d.urgencyDays <= 60);
  const open = all.filter((d) => d.status === 'open');
  const types = [...new Set(all.map((d) => d.type))];

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Decisions"
        title="One queue for every decision the data supports"
        description="Every renewal, cost, capacity, reclaim, forecast and data-quality decision in one place, each with its impact, urgency, confidence and owner."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Decisions" value={formatNumber(all.length)} detail={`${open.length} still open`} />
        <Kpi label="Value at stake" value={formatCurrency(totalImpact)} tone="accent" detail="Absolute annual impact across the queue" />
        <Kpi
          label="Urgent"
          value={formatNumber(urgent.length)}
          tone={urgent.length > 0 ? 'danger' : 'neutral'}
          detail="Requiring action within 60 days"
        />
        <Kpi
          label="High confidence"
          value={formatNumber(all.filter((d) => d.confidence === 'High').length)}
          tone="positive"
          detail="Backed by complete data"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilterChip href="/app/decisions" active={params.type === undefined && params.status === undefined}>
          All
        </FilterChip>
        {types.map((type) => (
          <FilterChip key={type} href={`/app/decisions?type=${type}`} active={params.type === type}>
            {DECISION_TYPE_LABELS[type as DecisionType]}{' '}
            <span className="tnum opacity-60">{all.filter((d) => d.type === type).length}</span>
          </FilterChip>
        ))}
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        <FilterChip href="/app/decisions?status=open" active={params.status === 'open'}>
          Open only
        </FilterChip>
      </div>

      <Card>
        <TableShell>
          <thead>
            <tr>
              <Th>Decision</Th>
              <Th>Type</Th>
              <Th align="right">Impact</Th>
              <Th align="right">Urgency</Th>
              <Th>Risk</Th>
              <Th>Confidence</Th>
              <Th>Recommended action</Th>
              <Th>Owner &amp; status</Th>
            </tr>
          </thead>
          <tbody>
            {decisions.map((decision) => (
              <tr key={decision.id} className="hover:bg-surface-2">
                <Td>
                  <Link href={decision.href} className="group block min-w-[220px] max-w-[300px]">
                    <span className="block truncate text-[12.5px] font-medium text-fg group-hover:text-accent">
                      {decision.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-fg-subtle">
                      {decision.description}
                    </span>
                  </Link>
                </Td>
                <Td>
                  <Badge>{DECISION_TYPE_LABELS[decision.type]}</Badge>
                </Td>
                <Td align="right" className="font-medium">
                  {decision.impact === null ? '—' : formatCurrency(Math.abs(decision.impact))}
                </Td>
                <Td align="right">
                  {decision.urgencyDays === null ? (
                    <span className="text-fg-subtle">—</span>
                  ) : (
                    <span className={decision.urgencyDays <= 60 ? 'font-medium text-danger' : 'text-fg-muted'}>
                      {decision.urgencyDays}d
                    </span>
                  )}
                </Td>
                <Td>
                  <RiskBadge risk={decision.risk} />
                </Td>
                <Td>
                  <ConfidenceBadge level={decision.confidence} />
                </Td>
                <Td className="max-w-[240px] text-[11.5px] text-fg-muted">{decision.recommendedAction}</Td>
                <Td>
                  <form action={updateDecision} className="flex flex-wrap items-center gap-1.5">
                    <input type="hidden" name="organizationId" value={organization.id} />
                    <input type="hidden" name="decisionId" value={decision.id} />
                    <input
                      type="text"
                      name="owner"
                      defaultValue={decision.owner ?? ''}
                      placeholder="Owner"
                      aria-label={`Owner for ${decision.title}`}
                      className="h-7 w-24 rounded-md border border-border bg-surface px-2 text-[11.5px] text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none"
                    />
                    <select
                      name="status"
                      defaultValue={decision.status}
                      aria-label={`Status for ${decision.title}`}
                      className="h-7 rounded-md border border-border bg-surface px-1.5 text-[11.5px] text-fg focus:border-accent focus:outline-none"
                    >
                      {Object.entries(DECISION_STATUS_LABELS).map(([value, label]) => (
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
                    {decision.status !== 'open' && (
                      <Badge tone={STATUS_TONE[decision.status]}>
                        {DECISION_STATUS_LABELS[decision.status]}
                      </Badge>
                    )}
                  </form>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableShell>

        {decisions.length === 0 && (
          <p className="px-4 py-10 text-center text-[13px] text-fg-muted">No decisions match this filter.</p>
        )}
      </Card>

      <MethodologyNote>
        Decisions are derived from current analytics on every read — only owner and status are stored. A
        decision can therefore never show a stale recommendation with a fresh-looking status.
        {workspace.usingMockData && ' Ownership and status persist for this session only.'}
      </MethodologyNote>
    </div>
  );
}

function FilterChip({
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
