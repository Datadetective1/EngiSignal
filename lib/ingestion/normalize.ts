/**
 * Normalization.
 *
 * Turns resolved columns into canonical records, one source row at a time.
 *
 * Two rules govern everything here:
 *
 *  1. No row disappears. Every input row is either accepted or recorded as a
 *     rejection with its source row number, the field at fault, the offending
 *     value and the rule that refused it.
 *  2. No value is invented. A field the source did not carry stays null and is
 *     reported through coverage, rather than being inferred from a neighbouring
 *     column.
 */

import type {
  CanonicalDataset,
  CanonicalEntitlementRecord,
  CanonicalPersonRecord,
  CanonicalUsageRecord,
  Provenance,
  RejectedRow,
  RejectionRule,
  RejectionSummary,
} from './canonical/types';
import { fieldSpec } from './adapters/fields';
import type { ColumnMapping } from './adapters/resolve';
import { toFieldIndex } from './adapters/resolve';
import type { CanonicalFieldKey, IngestionAdapter } from './adapters/types';
import { effectiveRequiredFields } from './requirements';
import { parseBoolean, parseDate, parseHour, parseLicenseModel, parseNumber, parseText, parseTimestamp } from './values';

export interface NormalizeInput {
  dataset: CanonicalDataset;
  adapter: IngestionAdapter;
  mappings: readonly ColumnMapping[];
  rows: readonly Record<string, unknown>[];
  /** Source row numbers parallel to `rows`. */
  sourceRows: readonly number[];
  sheetName: string | null;
  provenance: Omit<Provenance, 'sourceRow' | 'sourceSheet'>;
  options?: NormalizeOptions;
}

export interface NormalizeOptions {
  /** Interpret ambiguous numeric dates as DD/MM/YYYY. */
  dayFirst?: boolean;
  /** Drop exact duplicates after the first occurrence. Default true. */
  rejectDuplicates?: boolean;
  /** Cap on retained rejection detail; the count is always exact. */
  maxRejectionDetail?: number;
}

export interface NormalizeOutput {
  usage: CanonicalUsageRecord[];
  entitlements: CanonicalEntitlementRecord[];
  people: CanonicalPersonRecord[];
  accepted: number;
  rejections: RejectedRow[];
  rejectedCount: number;
  duplicateCount: number;
}

const DEFAULT_MAX_REJECTION_DETAIL = 500;

/** Quantity-like fields where a negative value is not physically meaningful. */
const NON_NEGATIVE_FIELDS = new Set<CanonicalFieldKey>([
  'quantity',
  'concurrent',
  'peak',
  'available',
  'durationHours',
  'denialCount',
  'tokens',
  'entitledQuantity',
]);

