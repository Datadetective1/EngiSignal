/**
 * The one place a canonical record becomes a database row.
 *
 * Persistence now happens twice over: once in the request, which records the
 * import, and once in a worker minutes later, which writes the rows. Those two
 * paths must agree on every column, and the failure mode if they drift is the
 * worst kind this product has -- an import that completes, reconciles by count,
 * and holds a field in the wrong place.
 *
 * So the mapping lives here and neither path is allowed its own copy.
 *
 * `organization_id` and `import_id` are deliberately absent. The database takes
 * both from arguments the caller cannot influence per row, so a payload cannot
 * place a row in another tenant even if it tries.
 */

import type {
  CanonicalContractRecord,
  CanonicalEntitlementRecord,
  CanonicalPersonRecord,
  CanonicalUsageRecord,
} from '../canonical/types';

export function usageRow(record: CanonicalUsageRecord): Record<string, unknown> {
  return {
    usage_date: record.date,
    hour: record.hour,
    observed_at: record.observedAt,
    raw_user: record.user,
    employee_code: record.employeeCode,
    raw_feature: record.feature,
    raw_product: record.product,
    raw_vendor: record.vendor,
    quantity: record.quantity,
    concurrent: record.concurrent,
    peak: record.peak,
    available: record.available,
    duration_hours: record.durationHours,
    checkout_at: record.checkoutAt,
    checkin_at: record.checkinAt,
    denied: record.denied,
    denial_count: record.denialCount,
    license_server: record.licenseServer,
    pool: record.pool,
    tokens: record.tokens,
    source_system: record.provenance.sourceSystem,
    source_file: record.provenance.sourceFile,
    source_sheet: record.provenance.sourceSheet,
    source_row: record.provenance.sourceRow,
  };
}

export function entitlementRow(record: CanonicalEntitlementRecord): Record<string, unknown> {
  return {
    raw_feature: record.feature,
    raw_product: record.product,
    raw_vendor: record.vendor,
    entitled_quantity: record.entitledQuantity,
    license_model: record.licenseModel,
    license_server: record.licenseServer,
    pool: record.pool,
    expires_on: record.expiresOn,
    source_system: record.provenance.sourceSystem,
    source_file: record.provenance.sourceFile,
    source_sheet: record.provenance.sourceSheet,
    source_row: record.provenance.sourceRow,
  };
}

export function personRow(record: CanonicalPersonRecord): Record<string, unknown> {
  return {
    raw_user: record.user,
    employee_code: record.employeeCode,
    display_name: record.displayName,
    email: record.email,
    employment_status: record.employmentStatus,
    employment_type: record.employmentType,
    manager_name: record.managerName,
    manager_key: record.managerKey,
    department: record.department,
    organization: record.organization,
    business_unit: record.businessUnit,
    program: record.program,
    discipline: record.discipline,
    competency: record.competency,
    location: record.location,
    region: record.region,
    cost_center: record.costCenter,
    source_system: record.provenance.sourceSystem,
    source_file: record.provenance.sourceFile,
    source_sheet: record.provenance.sourceSheet,
    source_row: record.provenance.sourceRow,
  };
}

export function contractRow(record: CanonicalContractRecord): Record<string, unknown> {
  return {
    raw_feature: record.feature,
    raw_product: record.product,
    raw_vendor: record.vendor,
    sku: record.sku,
    contract_number: record.contractNumber,
    agreement_number: record.agreementNumber,
    purchase_order: record.purchaseOrder,
    supplier: record.supplier,
    quantity: record.quantity,
    unit_price: record.unitPrice,
    total_cost: record.totalCost,
    annual_cost: record.annualCost,
    currency: record.currency,
    license_model: record.licenseModel,
    pricing_unit: record.pricingUnit,
    contract_start_date: record.contractStartDate,
    contract_end_date: record.contractEndDate,
    renewal_date: record.renewalDate,
    business_unit: record.businessUnit,
    cost_center: record.costCenter,
    owner: record.owner,
    notes: record.notes,
    unit_price_basis: record.unitPriceBasis,
    annual_cost_basis: record.annualCostBasis,
    multi_year_total: record.multiYearTotal,
    source_system: record.provenance.sourceSystem,
    source_file: record.provenance.sourceFile,
    source_sheet: record.provenance.sourceSheet,
    source_row: record.provenance.sourceRow,
  };
}

/** The rows a parsed file contributes, in the order the worker writes them. */
export function rowsForDataset(
  dataset: string,
  result: {
    usage: CanonicalUsageRecord[];
    entitlements: CanonicalEntitlementRecord[];
    people: CanonicalPersonRecord[];
    contracts: CanonicalContractRecord[];
  },
): Record<string, unknown>[] {
  switch (dataset) {
    case 'usage':
      return result.usage.map(usageRow);
    case 'entitlements':
      return result.entitlements.map(entitlementRow);
    case 'people':
      return result.people.map(personRow);
    case 'contracts':
      return result.contracts.map(contractRow);
    default:
      throw new Error(`Unknown dataset ${dataset}.`);
  }
}
