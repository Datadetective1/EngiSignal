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
import {
  buildRenewalLines,
  computeRenewalExposure,
  describeRenewalTiming,
  renewalUrgency,
} from '@/lib/analytics/renewal';
import { loadWorkspace } from '@/lib/workspace';
import { AnalyticsWithheld } from '@/components/app/data-integrity';
import { analyticsAvailable } from '@/lib/analytics/integrity';
import type { RenewalStage } from '@/lib/domain/types';
import { renewalHref } from '@/lib/routes';

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
  const { integrity, renewals, portfolio, dataset } = await loadWorkspace();
  // Every figure below is computed from usage. When the analysis did not
  // read all of it, there is no honest version of this page.
  if (!analyticsAvailable(integrity)) return <AnalyticsWithheld integrity={integrity} />;


  // Feature-level positions, reshaped from the portfolio the engine already
  // computed. Nothing is recalculated here.
  const renewalLines = buildRenewalLines(portfolio);
  const exposure = computeRenewalExposure(renewalLines, dataset.asOf);

  const positions = [...renewalLines].sort((a, b) => {
    // Dated lines first, soonest first. Undated lines are not "far away" — their
    // timing is unknown — so they sit at the end rather than being sorted as if
    // they renewed in the distant future.
    if (a.daysToRenewal === null && b.daysToRenewal === null) {
      return (b.currentAnnualCost ?? 0) - (a.currentAnnualCost ?? 0);
    }
    if (a.daysToRenewal === null) return 1;
    if (b.daysToRenewal === null) return -1;
    return a.daysToRenewal - b.daysToRenewal;
  });

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

      {/* ── Renewal exposure ────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-[13px] font-semibold text-fg">Renewal exposure</h2>
          <p className="mt-1 text-[12.5px] text-fg-muted">
            Commitments falling due inside each horizon. Windows are cumulative — a line renewing in
            45 days appears in 60, 90, 180 and 365 as well, because it is exposure inside all of them.
          </p>
        </div>

        <div className="es-scroll overflow-x-auto">
          <TableShell>
            <thead>
              <tr>
                <Th>Within</Th>
                <Th align="right">Lines</Th>
                <Th align="right">Annual value</Th>
                <Th align="right">Opportunity</Th>
                <Th>Pricing</Th>
              </tr>
            </thead>
            <tbody>
              {exposure.buckets.map((bucket) => (
                <tr key={bucket.window}>
                  <Td className="font-medium text-fg">{bucket.window} days</Td>
                  <Td align="right">{formatNumber(bucket.lineCount)}</Td>
                  <Td align="right" className="tnum">
                    {bucket.lineCount === 0 ? '—' : formatCurrency(bucket.annualCost)}
                  </Td>
                  <Td align="right" className="tnum">
                    {bucket.optimizationOpportunity > 0
                      ? formatCurrency(bucket.optimizationOpportunity)
                      : '—'}
                  </Td>
                  <Td>
                    {bucket.lineCount === 0 ? (
                      <span className="text-fg-subtle">No renewals in this window</span>
                    ) : bucket.unpricedLines > 0 ? (
                      <Badge tone="neutral">
                        {bucket.unpricedLines} of {bucket.lineCount} unpriced
                      </Badge>
                    ) : (
                      <Badge tone="positive">Fully priced</Badge>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </div>

        {(exposure.undatedLines > 0 || exposure.lapsedLines > 0) && (
          <div className="border-t border-border px-5 py-3.5">
            <ul className="space-y-1.5">
              {exposure.undatedLines > 0 && (
                <li className="text-[12px] leading-relaxed text-fg-subtle">
                  <span className="font-medium text-fg-muted">
                    {formatNumber(exposure.undatedLines)}{' '}
                    {exposure.undatedLines === 1 ? 'feature carries' : 'features carry'} no renewal
                    date.
                  </span>{' '}
                  They are excluded from every window above rather than assumed to renew annually —
                  perpetual licences do exist, and putting one on a renewal calendar would send
                  somebody to negotiate a contract that is not there.
                </li>
              )}
              {exposure.lapsedLines > 0 && (
                <li className="text-[12px] leading-relaxed text-fg-subtle">
                  <span className="font-medium text-fg-muted">
                    {formatNumber(exposure.lapsedLines)} renewal{' '}
                    {exposure.lapsedLines === 1 ? 'date has' : 'dates have'} already passed.
                  </span>{' '}
                  Usually a stale export. Worth confirming before it is treated as either.
                </li>
              )}
            </ul>
          </div>
        )}
      </Card>

      {/* ── Renewal positions ───────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-[13px] font-semibold text-fg">Renewal positions</h2>
          <p className="mt-1 text-[12.5px] text-fg-muted">
            One row per feature: what is owned, what demand supports, and what the difference is
            worth. Soonest first.
          </p>
        </div>

        {positions.length === 0 ? (
          <p className="px-5 py-6 text-[13px] text-fg-muted">
            No renewal positions yet. Import a usage export and a contract or renewal schedule to
            build one.
          </p>
        ) : (
          <div className="es-scroll overflow-x-auto">
            <TableShell>
              <thead>
                <tr>
                  <Th>Vendor</Th>
                  <Th>Feature</Th>
                  <Th align="right">Owned</Th>
                  <Th align="right">Annual cost</Th>
                  <Th align="right">Recommended</Th>
                  <Th align="right">At recommended</Th>
                  <Th align="right">Opportunity</Th>
                  <Th>Renewal</Th>
                  <Th>Evidence</Th>
                </tr>
              </thead>
              <tbody>
                {positions.map((line) => {
                  const urgency = renewalUrgency(line.daysToRenewal);
                  return (
                    <tr key={line.featureKey}>
                      <Td className="text-fg-muted">{line.vendor ?? '—'}</Td>
                      <Td className="font-medium text-fg">{line.featureName}</Td>
                      <Td align="right" className="tnum">
                        {formatNumber(line.currentQuantity)}
                      </Td>
                      <Td align="right" className="tnum">
                        {/* Unpriced is not zero. */}
                        {line.currentAnnualCost === null ? (
                          <span className="text-fg-subtle">Not priced</span>
                        ) : (
                          formatCurrency(line.currentAnnualCost)
                        )}
                      </Td>
                      <Td align="right" className="tnum">
                        {line.recommendedQuantity === null ? (
                          <span className="text-fg-subtle">—</span>
                        ) : (
                          formatNumber(line.recommendedQuantity)
                        )}
                      </Td>
                      <Td align="right" className="tnum">
                        {line.recommendedAnnualCost === null ? (
                          <span className="text-fg-subtle">—</span>
                        ) : (
                          formatCurrency(line.recommendedAnnualCost)
                        )}
                      </Td>
                      <Td align="right" className="tnum">
                        {line.optimizationOpportunity === null ? (
                          <span className="text-fg-subtle">—</span>
                        ) : line.optimizationOpportunity > 0 ? (
                          <span className="text-positive">
                            {formatCurrency(line.optimizationOpportunity)}
                          </span>
                        ) : (
                          '—'
                        )}
                      </Td>
                      <Td>
                        <Badge
                          tone={
                            urgency === 'critical' || urgency === 'lapsed'
                              ? 'danger'
                              : urgency === 'high'
                                ? 'warning'
                                : 'neutral'
                          }
                        >
                          {describeRenewalTiming(line.daysToRenewal)}
                        </Badge>
                      </Td>
                      <Td className="text-[11.5px] text-fg-subtle">{line.evidence}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </TableShell>
          </div>
        )}
      </Card>

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
                                href={renewalHref(r.contractId)}
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
                    <Link href={renewalHref(renewal.contractId)} className="group block min-w-[210px]">
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
