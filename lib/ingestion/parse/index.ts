/**
 * File parsing for ingestion.
 *
 * Deliberately free of `server-only` so the parsing rules are unit-testable.
 * The HTTP entry point that calls it is server-side and authenticated; nothing
 * here trusts a file name or a client-supplied content type.
 *
 * FORMAT SUPPORT is decided by content, not by extension. A file named
 * `usage.csv` that is really a workbook is parsed as a workbook, because an
 * attacker — or more often a customer — renaming a file must not change how it
 * is interpreted.
 *
 * Legacy `.xls` (BIFF) is NOT supported: the bundled parser reads the OOXML
 * format only. Such files are rejected with an explicit message rather than
 * being silently misread.
 */

import Papa from 'papaparse';
import type { IngestionWarning } from '../canonical/types';

export interface ParsedSheet {
  /** Worksheet name, or null for delimited files. */
  name: string | null;
  headers: string[];
  rows: Record<string, unknown>[];
  /**
   * Source row number for each parsed row, 1-based and counting the header, so
   * it matches what the customer sees in Excel.
   */
  sourceRows: number[];
}

export interface ParsedFile {
  format: 'csv' | 'tsv' | 'xlsx';
  sheets: ParsedSheet[];
  /** Names of every sheet found, including ones that produced no rows. */
  sheetNames: string[];
  totalRows: number;
  truncated: boolean;
  warnings: IngestionWarning[];
}

export const MAX_UPLOAD_BYTES = Number(process.env.ENGISIGNAL_MAX_UPLOAD_BYTES ?? 26_214_400);
export const MAX_INGEST_ROWS = Number(process.env.ENGISIGNAL_MAX_INGEST_ROWS ?? 500_000);

export const ACCEPTED_EXTENSIONS = ['.csv', '.tsv', '.txt', '.xlsx', '.xlsm'] as const;

export class UnsupportedFileError extends Error {}
export class EmptyFileError extends Error {}

export function hasAcceptedExtension(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

// ── Encoding ─────────────────────────────────────────────────────────────────

/**
 * Decode bytes to text, honouring a byte-order mark when present.
 *
 * Exports produced by Windows tooling are frequently UTF-16LE with a BOM. Read
 * as UTF-8 they become interleaved NUL characters, every header fails to match,
 * and the file looks like it has one unnamed column — a confusing failure that
 * looks like a mapping bug rather than an encoding one.
 */
export function decodeText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);

  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }

  // `fatal: false` keeps malformed bytes as replacement characters rather than
  // throwing: a single bad byte should cost one value, not the whole import.
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/** True when the bytes are a ZIP container, which is what XLSX/XLSM are. */
export function looksLikeZip(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer);
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** True when the bytes are a legacy OLE2 compound file, i.e. a real .xls. */
export function looksLikeLegacyXls(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer);
  const signature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  return bytes.length >= 8 && signature.every((byte, index) => bytes[index] === byte);
}

// ── Delimited ────────────────────────────────────────────────────────────────

/**
 * Choose a delimiter from the header line.
 *
 * Counting on the first line only is intentional: a comma inside a quoted
 * description field further down should not outvote the real delimiter.
 */
export function sniffDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const counts: { delimiter: string; count: number }[] = [
    { delimiter: '\t', count: (firstLine.match(/\t/g) ?? []).length },
    { delimiter: ',', count: (firstLine.match(/,/g) ?? []).length },
    { delimiter: ';', count: (firstLine.match(/;/g) ?? []).length },
    { delimiter: '|', count: (firstLine.match(/\|/g) ?? []).length },
  ];
  counts.sort((a, b) => b.count - a.count);
  const best = counts[0];
  return best !== undefined && best.count > 0 ? best.delimiter : ',';
}

export function parseDelimited(
  text: string,
  { maxRows = MAX_INGEST_ROWS, delimiter }: { maxRows?: number; delimiter?: string } = {},
): ParsedFile {
  if (text.trim().length === 0) {
    throw new EmptyFileError('The file is empty.');
  }

  const chosen = delimiter ?? sniffDelimiter(text);
  const warnings: IngestionWarning[] = [];

  // `header: false` so blank lines can be counted rather than silently dropped,
  // which is what keeps reported source row numbers aligned with the file.
  const result = Papa.parse<string[]>(text, {
    header: false,
    delimiter: chosen,
    skipEmptyLines: false,
    dynamicTyping: false,
    newline: undefined,
  });

  const matrix = result.data.filter((row) => Array.isArray(row));
  if (matrix.length === 0) throw new EmptyFileError('The file contains no rows.');

  const rawHeaders = (matrix[0] ?? []).map((cell) => String(cell ?? '').trim());
  const headers = rawHeaders.map((header, index) =>
    header.length > 0 ? header : `Column ${index + 1}`,
  );

  if (headers.every((header) => header.startsWith('Column '))) {
    throw new EmptyFileError('No column headers were found in the file.');
  }

  const rows: Record<string, unknown>[] = [];
  const sourceRows: number[] = [];
  let truncated = false;

  for (let index = 1; index < matrix.length; index++) {
    if (rows.length >= maxRows) {
      truncated = true;
      break;
    }
    const cells = matrix[index] ?? [];
    // Fully blank lines are structure, not data, and are not reported as
    // rejected rows — an export ending with a newline is not an error.
    if (cells.every((cell) => String(cell ?? '').trim().length === 0)) continue;

    const record: Record<string, unknown> = {};
    headers.forEach((header, column) => {
      record[header] = cells[column] ?? null;
    });
    rows.push(record);
    sourceRows.push(index + 1);
  }

  if (result.errors.length > 0) {
    for (const error of result.errors.slice(0, 5)) {
      warnings.push({
        code: 'parser_warning',
        message: 'The parser reported a problem while reading the file.',
        detail: `Row ${error.row ?? '?'}: ${error.message}`,
      });
    }
  }

  if (truncated) {
    warnings.push({
      code: 'row_limit_reached',
      message: `Only the first ${maxRows.toLocaleString('en-US')} rows were read.`,
      detail: 'Split the export by date range to import the remainder.',
    });
  }

  return {
    format: chosen === '\t' ? 'tsv' : 'csv',
    sheets: [{ name: null, headers, rows, sourceRows }],
    sheetNames: [],
    totalRows: rows.length,
    truncated,
    warnings,
  };
}

