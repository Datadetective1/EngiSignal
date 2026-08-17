import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { getDataProvider } from '@/lib/data';
import { shortEvidenceKey } from '@/lib/analytics/projection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * ── WHERE A PAGE'S TIME ACTUALLY GOES ───────────────────────────────────────
 *
 * Phase 2E cut the analytical read from 6.9 seconds to about 1.9, and then
 * spent two rounds of changes guessing at the remainder before admitting that
 * guessing is not measuring. Every authenticated page cost the same regardless
 * of what it rendered, which meant the time was in the shared path — and
 * nothing in production could say which part of it.
 *
 * This endpoint runs the same load an analytical page runs, with a clock around
 * each stage, and reports the answer for the caller's own tenant. It is the
 * observability the phase's own requirements asked for: the stored row count,
 * the analysed row count, and the projection source and version, from
 * production, without a database console.
 *
 * Authenticated and tenant-scoped like any other read: it resolves the session
 * and reports only on the organization that session belongs to. It exposes
 * timings and counts, never estate content.
 */
export async function GET() {
  const startedAt = Date.now();

  await requireSession();
  const sessionMs = Date.now() - startedAt;

  const provider = getDataProvider();

  const orgStart = Date.now();
  const organizations = await provider.listOrganizations((await requireSession()).userId);
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

  return NextResponse.json(
    {
      organization: { id: organization.id, name: organization.name },
      timings: {
        session: sessionMs,
        organization: organizationMs,
        // Fetching the read context and either inflating the projection or
        // rebuilding it from canonical rows.
        datasetLoad: loadMs,
        total: Date.now() - startedAt,
      },
      rows: {
        stored: storedRows,
        accepted: acceptedRows,
        analyzed: dataset.analyzedRows,
        // The comparison that decides whether any figure may be shown at all.
        reconciles:
          storedRows.usage === dataset.analyzedRows.usage &&
          storedRows.people === dataset.analyzedRows.people &&
          storedRows.entitlements === dataset.analyzedRows.entitlements &&
          storedRows.contracts === dataset.analyzedRows.contracts,
      },
      projection: {
        source: projection.source,
        version: projection.version,
        computedAt: projection.computedAt,
        buildMs: projection.buildMs,
        rebuiltBecause: projection.rebuiltBecause,
        payloadBytes: projection.payloadBytes,
        evidenceKey: shortEvidenceKey(projection.evidenceKey),
      },
      shape: {
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
