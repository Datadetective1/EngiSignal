import { describe, expect, it } from 'vitest';
import { getAdapter } from '@/lib/ingestion/adapters/registry';
import {
  aliasesFor,
  missingRequiredFields,
  normalizeHeader,
  resolveColumns,
  scoreHeader,
  toFieldIndex,
} from '@/lib/ingestion/adapters/resolve';

describe('normalizeHeader', () => {
  it('reduces the spellings real exports use to one form', () => {
    expect(normalizeHeader('VENDOR_DAEMON')).toBe('vendor_daemon');
    expect(normalizeHeader('Vendor Daemon')).toBe('vendor_daemon');
    expect(normalizeHeader('vendor-daemon')).toBe('vendor_daemon');
    expect(normalizeHeader('  Vendor.Daemon  ')).toBe('vendor_daemon');
    expect(normalizeHeader('Vendor/Daemon')).toBe('vendor_daemon');
  });

  it('strips punctuation that would break comparison', () => {
    expect(normalizeHeader('Licenses In Use (#)')).toBe('licenses_in_use');
    expect(normalizeHeader('Qty#')).toBe('qty');
  });
});

describe('scoreHeader', () => {
  it('scores an exact alias at maximum', () => {
    expect(scoreHeader('USER', 'user', ['user', 'username']).score).toBe(100);
    expect(scoreHeader('Network User', 'user', ['network_user']).score).toBe(100);
  });

  it('scores a containing header highly but below exact', () => {
    const { score } = scoreHeader('primary_network_user_id', 'user', ['network_user']);
    expect(score).toBeGreaterThan(60);
    expect(score).toBeLessThan(100);
  });

  it('prefers the most specific alias', () => {
    const specific = scoreHeader('max_concurrent_licenses', 'peak', ['max_concurrent', 'max']);
    expect(specific.alias).toBe('max_concurrent');
  });

  it('scores an unrelated header at zero', () => {
    expect(scoreHeader('invoice_total', 'user', ['user', 'username']).score).toBe(0);
  });
});

describe('aliasesFor', () => {
  it('layers adapter vocabulary on top of the shared base table', () => {
    const flexnet = aliasesFor(getAdapter('flexnet'), 'usage');
    // Source-specific first so it wins ties, base spellings still present.
    expect(flexnet.vendor?.[0]).toBe('vendor_daemon');
    expect(flexnet.vendor).toContain('publisher');
  });
});

describe('resolveColumns', () => {
  const flexnetHeaders = [
    'DATE',
    'FEATURE',
    'VENDOR_DAEMON',
    'USER',
    'SERVER_HOST',
    'LICENSES_ISSUED',
    'LICENSES_IN_USE',
  ];

  it('maps a FlexNet header row onto canonical fields', () => {
    const mappings = resolveColumns({
      headers: flexnetHeaders,
      adapter: getAdapter('flexnet'),
      dataset: 'usage',
    });
    const index = toFieldIndex(mappings);

    expect(index.get('date')).toBe('DATE');
    expect(index.get('feature')).toBe('FEATURE');
    expect(index.get('vendor')).toBe('VENDOR_DAEMON');
    expect(index.get('user')).toBe('USER');
    expect(index.get('available')).toBe('LICENSES_ISSUED');
    expect(index.get('concurrent')).toBe('LICENSES_IN_USE');
  });

  it('never assigns two columns to the same canonical field', () => {
    const mappings = resolveColumns({
      headers: ['user', 'username', 'user_id'],
      adapter: getAdapter('generic'),
      dataset: 'usage',
    });
    const assigned = mappings.map((mapping) => mapping.field).filter((field) => field === 'user');
    expect(assigned.length).toBe(1);
  });

  it('reports a confidence and sample value for every column', () => {
    const mappings = resolveColumns({
      headers: ['DATE', 'FEATURE'],
      adapter: getAdapter('flexnet'),
      dataset: 'usage',
      rows: [{ DATE: '2026-03-02', FEATURE: 'MECH_ENT' }],
    });

    expect(mappings).toHaveLength(2);
    for (const mapping of mappings) {
      expect(['exact', 'strong', 'possible', 'none']).toContain(mapping.confidence);
      expect(mapping.sampleValue).not.toBeNull();
    }
  });

  it('skips leading blanks when choosing a sample value', () => {
    const mappings = resolveColumns({
      headers: ['FEATURE'],
      adapter: getAdapter('generic'),
      dataset: 'usage',
      rows: [{ FEATURE: '' }, { FEATURE: '  ' }, { FEATURE: 'CFD_PREM' }],
    });
    expect(mappings[0]!.sampleValue).toBe('CFD_PREM');
  });

  it('honours a manual override', () => {
    const mappings = resolveColumns({
      headers: ['weird_column', 'FEATURE'],
      adapter: getAdapter('generic'),
      dataset: 'usage',
      overrides: { weird_column: 'user' },
    });
    const index = toFieldIndex(mappings);
    expect(index.get('user')).toBe('weird_column');
    expect(mappings.find((m) => m.sourceColumn === 'weird_column')?.confidence).toBe('exact');
  });

  it('honours an override that deliberately unmaps a column', () => {
    const mappings = resolveColumns({
      headers: ['USER', 'FEATURE'],
      adapter: getAdapter('generic'),
      dataset: 'usage',
      overrides: { USER: '' },
    });
    expect(mappings.find((m) => m.sourceColumn === 'USER')?.field).toBeNull();
  });

  it('reports required fields that nothing feeds', () => {
    const mappings = resolveColumns({
      headers: ['USER', 'SERVER_HOST'],
      adapter: getAdapter('generic'),
      dataset: 'usage',
    });
    const missing = missingRequiredFields(mappings, 'usage');
    expect(missing).toContain('Date');
    expect(missing).toContain('Feature');
  });

  it('maps the same concept across differently-worded sources', () => {
    const rlm = resolveColumns({
      headers: ['isv', 'product', 'count_in_use'],
      adapter: getAdapter('rlm'),
      dataset: 'usage',
    });
    const rlmIndex = toFieldIndex(rlm);
    expect(rlmIndex.get('vendor')).toBe('isv');
    expect(rlmIndex.get('feature')).toBe('product');
    expect(rlmIndex.get('concurrent')).toBe('count_in_use');

    const sentinel = resolveColumns({
      headers: ['Feature Name', 'Client User', 'Licenses In Use', 'Peak Usage'],
      adapter: getAdapter('sentinel'),
      dataset: 'usage',
    });
    const sentinelIndex = toFieldIndex(sentinel);
    expect(sentinelIndex.get('feature')).toBe('Feature Name');
    expect(sentinelIndex.get('user')).toBe('Client User');
    expect(sentinelIndex.get('concurrent')).toBe('Licenses In Use');
    expect(sentinelIndex.get('peak')).toBe('Peak Usage');
  });

  it('maps DSLS token columns without folding them into quantity', () => {
    const mappings = resolveColumns({
      headers: ['License Name', 'User ID', 'Token', 'Max Count', 'In Use'],
      adapter: getAdapter('dsls'),
      dataset: 'usage',
    });
    const index = toFieldIndex(mappings);
    expect(index.get('tokens')).toBe('Token');
    expect(index.get('quantity')).toBeUndefined();
  });
});
