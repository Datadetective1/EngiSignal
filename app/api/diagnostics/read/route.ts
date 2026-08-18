import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { getDataProvider } from '@/lib/data';
import { shortEvidenceKey } from '@/lib/analytics/projection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Same reason as the app segment: the integrity counts degrade while rows are
// being written, and the platform default would cut the read off mid-import.
export const maxDuration = 60;

/**
 * ── WHAT IS HAPPENING TO MY DATA ────────────────────────────────────────────
 *
 * Phase 2E added this to find out where a page's time went, after two rounds of
 * changes had guessed wrong. Phase 2F made the analysis asynchronous, which
 * means there is now a second question a customer and an engineer both need
 * answered without a database console: not just how long a read took, but
 * whether the thing being read is finished.
 *
 * It answers, for the caller's own tenant:
 *
 *   what is building            projection.buildingEvidenceKey, state
 *   which evidence version      projection.evidenceKey vs currentEvidenceKey
 *   when it began / finished    buildStartedAt, buildFinishedAt
 *   how many rows accepted      rows.accepted
 *   how many analysed           rows.analyzed
 *   which projection is shown   projection.source and version
 *   did the last build fail     projection.state, projection.buildError
 *
 * Authenticated and tenant-scoped like any other read. It exposes timings,
 * counts, state and shape — never estate content.
 */
export async function GET() {
  const startedAt = Date.now();

  const session = await requireSession();
  const sessionMs = Date.now() - startedAt;

  const provider = getDataProvider();

  const orgStart = Date.now();
  const organizations = await provider.listOrganizations(session.userId);
  const organization = organizations[0];
  const organizationMs = Date.now() - orgStart;

  if (organization === undefined) {
    return NextResponse.json(
      { error: 'No organization for this session.' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const loadStart = Date.now();
  const { dataset, projection, storedRows, acceptedRows } =
    await provider.getDatasetWithProjection(organization.id);
  const loadMs = Date.now() - loadStart;

  const analyzed = dataset?.analyzedRows ?? null;

  return NextResponse.json(
    {
      organization: { id: organization.id, name: organization.name },
      timings: {
        session: sessionMs,
        organization: organizationMs,
        datasetLoad: loadMs,
        total: Date.now() - startedAt,
      },
      rows: {
        stored: storedRows,
        accepted: acceptedRows,
        analyzed,
        // The comparison that decides whether any figure may be shown at all.
        // Unknown rather than false when there is no analysis yet: "we have not
        // finished" and "the numbers disagree" are different answers.
        reconciles:
          analyzed === null
            ? null
            : storedRows.usage === analyzed.usage &&
              storedRows.people === analyzed.people &&
              storedRows.entitlements === analyzed.entitlements &&
              storedRows.contracts === analyzed.contracts,
      },
      projection: {
        source: projection.source,
        state: projection.state,
        version: projection.version,
        analyticsCurrent: projection.analyticsCurrent,
        stale: projection.stale,
        computedAt: projection.computedAt,
        buildMs: projection.buildMs,
        buildPhases: projection.buildPhases,
        payloadBytes: projection.payloadBytes,
        evidenceKey: projection.evidenceKey === null ? null : shortEvidenceKey(projection.evidenceKey),
        currentEvidenceKey: shortEvidenceKey(projection.currentEvidenceKey),
        buildingEvidenceKey:
          projection.buildingEvidenceKey === null
            ? null
            : shortEvidenceKey(projection.buildingEvidenceKey),
        buildStartedAt: projection.buildStartedAt,
        buildFinishedAt: projection.buildFinishedAt,
        buildAttempt: projection.buildAttempt,
        buildError: projection.buildError,
        startedBecause: projection.startedBecause,
      },
      shape:
        dataset === null
          ? null
          : {
              features: dataset.features.length,
              dailyUsage: dataset.dailyUsage.length,
              hourlyUsage: dataset.hourlyUsage.length,
              activities: dataset.activities.length,
              employees: dataset.employees.length,
            },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
