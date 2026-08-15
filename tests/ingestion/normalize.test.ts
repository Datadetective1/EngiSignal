import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ingestParsedFile } from '@/lib/ingestion';
import { parseDelimited } from '@/lib/ingestion/parse';
import { parseDate, parseHour, parseNumber, parseTimestamp } from '@/lib/ingestion/values';

const FIXTURES = path.resolve(__dirname, '../fixtures/ingestion');

function ingest(fileName: string, options: Partial<Parameters<typeof ingestParsedFile>[1]> = {}) {
  const text = readFileSync(path.join(FIXTURES, fileName), 'utf8');
  const parsed = parseDelimited(text);
  return ingestParsedFile(parsed, {
    dataset: 'usage',
    organizationId: 'org-alpha',
    importId: 'import-0001',
    fileName,
    importedAt: '2026-08-15T00:00:00.000Z',
    ...options,
  });
}

describe('canonical normalization', () => {
  it('normalizes FlexNet rows into canonical usage records', () => {
    const { result } = ingest('flexnet-usage.csv');

    expect(result.sourceSystem).toBe('flexnet');
    expect(result.acceptedRows).toBe(8);
    expect(result.rejectedRows).toBe(0);

    const first = result.usage[0]!;
    expect(first.date).toBe('2026-03-02');
    expect(first.feature).toBe('MECH_ENT');
    expect(first.user).toBe('jhalvorsen');
    expect(first.vendor).toBe('ansyslmd');
    expect(first.concurrent).toBe(214);
    expect(first.available).toBe(400);
    expect(first.licenseServer).toBe('lic-prod-01');
    expect(first.checkoutAt).toBe('2026-03-02T08:04:11.000Z');
  });

  it('reads a denial status through the adapter coercion', () => {
    const { result } = ingest('flexnet-usage.csv');
    const denied = result.usage.filter((record) => record.denied === true);
    expect(denied).toHaveLength(1);
    expect(denied[0]!.user).toBe('sokafor');
  });

  it('normalizes every source to the same shape', () => {
    const sources = [
      { file: 'flexnet-usage.csv', expected: 'flexnet' },
      { file: 'rlm-usage.csv', expected: 'rlm' },
      { file: 'dsls-usage.csv', expected: 'dsls' },
      { file: 'sentinel-usage.csv', expected: 'sentinel' },
      { file: 'generic-usage.csv', expected: 'generic' },
    ] as const;

    for (const { file, expected } of sources) {
      const { result } = ingest(file);
      expect(result.sourceSystem).toBe(expected);
      expect(result.usage.length).toBeGreaterThan(0);
      for (const record of result.usage) {
        // Required canonical identity is always present.
        expect(record.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(record.feature.length).toBeGreaterThan(0);
        expect(record.provenance.sourceSystem).toBe(expected);
      }
    }
  });

  it('keeps DSLS tokens separate from seat quantity', () => {
    const { result } = ingest('dsls-usage.csv');
    const record = result.usage[0]!;
    expect(record.tokens).toBe(4);
    expect(record.concurrent).toBe(188);
  });

  it('reads Sentinel peak usage without inventing checkout times', () => {
    const { result } = ingest('sentinel-usage.csv');
    const record = result.usage[0]!;
    expect(record.peak).toBe(126);
    // Sentinel snapshots cannot report checkout/check-in, so these stay null
    // rather than being derived from the sample time.
    expect(record.checkoutAt).toBeNull();
    expect(record.checkinAt).toBeNull();
  });

  it('parses a TSV export with a different layout', () => {
    const { result } = ingest('rlm-variant.tsv');
    expect(result.sourceSystem).toBe('rlm');
    expect(result.acceptedRows).toBe(5);
    expect(result.usage[0]!.feature).toBe('nx_design');
    expect(result.usage[0]!.vendor).toBe('siemens');
  });

  it('reads day-first dates when told to', () => {
    const { result } = ingest('flexnet-variant.csv', { dayFirst: true });
    expect(result.usage[0]!.date).toBe('2026-03-02');
    expect(result.usage[0]!.hour).toBe(8);
  });
});

describe('rejections', () => {
  it('rejects malformed rows with a reason for each, and never silently', () => {
    const { result } = ingest('malformed-usage.csv');

    // 7 data rows + 1 duplicate = 8 total.
    expect(result.totalRows).toBe(8);
    expect(result.acceptedRows + result.rejectedRows).toBe(result.totalRows);

    const rules = result.rejections.map((rejection) => rejection.rule);
    expect(rules).toContain('invalid_date');
    expect(rules).toContain('missing_required_field');
    expect(rules).toContain('negative_quantity');
    expect(rules).toContain('invalid_number');
    expect(rules).toContain('invalid_hour');
    expect(rules).toContain('duplicate_row');
  });

  it('names the source row, field and offending value in every rejection', () => {
    const { result } = ingest('malformed-usage.csv');
    for (const rejection of result.rejections) {
      expect(rejection.sourceRow).toBeGreaterThan(1);
      expect(rejection.message.length).toBeGreaterThan(0);
    }
    const badDate = result.rejections.find((rejection) => rejection.rule === 'invalid_date');
    expect(badDate?.value).toBe('not-a-date');
    expect(badDate?.sourceRow).toBe(3);
  });

  it('summarizes rejections by rule with counts and examples', () => {
    const { result } = ingest('malformed-usage.csv');
    const summary = result.rejectionSummary;
    expect(summary.length).toBeGreaterThan(0);
    const total = summary.reduce((sum, group) => sum + group.count, 0);
    expect(total).toBe(result.rejectedRows);
  });

  it('rejects a duplicate rather than dropping it quietly', () => {
    const { result } = ingest('malformed-usage.csv');
    expect(result.duplicateRows).toBe(1);
    const duplicate = result.rejections.find((rejection) => rejection.rule === 'duplicate_row');
    expect(duplicate?.message).toMatch(/Duplicate of row \d+/);
  });

  it('treats a second observation with different measures as real, not duplicate', () => {
    const parsed = parseDelimited(
      [
        'date,feature,user,licenses used',
        '2026-06-01,MECH_ENT,agarcia,12',
        '2026-06-01,MECH_ENT,agarcia,19',
      ].join('\n'),
    );
    const { result } = ingestParsedFile(parsed, {
      dataset: 'usage',
      organizationId: 'org-alpha',
      importId: 'import-dup',
      fileName: 'dup.csv',
    });
    expect(result.duplicateRows).toBe(0);
    expect(result.acceptedRows).toBe(2);
  });

  it('rejects every row once when a required field is unmapped', () => {
    const parsed = parseDelimited(['server,notes', 'lic-01,hello', 'lic-02,world'].join('\n'));
    const { result, missingRequired } = ingestParsedFile(parsed, {
      dataset: 'usage',
      organizationId: 'org-alpha',
      importId: 'import-missing',
      fileName: 'missing.csv',
    });

    expect(missingRequired).toContain('Date');
    expect(missingRequired).toContain('Feature');
    expect(result.acceptedRows).toBe(0);
    expect(result.rejectedRows).toBe(2);
    expect(result.rejections[0]!.rule).toBe('unmapped_required_field');
  });
});

describe('value parsing', () => {
  it('parses the date formats real exports use', () => {
    expect(parseDate('2026-03-02')).toBe('2026-03-02');
    expect(parseDate('03/02/2026')).toBe('2026-03-02');
    expect(parseDate('02/03/2026', { dayFirst: true })).toBe('2026-03-02');
    expect(parseDate(new Date('2026-03-02T00:00:00Z'))).toBe('2026-03-02');
  });

  it('refuses nonsense rather than inventing a date', () => {
    // JavaScript's Date turns these into real dates; the guard must not.
    expect(parseDate('bad-1')).toBeNull();
    expect(parseDate('not-a-date')).toBeNull();
    expect(parseDate('')).toBeNull();
    expect(parseDate('2026-13-45')).toBeNull();
  });

  it('rejects dates outside a plausible range', () => {
    expect(parseDate('1889-01-01')).toBeNull();
    expect(parseDate('2451-01-01')).toBeNull();
  });

  it('parses timestamps and preserves the time', () => {
    expect(parseTimestamp('2026-03-02 08:04:11')).toBe('2026-03-02T08:04:11.000Z');
    expect(parseTimestamp('2026-03-02')).toBe('2026-03-02T00:00:00.000Z');
    expect(parseTimestamp('rubbish')).toBeNull();
  });

  it('parses numbers with currency and separators', () => {
    expect(parseNumber('1,240')).toBe(1240);
    expect(parseNumber('$5,000')).toBe(5000);
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('')).toBeNull();
  });

  it('parses hours including clock notation and rejects out-of-range values', () => {
    expect(parseHour('9')).toBe(9);
    expect(parseHour('14:00')).toBe(14);
    expect(parseHour('24')).toBeNull();
    expect(parseHour('-1')).toBeNull();
    expect(parseHour('9.5')).toBeNull();
  });
});

