import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { CONNECTOR_SAMPLES, connectorSample } from '@/lib/connectors/samples';

export const runtime = 'nodejs';

/**
 * Download a native-format sample export for one connector.
 *
 * The samples themselves live in lib/connectors/samples.ts rather than here:
 * a Next.js route module may only export route handlers and a small set of
 * config values, so data that also needs to be reachable from a test has to
 * live outside it. That is a better home for it anyway.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ connector: string }> },
) {
  // Authenticated like every other endpoint. These files contain nothing
  // sensitive, but an unauthenticated download endpoint is a surface with no
  // reason to exist.
  await requireSession();

  const { connector } = await context.params;
  const sample = connectorSample(connector);

  if (sample === undefined) {
    return NextResponse.json(
      { error: `No sample export for "${connector}".`, available: Object.keys(CONNECTOR_SAMPLES) },
      { status: 404 },
    );
  }

  return new NextResponse(sample.csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${sample.fileName}"`,
      'Cache-Control': 'no-store',
    },
  });
}
