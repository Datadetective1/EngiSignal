import { describe, expect, it } from 'vitest';
import { missingFields, normalizeHeader, scoreHeader, suggestMapping, toMappingRecord } from '@/lib/import/mapping';
import { IMPORT_SCHEMAS } from '@/lib/import/schema';
import { parseDateValue, parseHourValue, parseNumberValue, validateRows } from '@/lib/import/validate';
import { escapeCsvValue, toCsv } from '@/lib/export/csv';

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

describe('scoreHeader', () => {
  const usageFields = IMPORT_SCHEMAS.usage.fields;
  const userField = usageFields.find((f) => f.key === 'username')!;

  it('scores an exact synonym at maximum', () => {
    expect(scoreHeader('NETWORK_USER', userField)).toBe(100);
    expect(scoreHeader('username', userField)).toBe(100);
  });

  it('scores a containing header highly but below exact', () => {
    const score = scoreHeader('primary_network_user_id', userField);
    expect(score).toBeGreaterThan(60);
    expect(score).toBeLessThan(100);
  });

  it('scores an unrelated header at zero', () => {
    expect(scoreHeader('invoice_total', userField)).toBe(0);
  });
});

describe('suggestMapping', () => {
  it('maps a realistic FlexNet export', () => {
    const headers = [
      'USAGE_DATE',
      'HOUR_OF_DAY',
      'NETWORK_USER',
      'FEATURE_NAME',
      'VENDOR_DAEMON',
      'LIC_SERVER',
      'MAX_CONCURRENT',
      'CHECKOUT_COUNT',
    ];
    const mapping = toMappingRecord(suggestMapping(headers, 'usage'));

    expect(mapping.USAGE_DATE).toBe('date');
    expect(mapping.HOUR_OF_DAY).toBe('hour');
    expect(mapping.NETWORK_USER).toBe('username');
    expect(mapping.FEATURE_NAME).toBe('featureCode');
    expect(mapping.VENDOR_DAEMON).toBe('vendor');
    expect(mapping.LIC_SERVER).toBe('licenseServer');
    expect(mapping.MAX_CONCURRENT).toBe('peakUsage');
  });

  it('maps an HR roster with entirely different naming', () => {
    const headers = ['EMPL_ID', 'NTWK_ID', 'FULL_NAME', 'SUPERVISOR', 'DEPT_DESC', 'BUS_UNIT', 'WORK_LOCATION'];
    const mapping = toMappingRecord(suggestMapping(headers, 'employees'));

    expect(mapping.EMPL_ID).toBe('employeeCode');
    expect(mapping.NTWK_ID).toBe('username');
    expect(mapping.FULL_NAME).toBe('fullName');
    expect(mapping.SUPERVISOR).toBe('managerName');
    expect(mapping.DEPT_DESC).toBe('department');
    expect(mapping.BUS_UNIT).toBe('businessUnit');
    expect(mapping.WORK_LOCATION).toBe('location');
  });

  it('never assigns two source columns to the same canonical field', () => {
    // Both plausibly mean "user"; assigning both would silently discard one.
    const suggestions = suggestMapping(['username', 'user_name', 'login'], 'usage');
    const assigned = suggestions.map((s) => s.field).filter((f): f is string => f !== null);
    expect(new Set(assigned).size).toBe(assigned.length);
  });

  it('leaves genuinely unrecognizable columns unmapped rather than guessing', () => {
    const suggestions = suggestMapping(['zzz_internal_ref', 'FEATURE_NAME'], 'usage');
    const unknown = suggestions.find((s) => s.sourceColumn === 'zzz_internal_ref');
    expect(unknown?.field).toBeNull();
    expect(unknown?.confidence).toBe('none');
  });

  it('reports confidence so the reviewer knows what to check', () => {
    const suggestions = suggestMapping(['FEATURE_NAME', 'some_feature_ish_column'], 'usage');
    expect(suggestions.find((s) => s.sourceColumn === 'FEATURE_NAME')?.confidence).toBe('exact');
  });

  it('handles an empty header list', () => {
    expect(suggestMapping([], 'usage')).toEqual([]);
  });
});

describe('missingFields', () => {
  it('separates required from optional gaps', () => {
    const mapping = { A: 'date', B: 'username' };
    const missing = missingFields(mapping, 'usage');

    expect(missing.required.map((f) => f.key)).toContain('featureCode');
    expect(missing.required.map((f) => f.key)).not.toContain('date');
    expect(missing.optional.length).toBeGreaterThan(0);
  });
});

