import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Badge,
  Card,
  ConfidenceBadge,
  Kpi,
  MethodologyNote,
  SectionHeading,
  TableShell,
  Td,
  Th,
} from '@/components/ui/primitives';
import { RENEWAL_STAGES } from '@/lib/analytics/portfolio';
import { formatDate } from '@/lib/analytics/dates';
import { formatCurrency, formatNumber, formatSignedPercent } from '@/lib/analytics/financial';
import { loadWorkspace } from '@/lib/workspace';
import type { RenewalStage } from '@/lib/domain/types';

export const metadata: Metadata = { title: 'Renewals' };

const STAGE_INDEX: Record<RenewalStage, number> = {
  analyze: 0,
  validate: 1,
  recommend: 2,
  negotiate: 3,
  finalize: 4,
  renewed: 5,
};

export default async function RenewalsPage() {
  const { renewals } = await loadWorkspace();

  const upcoming = renewals.filter((r) => r.daysRemaining >= 0);
  const totalSpend = upcoming.reduce((acc, r) => acc + (r.currentAnnualSpend ?? 0), 0);
  const totalOpportunity = upcoming.reduce((acc, r) => acc + (r.optimizationOpportunity ?? 0), 0);
  const totalIncremental = upcoming.reduce((acc, r) => acc + (r.incrementalSpend ?? 0), 0);
  const exposed = upcoming.filter((r) => r.capacityExposure > 0).length;

  return (
    <div className="space-y-7">
      <SectionHeading
        eyebrow="Renewal Command Centre"
        title="Every commitment, with a position before you walk in"
        description="Renewals ordered by how soon money is committed. Each carries a demand-backed recommended quantity, the financial consequence, and the confidence behind it."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Contracts ahead" value={formatNumber(upcoming.length)} detail="With a future renewal date" />
        <Kpi label="Spend at renewal" value={formatCurrency(totalSpend)} detail="Current annual value" />
        <Kpi
          label="Optimization"
          value={formatCurrency(totalOpportunity)}
          tone="positive"
          detail="Reduction supported by demand"
        />
        <Kpi
          label="Capacity exposure"
          value={formatNumber(exposed)}
          tone={exposed > 0 ? 'danger' : 'neutral'}
          detail={
            totalIncremental > 0
              ? `${formatCurrency(totalIncremental)} of increases indicated`
              : 'No contracts with elevated risk'
          }
        />
      </div>

      {/* ── Decision timeline ───────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-[13px] font-semibold text-fg">Decision timeline</h2>
          <p className="mt-1 text-[12.5px] text-fg-muted">
            Each contract sits at the stage its countdown has reached.
          </p>
        </div>

        <div className="es-scroll overflow-x-auto">
          <div className="min-w-[860px] px-5 py-5">
            <div className="relative flex justify-between">
              <div className="absolute left-0 right-0 top-[9px] h-px bg-border" aria-hidden="true" />
              {RENEWAL_STAGES.map((stage) => {
                const count = upcoming.filter((r) => r.stage === stage.stage).length;
                return (
                  <div key={stage.stage} className="relative flex-1 pr-4 last:pr-0">
                    <span
                      className={`relative z-10 block size-[18px] rounded-full border-2 ${
                        count > 0 ? 'border-accent bg-accent' : 'border-border bg-surface'
                      }`}
                      aria-hidden="true"
                    />
                    <p className="mt-2.5 text-[12.5px] font-medium text-fg">{stage.label}</p>
                    <p className="mt-0.5 text-[11px] text-fg-subtle">
                      {stage.stage === 'renewed' ? 'Complete' : `${stage.startsAtDays} days out`}
                    </p>
                    <p className="mt-1.5 text-[11.5px] leading-snug text-fg-muted">{stage.description}</p>
                    {count > 0 && (
                      <ul className="mt-2 space-y-1">
                        {upcoming
                          .filter((r) => r.stage === stage.stage)
                          .map((r) => (
                            <li key={r.contractId}>
                              <Link
                                href={`/app/renewals/${r.contractId}`}
                                className="block truncate rounded-sm bg-accent-soft px-2 py-1 text-[11.5px] font-medium text-accent hover:brightness-110"
                              >
                                {r.vendorName} · {r.daysRemaining}d
                              </Link>
                            </li>
                          ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </Card>

      {/* ── Table ───────────────────────────────────────────────────────── */}
      <Card>
        <TableShell>
          <thead>
            <tr>
              <Th>Vendor / Agreement</Th>
              <Th>Renewal</Th>
              <Th align="right">Days</Th>
              <Th>Stage</Th>
              <Th align="right">Current spend</Th>
              <Th align="right">Recommended</Th>
              <Th align="right">Opportunity</Th>
              <Th align="right">Exposure</Th>
              <Th align="right">Demand</Th>
              <Th align="right">Headcount</Th>
              <Th>Confidence</Th>
            </tr>
          </thead>
          <tbody>
            {renewals.map((renewal) => {
              const net = (renewal.optimizationOpportunity ?? 0) - (renewal.incrementalSpend ?? 0);
              return (
                <tr key={renewal.contractId} className="transition-colors hover:bg-surface-2">
                  <Td>
                    <Link href={`/app/renewals/${renewal.contractId}`} className="group block min-w-[210px]">
                      <span className="block truncate text-[12.5px] font-medium text-fg group-hover:text-accent">
                        {renewal.vendorName}
                      </span>
                      <span className="block truncate text-[11px] text-fg-subtle">
                        {renewal.agreementName} · {renewal.contractNumber}
                      </span>
                    </Link>
                  </Td>
                  <Td className="whitespace-nowrap text-fg-muted">{formatDate(renewal.renewalDate)}</Td>
                  <Td align="right">
                    <span
                      className={
                        renewal.daysRemaining <= 60 ? 'font-medium text-danger' : 'text-fg'
                      }
                    >
                      {renewal.daysRemaining}
                    </span>
                  </Td>
                  <Td>
                    <Badge tone={STAGE_INDEX[renewal.stage] >= 3 ? 'accent' : 'neutral'}>
                      {RENEWAL_STAGES.find((s) => s.stage === renewal.stage)?.label}
                    </Badge>
                  </Td>
                  <Td align="right">{formatCurrency(renewal.currentAnnualSpend)}</Td>
                  <Td align="right">{formatCurrency(renewal.recommendedAnnualSpend)}</Td>
                  <Td align="right">
                    {net === 0 ? (
                      <span className="text-fg-subtle">—</span>
                    ) : (
                      <span className={net > 0 ? 'font-medium text-positive' : 'font-medium text-danger'}>
                        {net > 0 ? '' : '+'}
                        {formatCurrency(Math.abs(net))}
                      </span>
                    )}
                  </Td>
                  <Td align="right">
                    {renewal.capacityExposure === 0 ? (
                      <span className="text-fg-subtle">—</span>
                    ) : (
                      <span className="font-medium text-danger">{renewal.capacityExposure}</span>
                    )}
                  </Td>
                  <Td align="right" className="text-fg-muted">
                    {formatSignedPercent(renewal.demandTrendPct)}
                  </Td>
                  <Td align="right" className="text-fg-muted">
                    {formatSignedPercent(renewal.headcountImpactPct, 0)}
                  </Td>
                  <Td>
                    <ConfidenceBadge level={renewal.confidence.level} score={renewal.confidence.score} />
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      </Card>

      <MethodologyNote>
        Demand trend is weighted by spend, so a large product moves the contract-level figure and a small
        one does not. Capacity exposure counts features on the agreement currently at High or Critical risk.
        Headcount reflects the organization&rsquo;s configured growth assumption.
      </MethodologyNote>
    </div>
  );
}