describe('provenance', () => {
  it('carries file, source, import id, timestamp and row on every record', () => {
    const { result } = ingest('flexnet-usage.csv');

    for (const record of result.usage) {
      expect(record.provenance.organizationId).toBe('org-alpha');
      expect(record.provenance.importId).toBe('import-0001');
      expect(record.provenance.importedAt).toBe('2026-08-15T00:00:00.000Z');
      expect(record.provenance.sourceFile).toBe('flexnet-usage.csv');
      expect(record.provenance.sourceSystem).toBe('flexnet');
      expect(record.provenance.sourceRow).toBeGreaterThan(1);
    }
  });

  it('numbers source rows so they match what the customer sees in the file', () => {
    const { result } = ingest('flexnet-usage.csv');
    // Header is row 1, so the first data record is row 2.
    expect(result.usage[0]!.provenance.sourceRow).toBe(2);
    expect(result.usage[1]!.provenance.sourceRow).toBe(3);
  });

  it('keeps row numbers aligned when earlier rows are rejected', () => {
    const { result } = ingest('malformed-usage.csv');
    const gpatel = result.usage.find((record) => record.user === 'gpatel');
    // gpatel is the 7th data row, so row 8 in the file.
    expect(gpatel?.provenance.sourceRow).toBe(8);
  });
});

