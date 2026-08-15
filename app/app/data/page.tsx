import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Badge,
  Card,
  CardHeader,
  Kpi,
  LinkButton,
  MethodologyNote,
  SectionHeading,
  TableShell,
  Td,
  Th,
} from '@/components/ui/primitives';
import { ImportInventory } from '@/components/app/import-inventory';
import { formatDate } from '@/lib/analytics/dates';
import { formatNumber, formatPercent } from '@/lib/analytics/financial';
import { CONNECTORS } from '@/lib/connectors';
import { IMPORT_KINDS, IMPORT_SCHEMAS } from '@/lib/import/schema';
import { getIngestionStore, isEphemeralStore, isServerlessEphemeral } from '@/lib/ingestion/store';
import { capabilityLines, coverageLines, qualityBand } from '@/lib/ingestion/capabilities';
import { loadWorkspace } from '@/lib/workspace';

export const metadata: Metadata = { title: 'Data' };

export default async function DataPage() {
  const { dataset, dataQuality, confidence, organization } = await loadWorkspace();

  // Read directly rather than through the HTTP endpoint: this is a server
  // component, and the store is already tenant-scoped by argument.
  const store = getIngestionStore();
  const [ingestedImports, ingestedCoverage, ingestedUsage] = await Promise.all([
    store.listImports(organization.id),
    store.getCoverage(organization.id),
    store.listUsage(organization.id),
  ]);

  // Capability gating runs against what is actually stored, never a fixed list.
  const capabilityInput = {
    coverage: ingestedCoverage,
    distinctDates: new Set(ingestedUsage.map((row) => row.date)).size,
    // A licence export never carries price, so cost is only present once a
    // contract import supplies it.
    hasCost: dataset.contractItems.some((item) => item.unitPrice !== null),
    resolvedPeople: ingestedCoverage.peopleRecords,
    // Reclaim is only meaningful where a seat belongs to a person. Reading this
    // from the resolved features rather than assuming it keeps the capability
    // withheld for a purely concurrent estate, where "inactive seat" has no
    // meaning and a reclaim recommendation would be nonsense.
    hasNamedUserLicensing: dataset.features.some((feature) => feature.licenseModel === 'named_user'),
  };

  const totalRows = dataset.imports.reduce((acc, record) => acc + record.rowCount, 0);
  const rejectedRows = dataset.imports.reduce((acc, record) => acc + record.rejectedRows, 0);
  const openUnmatched = dataset.unmatchedUsers.filter((u) => u.status === 'open').length;
  const openUnmapped = dataset.unmappedFeatures.filter((f) => f.status === 'open').length;

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Data"
        title="What EngiSignal knows, and how well it knows it"
        description="Sources, imports, mappings and the specific data conditions limiting confidence in the recommendations."
        action={
          <LinkButton href="/app/data/import" variant="primary">
            Import data
          </LinkButton>
        }
      />

      <ImportInventory
        imports={ingestedImports}
        coverage={ingestedCoverage}
        coverageLines={coverageLines(capabilityInput)}
        capabilityLines={capabilityLines(capabilityInput)}
        quality={qualityBand(capabilityInput)}
        ephemeral={isEphemeralStore()}
        serverless={isServerlessEphemeral()}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Portfolio confidence"
          value={`${confidence.score}`}
          tone={confidence.level === 'High' ? 'positive' : confidence.level === 'Medium' ? 'warning' : 'danger'}
          detail={`${confidence.level} confidence across analyzed features`}
        />
        <Kpi
          label="Employee mapping"
          value={formatPercent(dataset.employeeMappingRate * 100, 0)}
          detail={`${openUnmatched} usernames unresolved`}
          href="/app/data/unmatched-users"
        />
        <Kpi
          label="Feature mapping"
          value={formatPercent(dataset.featureMappingRate * 100, 0)}
          detail={`${openUnmapped} raw features unmapped`}
          href="/app/data/unmapped-features"
        />
        <Kpi
          label="Rows imported"
          value={formatNumber(totalRows)}
          detail={`${formatNumber(rejectedRows)} rejected on validation`}
        />
      </div>

      {/* ── Data quality ────────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Data quality"
          description="Each condition below has a measurable effect on the confidence attached to recommendations."
        />
        {dataQuality.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13px] text-fg-muted">No outstanding data conditions.</p>
        ) : (
          <ul className="divide-y divide-border">
            {dataQuality.map((issue) => (
              <li key={issue.id} className="flex flex-wrap items-center gap-4 px-5 py-3.5">
                <span
                  className={`mt-0.5 size-2 shrink-0 rounded-full ${
                    issue.severity === 'critical'
                      ? 'bg-danger'
                      : issue.severity === 'warning'
                        ? 'bg-warning'
                        : 'bg-fg-subtle'
                  }`}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-fg">{issue.title}</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-fg-muted">{issue.detail}</p>
                </div>
                <Badge tone={issue.severity === 'critical' ? 'danger' : issue.severity === 'warning' ? 'warning' : 'neutral'}>
                  {issue.category}
                </Badge>
                {issue.href !== null && (
                  <Link
                    href={issue.href}
                    className="text-[12.5px] font-medium text-accent underline-offset-4 hover:underline"
                  >
                    Resolve
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ── Import history ────────────────────────────────────────────── */}
        <Card>
          <CardHeader title="Import history" description="Every import is auditable, including what was rejected." />
          <TableShell className="min-w-0">
            <thead>
              <tr>
                <Th>File</Th>
                <Th>Type</Th>
                <Th align="right">Rows</Th>
                <Th align="right">Rejected</Th>
                <Th>Imported</Th>
              </tr>
            </thead>
            <tbody>
              {dataset.imports.map((record) => (
                <tr key={record.id}>
                  <Td>
                    <span className="block truncate text-[12px] font-medium">{record.fileName}</span>
                    {record.notes !== null && (
                      <span className="block truncate text-[11px] text-warning">{record.notes}</span>
                    )}
                  </Td>
                  <Td>
                    <Badge>{IMPORT_SCHEMAS[record.kind].label}</Badge>
                  </Td>
                  <Td align="right">{formatNumber(record.rowCount)}</Td>
                  <Td align="right" className={record.rejectedRows > 0 ? 'text-warning' : 'text-fg-muted'}>
                    {formatNumber(record.rejectedRows)}
                  </Td>
                  <Td className="whitespace-nowrap text-fg-muted">
                    {formatDate(record.createdAt.slice(0, 10))}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </Card>

        {/* ── Saved mappings ────────────────────────────────────────────── */}
        <Card>
          <CardHeader
            title="Saved field mappings"
            description="Reused automatically on the next import from the same source."
          />
          <ul className="divide-y divide-border">
            {dataset.importMappings.map((mapping) => (
              <li key={mapping.id} className="px-5 py-3.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-[13px] font-medium text-fg">{mapping.name}</p>
                  <span className="tnum text-[11.5px] text-fg-subtle">
                    used {mapping.useCount}× · {Object.keys(mapping.fields).length} fields
                  </span>
                </div>
                <p className="mt-1.5 truncate text-[11.5px] text-fg-subtle">
                  {Object.entries(mapping.fields)
                    .slice(0, 4)
                    .map(([source, target]) => `${source} → ${target}`)
                    .join(' · ')}
                  {Object.keys(mapping.fields).length > 4 && ' …'}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* ── Templates ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Import templates"
          description="Starting points, not requirements — EngiSignal maps whatever column names your export already uses."
        />
        <div className="grid gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
          {IMPORT_KINDS.map((kind) => (
            <a
              key={kind}
              href={`/api/templates/${kind}`}
              className="rounded-md border border-border px-4 py-3 transition-colors hover:border-border-strong hover:bg-surface-2"
            >
              <p className="text-[12.5px] font-medium text-fg">{IMPORT_SCHEMAS[kind].label}</p>
              <p className="mt-0.5 text-[11.5px] leading-snug text-fg-muted">
                {IMPORT_SCHEMAS[kind].description}
              </p>
              <p className="mt-1.5 text-[11px] font-medium text-accent">Download CSV template</p>
            </a>
          ))}
        </div>
      </Card>

      {/* ── Connectors ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="License manager connectors"
          description="Planned direct collection. None is implemented in this release, and EngiSignal will not show one as connected until it is."
        />
        <TableShell>
          <thead>
            <tr>
              <Th>Connector</Th>
              <Th>Source</Th>
              <Th>Resolution</Th>
              <Th>Denials</Th>
              <Th>Tokens</Th>
              <Th>Status</Th>
              <Th>Implementation note</Th>
            </tr>
          </thead>
          <tbody>
            {CONNECTORS.map((connector) => (
              <tr key={connector.id}>
                <Td className="font-medium">{connector.name}</Td>
                <Td className="text-fg-muted">{connector.sourceDescription}</Td>
                <Td className="text-fg-muted">{connector.resolution}</Td>
                <Td className="text-fg-muted">{connector.supportsDenials ? 'Yes' : 'No'}</Td>
                <Td className="text-fg-muted">{connector.supportsTokens ? 'Yes' : 'No'}</Td>
                <Td>
                  <Badge>{connector.available ? 'Available' : 'Not implemented'}</Badge>
                </Td>
                <Td className="max-w-[300px] text-[11.5px] text-fg-subtle">{connector.notes}</Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </Card>

      <MethodologyNote>
        Confidence is not a badge applied by hand — it is computed from observation period, missing days,
        price availability, employee and feature mapping rates, and denial visibility. Improving any of the
        conditions above raises it measurably.
      </MethodologyNote>
    </div>
  );
}
