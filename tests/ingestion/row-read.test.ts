import { describe, expect, it } from 'vitest';
import {
  asDateString,
  asTimestampString,
  toContractRecord,
  toEntitlementRecord,
  toUsageRecord,
} from '@/lib/ingestion/store/row-read';

/**
 * ── TWO ROADS, ONE RECORD ───────────────────────────────────────────────────
 *
 * Rows reach these mappers two ways. A signed-in customer's read comes over
 * PostgREST, which renders every column as a string. The projection worker
 * reads over a direct Postgres connection, which returns `date`, `timestamp`
 * and `timestamptz` as JavaScript Date objects.
 *
 * That difference is invisible in every count. The first worker build after the
 * switch to typed rows failed with `a.date.localeCompare is not a function`,
 * because a Date had reached code that sorts dates as strings — and the only
 * reason it was caught rather than published is that it threw. A column whose
 * type changed without throwing would have produced an analysis that reconciled
 * perfectly and was wrong.
 *
 * So every date-bearing field is asserted to come out identical from both.
 */

describe('normalising what the two connections return', () => {
  it('renders a Date as a plain calendar day', () => {
    expect(asDateString(new Date('2026-03-09T00:00:00.000Z'))).toBe('2026-03-09');
  });

  it('leaves a PostgREST date string exactly as it was', () => {
    expect(asDateString('2026-03-09')).toBe('2026-03-09');
  });

  it('takes the day from a timestamp for a column that means a day', () => {
    expect(asDateString('2026-03-09T17:45:00.000Z')).toBe('2026-03-09');
  });

  it('renders a Date as an ISO timestamp', () => {
    expect(asTimestampString(new Date('2026-03-09T17:45:00.000Z'))).toBe(
      '2026-03-09T17:45:00.000Z',
    );
  });

  it('passes null through rather than inventing an epoch', () => {
    // A missing date must stay missing. Coercing null to 1970 would put real
    // usage in a year nobody imported.
    expect(asDateString(null)).toBeNull();
    expect(asTimestampString(undefined)).toBeNull();
  });
});

/** The same row, as each connection would deliver it. */
const usageFromPostgrest = {
  usage_date: '2026-03-09',
  observed_at: '2026-03-09T17:45:00.000Z',
  checkout_at: '2026-03-09T09:00:00.000Z',
  checkin_at: null,
  hour: 9,
  raw_user: 'j.reyes',
  raw_feature: 'ANSYS_MECH_ENT',
  concurrent: 3,
  duration_hours: '2.5000',
  organization_id: 'org-1',
  import_id: 'imp-1',
  created_at: '2026-03-09T18:00:00.000Z',
  source_file: 'usage.csv',
  source_system: 'generic',
  source_sheet: null,
  source_row: 2,
};

const usageFromDirectConnection = {
  ...usageFromPostgrest,
  usage_date: new Date('2026-03-09T00:00:00.000Z'),
  observed_at: new Date('2026-03-09T17:45:00.000Z'),
  checkout_at: new Date('2026-03-09T09:00:00.000Z'),
  created_at: new Date('2026-03-09T18:00:00.000Z'),
};

describe('both connections produce the same record', () => {
  it('agrees on every field of a usage row', () => {
    expect(toUsageRecord(usageFromDirectConnection)).toEqual(
      toUsageRecord(usageFromPostgrest),
    );
  });

  it('produces a date that can be compared as a string', () => {
    // This is the exact call that failed in production.
    const record = toUsageRecord(usageFromDirectConnection);
    expect(() => record.date.localeCompare('2026-01-01')).not.toThrow();
    expect(record.date).toBe('2026-03-09');
  });

  it('agrees on an entitlement expiry', () => {
    const shared = {
      raw_feature: 'F',
      organization_id: 'org-1',
      import_id: 'imp-1',
      source_file: 'e.csv',
      source_system: 'generic',
      source_sheet: null,
      source_row: 2,
      created_at: '2026-03-09T18:00:00.000Z',
    };
    expect(
      toEntitlementRecord({ ...shared, expires_on: new Date('2027-01-31T00:00:00.000Z') }).expiresOn,
    ).toBe(toEntitlementRecord({ ...shared, expires_on: '2027-01-31' }).expiresOn);
  });

  it('agrees on contract dates, which decide renewals', () => {
    const shared = {
      raw_feature: 'F',
      organization_id: 'org-1',
      import_id: 'imp-1',
      source_file: 'c.csv',
      source_system: 'generic',
      source_sheet: null,
      source_row: 2,
      created_at: '2026-03-09T18:00:00.000Z',
      annual_cost: '120000.00',
    };
    const fromDates = toContractRecord({
      ...shared,
      contract_start_date: new Date('2026-04-01T00:00:00.000Z'),
      contract_end_date: new Date('2027-03-31T00:00:00.000Z'),
      renewal_date: new Date('2027-02-28T00:00:00.000Z'),
    });
    const fromStrings = toContractRecord({
      ...shared,
      contract_start_date: '2026-04-01',
      contract_end_date: '2027-03-31',
      renewal_date: '2027-02-28',
    });

    expect(fromDates.contractStartDate).toBe(fromStrings.contractStartDate);
    expect(fromDates.contractEndDate).toBe(fromStrings.contractEndDate);
    expect(fromDates.renewalDate).toBe(fromStrings.renewalDate);
    // And money still arrives as a number, not a string, on both roads.
    expect(fromDates.annualCost).toBe(120000);
  });
});