describe('tenant isolation', () => {
  it('stamps the caller-supplied organization onto every record', () => {
    const alpha = ingest('flexnet-usage.csv', { organizationId: 'org-alpha' });
    const beta = ingest('flexnet-usage.csv', { organizationId: 'org-beta' });

    expect(alpha.result.usage.every((r) => r.provenance.organizationId === 'org-alpha')).toBe(true);
    expect(beta.result.usage.every((r) => r.provenance.organizationId === 'org-beta')).toBe(true);
  });

  it('never mixes tenants within one ingestion run', () => {
    const { result } = ingest('flexnet-usage.csv', { organizationId: 'org-alpha' });
    const tenants = new Set(result.usage.map((record) => record.provenance.organizationId));
    expect(tenants.size).toBe(1);
  });

  it('gives separate runs distinct import ids so batches stay traceable', () => {
    const first = ingest('flexnet-usage.csv', { importId: 'import-a' });
    const second = ingest('flexnet-usage.csv', { importId: 'import-b' });
    expect(first.result.usage[0]!.provenance.importId).toBe('import-a');
    expect(second.result.usage[0]!.provenance.importId).toBe('import-b');
  });
});

describe('entitlements and people', () => {
  it('normalizes entitlements with a license model', () => {
    const { result } = ingest('flexnet-entitlements.csv', { dataset: 'entitlements' });

    expect(result.entitlements).toHaveLength(4);
    const mech = result.entitlements.find((row) => row.feature === 'MECH_ENT')!;
    expect(mech.entitledQuantity).toBe(400);
    expect(mech.licenseModel).toBe('concurrent');
    expect(mech.expiresOn).toBe('2027-01-31');

    const named = result.entitlements.find((row) => row.feature === 'STRUCT_NAMED')!;
    expect(named.licenseModel).toBe('named_user');
  });

  it('normalizes people records', () => {
    const { result } = ingest('generic-people.csv', { dataset: 'people' });
    expect(result.people).toHaveLength(4);
    expect(result.people[0]!.user).toBe('pandersson');
    expect(result.people[0]!.employeeCode).toBe('E10442');
    expect(result.people[0]!.email).toBe('petra.andersson@example.com');
  });

  it('leaves an unknown license model unknown rather than guessing', () => {
    const parsed = parseDelimited(
      ['feature,quantity,license_type', 'X_FEAT,10,mystery-model'].join('\n'),
    );
    const { result } = ingestParsedFile(parsed, {
      dataset: 'entitlements',
      organizationId: 'org-alpha',
      importId: 'import-model',
      fileName: 'models.csv',
    });
    expect(result.entitlements[0]!.licenseModel).toBe('unknown');
  });
});

describe('quality reporting', () => {
  it('reports coverage per canonical field', () => {
    const { result } = ingest('flexnet-usage.csv');
    const coverage = result.quality.coverage;

    const feature = coverage.find((entry) => entry.field === 'feature')!;
    expect(feature.coveragePct).toBe(100);

    const employee = coverage.find((entry) => entry.field === 'employeeCode')!;
    expect(employee.coveragePct).toBe(0);
    expect(employee.note).toContain('No column');
  });

  it('distinguishes a source limit from a missing column', () => {
    const { result } = ingest('sentinel-usage.csv');
    const checkout = result.quality.coverage.find((entry) => entry.field === 'checkoutAt')!;
    expect(checkout.supportedBySource).toBe(false);
    expect(checkout.note).toContain('do not carry this field');
    expect(result.quality.unsupportedFields).toContain('Checkout time');
  });

  it('warns that interval snapshots can understate peak demand', () => {
    const { result } = ingest('sentinel-usage.csv');
    expect(result.quality.notes.join(' ')).toContain('understated');
  });

  it('lowers confidence when the source could not be identified', () => {
    const generic = ingest('generic-usage.csv');
    const flexnet = ingest('flexnet-usage.csv');
    expect(generic.result.quality.confidence).toBeLessThan(flexnet.result.quality.confidence);
  });

  it('warns when a column is not mapped to anything', () => {
    const parsed = parseDelimited(
      ['date,feature,mystery_column', '2026-03-02,MECH_ENT,xyz'].join('\n'),
    );
    const { result } = ingestParsedFile(parsed, {
      dataset: 'usage',
      organizationId: 'org-alpha',
      importId: 'import-unmapped',
      fileName: 'unmapped.csv',
    });
    const unmapped = result.warnings.filter((warning) => warning.code === 'unmapped_column');
    expect(unmapped.some((warning) => warning.message.includes('mystery_column'))).toBe(true);
  });
});
