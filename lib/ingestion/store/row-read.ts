/**
 * The one place a database row becomes a canonical record.
 *
 * Rows now arrive by two routes: over PostgREST for a signed-in customer, and
 * over a direct connection for the projection worker. Both must produce
 * identical records, and the failure if they drift is the worst kind this
 * product has — an analysis that reconciles perfectly by count while holding a
 * field in the wrong place.
 *
 * `row-shape.ts` is the mirror of this file for writes. Neither path is allowed
 * its own copy of either mapping.
 */

import type {
  CanonicalContractRecord,
  CanonicalEntitlementRecord,
  CanonicalPersonRecord,
  CanonicalUsageRecord,
  SourceSystem,
} from '../canonical/types';

type Row = Record<string, unknown>;

/**
 * Postgres returns numeric as a string to preserve exactness. Coercing here
 * rather than trusting the driver keeps money out of string concatenation,
 * where "5000" + 1 becomes "50001".
 */
export function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}


/**
 * Dates arrive as two different things depending on the road they took.
 *
 * PostgREST hands back strings. A direct Postgres connection hands back JS Date
 * objects for `date`, `timestamp` and `timestamptz`. The records these mappers
 * produce are compared and sorted as strings downstream, so a Date reaching
 * them fails with `a.date.localeCompare is not a function` -- which is how this
 * was found, on the first worker build after the reader switched to typed rows.
 *
 * Normalised here rather than at each call site: this is the seam where the two
 * roads meet, and it is the only place that should have to know they differ.
 */
export function asDateString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value);
  // Already a date, or a timestamp whose date half is what this column means.
  return text.length >= 10 ? text.slice(0, 10) : text;
}

export function asTimestampString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function provenanceOf(row: Row) {
  return {
    organizationId: row.organization_id as string,
    importId: row.import_id as string,
    importedAt: asTimestampString(row.created_at) as string,
    sourceFile: row.source_file as string,
    sourceSystem: row.source_system as SourceSystem,
    sourceSheet: row.source_sheet as string | null,
    sourceRow: row.source_row as number,
  };
}

export function toUsageRecord(row: Row): CanonicalUsageRecord {
  return {
    date: asDateString(row.usage_date) as string,
    hour: row.hour as number | null,
    observedAt: asTimestampString(row.observed_at),
    user: row.raw_user as string | null,
    employeeCode: row.employee_code as string | null,
    feature: row.raw_feature as string,
    product: row.raw_product as string | null,
    vendor: row.raw_vendor as string | null,
    quantity: row.quantity as number | null,
    concurrent: row.concurrent as number | null,
    peak: row.peak as number | null,
    available: row.available as number | null,
    durationHours: numberOrNull(row.duration_hours),
    checkoutAt: asTimestampString(row.checkout_at),
    checkinAt: asTimestampString(row.checkin_at),
    denied: row.denied as boolean | null,
    denialCount: row.denial_count as number | null,
    licenseServer: row.license_server as string | null,
    pool: row.pool as string | null,
    tokens: numberOrNull(row.tokens),
    // `?? null` rather than a bare cast: rows written before these columns
    // existed come back with the key absent, and undefined would defeat the
    // whole point of distinguishing "not reported" from "false".
    hostname: (row.hostname as string | null | undefined) ?? null,
    version: (row.version as string | null | undefined) ?? null,
    borrowed: (row.borrowed as boolean | null | undefined) ?? null,
    provenance: provenanceOf(row),
  } as CanonicalUsageRecord;
}

export function toEntitlementRecord(row: Row): CanonicalEntitlementRecord {
  return {
    feature: row.raw_feature as string,
    product: row.raw_product as string | null,
    vendor: row.raw_vendor as string | null,
    entitledQuantity: row.entitled_quantity as number | null,
    licenseModel: row.license_model as CanonicalEntitlementRecord['licenseModel'],
    licenseServer: row.license_server as string | null,
    pool: row.pool as string | null,
    expiresOn: asDateString(row.expires_on),
    provenance: provenanceOf(row),
  } as CanonicalEntitlementRecord;
}

export function toPersonRecord(row: Row): CanonicalPersonRecord {
  return {
    user: row.raw_user as string,
    employeeCode: row.employee_code as string | null,
    displayName: row.display_name as string | null,
    email: row.email as string | null,
    employmentStatus: row.employment_status as string | null,
    employmentType: row.employment_type as string | null,
    managerName: row.manager_name as string | null,
    managerKey: row.manager_key as string | null,
    department: row.department as string | null,
    organization: row.organization as string | null,
    businessUnit: row.business_unit as string | null,
    program: row.program as string | null,
    discipline: row.discipline as string | null,
    competency: row.competency as string | null,
    location: row.location as string | null,
    region: row.region as string | null,
    costCenter: row.cost_center as string | null,
    provenance: provenanceOf(row),
  } as CanonicalPersonRecord;
}

export function toContractRecord(row: Row): CanonicalContractRecord {
  return {
    feature: row.raw_feature as string,
    product: row.raw_product as string | null,
    vendor: row.raw_vendor as string | null,
    sku: row.sku as string | null,
    contractNumber: row.contract_number as string | null,
    agreementNumber: row.agreement_number as string | null,
    purchaseOrder: row.purchase_order as string | null,
    supplier: row.supplier as string | null,
    quantity: numberOrNull(row.quantity),
    unitPrice: numberOrNull(row.unit_price),
    totalCost: numberOrNull(row.total_cost),
    annualCost: numberOrNull(row.annual_cost),
    currency: row.currency as string | null,
    licenseModel: row.license_model as CanonicalContractRecord['licenseModel'],
    pricingUnit: row.pricing_unit as string | null,
    contractStartDate: asDateString(row.contract_start_date),
    contractEndDate: asDateString(row.contract_end_date),
    renewalDate: asDateString(row.renewal_date),
    businessUnit: row.business_unit as string | null,
    costCenter: row.cost_center as string | null,
    owner: row.owner as string | null,
    notes: row.notes as string | null,
    unitPriceBasis: row.unit_price_basis as CanonicalContractRecord['unitPriceBasis'],
    annualCostBasis: row.annual_cost_basis as CanonicalContractRecord['annualCostBasis'],
    multiYearTotal: Boolean(row.multi_year_total),
    provenance: provenanceOf(row),
  } as CanonicalContractRecord;
}
