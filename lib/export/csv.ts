/**
 * CSV serialization for exports and downloadable templates.
 *
 * Values are quoted defensively: a product name containing a comma, a quote or
 * a newline must survive the round trip into Excel unchanged.
 */

export function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (text.length === 0) return '';

  // A leading =, +, - or @ is interpreted as a formula by spreadsheet apps.
  // Prefixing with a single quote neutralizes it without altering the reading.
  const needsFormulaGuard = /^[=+\-@]/.test(text);
  const guarded = needsFormulaGuard ? `'${text}` : text;

  if (/[",\n\r]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

export function toCsv(headers: readonly string[], rows: readonly unknown[][]): string {
  const lines = [headers.map(escapeCsvValue).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCsvValue).join(','));
  }
  // CRLF and a UTF-8 BOM so Excel opens the file correctly on Windows.
  return `﻿${lines.join('\r\n')}\r\n`;
}

export function csvResponse(fileName: string, content: string): Response {
  return new Response(content, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    },
  });
}
