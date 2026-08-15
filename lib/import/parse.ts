/**
 * File parsing for CSV and XLSX imports.
 *
 * Server-side only. Both parsers return the same shape so the mapping and
 * validation layers never need to know which format arrived.
 */

import 'server-only';
import Papa from 'papaparse';
import type { SourceRow } from './validate';

export interface ParsedFile {
  headers: string[];
  rows: SourceRow[];
  /** Rows actually parsed, which may be fewer than the file contains. */
  parsedRows: number;
  truncated: boolean;
  parseErrors: string[];
}

export const MAX_UPLOAD_BYTES = Number(process.env.ENGISIGNAL_MAX_UPLOAD_BYTES ?? 26_214_400);
export const MAX_IMPORT_ROWS = Number(process.env.ENGISIGNAL_MAX_IMPORT_ROWS ?? 500_000);

/** Extensions accepted for import. Content is validated by parsing, not by name. */
export const ACCEPTED_EXTENSIONS = ['.csv', '.tsv', '.txt', '.xlsx', '.xlsm'] as const;

export function hasAcceptedExtension(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

export function parseCsv(content: string, maxRows = MAX_IMPORT_ROWS): ParsedFile {
  const result = Papa.parse<SourceRow>(content, {
    header: true,
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
    preview: maxRows,
    transformHeader: (header) => header.trim(),
  });

  const headers = (result.meta.fields ?? []).filter((header) => header.length > 0);
  const rows = result.data.filter((row) => row !== null && typeof row === 'object');

  return {
    headers,
    rows,
    parsedRows: rows.length,
    truncated: rows.length >= maxRows,
    parseErrors: result.errors.slice(0, 5).map((error) => `Row ${error.row ?? '?'}: ${error.message}`),
  };
}

export async function parseXlsx(buffer: ArrayBuffer, maxRows = MAX_IMPORT_ROWS): Promise<ParsedFile> {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheet = workbook.worksheets[0];
  if (sheet === undefined) {
    return { headers: [], rows: [], parsedRows: 0, truncated: false, parseErrors: ['Workbook contains no sheets.'] };
  }

  const headers: string[] = [];
  const headerRow = sheet.getRow(1);
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber - 1] = String(cell.value ?? '').trim();
  });

  const cleanHeaders = headers.map((header, index) => (header.length > 0 ? header : `Column ${index + 1}`));

  const rows: SourceRow[] = [];
  let truncated = false;

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    if (rows.length >= maxRows) {
      truncated = true;
      break;
    }
    const row = sheet.getRow(rowNumber);
    const record: SourceRow = {};
    let hasValue = false;

    cleanHeaders.forEach((header, index) => {
      const cell = row.getCell(index + 1);
      let value = cell.value;

      // ExcelJS returns rich objects for formulas, hyperlinks and rich text;
      // reduce them to the value a human sees in the cell.
      if (value !== null && typeof value === 'object') {
        if ('result' in value) value = (value as { result: unknown }).result as never;
        else if ('text' in value) value = (value as { text: string }).text as never;
        else if ('richText' in value) {
          value = (value as { richText: { text: string }[] }).richText.map((part) => part.text).join('') as never;
        }
      }

      if (value !== null && value !== undefined && String(value).trim().length > 0) hasValue = true;
      record[header] = value as never;
    });

    if (hasValue) rows.push(record);
  }

  return {
    headers: cleanHeaders,
    rows,
    parsedRows: rows.length,
    truncated,
    parseErrors: [],
  };
}

export async function parseUpload(file: File): Promise<ParsedFile> {
  const lower = file.name.toLowerCase();

  if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) {
    return parseXlsx(await file.arrayBuffer());
  }

  const text = await file.text();
  return parseCsv(text);
}
