/**
 * The canonical ingestion model.
 *
 * Every adapter — FlexNet, RLM, DSLS, Sentinel, generic — converts its source
 * into these shapes and nothing else. The analytics engine never learns which
 * license manager produced a number.
 *
 * TRUTHFULNESS CONSTRAINT — read before adding a field.
 *
 * A field is `null` when the source did not carry it. Adapters must never
 * invent a value to fill a column: an inferred concurrency figure looks
 * identical to a measured one once it reaches the analytics engine, and a
 * renewal recommendation built on it cannot be defended in a negotiation.
 * Report the gap through the quality report instead.
 */

/** License-management systems Phase 1 can read files from. */
export type SourceSystem = 'flexnet' | 'rlm' | 'dsls' | 'sentinel' | 'generic';

export const SOURCE_SYSTEMS: SourceSystem[] = ['flexnet', 'rlm', 'dsls', 'sentinel', 'generic'];

/** The record families a file can produce. */
export type CanonicalDataset = 'usage' | 'entitlements' | 'people' | 'contracts';

export const CANONICAL_DATASETS: CanonicalDataset[] = ['usage', 'entitlements', 'people', 'contracts'];

/**
 * Where a record came from.
 *
 * Attached to every canonical record. EngiSignal recommendations are only
 * defensible if any single number can be traced back to the row of the file it
 * came from, so provenance is required rather than optional.
 */
export interface Provenance {
  /** Tenant that owns the record. Carried on the record itself so a mixed batch cannot be written across tenants. */
  organizationId: string;
  importId: string;
  /** ISO timestamp of the import run. */
  importedAt: string;
  sourceFile: string;
  sourceSystem: SourceSystem;
  /** Worksheet name for workbooks; null for delimited files. */
  sourceSheet: string | null;
  /**
   * 1-based row number in the source, counting the header as row 1, so the
   * number matches what the customer sees when they open the file.
   */
  sourceRow: number;
}

/** How a license is consumed. Unknown when the source does not say. */
export type LicenseModel = 'concurrent' | 'named_user' | 'token' | 'node_locked' | 'unknown';

/**
 * One usage observation.
 *
 * Sources disagree on granularity: FlexNet report logs are event-level
 * (checkout/checkin), Sentinel polls are interval snapshots. Both land here,
 * and the fields the source could not provide stay null.
 */
export interface CanonicalUsageRecord {
  /** ISO calendar date, always present — a usage row without a date is rejected. */
  date: string;
  /** 0–23 when the source carries a time, else null. */
  hour: number | null;
  /** ISO timestamp when the source carried a full timestamp. */
  observedAt: string | null;
  user: string | null;
  employeeCode: string | null;
  /** Raw feature string exactly as the license manager recorded it. */
  feature: string;
  product: string | null;
  vendor: string | null;
  /** Checkouts or requested quantity for this row. */
  quantity: number | null;
  /** Licenses in use at the observation. */
  concurrent: number | null;
  /** Maximum concurrent use within the row's bucket. */
  peak: number | null;
  /** Capacity reported alongside the observation, when present. */
  available: number | null;
  durationHours: number | null;
  checkoutAt: string | null;
  checkinAt: string | null;
  /** True when the row represents a denied request. Null when the source cannot report denials. */
  denied: boolean | null;
  denialCount: number | null;
  licenseServer: string | null;
  pool: string | null;
  /** Token weight consumed, for token-based products such as DSLS. */
  tokens: number | null;
  provenance: Provenance;
}

/** Entitlement / capacity as reported by a license server or export. */
export interface CanonicalEntitlementRecord {
  feature: string;
  product: string | null;
  vendor: string | null;
  entitledQuantity: number | null;
  licenseModel: LicenseModel;
  licenseServer: string | null;
  pool: string | null;
  /** ISO date, or null when perpetual or unstated. */
  expiresOn: string | null;
  provenance: Provenance;
}

/**
 * A person as the directory or HR export described them.
 *
 * The organizational fields are what turn "275 concurrent licences" into
 * "Structures drives 60% of Ansys demand". Every one of them is optional and
 * stays null when absent: an allocation built on a guessed department would
 * send a cost conversation to the wrong director, and "Unknown = 0" would tell
 * them their group uses nothing.
 */
export interface CanonicalPersonRecord {
  user: string;
  employeeCode: string | null;
  displayName: string | null;
  email: string | null;

  /** Active, terminated, on leave — as the source stated it. */
  employmentStatus: string | null;
  /** Employee or contractor, when distinguished. */
  employmentType: string | null;
  managerName: string | null;
  /** Manager's employee id or email — the only defensible way to link a chain. */
  managerKey: string | null;

  department: string | null;
  organization: string | null;
  businessUnit: string | null;
  program: string | null;
  discipline: string | null;
  competency: string | null;
  location: string | null;
  region: string | null;
  costCenter: string | null;

  provenance: Provenance;
}

/**
 * How a commercial value was arrived at.
 *
 * Stored on the record itself so any figure in a renewal position can be
 * defended line by line. `supplied` means the file stated it; `quantity_x_unit`
 * and `total_over_quantity` are the only two arithmetic derivations performed,
 * and both are reversible from fields that are also stored.
 *
 * Deliberately absent: any rule that spreads a multi-year total across a term.
 * A `Total` column may be a one-year price, a three-year commitment or a
 * co-termed true-up, and the spreadsheet rarely says which. Dividing by the
 * term would produce a confident annual figure from an assumption the customer
 * never made, so a multi-year total is carried as `totalCost` and left out of
 * annual reporting instead.
 */
