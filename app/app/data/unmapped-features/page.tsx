import type { Metadata } from 'next';
import Link from 'next/link';
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
import { formatDate } from '@/lib/analytics/dates';
import { formatNumber } from '@/lib/analytics/financial';
import { loadWorkspace } from '@/lib/workspace';
import { featureHref } from '@/lib/routes';

export const metadata: Metadata = { title: 'Unmapped features' };

/**
 * Normalization queue.
 *
 * Unmapped raw feature strings are excluded from analytics rather than guessed
 * into a product. Excluding them understates demand — which is stated plainly
 * here, because the alternative (a silent wrong mapping) overstates it in a way
 * nobody can trace.
 */
export default async function UnmappedFeaturesPage() {
  const { dataset, portfolio } = await loadWorkspace();
  const open = dataset.unmappedFeatures.filter((feature) => feature.status === 'open');
  const totalOccurrences = open.reduce((acc, feature) => acc + feature.occurrences, 0);

  // Suggest a canonical feature by shared tokens with known feature codes.
  const candidates = portfolio.map((row) => ({
    featureId: row.featureId,
    label: `${row.productName} — ${row.featureName}`,
    tokens: new Set(
      `${row.featureCode} ${row.productName} ${row.featureName}`
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 3),
    ),
  }));

  const rows = open.map((feature) => {
    const tokens = feature.rawValue
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3);

    let best: { label: string; featureId: string; overlap: number } | null = null;
    for (const candidate of candidates) {
      const overlap = tokens.filter((token) => candidate.tokens.has(token)).length;
      if (overlap > 0 && (best === null || overlap > best.overlap)) {
        best = { label: candidate.label, featureId: candidate.featureId, overlap };
      }
    }

    return { feature, suggestion: best };
  });

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-1.5 text-[12px] text-fg-subtle">
        <Link href="/app/data" className="hover:text-fg">
          Data
        </Link>
        <span>/</span>
        <span>Unmapped features</span>
      </nav>

      <SectionHeading
        eyebrow="Normalization"
        title="License features with no product mapping"
        description="These raw strings appear in usage data but do not resolve to a known product, so their demand is currently excluded from the portfolio."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi label="Unmapped features" value={formatNumber(open.length)} tone="warning" />
        <Kpi label="Affected records" value={formatNumber(totalOccurrences)} detail="Excluded from demand analytics" />
        <Kpi
          label="With a suggestion"
          value={formatNumber(rows.filter((row) => row.suggestion !== null).length)}
          detail="Resembles an existing product"
        />
      </div>

      <Card>
        <CardHeader
          title="Mapping queue"
          description="Mapping these may increase measured demand, which can change a recommended quantity upward."
        />
        <TableShell>
          <thead>
            <tr>
              <Th>Raw feature string</Th>
              <Th align="right">Occurrences</Th>
              <Th>First seen</Th>
              <Th>Last seen</Th>
              <Th>Suggested product</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ feature, suggestion }) => (
              <tr key={feature.id} className="hover:bg-surface-2">
                <Td>
                  <code className="text-[12px] font-medium text-fg">{feature.rawValue}</code>
                </Td>
                <Td align="right">{formatNumber(feature.occurrences)}</Td>
                <Td className="whitespace-nowrap text-fg-muted">{formatDate(feature.firstSeen)}</Td>
                <Td className="whitespace-nowrap text-fg-muted">{formatDate(feature.lastSeen)}</Td>
                <Td>
                  {suggestion === null ? (
                    <span className="text-[12px] text-fg-subtle">No confident match</span>
                  ) : (
                    <Link
                      href={featureHref(suggestion.featureId)}
                      className="text-[12px] text-accent hover:underline"
                    >
                      {suggestion.label}
                    </Link>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </Card>

      <Card>
        <CardHeader
          title="The normalization hierarchy"
          description="Raw license-manager strings resolve upward into a structure the business recognizes."
        />
        <div className="es-scroll overflow-x-auto px-5 py-5">
          <ol className="flex min-w-[600px] items-center gap-2 text-[12.5px]">
            {['Vendor', 'Product family', 'Product', 'Feature', 'Raw alias'].map((level, index) => (
              <li key={level} className="flex items-center gap-2">
                {index > 0 && <span className="text-fg-subtle">→</span>}
                <span className="rounded-md border border-border px-3 py-1.5 font-medium text-fg-muted">
                  {level}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-[12.5px] leading-relaxed text-fg-muted">
            Many raw aliases can map to one feature. No vendor&rsquo;s hierarchy is hard-coded — vendors,
            families and products are data, so a new vendor needs no code change.
          </p>
        </div>
      </Card>

      <MethodologyNote>
        Unmapped features are excluded from demand rather than guessed into a product. Exclusion
        understates demand, which is the safer error: it can only lead to recommending too few licenses,
        which surfaces immediately as saturation or denials. A silent wrong mapping overstates demand and
        nobody ever finds it.
      </MethodologyNote>
    </div>
  );
}
