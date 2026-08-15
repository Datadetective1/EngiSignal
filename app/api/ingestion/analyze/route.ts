import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { getDataProvider } from '@/lib/data';
import {
  EmptyFileError,
  MAX_UPLOAD_BYTES,
  SOURCE_SYSTEMS,
  UnsupportedFileError,
  hasAcceptedExtension,
  ingestFile,
} from '@/lib/ingestion';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Engineering-license ingestion analysis.
 *
 * Analysis only: this endpoint detects the source, proposes a mapping and
 * reports what would be accepted or rejected. It does NOT write records. The
 * mapping is reviewed by a human first, because a wrong mapping produces a
 * wrong purchasing recommendation.
 *
 * SECURITY
 *  - Authenticated, and the tenant is resolved server-side from the caller's
 *    own memberships rather than read from the request body, so a caller
 *    cannot stamp another organization's id onto records by editing the form.
 *  - The upload is validated by parsing its bytes. Extension and client-supplied
 *    content type are hints only.
 *  - The raw file is never persisted here; it lives in memory for the request
 *    and is discarded when the response is written.
 */

const requestSchema = z.object({
  dataset: z.enum(['usage', 'entitlements', 'people']),
  forceSource: z.enum(SOURCE_SYSTEMS as [string, ...string[]]).optional(),
  mappingOverrides: z.record(z.string(), z.string()).optional(),
  sheetName: z.string().optional(),
  dayFirst: z.boolean().optional(),
});

/** Rejection detail returned to the client. The counts are always exact. */
const MAX_REJECTIONS_RETURNED = 50;

export async function POST(request: Request) {
  const session = await getSession();
  if (session === null) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected a multipart form upload.' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file was provided.' }, { status: 400 });
  }

  if (!hasAcceptedExtension(file.name)) {
    return NextResponse.json(
      { error: 'Unsupported file type. Upload a CSV, TSV or XLSX export.' },
      { status: 415 },
    );
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      {
        error: `File is ${(file.size / 1_048_576).toFixed(1)} MB, above the ${(MAX_UPLOAD_BYTES / 1_048_576).toFixed(0)} MB limit. Split the export by date range.`,
      },
      { status: 413 },
    );
  }

  const rawOverrides = form.get('mappingOverrides');
  let parsedOverrides: unknown;
  if (typeof rawOverrides === 'string' && rawOverrides.length > 0) {
    try {
      parsedOverrides = JSON.parse(rawOverrides);
    } catch {
      return NextResponse.json({ error: 'Mapping overrides are not valid JSON.' }, { status: 400 });
    }
  }

  const body = requestSchema.safeParse({
    dataset: form.get('dataset') ?? 'usage',
    forceSource: form.get('forceSource') ?? undefined,
    mappingOverrides: parsedOverrides,
    sheetName: form.get('sheetName') ?? undefined,
    dayFirst: form.get('dayFirst') === 'true' ? true : undefined,
  });

  if (!body.success) {
    return NextResponse.json({ error: 'Invalid ingestion request.' }, { status: 400 });
  }

  // Tenant is derived from the caller's own memberships. The client never
  // supplies an organization id, so it cannot address another tenant.
  const organizations = await getDataProvider().listOrganizations(session.userId);
  const organization = organizations[0];
  if (organization === undefined) {
    return NextResponse.json({ error: 'No organization is available for this account.' }, { status: 403 });
  }

  const importId = crypto.randomUUID();

  let analysis;
  try {
    analysis = await ingestFile(await file.arrayBuffer(), {
      dataset: body.data.dataset,
      organizationId: organization.id,
      importId,
      fileName: file.name,
      forceSource: body.data.forceSource as never,
      mappingOverrides: body.data.mappingOverrides,
      sheetName: body.data.sheetName,
      dayFirst: body.data.dayFirst,
    });
  } catch (error) {
    if (error instanceof EmptyFileError || error instanceof UnsupportedFileError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    return NextResponse.json(
      { error: 'The file could not be read. Check that it is a valid CSV, TSV or XLSX export.' },
      { status: 422 },
    );
  }

  const { detection, mappings, missingRequired, sheetNames, previewRows, result } = analysis;

  return NextResponse.json({
    importId,
    fileName: file.name,
    fileBytes: file.size,
    dataset: result.dataset,
    detection: {
      source: detection.source,
      name: detection.name,
      confidence: detection.confidence,
      evidence: detection.evidence,
      fellBack: detection.fellBack,
    },
    sheetNames,
    mappings,
    missingRequired,
    preview: previewRows,
    summary: {
      totalRows: result.totalRows,
      acceptedRows: result.acceptedRows,
      rejectedRows: result.rejectedRows,
      duplicateRows: result.duplicateRows,
    },
    rejectionSummary: result.rejectionSummary,
    rejections: result.rejections.slice(0, MAX_REJECTIONS_RETURNED),
    warnings: result.warnings,
    quality: result.quality,
  });
}
