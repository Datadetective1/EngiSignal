import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveIngestionContext } from '@/lib/ingestion/session';
import { capabilityLines, unlockSuggestions } from '@/lib/ingestion/capabilities';
import { summarizeCoverage } from '@/lib/ingestion/store';
import {
  EmptyFileError,
  FIELDS_BY_DATASET,
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
  dataset: z.enum(['usage', 'entitlements', 'people', 'contracts']),
  forceSource: z.enum(SOURCE_SYSTEMS as [string, ...string[]]).optional(),
  mappingOverrides: z.record(z.string(), z.string()).optional(),
  sheetName: z.string().optional(),
  dayFirst: z.boolean().optional(),
});

/** Rejection detail returned to the client. The counts are always exact. */
const MAX_REJECTIONS_RETURNED = 50;

/** Rows shown in the normalized preview table. */
const PREVIEW_ROWS = 10;

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

  const importId = crypto.randomUUID();

  let analysis;
  try {
    analysis = await ingestFile(await file.arrayBuffer(), {
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

  const { detection, mappings, missingRequired, sheetNames, previewRows, result } = analysis;

  // What this file alone would support. Computed from the records that would
  // actually be written, so the customer sees the consequences of the mapping
  // they are about to confirm rather than a generic promise.
  const coverage = summarizeCoverage(result.usage, result.entitlements, result.people, result.contracts);
  // The same matrix the Data page and the analytics layer use.
  const capabilityInput = {
    coverage,
    distinctDates: new Set(result.usage.map((record) => record.date)).size,
    // Cost is derived from this file's own records rather than asserted:
    // `availableInputs` reads `pricedContractRecords` from the coverage above,
    // so a commercial file that priced nothing correctly leaves the financial
    // capability locked even though it is a contracts import.
    hasCost: false,
    resolvedPeople: result.people.length,
    hasNamedUserLicensing:
      result.entitlements.some((record) => record.licenseModel === 'named_user') ||
      result.contracts.some((record) => record.licenseModel === 'named_user'),
  };
  const capabilities = capabilityLines(capabilityInput);
  const unlocks = unlockSuggestions(capabilityInput);

  /** Normalized records, not the source spreadsheet. */
  const normalizedPreview =
    result.dataset === 'usage'
      ? result.usage.slice(0, PREVIEW_ROWS).map((record) => ({
          date: record.date,
          hour: record.hour,
          observedAt: record.observedAt,
          user: record.user,
          feature: record.feature,
          product: record.product,
          vendor: record.vendor,
          quantity: record.quantity,
          concurrent: record.concurrent,
          peak: record.peak,
          licenseServer: record.licenseServer,
          tokens: record.tokens,
          denied: record.denied,
          source: record.provenance.sourceSystem,
          sourceRow: record.provenance.sourceRow,
        }))
      : result.dataset === 'entitlements'
        ? result.entitlements.slice(0, PREVIEW_ROWS).map((record) => ({
            feature: record.feature,
            product: record.product,
            vendor: record.vendor,
            entitledQuantity: record.entitledQuantity,
            licenseModel: record.licenseModel,
            licenseServer: record.licenseServer,
            expiresOn: record.expiresOn,
            source: record.provenance.sourceSystem,
            sourceRow: record.provenance.sourceRow,
          }))
        : result.dataset === 'contracts'
          ? result.contracts.slice(0, PREVIEW_ROWS).map((record) => ({
              feature: record.feature,
              product: record.product,
              vendor: record.vendor,
              sku: record.sku,
              quantity: record.quantity,
              unitPrice: record.unitPrice,
              annualCost: record.annualCost,
              currency: record.currency,
              // The derivation travels with the figure so a reviewer can see
              // that a unit price was computed rather than stated, before they
              // commit the import that will price their renewal position.
              unitPriceBasis: record.unitPriceBasis,
              renewalDate: record.renewalDate,
              contractNumber: record.contractNumber,
              licenseModel: record.licenseModel,
              source: record.provenance.sourceSystem,
              sourceRow: record.provenance.sourceRow,
            }))
          : result.people.slice(0, PREVIEW_ROWS).map((record) => ({
              user: record.user,
              employeeCode: record.employeeCode,
              displayName: record.displayName,
              email: record.email,
              source: record.provenance.sourceSystem,
              sourceRow: record.provenance.sourceRow,
            }));

  return NextResponse.json({
    normalizedPreview,
    coverage,
    capabilities,
    unlocks,
    /** Every canonical field, so a reviewer can reassign any column. */
    fields: FIELDS_BY_DATASET[result.dataset].map((spec) => ({
      key: spec.key,
      label: spec.label,
      type: spec.type,
      required: spec.required,
      description: spec.description,
    })),
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
