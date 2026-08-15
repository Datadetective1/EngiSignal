import { describe, expect, it } from 'vitest';
import { normalizeHeader } from '@/lib/import/mapping';
import { escapeCsvValue, toCsv } from '@/lib/export/csv';

/**
 * What remains of the legacy import tests.
 *
 * File ingestion moved to lib/ingestion/* and is covered by tests/ingestion/*.
 * The duplicate mapping, parsing and validation engine that used to live here
 * was removed rather than kept in parallel, so these tests now cover only the
 * header normalization the identity screens still use, plus CSV export.
 */

describe('normalizeHeader', () => {
  it('reduces the header spellings real exports use to one form', () => {
    expect(normalizeHeader('NETWORK_USER')).toBe('network_user');
    expect(normalizeHeader('Network User')).toBe('network_user');
    expect(normalizeHeader('network-user')).toBe('network_user');
    expect(normalizeHeader('  Network.User  ')).toBe('network_user');
  });

  it('strips punctuation that would break comparison', () => {
    expect(normalizeHeader('Unit Cost ($)')).toBe('unit_cost');
    expect(normalizeHeader('Qty#')).toBe('qty');
  });
});

describe('CSV export', () => {
  it('quotes values containing commas, quotes or newlines', () => {
    expect(escapeCsvValue('Simple')).toBe('Simple');
    expect(escapeCsvValue('Has, comma')).toBe('"Has, comma"');
    expect(escapeCsvValue('Has "quote"')).toBe('"Has ""quote"""');
    expect(escapeCsvValue('Line\nbreak')).toBe('"Line\nbreak"');
  });

  it('neutralizes values a spreadsheet would execute as a formula', () => {
    // CSV injection: =cmd|... would execute on open in some spreadsheet apps.
    expect(escapeCsvValue('=1+1')).toBe("'=1+1");
    expect(escapeCsvValue('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(escapeCsvValue('-2+3')).toBe("'-2+3");
  });

  it('renders empty for null and undefined rather than the word "null"', () => {
    expect(escapeCsvValue(null)).toBe('');
    expect(escapeCsvValue(undefined)).toBe('');
  });

  it('emits a BOM and CRLF so Excel opens it correctly', () => {
    const csv = toCsv(['A', 'B'], [[1, 2]]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('\r\n');
    expect(csv).toContain('A,B');
    expect(csv).toContain('1,2');
  });
});
