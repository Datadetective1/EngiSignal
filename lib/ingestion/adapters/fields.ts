/**
 * Canonical field specifications and the base alias table.
 *
 * The base table holds spellings that are common across every license manager
 * and hand-built spreadsheet. Adapters add the vocabulary specific to their
 * source rather than restating all of this.
 */

import type { CanonicalDataset } from '../canonical/types';
import type { AliasTable, CanonicalFieldKey, FieldSpec } from './types';

export const USAGE_FIELDS: FieldSpec[] = [
  { key: 'date', label: 'Date', type: 'date', required: true, description: 'Calendar date of the observation.' },
  { key: 'hour', label: 'Hour', type: 'hour', required: false, description: 'Hour of day, 0–23. Enables daily-peak analysis.' },
  { key: 'observedAt', label: 'Timestamp', type: 'datetime', required: false, description: 'Full timestamp when the source records one.' },
  { key: 'user', label: 'User', type: 'string', required: false, description: 'License-manager username.' },
  { key: 'employeeCode', label: 'Employee ID', type: 'string', required: false, description: 'HR identifier, when carried.' },
  { key: 'feature', label: 'Feature', type: 'string', required: true, description: 'Raw license feature name.' },
  { key: 'product', label: 'Product', type: 'string', required: false, description: 'Product name when distinct from the feature.' },
  { key: 'vendor', label: 'Vendor', type: 'string', required: false, description: 'Vendor or vendor daemon.' },
  { key: 'quantity', label: 'Quantity', type: 'number', required: false, description: 'Checkouts or requested quantity.' },
  { key: 'concurrent', label: 'Concurrent in use', type: 'number', required: false, description: 'Licenses in use at the observation.' },
  { key: 'peak', label: 'Peak usage', type: 'number', required: false, description: 'Maximum concurrent use in the bucket.' },
  { key: 'available', label: 'Available capacity', type: 'number', required: false, description: 'Capacity reported alongside usage.' },
  { key: 'durationHours', label: 'Duration (hours)', type: 'number', required: false, description: 'Session length in hours.' },
  { key: 'checkoutAt', label: 'Checkout time', type: 'datetime', required: false, description: 'When the license was taken.' },
  { key: 'checkinAt', label: 'Check-in time', type: 'datetime', required: false, description: 'When the license was returned.' },
  { key: 'denied', label: 'Denied', type: 'boolean', required: false, description: 'Whether the request was refused.' },
  { key: 'denialCount', label: 'Denial count', type: 'number', required: false, description: 'Denied requests in the row.' },
  { key: 'licenseServer', label: 'License server', type: 'string', required: false, description: 'Server that issued the license.' },
  { key: 'pool', label: 'Pool', type: 'string', required: false, description: 'License pool or server group.' },
  { key: 'tokens', label: 'Tokens', type: 'number', required: false, description: 'Token weight consumed.' },
];

export const ENTITLEMENT_FIELDS: FieldSpec[] = [
  { key: 'feature', label: 'Feature', type: 'string', required: true, description: 'Entitled feature name.' },
  { key: 'product', label: 'Product', type: 'string', required: false, description: 'Product name.' },
  { key: 'vendor', label: 'Vendor', type: 'string', required: false, description: 'Vendor or vendor daemon.' },
  { key: 'entitledQuantity', label: 'Entitled quantity', type: 'number', required: true, description: 'Licenses owned.' },
  { key: 'licenseModel', label: 'License model', type: 'string', required: false, description: 'Concurrent, named user, token or node locked.' },
  { key: 'licenseServer', label: 'License server', type: 'string', required: false, description: 'Server hosting the entitlement.' },
  { key: 'pool', label: 'Pool', type: 'string', required: false, description: 'License pool or server group.' },
  { key: 'expiresOn', label: 'Expires on', type: 'date', required: false, description: 'Expiration date when stated.' },
];

export const PEOPLE_FIELDS: FieldSpec[] = [
  { key: 'user', label: 'User', type: 'string', required: true, description: 'Network or license-manager username.' },
  { key: 'employeeCode', label: 'Employee ID', type: 'string', required: false, description: 'HR identifier.' },
  { key: 'displayName', label: 'Full name', type: 'string', required: false, description: 'Display name.' },
  { key: 'email', label: 'Email', type: 'string', required: false, description: 'Work email address.' },
];