export function normalizeRows(input: NormalizeInput): NormalizeOutput {
  const {
    dataset,
    adapter,
    mappings,
    rows,
    sourceRows,
    sheetName,
    provenance,
    options = {},
  } = input;

  const {
    dayFirst = false,
    rejectDuplicates = true,
    maxRejectionDetail = DEFAULT_MAX_REJECTION_DETAIL,
  } = options;

  const columnFor = toFieldIndex(mappings);

  const usage: CanonicalUsageRecord[] = [];
  const entitlements: CanonicalEntitlementRecord[] = [];
  const people: CanonicalPersonRecord[] = [];
  const rejections: RejectedRow[] = [];

  let rejectedCount = 0;
  let duplicateCount = 0;
  const seen = new Map<string, number>();

  // A row can fail several rules at once — an invalid date AND a negative
  // quantity. Every reason is recorded, but the row is counted once, so
  // accepted + rejected always equals the number of rows in the file.
  let currentRow = -1;
  let currentRowRejected = false;

  const reject = (
    sourceRow: number,
    rule: RejectionRule,
    field: string | null,
    value: unknown,
    message: string,
  ) => {
    if (sourceRow !== currentRow) {
      currentRow = sourceRow;
      currentRowRejected = false;
    }
    if (!currentRowRejected) {
      rejectedCount += 1;
      currentRowRejected = true;
    }
    if (rejections.length < maxRejectionDetail) {
      rejections.push({
        sourceRow,
        sourceSheet: sheetName,
        rule,
        field,
        value: value === null || value === undefined ? null : String(value).slice(0, 60),
        message,
      });
    }
  };

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index] ?? {};
    const sourceRow = sourceRows[index] ?? index + 2;

    currentRow = sourceRow;
    currentRowRejected = false;

    const rowProvenance: Provenance = { ...provenance, sourceRow, sourceSheet: sheetName };

    /** Read a mapped field, coercing by its declared type. */
    const read = (key: CanonicalFieldKey): { ok: boolean; value: unknown } => {
      const column = columnFor.get(key);
      if (column === undefined) return { ok: true, value: null };

      const raw = row[column];
      if (raw === null || raw === undefined || String(raw).trim().length === 0) {
        return { ok: true, value: null };
      }

      const spec = fieldSpec(dataset, key);
      switch (spec?.type) {
        case 'date': {
          const parsed = parseDate(raw, { dayFirst });
          if (parsed === null) {
            reject(sourceRow, 'invalid_date', key, raw, `${spec.label} is not a recognizable date.`);
            return { ok: false, value: null };
          }
          return { ok: true, value: parsed };
        }
        case 'datetime': {
          const parsed = parseTimestamp(raw, { dayFirst });
          if (parsed === null) {
            reject(sourceRow, 'invalid_date', key, raw, `${spec.label} is not a recognizable timestamp.`);
            return { ok: false, value: null };
          }
          return { ok: true, value: parsed };
        }
        case 'number': {
          const parsed = parseNumber(raw);
          if (parsed === null) {
            reject(sourceRow, 'invalid_number', key, raw, `${spec.label} is not numeric.`);
            return { ok: false, value: null };
          }
          if (parsed < 0 && NON_NEGATIVE_FIELDS.has(key)) {
            reject(sourceRow, 'negative_quantity', key, raw, `${spec.label} cannot be negative.`);
            return { ok: false, value: null };
          }
          return { ok: true, value: parsed };
        }
        case 'hour': {
          const parsed = parseHour(raw);
          if (parsed === null) {
            reject(sourceRow, 'invalid_hour', key, raw, `${spec.label} must be a whole number from 0 to 23.`);
            return { ok: false, value: null };
          }
          return { ok: true, value: parsed };
        }
        case 'boolean': {
          const coerced = adapter.coerce?.denied?.(String(raw));
          if (coerced !== undefined) return { ok: true, value: coerced };
          // An uninterpretable status is not a denial; leave it unknown rather
          // than defaulting to false and understating unmet demand.
          return { ok: true, value: parseBoolean(raw) };
        }
        default:
          return { ok: true, value: parseText(raw) };
      }
    };

    // Required fields are checked first so a row missing its key identity is
    // rejected once, with the clearest reason.
    const requiredKeys = requiredFieldsFor(dataset, columnFor);
    let rowOk = true;

    for (const key of requiredKeys) {
      const column = columnFor.get(key);
      const spec = fieldSpec(dataset, key);
      if (column === undefined) {
        reject(
          sourceRow,
          'unmapped_required_field',
          key,
          null,
          `${spec?.label ?? key} is required but no column is mapped to it.`,
        );
        rowOk = false;
        continue;
      }
      const raw = row[column];
      if (raw === null || raw === undefined || String(raw).trim().length === 0) {
        reject(sourceRow, 'missing_required_field', key, null, `${spec?.label ?? key} is empty.`);
        rowOk = false;
      }
    }

    if (!rowOk) continue;

    if (dataset === 'usage') {
      const date = read('date');
      const feature = read('feature');
      const hour = read('hour');
      const observedAt = read('observedAt');
      const quantity = read('quantity');
      const concurrent = read('concurrent');
      const peak = read('peak');
      const available = read('available');
      const duration = read('durationHours');
      const checkoutAt = read('checkoutAt');
      const checkinAt = read('checkinAt');
      const denialCount = read('denialCount');
      const denied = read('denied');
      const tokens = read('tokens');

      if (
        !date.ok ||
        !feature.ok ||
        !hour.ok ||
        !observedAt.ok ||
        !quantity.ok ||
        !concurrent.ok ||
        !peak.ok ||
        !available.ok ||
        !duration.ok ||
        !checkoutAt.ok ||
        !checkinAt.ok ||
        !denialCount.ok ||
        !denied.ok ||
        !tokens.ok
      ) {
        continue;
      }

      // Take the calendar date from a timestamp when the file has no date
      // column. Both are parsed as UTC, so the two agree.
      const resolvedDate =
        (date.value as string | null) ??
        (typeof observedAt.value === 'string' ? observedAt.value.slice(0, 10) : null) ??
        (typeof checkoutAt.value === 'string' ? checkoutAt.value.slice(0, 10) : null);

      if (resolvedDate === null) {
        reject(sourceRow, 'missing_required_field', 'date', null, 'Date is empty and no timestamp was available to take it from.');
        continue;
      }

      const productValue = read('product').value as string | null;
      const resolvedFeature = (feature.value as string | null) ?? productValue;
      if (resolvedFeature === null) {
        reject(sourceRow, 'missing_required_field', 'feature', null, 'Feature is empty and no product name was available to identify it.');
        continue;
      }

      const record: CanonicalUsageRecord = {
        date: resolvedDate,
        hour: hour.value as number | null,
        observedAt: observedAt.value as string | null,
        user: read('user').value as string | null,
        employeeCode: read('employeeCode').value as string | null,
        feature: resolvedFeature,
        product: productValue,
        vendor: read('vendor').value as string | null,
        quantity: quantity.value as number | null,
        concurrent: concurrent.value as number | null,
        peak: peak.value as number | null,
        available: available.value as number | null,
        durationHours: duration.value as number | null,
        checkoutAt: checkoutAt.value as string | null,
        checkinAt: checkinAt.value as string | null,
        denied: adapter.capabilities.denials ? (denied.value as boolean | null) : null,
        denialCount: denialCount.value as number | null,
        licenseServer: read('licenseServer').value as string | null,
        pool: read('pool').value as string | null,
        tokens: tokens.value as number | null,
        provenance: rowProvenance,
      };

      const key = usageKey(record);
      const firstSeen = seen.get(key);
      if (rejectDuplicates && firstSeen !== undefined) {
        duplicateCount += 1;
        reject(sourceRow, 'duplicate_row', null, null, `Duplicate of row ${firstSeen}.`);
        continue;
      }
      seen.set(key, sourceRow);
      usage.push(record);
      continue;
    }

    if (dataset === 'entitlements') {
      const feature = read('feature');
      const quantity = read('entitledQuantity');
      const expiresOn = read('expiresOn');
      if (!feature.ok || !quantity.ok || !expiresOn.ok) continue;

      const modelRaw = columnFor.get('licenseModel');
      const modelText = modelRaw === undefined ? null : parseText(row[modelRaw]);
      const licenseModel =
        modelText === null
          ? 'unknown'
          : (adapter.coerce?.licenseModel?.(modelText) ?? parseLicenseModel(modelText));

      const entitlementProduct = read('product').value as string | null;
      const entitlementFeature = (feature.value as string | null) ?? entitlementProduct;
      if (entitlementFeature === null) {
        reject(sourceRow, 'missing_required_field', 'feature', null, 'Feature is empty and no product name was available to identify it.');
        continue;
      }

      const record: CanonicalEntitlementRecord = {
        feature: entitlementFeature,
        product: entitlementProduct,
        vendor: read('vendor').value as string | null,
        entitledQuantity: quantity.value as number | null,
        licenseModel,
        licenseServer: read('licenseServer').value as string | null,
        pool: read('pool').value as string | null,
        expiresOn: expiresOn.value as string | null,
        provenance: rowProvenance,
      };

      const key = [record.feature, record.licenseServer, record.pool, record.expiresOn].join('|').toLowerCase();
      const firstSeen = seen.get(key);
      if (rejectDuplicates && firstSeen !== undefined) {
        duplicateCount += 1;
        reject(sourceRow, 'duplicate_row', null, null, `Duplicate of row ${firstSeen}.`);
        continue;
      }
      seen.set(key, sourceRow);
      entitlements.push(record);
      continue;
    }

    const user = read('user');
    if (!user.ok) continue;

    const record: CanonicalPersonRecord = {
      user: String(user.value),
      employeeCode: read('employeeCode').value as string | null,
      displayName: read('displayName').value as string | null,
      email: read('email').value as string | null,
      provenance: rowProvenance,
    };

    const key = record.user.toLowerCase();
    const firstSeen = seen.get(key);
    if (rejectDuplicates && firstSeen !== undefined) {
      duplicateCount += 1;
      reject(sourceRow, 'duplicate_row', null, null, `Duplicate of row ${firstSeen}.`);
      continue;
    }
    seen.set(key, sourceRow);
    people.push(record);
  }

  return {
    usage,
    entitlements,
    people,
    accepted: usage.length + entitlements.length + people.length,
    rejections,
    rejectedCount,
    duplicateCount,
  };
}

