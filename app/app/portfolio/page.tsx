import type { Metadata } from 'next';
import { PortfolioTable, type PortfolioTableRow } from '@/components/app/portfolio-table';
import { MethodologyNote, SectionHeading } from '@/components/ui/primitives';
import { formatCurrency } from '@/lib/analytics/financial';
import { loadWorkspace } from '@/lib/workspace';

export const metadata: Metadata = { title: 'Portfolio' };

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ risk?: string }>;
}) {
  const { portfolio, totals, options } = await loadWorkspace();
  const params = await searchParams;

  const rows: PortfolioTableRow[] = portfolio.map((row) => ({
    featureId: row.featureId,
    featureName: row.featureName,
    featureCode: row.featureCode,
    productName: row.productName,
    vendorName: row.vendorName,
    licenseModel: row.licenseModel,
    entitled: row.entitled,
    p95: row.metrics?.p95 ?? null,
    max: row.metrics?.max ?? null,
    utilizationPct: row.metrics?.utilizationPct ?? row.namedUser?.utilizationPct ?? null,
    annualCost: row.financial.currentAnnualCost,
    recommended: row.rightSizing?.recommended ?? null,
    opportunity: row.financial.optimizationOpportunity,
    incremental: row.financial.incrementalSpend,
    renewalDate: row.renewalDate,
    daysToRenewal: row.daysToRenewal,
    risk: row.risk,
    confidence: row.confidence.level,
    usageEvidence: row.usageEvidence,
  }));

  return (
    <div>
      <SectionHeading
        eyebrow="Portfolio"
        title="Every engineering software position"
        description={`${portfolio.length} features across ${totals.vendorCount} vendors, ${formatCurrency(totals.annualSpend)} committed annually. Sort, filter and drill into any position.`}
      />

      <PortfolioTable rows={rows} initialRisk={params.risk} />

      <MethodologyNote>
        Concurrent features are sized from P95 of daily peak demand over{' '}
        {options.periodKey === '12m' ? '12 months' : options.periodKey}; named-user features are sized from
        users active within {options.reclaimThresholdDays} days. Both apply a{' '}
        {((options.safetyFactor - 1) * 100).toFixed(0)}% buffer. Opportunity shown in green reduces spend;
        red indicates additional spend that demand supports.
      </MethodologyNote>
    </div>
  );
}