/**
 * Commercial fields.
 *
 * `feature` is the only nominally required identity, and even that is satisfied
 * by `product` or `sku` — see requirements.ts. Renewal spreadsheets are written
 * by procurement, not by license administrators, and frequently name the
 * product without ever using the license-manager's feature string.
 *
 * Nothing here is required beyond identity. The commercial-content rule that
 * decides whether a row carries anything usable lives in the normalizer, where
 * it can inspect the values rather than only the mapping.
 */
export const CONTRACT_FIELDS: FieldSpec[] = [
  { key: 'feature', label: 'Feature', type: 'string', required: true, description: 'Licensed feature, product or line item.' },
  { key: 'product', label: 'Product', type: 'string', required: false, description: 'Product name when distinct from the feature.' },
  { key: 'vendor', label: 'Vendor', type: 'string', required: false, description: 'Software publisher.' },
  { key: 'sku', label: 'SKU', type: 'string', required: false, description: 'Vendor part number. The strongest matching key when present.' },
  { key: 'contractNumber', label: 'Contract number', type: 'string', required: false, description: 'Contract reference.' },
  { key: 'agreementNumber', label: 'Agreement number', type: 'string', required: false, description: 'Master agreement reference.' },
  { key: 'purchaseOrder', label: 'Purchase order', type: 'string', required: false, description: 'PO number.' },
  { key: 'supplier', label: 'Supplier', type: 'string', required: false, description: 'Reseller, when it differs from the publisher.' },
  { key: 'quantity', label: 'Quantity', type: 'number', required: false, description: 'Units purchased: seats, concurrent slots or tokens.' },
  { key: 'unitPrice', label: 'Unit price', type: 'number', required: false, description: 'Price for a single unit.' },
  { key: 'totalCost', label: 'Total cost', type: 'number', required: false, description: 'Line total or contract value.' },
  { key: 'annualCost', label: 'Annual cost', type: 'number', required: false, description: 'Cost for one year. Preferred for annual reporting.' },
  { key: 'currency', label: 'Currency', type: 'string', required: false, description: 'ISO currency code. Never assumed when absent.' },
  { key: 'licenseModel', label: 'License model', type: 'string', required: false, description: 'Concurrent, named user, token or node locked.' },
  { key: 'pricingUnit', label: 'Pricing unit', type: 'string', required: false, description: 'What one unit represents: seat, token, core.' },
  { key: 'contractStartDate', label: 'Contract start', type: 'date', required: false, description: 'Term start date.' },
  { key: 'contractEndDate', label: 'Contract end', type: 'date', required: false, description: 'Term end date.' },
  { key: 'renewalDate', label: 'Renewal date', type: 'date', required: false, description: 'When the line must be renewed. Drives renewal exposure.' },
  { key: 'businessUnit', label: 'Business unit', type: 'string', required: false, description: 'Owning business unit.' },
  { key: 'costCenter', label: 'Cost centre', type: 'string', required: false, description: 'Charge code.' },
  { key: 'owner', label: 'Owner', type: 'string', required: false, description: 'Person accountable for the line.' },
  { key: 'notes', label: 'Notes', type: 'string', required: false, description: 'Free text carried through unchanged.' },
];

export const FIELDS_BY_DATASET: Record<CanonicalDataset, FieldSpec[]> = {
  usage: USAGE_FIELDS,
  entitlements: ENTITLEMENT_FIELDS,
  people: PEOPLE_FIELDS,
  contracts: CONTRACT_FIELDS,
};

export function fieldSpec(dataset: CanonicalDataset, key: CanonicalFieldKey): FieldSpec | undefined {
  return FIELDS_BY_DATASET[dataset].find((field) => field.key === key);
}

/**
 * Spellings shared by every source.
 *
 * Adapter tables are merged on top of this, so a FlexNet file whose author
 * renamed a column to something ordinary still maps.
 */
