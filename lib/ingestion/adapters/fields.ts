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

export const FIELDS_BY_DATASET: Record<CanonicalDataset, FieldSpec[]> = {
  usage: USAGE_FIELDS,
  entitlements: ENTITLEMENT_FIELDS,
  people: PEOPLE_FIELDS,
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
    concurrent: ['concurrent', 'in_use', 'inuse', 'used', 'licenses_used', 'checked_out', 'current_usage', 'active'],
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
};
