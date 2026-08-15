/**
 * Ingestion entry point.
 *
 * PHASE 1 SCOPE — file-based ingestion only.
 *
 * EngiSignal reads exports a customer already has: FlexNet, RLM, DSLS, Sentinel
 * and generic tabular files. It does not connect to a license server, poll a
 * daemon, or synchronize on a schedule, and nothing in this module should ever
 * be described as if it does.
 *
 * The pipeline is: parse → detect → resolve columns → normalize → report.
 * Detection and resolution are both advisory — a human confirms the mapping
 * before anything is committed, because a wrong mapping produces a wrong
 * purchasing recommendation.
 */

import type {
  CanonicalDataset,
  CanonicalRecord,
  IngestionResult,
  IngestionWarning,
  Provenance,
  RejectedRow,
  SourceSystem,
} from './canonical/types';
import { buildQualityReport } from './canonical/quality';
import { getAdapter } from './adapters/registry';
import { FIELDS_BY_DATASET } from './adapters/fields';
import { missingRequiredFields, resolveColumns, type ColumnMapping } from './adapters/resolve';
import type { CanonicalFieldKey } from './adapters/types';
import { buildDetectionContext, detectSource, type DetectionResult } from './detect';
import { normalizeRows, summarizeRejections, type NormalizeOptions } from './normalize';
import { parseIngestionFile, type ParsedFile } from './parse';

export * from './canonical/types';
export { ADAPTERS, ADAPTER_LIST, getAdapter } from './adapters/registry';
export { FIELDS_BY_DATASET } from './adapters/fields';
export { resolveColumns, normalizeHeader, type ColumnMapping } from './adapters/resolve';
export { detectSource, buildDetectionContext, MIN_CONFIDENCE, type DetectionResult } from './detect';
export {
  parseIngestionFile,
  parseDelimited,
  parseWorkbook,
  decodeText,
  sniffDelimiter,
  hasAcceptedExtension,
  EmptyFileError,
  UnsupportedFileError,
  MAX_UPLOAD_BYTES,
  MAX_INGEST_ROWS,
  type ParsedFile,
} from './parse';
export { normalizeRows, summarizeRejections } from './normalize';

export interface IngestOptions extends NormalizeOptions {
  dataset: CanonicalDataset;
  /** Tenant the records belong to. Written onto every record's provenance. */
  organizationId: string;
  importId: string;
  fileName: string;
  /** ISO timestamp; defaults to now. */
  importedAt?: string;
  /** Force an adapter instead of using detection. */
  forceSource?: SourceSystem;
  /** sourceColumn → canonical field, or '' to unmap. Applied per sheet. */
  mappingOverrides?: Record<string, string>;
  /** Restrict ingestion to one worksheet. */
  sheetName?: string;
}

export interface IngestionAnalysis {
  detection: DetectionResult;
  /** Mapping review rows: source column → field → confidence → sample. */
  mappings: ColumnMapping[];
  missingRequired: string[];
  sheetNames: string[];
  headers: string[];
  previewRows: Record<string, unknown>[];
  result: IngestionResult;
}

const PREVIEW_ROWS = 8;

/**
 * Analyze and normalize a parsed file.
 *
 * Separated from `ingestFile` so the same logic can be exercised in tests
 * without constructing a File or touching the filesystem.
 */