export const BASE_ALIASES: Record<CanonicalDataset, AliasTable> = {
  usage: {
    date: ['date', 'usage_date', 'day', 'log_date', 'event_date', 'report_date', 'activity_date', 'calendar_date'],
    hour: ['hour', 'hour_of_day', 'hr', 'time_bucket', 'interval', 'bucket'],
    observedAt: ['timestamp', 'datetime', 'date_time', 'event_time', 'observed_at', 'time_stamp', 'sample_time'],
    user: ['user', 'username', 'user_name', 'userid', 'user_id', 'login', 'login_name', 'network_id', 'network_user', 'account', 'account_name'],
    employeeCode: ['employee_id', 'employeeid', 'emp_id', 'empl_id', 'badge', 'personnel_number', 'worker_id'],
    feature: ['feature', 'feature_name', 'license_feature', 'lic_feature', 'module', 'featurename'],
    product: ['product', 'product_name', 'application', 'app', 'app_name', 'software', 'title'],
    vendor: ['vendor', 'publisher', 'supplier', 'manufacturer', 'vendor_name'],
    quantity: ['quantity', 'qty', 'count', 'num_licenses', 'licenses', 'requested', 'checkouts', 'checkout_count', 'usage_count', 'sessions', 'session_count'],
    // `licenses_in_use` and friends are listed EXPLICITLY so they win by exact
    // match. Without them, the generic alias `licenses` on quantity (8 chars)
    // outscored `in_use` on concurrent (6) by pure length, and a column that
    // plainly means concurrency was read as a checkout count. Because checkout
    // counts are deliberately excluded from concurrency, the result was a
    // feature with zero measured demand and therefore a P95 of zero — a
    // silently catastrophic under-recommendation.
    concurrent: [
      'licenses_in_use',
      'licences_in_use',
      'licenses_checked_out',
      'in_use_count',
      'concurrent',
      'in_use',
      'inuse',
      'used',
      'licenses_used',
      'checked_out',
      'current_usage',
      'active',
    ],
    peak: ['peak', 'peak_usage', 'max_concurrent', 'max_used', 'high_water', 'maximum_used', 'peak_concurrent'],
    available: ['available', 'total', 'capacity', 'issued', 'total_licenses', 'licenses_available', 'free'],
    durationHours: ['duration', 'duration_hours', 'hours', 'usage_hours', 'license_hours', 'elapsed', 'elapsed_hours', 'runtime'],
    checkoutAt: ['checkout', 'checkout_time', 'check_out', 'start_time', 'acquired', 'out_time'],
    checkinAt: ['checkin', 'checkin_time', 'check_in', 'end_time', 'released', 'in_time'],
    denied: ['denied', 'denial', 'is_denied', 'rejected', 'status'],
    denialCount: ['denials', 'denial_count', 'denied_count', 'rejections', 'queued'],
    // Deliberately excludes bare `host` and `hostname`. In FlexNet and RLM
    // exports those name the CLIENT workstation, not the license server, and
    // mapping them here attributes demand to the wrong pool. Server columns are
    // matched by explicit server wording instead.
    licenseServer: ['license_server', 'lic_server', 'server_host', 'server_name', 'license_host'],
    pool: ['pool', 'license_pool', 'server_group', 'cluster', 'site'],
    tokens: ['tokens', 'token_count', 'token_usage', 'tokens_used', 'credits'],
  },
  entitlements: {
    feature: ['feature', 'feature_name', 'license_feature', 'module', 'featurename'],
    product: ['product', 'product_name', 'application', 'software', 'title'],
    vendor: ['vendor', 'publisher', 'supplier', 'manufacturer', 'vendor_name'],
    entitledQuantity: ['quantity', 'qty', 'entitled', 'entitled_quantity', 'seats', 'licenses', 'count', 'total_licenses', 'max', 'max_licenses', 'num_licenses', 'capacity'],
    licenseModel: ['license_model', 'license_type', 'model', 'type', 'metric', 'licensing_model'],
    licenseServer: ['license_server', 'lic_server', 'server_host', 'server_name', 'license_host'],
    pool: ['pool', 'license_pool', 'server_group', 'cluster', 'site'],
    expiresOn: ['expires', 'expiry', 'expiration', 'expiration_date', 'expires_on', 'end_date', 'valid_until', 'renewal_date'],
  },
  people: {
    user: ['user', 'username', 'user_name', 'login', 'network_id', 'network_user', 'userid', 'user_id', 'sam_account'],
    employeeCode: ['employee_id', 'employeeid', 'emp_id', 'empl_id', 'badge', 'personnel_number', 'worker_id'],
    displayName: ['name', 'full_name', 'fullname', 'display_name', 'employee_name', 'person'],
    email: ['email', 'email_address', 'mail', 'work_email'],
  },
  // Commercial vocabulary is procurement's, not the license administrator's.
  // These files are written in Excel by finance, so the spellings below are the
  // ones that actually appear on renewal schedules and PO extracts.
  //
  // THE MONEY COLUMNS NEED CARE. `Cost`, `Price` and `Total` are all ambiguous
  // in isolation, and reading a line total as a unit price would overstate a
  // renewal position by the quantity — a hundredfold error on a 100-seat line.
  // Each bare word is therefore claimed EXACTLY ONCE, by the field it most
  // often means on a purchasing document:
  //   `price`  → unit price  (a price is per-thing)
  //   `cost`   → total cost  (a cost sits next to a quantity as the extension)
  //   `spend`  → annual cost (spend is what finance reports per year)
  // Qualified spellings such as `unit_cost` or `annual_price` are exact matches
  // on their own field and win outright, and every assignment is shown to the
  // customer with a sample value before anything is committed.
  contracts: {
    feature: [
      'feature', 'feature_name', 'license_feature', 'module', 'component',
      'sku_description', 'item_description', 'line_description', 'description',
      'line_item', 'item',
    ],
    product: ['product', 'product_name', 'application', 'software', 'tool', 'software_name', 'title'],
    vendor: ['vendor', 'publisher', 'manufacturer', 'software_vendor', 'vendor_name', 'oem', 'brand'],
    sku: ['sku', 'part_number', 'part_no', 'partno', 'item_number', 'item_code', 'product_code', 'material', 'material_number', 'catalog_number'],
    contractNumber: ['contract', 'contract_number', 'contract_no', 'contract_id', 'contract_ref', 'contract_reference'],
    agreementNumber: ['agreement', 'agreement_number', 'agreement_no', 'master_agreement', 'enterprise_agreement', 'ela'],
    purchaseOrder: ['po', 'po_number', 'po_no', 'purchase_order', 'purchase_order_number'],
    supplier: ['supplier', 'reseller', 'distributor', 'partner', 'sold_by'],
    quantity: ['qty', 'quantity', 'seats', 'licenses', 'licences', 'owned', 'entitled', 'entitlement_qty', 'units', 'seat_count', 'volume', 'number_of_licenses'],
    unitPrice: ['unit_price', 'price', 'price_each', 'cost_per_license', 'per_seat_cost', 'unit_cost', 'unit_list_price', 'list_price', 'net_price', 'price_per_unit', 'price_per_seat', 'rate'],
    totalCost: ['total', 'total_cost', 'total_price', 'extended_cost', 'extended_price', 'contract_value', 'line_total', 'cost', 'amount', 'net_amount'],
    annualCost: ['annual_cost', 'annual_spend', 'yearly_cost', 'annualized_cost', 'annualised_cost', 'annual_price', 'annual_value', 'cost_per_year', 'spend'],
    currency: ['currency', 'currency_code', 'ccy', 'curr'],
    licenseModel: ['license_model', 'license_type', 'licensing_model', 'license_metric', 'model', 'metric'],
    pricingUnit: ['pricing_unit', 'unit', 'uom', 'unit_of_measure', 'price_unit'],
    contractStartDate: ['start_date', 'contract_start', 'term_start', 'effective_date', 'start'],
    contractEndDate: ['end_date', 'contract_end', 'term_end', 'expires_on', 'end'],
    // Expiry wording lives here rather than on contract end: on a renewal
    // schedule the expiry date IS the date the customer must act on, and
    // renewal exposure is the analysis those files exist to support.
    renewalDate: ['renewal_date', 'renewal', 'next_renewal', 'expiration_date', 'expiry_date', 'expiration', 'expiry', 'expires', 'renews_on', 'renew_by'],
    businessUnit: ['business_unit', 'division', 'department', 'bu'],
    costCenter: ['cost_center', 'cost_centre', 'charge_code', 'gl_code', 'account_code', 'cc'],
    owner: ['owner', 'business_owner', 'responsible', 'requestor', 'contact'],
    notes: ['notes', 'note', 'comment', 'comments', 'remarks'],
  },
};