describe('value parsing', () => {
  it('accepts the date formats license-manager exports actually use', () => {
    expect(parseDateValue('2026-03-02')).toBe('2026-03-02');
    expect(parseDateValue('2026-03-02 14:00:00')).toBe('2026-03-02');
    expect(parseDateValue('3/2/2026')).toBe('2026-03-02');
    expect(parseDateValue('03-02-2026')).toBe('2026-03-02');
  });

  it('rejects values that are not dates', () => {
    expect(parseDateValue('not a date')).toBeNull();
    expect(parseDateValue('')).toBeNull();
    expect(parseDateValue(null)).toBeNull();
  });

  it('does not let the lenient JS Date parser invent a date from garbage', () => {
    // new Date('bad-1') returns 2001-01-01 and new Date('bad-7') returns
    // 2001-07-01. Accepting those would silently move usage into the wrong
    // year, dropping it out of the analysis window with no trace.
    expect(new Date('bad-1').getTime()).not.toBeNaN(); // the hazard is real
    expect(parseDateValue('bad-1')).toBeNull();
    expect(parseDateValue('bad-7')).toBeNull();
    expect(parseDateValue('feature-12')).toBeNull();
    expect(parseDateValue('v2-3')).toBeNull();
  });

  it('rejects impossible calendar components', () => {
    expect(parseDateValue('2026-13-02')).toBeNull();
    expect(parseDateValue('2026-03-45')).toBeNull();
    expect(parseDateValue('13/45/2026')).toBeNull();
  });

  it('rejects dates outside a plausible range', () => {
    expect(parseDateValue('1687-03-02')).toBeNull();
    expect(parseDateValue('2999-03-02')).toBeNull();
  });

  it('still accepts written month formats', () => {
    expect(parseDateValue('2 March 2026')).toBe('2026-03-02');
    expect(parseDateValue('Mar 2, 2026')).toBe('2026-03-02');
  });

  it('strips currency formatting from numbers', () => {
    expect(parseNumberValue('$5,000.00')).toBe(5000);
    expect(parseNumberValue('1 234')).toBe(1234);
    expect(parseNumberValue('42')).toBe(42);
  });

  it('rejects non-numeric values rather than coercing to zero', () => {
    expect(parseNumberValue('n/a')).toBeNull();
    expect(parseNumberValue('')).toBeNull();
  });

  it('bounds hours to 0–23', () => {
    expect(parseHourValue('0')).toBe(0);
    expect(parseHourValue('23')).toBe(23);
    expect(parseHourValue('24')).toBeNull();
    expect(parseHourValue('-1')).toBeNull();
  });
});

describe('validateRows', () => {
  const mapping = { D: 'date', U: 'username', F: 'featureCode', P: 'peakUsage' };

  it('accepts well-formed rows', () => {
    const result = validateRows(
      [
        { D: '2026-03-02', U: 'aokafor', F: 'MECH_ENT', P: '268' },
        { D: '2026-03-03', U: 'dlind', F: 'MECH_ENT', P: '241' },
      ],
      mapping,
      'usage',
    );

    expect(result.totalRows).toBe(2);
    expect(result.acceptedRows).toBe(2);
    expect(result.rejectedRows).toBe(0);
    expect(result.issues).toEqual([]);
  });

  it('rejects rows with an unparseable date and explains why, with an example', () => {
    const result = validateRows(
      [
        { D: '2026-03-02', U: 'a', F: 'X', P: '1' },
        { D: 'yesterday', U: 'b', F: 'X', P: '2' },
      ],
      mapping,
      'usage',
    );

    expect(result.acceptedRows).toBe(1);
    expect(result.rejectedRows).toBe(1);
    const issue = result.issues.find((i) => i.field === 'date');
    expect(issue?.rule).toContain('not a recognizable date');
    expect(issue?.examples).toContain('yesterday');
  });

  it('rejects rows missing a required value', () => {
    const result = validateRows([{ D: '2026-03-02', U: '', F: 'X', P: '1' }], mapping, 'usage');
    expect(result.rejectedRows).toBe(1);
    expect(result.issues.some((i) => i.field === 'username')).toBe(true);
  });

  it('fails every row when a required field is not mapped at all', () => {
    const result = validateRows(
      [{ D: '2026-03-02', U: 'a', P: '1' }],
      { D: 'date', U: 'username', P: 'peakUsage' },
      'usage',
    );
    expect(result.acceptedRows).toBe(0);
    expect(result.issues.some((i) => i.rule.includes('not mapped'))).toBe(true);
  });

  it('tolerates blank optional values', () => {
    const result = validateRows([{ D: '2026-03-02', U: 'a', F: 'X', P: '' }], mapping, 'usage');
    expect(result.acceptedRows).toBe(1);
  });

  it('reports what arrived, so the reviewer can sanity-check before committing', () => {
    const result = validateRows(
      [
        { D: '2026-03-02', U: 'a', F: 'MECH_ENT', P: '1' },
        { D: '2026-03-02', U: 'b', F: 'FLUENT', P: '1' },
      ],
      mapping,
      'usage',
    );

    const features = result.distinct.find((d) => d.field === 'Feature');
    expect(features?.count).toBe(2);
    expect(features?.samples).toContain('MECH_ENT');
  });

  it('caps examples so one bad column cannot flood the report', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      D: `not a date ${i}`,
      U: 'a',
      F: 'X',
      P: '1',
    }));
    const result = validateRows(rows, mapping, 'usage');
    const issue = result.issues.find((i) => i.field === 'date');
    expect(issue?.count).toBe(50);
    expect(issue?.examples.length).toBeLessThanOrEqual(3);
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