// ── Workbook ─────────────────────────────────────────────────────────────────

/**
 * Parse every worksheet in a workbook.
 *
 * All sheets are read rather than only the first: license exports routinely put
 * usage on one sheet and entitlements on another, and silently ignoring sheet
 * two loses half the file with no message.
 */
export async function parseWorkbook(
  buffer: ArrayBuffer,
  { maxRows = MAX_INGEST_ROWS }: { maxRows?: number } = {},
): Promise<ParsedFile> {
  if (looksLikeLegacyXls(buffer)) {
    throw new UnsupportedFileError(
      'Legacy .xls workbooks are not supported. Save the file as .xlsx or export it as CSV and upload again.',
    );
  }

  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheetNames = workbook.worksheets.map((sheet) => sheet.name);
  if (sheetNames.length === 0) throw new EmptyFileError('The workbook contains no sheets.');

  const sheets: ParsedSheet[] = [];
  const warnings: IngestionWarning[] = [];
  let total = 0;
  let truncated = false;

  for (const sheet of workbook.worksheets) {
    if (total >= maxRows) {
      truncated = true;
      warnings.push({
        code: 'sheet_skipped',
        message: `Sheet "${sheet.name}" was not read because the row limit was reached.`,
        detail: null,
      });
      continue;
    }

    const headerRow = sheet.getRow(1);
    const rawHeaders: string[] = [];
    headerRow.eachCell({ includeEmpty: false }, (cell, column) => {
      rawHeaders[column - 1] = cellText(cell.value).trim();
    });

    const headers = Array.from({ length: rawHeaders.length }, (_, index) => {
      const header = rawHeaders[index] ?? '';
      return header.length > 0 ? header : `Column ${index + 1}`;
    });

    if (headers.length === 0) {
      warnings.push({
        code: 'sheet_skipped',
        message: `Sheet "${sheet.name}" has no header row and was skipped.`,
        detail: null,
      });
      continue;
    }

    const rows: Record<string, unknown>[] = [];
    const sourceRows: number[] = [];

    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
      if (total + rows.length >= maxRows) {
        truncated = true;
        break;
      }
      const row = sheet.getRow(rowNumber);
      const record: Record<string, unknown> = {};
      let hasValue = false;

      headers.forEach((header, index) => {
        const value = normalizeCell(row.getCell(index + 1).value);
        if (value !== null && String(value).trim().length > 0) hasValue = true;
        record[header] = value;
      });

      if (!hasValue) continue;
      rows.push(record);
      sourceRows.push(rowNumber);
    }

    total += rows.length;
    sheets.push({ name: sheet.name, headers, rows, sourceRows });
  }

  if (truncated) {
    warnings.push({
      code: 'row_limit_reached',
      message: `Only the first ${maxRows.toLocaleString('en-US')} rows were read.`,
      detail: 'Split the export by date range to import the remainder.',
    });
  }

  if (sheets.every((sheet) => sheet.rows.length === 0)) {
    throw new EmptyFileError('The workbook contains no data rows.');
  }

  return { format: 'xlsx', sheets, sheetNames, totalRows: total, truncated, warnings };
}

/** ExcelJS returns rich objects for formulas, links and rich text. */
function normalizeCell(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('result' in record) return record.result ?? null;
    if ('text' in record) return record.text ?? null;
    if ('richText' in record) {
      const parts = record.richText as { text: string }[];
      return parts.map((part) => part.text).join('');
    }
    if ('hyperlink' in record) return record.hyperlink ?? null;
    return null;
  }
  return value;
}

function cellText(value: unknown): string {
  const normalized = normalizeCell(value);
  return normalized === null ? '' : String(normalized);
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Parse an uploaded file by inspecting its bytes.
 *
 * The extension is used only as a hint for delimited text; container detection
 * always wins, so a mislabelled workbook is still parsed correctly.
 */
export async function parseIngestionFile(
  buffer: ArrayBuffer,
  fileName: string,
  { maxRows = MAX_INGEST_ROWS }: { maxRows?: number } = {},
): Promise<ParsedFile> {
  if (buffer.byteLength === 0) throw new EmptyFileError('The file is empty.');

  if (looksLikeZip(buffer)) return parseWorkbook(buffer, { maxRows });
  if (looksLikeLegacyXls(buffer)) {
    throw new UnsupportedFileError(
      'Legacy .xls workbooks are not supported. Save the file as .xlsx or export it as CSV and upload again.',
    );
  }

  const lower = fileName.toLowerCase();
  const delimiter = lower.endsWith('.tsv') ? '\t' : undefined;
  return parseDelimited(decodeText(buffer), { maxRows, delimiter });
}
