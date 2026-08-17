import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CostBridge } from '@/components/charts';
import {
  Badge,
  Card,
  CardHeader,
  ConfidenceBadge,
  Kpi,
  LinkButton,
  MethodologyNote,
  MetricRow,
  RiskBadge,
  TableShell,
  Td,
  Th,
} from '@/components/ui/primitives';
import { RENEWAL_STAGES } from '@/lib/analytics/portfolio';
import { formatDate } from '@/lib/analytics/dates';
import {
  formatCurrency,
  formatCurrencyExact,
  formatNumber,
  formatPercent,
  formatSignedPercent,
} from '@/lib/analytics/financial';
import { AnalyticsWithheld } from '@/components/app/data-integrity';
import { analyticsAvailable } from '@/lib/analytics/integrity';
import { decodeRouteId, featureHref, renewalBriefHref } from '@/lib/routes';
import { loadWorkspace } from '@/lib/workspace';

export const metadata: Metadata = { title: 'Renewal' };

export default async function RenewalDetailPage({
  params,
}: {
  params: Promise<{ contractId: string }>;
}) {
  // Pages receive dynamic segments percent-encoded; identities are not. See
  // lib/routes.ts — comparing the two directly 404s every detail page.
  const contractId = decodeRouteId((await params).contractId);
  const workspace = await loadWorkspace();

  // Every quantity below is demand-backed, and demand comes from usage. If the
  // analysis did not read all of the stored usage, this page has no defensible
  // version of itself — least of all the one a customer takes into a
  // negotiation.
  if (!analyticsAvailable(workspace.integrity)) {
    return <AnalyticsWithheld integrity={workspace.integrity} />;
  }

  const renewal = workspace.renewals.find((r) => r.contractId === contractId);
  const contract = workspace.dataset.contracts.find((c) => c.id === contractId);
  if (renewal === undefined || contract === undefined) notFound();

  const rows = workspace.portfolio.filter((row) => row.contractId === contractId);
  const net = (renewal.optimizationOpportunity ?? 0) - (renewal.incrementalSpend ?? 0);

  const reductions = rows
    .filter((row) => (row.financial.optimizationOpportunity ?? 0) > 0)
    .reduce((acc, row) => acc + (row.financial.optimizationOpportunity ?? 0), 0);
  const increases = rows
    .filter((row) => (row.financial.incrementalSpend ?? 0) > 0)
    .reduce((acc, row) => acc + (row.financial.incrementalSpend ?? 0), 0);

  const stageIndex = RENEWAL_STAGES.findIndex((s) => s.stage === renewal.stage);

  return (
    <div className="space-y-6">
      <header>
        <nav className="mb-2 flex items-center gap-1.5 text-[12px] text-fg-subtle">
          <Link href="/app/renewals" className="hover:text-fg">
            Renewals
          </Link>
          <span>/</span>
          <span>{renewal.vendorName}</span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[24px] font-semibold tracking-[-0.026em] text-fg">
              {renewal.vendorName} renewal
            </h1>
            <p className="mt-1.5 text-[13px] text-fg-muted">
              {renewal.agreementName} · {renewal.contractNumber} · renews{' '}
              {formatDate(renewal.renewalDate)}
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <Badge tone={renewal.daysRemaining <= 60 ? 'danger' : 'accent'}>
                {renewal.daysRemaining} days remaining
              </Badge>
              <Badge>{RENEWAL_STAGES[stageIndex]?.label ?? 'Analyze'}</Badge>
              <ConfidenceBadge level={renewal.confidence.level} score={renewal.confidence.score} />
              {contract.businessOwner !== null && <Badge>Owner: {contract.businessOwner}</Badge>}
            </div>
          </div>

          <LinkButton href={renewalBriefHref(contractId)} variant="primary">
            Generate negotiation brief
          </LinkButton>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Current annual spend" value={formatCurrency(renewal.currentAnnualSpend)} detail={`${rows.length} line items`} />
        <Kpi label="Recommended spend" value={formatCurrency(renewal.recommendedAnnualSpend)} tone="accent" detail="At demand-backed quantities" />
        <Kpi
          label={net >= 0 ? 'Net opportunity' : 'Net increase'}
          value={formatCurrency(Math.abs(net))}
          tone={net > 0 ? 'positive' : net < 0 ? 'danger' : 'neutral'}
          detail={`${formatCurrency(reductions)} reductions · ${formatCurrency(increases)} increases`}
        />
        <Kpi
          label="Capacity exposure"
          value={formatNumber(renewal.capacityExposure)}
          tone={renewal.capacityExposure > 0 ? 'danger' : 'neutral'}
          detail={renewal.capacityExposure > 0 ? 'Features at High or Critical risk' : 'No elevated risk on this agreement'}
        />
      </div>

      {/* ── Position bridge ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="From current position to recommended position"
          description="Every step is a quantity change backed by observed demand."
        />
        <div className="px-4 py-4">
          <CostBridge
            start={{ label: 'Current', value: renewal.currentAnnualSpend ?? 0 }}
            changes={[
              { label: 'Reductions', delta: -reductions },
              { label: 'Increases', delta: increases },
            ]}
            formatValue={(value) => formatCurrency(value)}
          />
        </div>
      </Card>

      {/* ── Line items ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Line items"
          description="Each position sized by the model appropriate to its license type."
        />
        <TableShell>
          <thead>
            <tr>
              <Th>Product / Feature</Th>
              <Th>Model</Th>
              <Th align="right">Entitled</Th>
              <Th align="right">Demand basis</Th>
              <Th align="right">Utilization</Th>
              <Th align="right">Recommended</Th>
              <Th align="right">Unit price</Th>
              <Th align="right">Current</Th>
              <Th align="right">Recommended cost</Th>
              <Th align="right">Change</Th>
              <Th>Risk</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const delta = (row.financial.recommendedAnnualCost ?? 0) - (row.financial.currentAnnualCost ?? 0);
              return (
                <tr key={row.featureId} className="transition-colors hover:bg-surface-2">
                  <Td>
                    <Link href={featureHref(row.featureId)} className="group block min-w-[180px]">
                      <span className="block truncate text-[12.5px] font-medium text-fg group-hover:text-accent">
                        {row.productName}
                      </span>
                      <span className="block truncate text-[11px] text-fg-subtle">{row.featureName}</span>
                    </Link>
                  </Td>
                  <Td>
                    <Badge>{row.licenseModel.replace('_', ' ')}</Badge>
                  </Td>
                  <Td align="right">{formatNumber(row.entitled)}</Td>
                  <Td align="right">
                    {row.rightSizing === null ? '—' : formatNumber(row.rightSizing.basis, 0)}
                    <span className="ml-1 text-[10.5px] text-fg-subtle">
                      {row.metrics !== null ? 'P95' : row.namedUser !== null ? 'active' : ''}
                    </span>
                  </Td>
                  <Td align="right">
                    {formatPercent(row.metrics?.utilizationPct ?? row.namedUser?.utilizationPct ?? null, 0)}
                  </Td>
                  <Td align="right" className="font-medium">
                    {row.rightSizing === null ? '—' : formatNumber(row.rightSizing.recommended)}
                  </Td>
                  <Td align="right" className="text-fg-muted">
                    {formatCurrencyExact(row.unitPrice)}
                  </Td>
                  <Td align="right">{formatCurrency(row.financial.currentAnnualCost)}</Td>
                  <Td align="right">{formatCurrency(row.financial.recommendedAnnualCost)}</Td>
                  <Td align="right">
                    {delta === 0 ? (
                      <span className="text-fg-subtle">—</span>
                    ) : (
                      <span className={delta < 0 ? 'font-medium text-positive' : 'font-medium text-danger'}>
                        {delta < 0 ? '−' : '+'}
                        {formatCurrency(Math.abs(delta))}
                      </span>
                    )}
                  </Td>
                  <Td>
                    <RiskBadge risk={row.risk} />
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Contract" description="Commercial terms of record." />
          <div className="px-5 py-4">
            <MetricRow label="Agreement" value={contract.agreementName ?? '—'} />
            <MetricRow label="Contract number" value={contract.contractNumber} />
            <MetricRow label="Term" value={`${formatDate(contract.startDate)} – ${formatDate(contract.endDate)}`} />
            <MetricRow label="Renewal date" value={formatDate(contract.renewalDate)} emphasis />
            <MetricRow label="Purchase order" value={contract.purchaseOrder ?? '—'} />
            <MetricRow label="Business owner" value={contract.businessOwner ?? '—'} />
            <MetricRow label="Cost centre" value={contract.costCenter ?? '—'} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Decision inputs" description="What is driving the recommended position." />
          <div className="px-5 py-4">
            <MetricRow
              label="Demand trend"
              value={`${formatSignedPercent(renewal.demandTrendPct)} / yr`}
              note="Spend-weighted across the agreement"
            />
            <MetricRow
              label="Headcount assumption"
              value={formatSignedPercent(renewal.headcountImpactPct, 0)}
              note="Organization-wide technical headcount growth"
            />
            <MetricRow
              label="Features at elevated risk"
              value={formatNumber(renewal.capacityExposure)}
            />
            <MetricRow
              label="Line items reducing"
              value={formatNumber(rows.filter((r) => (r.rightSizing?.quantityDelta ?? 0) < 0).length)}
            />
            <MetricRow
              label="Line items increasing"
              value={formatNumber(rows.filter((r) => (r.rightSizing?.quantityDelta ?? 0) > 0).length)}
            />

            <div className="mt-4 space-y-1.5">
              <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-fg-subtle">
                Confidence
              </p>
              {renewal.confidence.reasons.map((reason, index) => (
                <p key={index} className="text-[12.5px] text-fg-muted">
                  <span className="font-medium text-fg">{reason.label}:</span> {reason.detail}
                </p>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <MethodologyNote>
        Quantities on this agreement are recommended independently per feature using the model appropriate
        to its license type, then summed. No cross-subsidy is applied between line items and no vendor
        bundling assumption is made — those are negotiation levers for a human, not arithmetic.
      </MethodologyNote>
    </div>
  );
}