export function ingestParsedFile(parsed: ParsedFile, options: IngestOptions): IngestionAnalysis {
  const {
    dataset,
    organizationId,
    importId,
    fileName,
    importedAt = new Date().toISOString(),
    forceSource,
    mappingOverrides,
    sheetName,
    ...normalizeOptions
  } = options;

  const warnings: IngestionWarning[] = [...parsed.warnings];

  const sheets = sheetName === undefined
    ? parsed.sheets
    : parsed.sheets.filter((sheet) => sheet.name === sheetName);

  if (sheetName !== undefined && sheets.length === 0) {
    warnings.push({
      code: 'sheet_skipped',
      message: `No worksheet named "${sheetName}" was found.`,
      detail: `Available sheets: ${parsed.sheetNames.join(', ') || 'none'}.`,
    });
  }

  // Detection reads the whole file, not one sheet, so a workbook whose product
  // identity lives in a second sheet's headers is still recognized.
  const detectionContext = buildDetectionContext({
    headers: sheets.flatMap((sheet) => sheet.headers),
    rows: sheets.flatMap((sheet) => sheet.rows.slice(0, 25)),
    sheetNames: parsed.sheetNames,
    fileName,
  });

  const detection: DetectionResult =
    forceSource === undefined
      ? detectSource(detectionContext)
      : {
          source: forceSource,
          name: getAdapter(forceSource).name,
          confidence: 100,
          evidence: ['Source was selected manually rather than detected'],
          fellBack: false,
          candidates: [],
        };

  if (detection.fellBack) {
    warnings.push({
      code: 'low_detection_confidence',
      message: 'The license-management system could not be identified with confidence.',
      detail: 'Generic mapping was used. Review the column mapping before importing.',
    });
  }

  const adapter = getAdapter(detection.source);

  const allMappings: ColumnMapping[] = [];
  const usage: IngestionResult['usage'] = [];
  const entitlements: IngestionResult['entitlements'] = [];
  const people: IngestionResult['people'] = [];
  const rejections: RejectedRow[] = [];

  let totalRows = 0;
  let accepted = 0;
  let rejected = 0;
  let duplicates = 0;

  const provenanceBase: Omit<Provenance, 'sourceRow' | 'sourceSheet'> = {
    organizationId,
    importId,
    importedAt,
    sourceFile: fileName,
    sourceSystem: detection.source,
  };

  for (const sheet of sheets) {
    const mappings = resolveColumns({
      headers: sheet.headers,
      adapter,
      dataset,
      rows: sheet.rows,
      overrides: mappingOverrides,
    });

    for (const mapping of mappings) {
      if (!allMappings.some((existing) => existing.sourceColumn === mapping.sourceColumn)) {
        allMappings.push(mapping);
      }
    }

    const output = normalizeRows({
      dataset,
      adapter,
      mappings,
      rows: sheet.rows,
      sourceRows: sheet.sourceRows,
      sheetName: sheet.name,
      provenance: provenanceBase,
      options: normalizeOptions,
    });

    totalRows += sheet.rows.length;
    accepted += output.accepted;
    rejected += output.rejectedCount;
    duplicates += output.duplicateCount;
    usage.push(...output.usage);
    entitlements.push(...output.entitlements);
    people.push(...output.people);
    rejections.push(...output.rejections);
  }

  for (const mapping of allMappings) {
    if (mapping.field === null) {
      warnings.push({
        code: 'unmapped_column',
        message: `Column "${mapping.sourceColumn}" was not mapped to any EngiSignal field.`,
        detail: 'Its values are not imported. Map it manually if it is needed.',
      });
    }
  }

  const mappedFields = new Set<CanonicalFieldKey>(
    allMappings.map((mapping) => mapping.field).filter((field): field is CanonicalFieldKey => field !== null),
  );

  // Substitutions the pipeline made are stated, never assumed to be obvious.
  if (dataset !== 'people' && !mappedFields.has('feature') && mappedFields.has('product')) {
    warnings.push({
      code: 'missing_optional_field',
      message: 'No feature column was found, so the product name is being used as the feature identity.',
      detail: 'Map a feature column if this file distinguishes features from products.',
    });
  }

  if (dataset === 'usage' && !mappedFields.has('date') && mappedFields.has('observedAt')) {
    warnings.push({
      code: 'missing_optional_field',
      message: 'No date column was found, so the calendar date is being taken from the timestamp column.',
      detail: 'Timestamps are read as UTC.',
    });
  }

  for (const spec of FIELDS_BY_DATASET[dataset]) {
    if (!spec.required && !mappedFields.has(spec.key)) {
      warnings.push({
        code: 'missing_optional_field',
        message: `No column was mapped to ${spec.label}.`,
        detail: spec.description,
      });
    }
  }

  const records: CanonicalRecord[] =
    dataset === 'usage' ? usage : dataset === 'entitlements' ? entitlements : people;

  const quality = buildQualityReport({
    dataset,
    adapter,
    records,
    detectionConfidence: detection.confidence,
    mappedFields,
    acceptedRows: accepted,
    totalRows,
  });

  const result: IngestionResult = {
    dataset,
    sourceSystem: detection.source,
    usage,
    entitlements,
    people,
    totalRows,
    acceptedRows: accepted,
    rejectedRows: rejected,
    rejections,
    rejectionSummary: summarizeRejections(rejections, rejected),
    duplicateRows: duplicates,
    warnings,
    quality,
  };

  return {
    detection,
    mappings: allMappings,
    missingRequired: missingRequiredFields(allMappings, dataset),
    sheetNames: parsed.sheetNames,
    headers: sheets.flatMap((sheet) => sheet.headers),
    previewRows: sheets[0]?.rows.slice(0, PREVIEW_ROWS) ?? [],
    result,
  };
}

/** Parse bytes and run the full pipeline. */
export async function ingestFile(
  buffer: ArrayBuffer,
  options: IngestOptions,
): Promise<IngestionAnalysis> {
  const parsed = await parseIngestionFile(buffer, options.fileName);
  return ingestParsedFile(parsed, options);
}
