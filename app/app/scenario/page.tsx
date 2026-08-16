import type { Metadata } from 'next';
import { ScenarioLab, type ScenarioFeature } from '@/components/app/scenario-lab';
import { SectionHeading } from '@/components/ui/primitives';
import { buildWindow } from '@/lib/analytics/dates';
import { dailySeriesForFeature } from '@/lib/analytics/concurrent';
import { loadWorkspace } from '@/lib/workspace';
import { AnalyticsWithheld } from '@/components/app/data-integrity';
import { analyticsAvailable } from '@/lib/analytics/integrity';

export const metadata: Metadata = { title: 'Scenario Lab' };

export default async function ScenarioPage({
  searchParams,
}: {
  searchParams: Promise<{ feature?: string }>;
}) {
  const { integrity, dataset, portfolio } = await loadWorkspace();
  // Every figure below is computed from usage. When the analysis did not
  // read all of it, there is no honest version of this page.
  if (!analyticsAvailable(integrity)) return <AnalyticsWithheld integrity={integrity} />;

  const params = await searchParams;

  // Two years of daily peaks, so the client can re-slice any period locally
  // and recalculate without a network round trip.
  const fullWindow = buildWindow(dataset.asOf, '24m');

  const features: ScenarioFeature[] = portfolio
    .filter((row) => row.licenseModel !== 'token')
    .map((row) => {
      const series =
        row.metrics === null ? [] : dailySeriesForFeature(dataset.dailyUsage, row.featureId, fullWindow);

      return {
        featureId: row.featureId,
        featureName: row.featureName,
        productName: row.productName,
        vendorName: row.vendorName,
        kind: row.metrics !== null ? 'concurrent' : row.namedUser !== null ? 'named' : 'other',
        entitled: row.entitled,
        unitPrice: row.unitPrice,
        peaks: series.map((d) => d.peak),
        dates: series.map((d) => d.date),
        activeUsers: row.namedUser?.activeUsers ?? null,
        renewalDays: row.daysToRenewal,
      };
    });

  return (
    <div>
      <SectionHeading
        eyebrow="Scenario Lab"
        title="Change an assumption, see the consequence"
        description="Every control here feeds the same deterministic engine that produces the recommendations elsewhere in EngiSignal. Nothing is approximated for speed."
      />

      <ScenarioLab features={features} initialFeatureId={params.feature} />
    </div>
  );
}
