import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  EmptyFileError,
  MAX_UPLOAD_BYTES,
  SOURCE_SYSTEMS,
  UnsupportedFileError,
  hasAcceptedExtension,
  ingestFile,
} from '@/lib/ingestion';
import { resolveIngestionContext } from '@/lib/ingestion/session';
import { getIngestionStore } from '@/lib/ingestion/store';
import { DuplicateImportError } from '@/lib/ingestion/store/types';
import { fingerprintImport } from '@/lib/ingestion/fingerprint';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Commit an import.
 *
 * The file is re-parsed and re-normalized here rather than trusting records
 * posted by the client. That costs a second parse and is worth it: accepting
 * client-supplied canonical rows would let a caller write arbitrary numbers
 * into the analytical record, which is precisely the data a purchasing
 * decision rests on.
 *
 * The confirmed mapping IS taken from the client — that is the reviewer's
 * decision, and it is re-validated by the same pipeline either way.
 *
 * Success is reported only after persistence returns. A failed write removes
 * the import and everything it created rather than leaving a partial dataset.
 */

const requestSchema = z.object({
  dataset: z.enum(['usage', 'entitlements', 'people', 'contracts']),
  forceSource: z.enum(SOURCE_SYSTEMS as [string, ...string[]]).optional(),
  mappingOverrides: z.record(z.string(), z.string()).optional(),
  sheetName: z.string().optional(),
  dayFirst: z.boolean().optional(),
});

export async function POST(request: Request) {
  const auth = await resolveIngestionContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

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
      { error: 'Unsupported file type. Upload a CSV, TSV, XLSX or XLSM export.' },
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

  const importId = crypto.randomUUID();
  // Read once: the bytes are needed for both parsing and fingerprinting.
  const fileBytes = await file.arrayBuffer();

  let analysis;
  try {
    analysis = await ingestFile(fileBytes, {
      dataset: body.data.dataset,
      organizationId: auth.context.organizationId,
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
    // The cause is logged server-side and never returned: a parser stack trace
    // tells an attacker about the runtime, but without it a production-only
    // parse failure is undiagnosable from the outside.
    console.error('[ingestion] parse failed', {
      fileName: file.name,
      bytes: file.size,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack?.slice(0, 800) : undefined,
    });
    return NextResponse.json(
      { error: 'The file could not be read. Check that it is a valid CSV, TSV or XLSX export.' },
      { status: 422 },
    );
  }

  if (analysis.missingRequired.length > 0) {
    return NextResponse.json(
      {
        error: `Cannot import until every required field is mapped: ${analysis.missingRequired.join(', ')}.`,
        missingRequired: analysis.missingRequired,
      },
      { status: 422 },
    );
  }

  if (analysis.result.acceptedRows === 0) {
    return NextResponse.json(
      {
        error: 'No rows passed validation, so there is nothing to import.',
        rejectionSummary: analysis.result.rejectionSummary,
      },
      { status: 422 },
    );
  }

  const mappingUsed: Record<string, string> = {};
  for (const mapping of analysis.mappings) {
    if (mapping.field !== null) mappingUsed[mapping.sourceColumn] = mapping.field;
  }

  // Identical content, dataset and mapping must not be committed twice: two
  // commits of one file double every observation, raising P95 and the
  // recommended quantity silently.
  const contentFingerprint = await fingerprintImport(fileBytes, body.data.dataset, mappingUsed);

  let summary;
  try {
    summary = await getIngestionStore().commitImport({
      contentFingerprint,
      organizationId: auth.context.organizationId,
      importId,
      fileName: file.name,
      fileBytes: file.size,
      dataset: body.data.dataset,
      detectionEvidence: analysis.detection.evidence,
      detectionConfidence: analysis.detection.confidence,
      detectionFellBack: analysis.detection.fellBack,
      sourceSheets: analysis.sheetNames,
      mappingUsed,
      result: analysis.result,
    });
  } catch (error) {
    if (error instanceof DuplicateImportError) {
      return NextResponse.json(
        {
          error:
            'This file has already been imported with the same mapping. Importing it again would double-count the same demand.',
          duplicate: true,
          existingImportId: error.existingImportId,
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? `The import could not be stored: ${error.message}`
            : 'The import could not be stored.',
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    import: summary,
    detection: {
      source: analysis.detection.source,
      name: analysis.detection.name,
      confidence: analysis.detection.confidence,
      evidence: analysis.detection.evidence,
      fellBack: analysis.detection.fellBack,
    },
    quality: analysis.result.quality,
    warnings: analysis.result.warnings,
  });
}