export type CostBasis =
  | 'supplied_unit_price'
  | 'supplied_annual_cost'
  | 'supplied_total_cost'
  | 'quantity_x_unit'
  | 'total_over_quantity'
  | 'none';

/**
 * One commercial line: what was bought, on what terms, for how much.
 *
 * MINIMUM IMPORTABLE RECORD — stated here because rejecting a customer's row
 * needs a defensible reason.
 *
 * A row must carry:
 *   1. an identity — `feature`, or a `product` or `sku` to stand in for it, and
 *   2. at least one of a cost basis (unitPrice / totalCost / annualCost)
 *      or a contract date (renewalDate / contractEndDate).
 *
 * The second half is deliberately not "must have a price". A renewal schedule
 * that lists dates but leaves pricing to procurement is a real and useful
 * document: it unlocks renewal exposure even with no money in it. What the rule
 * does reject is a row carrying a name and nothing else, which cannot
 * contribute to any analysis and would otherwise inflate the accepted count
 * with rows that do nothing.
 */
export interface CanonicalContractRecord {
  /** Raw feature string as the commercial document wrote it. */
  feature: string;
  product: string | null;
  vendor: string | null;
  sku: string | null;

  contractNumber: string | null;
  agreementNumber: string | null;
  purchaseOrder: string | null;
  supplier: string | null;

  quantity: number | null;
  /** Price for one unit, as supplied or derived. Null when not determinable. */
  unitPrice: number | null;
  totalCost: number | null;
  annualCost: number | null;
  /** ISO 4217 when the file stated one. Never defaulted — see cost.ts. */
  currency: string | null;
  licenseModel: LicenseModel;
  /** What one unit of `quantity` is: seat, token, core. Null when unstated. */
  pricingUnit: string | null;

  contractStartDate: string | null;
  contractEndDate: string | null;
  renewalDate: string | null;

  businessUnit: string | null;
  costCenter: string | null;
  owner: string | null;
  notes: string | null;

  /** How `unitPrice` was obtained. Shown to the customer alongside the figure. */
  unitPriceBasis: CostBasis;
  /** How `annualCost` was obtained. */
  annualCostBasis: CostBasis;
  /** True when totalCost covers a term longer than a year, so it is not annualized. */
  multiYearTotal: boolean;

  provenance: Provenance;
}

export type CanonicalRecord =
  | CanonicalUsageRecord
  | CanonicalEntitlementRecord
  | CanonicalPersonRecord
  | CanonicalContractRecord;

// ─────────────────────────────────────────────────────────────────────────────
// Rejections and warnings
// ─────────────────────────────────────────────────────────────────────────────

export type RejectionRule =
  | 'missing_required_field'
  | 'unmapped_required_field'
  | 'invalid_date'
  | 'invalid_number'
  | 'invalid_hour'
  | 'negative_quantity'
  | 'duplicate_row'
  | 'malformed_row'
  /** A commercial row carrying neither a cost basis nor a contract date. */
  | 'no_commercial_content'
  | 'invalid_currency'
  /** End or renewal date earlier than the start date. */
  | 'inconsistent_dates';

/**
 * One rejected source row.
 *
 * Rows are never dropped quietly. Each rejection names the row, the field, the
 * offending value and the rule, so a customer can open the file and see exactly
 * what EngiSignal refused and why.
 */
export interface RejectedRow {
  sourceRow: number;
  sourceSheet: string | null;
  rule: RejectionRule;
  field: string | null;
  /** Truncated for safety — source values can be long. */
  value: string | null;
  message: string;
}

export type WarningCode =
  | 'row_limit_reached'
  | 'sheet_skipped'
  | 'unmapped_column'
  | 'missing_optional_field'
  | 'low_detection_confidence'
  | 'parser_warning';

export interface IngestionWarning {
  code: WarningCode;
  message: string;
  detail: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Quality
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Coverage for one canonical field.
 *
 * `supportedBySource` is the honest half: Sentinel interval polls cannot
 * produce checkout/checkin pairs, so 0% coverage there is a property of the
 * source rather than a defect in the customer's file.
 */
export interface FieldCoverage {
  field: string;
  label: string;
  /** Records carrying a non-null value. */
  populated: number;
  total: number;
  /** 0–100. */
  coveragePct: number;
  supportedBySource: boolean;
  note: string | null;
}

export interface QualityReport {
  /** Overall 0–100 confidence that the file was understood correctly. */
  confidence: number;
  coverage: FieldCoverage[];
  /** Fields the detected source can never provide, stated plainly. */
  unsupportedFields: string[];
  notes: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Results
// ─────────────────────────────────────────────────────────────────────────────

export interface RejectionSummary {
  rule: RejectionRule;
  field: string | null;
  count: number;
  message: string;
  examples: string[];
}

export interface IngestionResult {
  dataset: CanonicalDataset;
  sourceSystem: SourceSystem;
  usage: CanonicalUsageRecord[];
  entitlements: CanonicalEntitlementRecord[];
  people: CanonicalPersonRecord[];
  contracts: CanonicalContractRecord[];
  totalRows: number;
  acceptedRows: number;
  rejectedRows: number;
  /** Capped for transport; `rejectedRows` is the true count. */
  rejections: RejectedRow[];
  rejectionSummary: RejectionSummary[];
  duplicateRows: number;
  warnings: IngestionWarning[];
  quality: QualityReport;
}