/**
 * Duplicate identity for a usage row.
 *
 * Deliberately includes the measures, not just the dimensions: the same user on
 * the same feature in the same hour with a different concurrent count is a
 * second observation, not a repeat, and collapsing the two would erase real
 * demand.
 */
function usageKey(record: CanonicalUsageRecord): string {
  return [
    record.date,
    record.hour ?? '',
    record.observedAt ?? '',
    (record.user ?? '').toLowerCase(),
    record.feature.toLowerCase(),
    record.licenseServer ?? '',
    record.pool ?? '',
    record.quantity ?? '',
    record.concurrent ?? '',
    record.peak ?? '',
    record.checkoutAt ?? '',
  ].join('|');
}

/** Delegates to the single shared definition — see lib/ingestion/requirements.ts. */
function requiredFieldsFor(
  dataset: CanonicalDataset,
  columnFor: ReadonlyMap<CanonicalFieldKey, string>,
): CanonicalFieldKey[] {
  return effectiveRequiredFields(dataset, new Set(columnFor.keys()));
}

/** Group rejections for display; counts come from the caller, not this list. */
export function summarizeRejections(
  rejections: readonly RejectedRow[],
  totalRejected: number,
): RejectionSummary[] {
  const groups = new Map<string, RejectionSummary>();

  for (const rejection of rejections) {
    const key = `${rejection.rule}:${rejection.field ?? ''}`;
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, {
        rule: rejection.rule,
        field: rejection.field,
        count: 1,
        message: rejection.message,
        examples: rejection.value === null ? [] : [rejection.value],
      });
      continue;
    }
    existing.count += 1;
    if (existing.examples.length < 3 && rejection.value !== null && !existing.examples.includes(rejection.value)) {
      existing.examples.push(rejection.value);
    }
  }

  const summary = [...groups.values()].sort((a, b) => b.count - a.count);

  // Group counts are reason counts, and one row can fail for several reasons,
  // so they are compared against distinct rows rather than summed. Without
  // this, a row with two problems would look like an extra rejected row.
  const rowsWithDetail = new Set(rejections.map((rejection) => rejection.sourceRow)).size;
  if (rowsWithDetail < totalRejected) {
    summary.push({
      rule: 'malformed_row',
      field: null,
      count: totalRejected - rowsWithDetail,
      message: 'Additional rejected rows beyond the detail limit retained for this report.',
      examples: [],
    });
  }

  return summary;
}
