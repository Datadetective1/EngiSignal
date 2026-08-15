/**
 * Canonical import fields and the synonyms real exports use.
 *
 * Customers do not share a schema. A FlexNet export calls the user column
 * NETWORK_USER; an HR extract calls it NTWK_ID; a hand-built spreadsheet calls
 * it "User Name". Rather than forcing a rigid template, EngiSignal maps
 * whatever arrives — and remembers the mapping for next time.
 */

import type { ImportKind } from '@/lib/domain/types';

export interface CanonicalField {
  key: string;
  label: string;
  description: string;
  required: boolean;
  type: 'string' | 'number' | 'date' | 'hour';
  /** Lower-case header fragments that indicate this field. */
  synonyms: string[];
}

export const IMPORT_SCHEMAS: Record<ImportKind, { label: string; description: string; fields: CanonicalField[] }> = {
  usage: {
    label: 'Usage',
    description: 'License-manager usage records — one row per user, feature and time bucket.',
    fields: [
      {
        key: 'date',
        label: 'Date',
        description: 'Calendar date of the observation.',
        required: true,
        type: 'date',
        synonyms: ['date', 'usage_date', 'usagedate', 'day', 'timestamp', 'time', 'datetime', 'log_date', 'event_date'],
      },
      {
        key: 'hour',
        label: 'Hour',
        description: 'Hour of day, 0–23. Enables daily-peak analysis.',
        required: false,
        type: 'hour',
        synonyms: ['hour', 'hour_of_day', 'hourofday', 'hr', 'time_bucket', 'interval'],
      },
      {
        key: 'username',
        label: 'User',
        description: 'License-manager username, matched to an employee record.',
        required: true,
        type: 'string',
        synonyms: ['user', 'username', 'user_name', 'network_user', 'networkuser', 'ntwk_id', 'login', 'userid', 'user_id', 'account'],
      },
      {
        key: 'employeeCode',
        label: 'Employee ID',
        description: 'HR identifier, when the export carries one.',
        required: false,
        type: 'string',
        synonyms: ['employee_id', 'employeeid', 'empl_id', 'emp_id', 'badge', 'personnel_number'],
      },
      {
        key: 'featureCode',
        label: 'Feature',
        description: 'Raw license feature name as recorded by the license manager.',
        required: true,
        type: 'string',
        synonyms: ['feature', 'feature_name', 'featurename', 'license_feature', 'product_feature', 'lic_feature', 'module'],
      },
      {
        key: 'vendor',
        label: 'Vendor',
        description: 'Vendor or vendor daemon.',
        required: false,
        type: 'string',
        synonyms: ['vendor', 'vendor_daemon', 'vendordaemon', 'publisher', 'supplier', 'manufacturer'],
      },
      {
        key: 'product',
        label: 'Product',
        description: 'Product name, when distinct from the feature.',
        required: false,
        type: 'string',
        synonyms: ['product', 'product_name', 'application', 'app', 'app_name', 'software'],
      },
      {
        key: 'licenseServer',
        label: 'License server',
        description: 'Server that issued the license.',
        required: false,
        type: 'string',
        synonyms: ['license_server', 'lic_server', 'server', 'host', 'server_name'],
      },
      {
        key: 'peakUsage',
        label: 'Peak usage',
        description: 'Maximum concurrent licenses in use in the bucket.',
        required: false,
        type: 'number',
        synonyms: ['peak', 'peak_usage', 'max_concurrent', 'maxconcurrent', 'max_used', 'concurrent_peak', 'high_water'],
      },
      {
        key: 'concurrent',
        label: 'Concurrent in use',
        description: 'Licenses in use at the observation.',
        required: false,
        type: 'number',
        synonyms: ['concurrent', 'in_use', 'inuse', 'used', 'checked_out', 'checkout_count', 'licenses_used'],
      },
      {
        key: 'sessions',
        label: 'Sessions',
        description: 'Checkout count in the bucket.',
        required: false,
        type: 'number',
        synonyms: ['sessions', 'session_count', 'checkouts', 'checkout_count', 'usage_count', 'requests'],
      },
      {
        key: 'durationHours',
        label: 'Duration (hours)',
        description: 'License-hours consumed.',
        required: false,
        type: 'number',
        synonyms: ['duration', 'hours', 'usage_hours', 'license_hours', 'elapsed', 'runtime', 'duration_hours'],
      },
      {
        key: 'available',
        label: 'Available capacity',
        description: 'Licenses available on the server.',
        required: false,
        type: 'number',
        synonyms: ['available', 'total', 'capacity', 'issued', 'licenses_available', 'total_licenses'],
      },
      {
        key: 'denials',
        label: 'Denials',
        description: 'Denied requests in the bucket.',
        required: false,
        type: 'number',
        synonyms: ['denials', 'denied', 'denial_count', 'rejections', 'queued'],
      },
    ],
  },

  employees: {
    label: 'Employees & contractors',
    description: 'The organizational roster used to attribute demand.',
    fields: [
      { key: 'employeeCode', label: 'Employee ID', description: 'HR identifier.', required: false, type: 'string', synonyms: ['employee_id', 'empl_id', 'emp_id', 'employeeid', 'badge', 'personnel_number', 'worker_id'] },
      { key: 'username', label: 'Username', description: 'Network or license-manager username.', required: true, type: 'string', synonyms: ['username', 'user', 'network_id', 'ntwk_id', 'login', 'sam_account', 'user_name'] },
      { key: 'fullName', label: 'Full name', description: 'Display name.', required: true, type: 'string', synonyms: ['name', 'full_name', 'fullname', 'employee_name', 'display_name', 'preferred_name'] },
      { key: 'email', label: 'Email', description: 'Work email address.', required: false, type: 'string', synonyms: ['email', 'email_address', 'mail', 'work_email'] },
      { key: 'managerName', label: 'Manager', description: 'Reporting manager, used to route reclaim reviews.', required: false, type: 'string', synonyms: ['manager', 'supervisor', 'reports_to', 'manager_name', 'line_manager'] },
      { key: 'department', label: 'Department', description: 'Organizational department.', required: false, type: 'string', synonyms: ['department', 'dept', 'dept_desc', 'org_unit', 'team'] },
      { key: 'businessUnit', label: 'Business unit', description: 'Division or business unit.', required: false, type: 'string', synonyms: ['business_unit', 'bus_unit', 'division', 'bu', 'sector'] },
      { key: 'program', label: 'Program', description: 'Program or project assignment.', required: false, type: 'string', synonyms: ['program', 'programme', 'project', 'program_cd', 'program_code'] },
      { key: 'discipline', label: 'Discipline', description: 'Engineering discipline.', required: false, type: 'string', synonyms: ['discipline', 'job_family', 'function', 'specialty', 'skill'] },
      { key: 'competency', label: 'Competency', description: 'Competency or capability group.', required: false, type: 'string', synonyms: ['competency', 'capability', 'competence', 'job_profile'] },
      { key: 'location', label: 'Location', description: 'Work location.', required: false, type: 'string', synonyms: ['location', 'site', 'work_location', 'office', 'facility'] },
      { key: 'region', label: 'Region', description: 'Geographic region.', required: false, type: 'string', synonyms: ['region', 'geo', 'area', 'country'] },
      { key: 'employeeType', label: 'Employee type', description: 'Employee or contractor.', required: false, type: 'string', synonyms: ['employee_type', 'worker_type', 'type', 'employment_type', 'category'] },
      { key: 'status', label: 'Status', description: 'Active or inactive.', required: false, type: 'string', synonyms: ['status', 'employment_status', 'active', 'state'] },
      { key: 'contractorCompany', label: 'Contractor company', description: 'Supplying company for contractors.', required: false, type: 'string', synonyms: ['contractor_company', 'supplier', 'agency', 'vendor_company'] },
    ],
  },

  contracts: {
    label: 'Contracts & renewals',
    description: 'Commercial position: what is owned, at what price, expiring when.',
    fields: [
      { key: 'vendor', label: 'Vendor', description: 'Supplier name.', required: true, type: 'string', synonyms: ['vendor', 'supplier', 'publisher', 'manufacturer'] },
      { key: 'product', label: 'Product', description: 'Product name.', required: true, type: 'string', synonyms: ['product', 'product_desc', 'application', 'software', 'item'] },
      { key: 'featureCode', label: 'Feature', description: 'Feature this line entitles.', required: false, type: 'string', synonyms: ['feature', 'feature_name', 'module', 'license_feature'] },
      { key: 'sku', label: 'SKU', description: 'Vendor part number.', required: false, type: 'string', synonyms: ['sku', 'part_number', 'license_sku', 'material', 'item_code'] },
      { key: 'licenseModel', label: 'License model', description: 'Concurrent, named user, token, subscription.', required: false, type: 'string', synonyms: ['license_model', 'license_type', 'model', 'type', 'metric'] },
      { key: 'quantity', label: 'Quantity', description: 'Entitled quantity.', required: true, type: 'number', synonyms: ['quantity', 'qty', 'seats', 'licenses', 'count', 'entitled'] },
      { key: 'unitPrice', label: 'Unit price (annual)', description: 'Annual price per license.', required: false, type: 'number', synonyms: ['unit_price', 'unit_cost', 'price', 'cost', 'annual_price', 'unit_cost_annual', 'list_price'] },
      { key: 'annualPrice', label: 'Annual total', description: 'Annual line total.', required: false, type: 'number', synonyms: ['annual_price', 'annual_cost', 'total', 'extended_price', 'line_total'] },
      { key: 'contractNumber', label: 'Contract number', description: 'Agreement identifier.', required: false, type: 'string', synonyms: ['contract', 'contract_number', 'agreement_no', 'agreement', 'contract_id'] },
      { key: 'startDate', label: 'Start date', description: 'Term start.', required: false, type: 'date', synonyms: ['start_date', 'term_start', 'effective_date', 'begin'] },
      { key: 'renewalDate', label: 'Renewal date', description: 'Date the commitment is made again.', required: true, type: 'date', synonyms: ['renewal_date', 'renewal', 'term_end', 'end_date', 'expiration', 'expiry', 'expires'] },
      { key: 'purchaseOrder', label: 'Purchase order', description: 'PO reference.', required: false, type: 'string', synonyms: ['po', 'po_number', 'purchase_order', 'order_number'] },
      { key: 'businessOwner', label: 'Business owner', description: 'Internal owner of the agreement.', required: false, type: 'string', synonyms: ['owner', 'business_owner', 'contact', 'responsible'] },
      { key: 'costCenter', label: 'Cost centre', description: 'Charged cost centre.', required: false, type: 'string', synonyms: ['cost_center', 'cost_centre', 'cc', 'gl_code', 'account'] },
    ],
  },

  assignments: {
    label: 'Named-user assignments',
    description: 'Which person holds which named-user license.',
    fields: [
      { key: 'username', label: 'User', description: 'Assignee username.', required: true, type: 'string', synonyms: ['user', 'username', 'assignee', 'network_user', 'login'] },
      { key: 'featureCode', label: 'Feature', description: 'Assigned feature or product.', required: true, type: 'string', synonyms: ['feature', 'product', 'license', 'entitlement', 'application'] },
      { key: 'assignedOn', label: 'Assigned on', description: 'Date the seat was granted.', required: false, type: 'date', synonyms: ['assigned_on', 'assigned_date', 'granted', 'start_date', 'provisioned'] },
      { key: 'lastUsedDate', label: 'Last used', description: 'Most recent recorded activity.', required: false, type: 'date', synonyms: ['last_used', 'last_used_date', 'last_activity', 'last_login', 'last_access'] },
      { key: 'totalSessions', label: 'Sessions', description: 'Lifetime session count.', required: false, type: 'number', synonyms: ['sessions', 'session_count', 'logins', 'usage_count'] },
      { key: 'totalHours', label: 'Hours', description: 'Lifetime usage hours.', required: false, type: 'number', synonyms: ['hours', 'usage_hours', 'total_hours', 'duration'] },
    ],
  },

  denials: {
    label: 'Denials',
    description: 'Denied license requests, used as risk context.',
    fields: [
      { key: 'date', label: 'Date', description: 'Date of the denial.', required: true, type: 'date', synonyms: ['date', 'denial_date', 'timestamp', 'time', 'event_date'] },
      { key: 'hour', label: 'Hour', description: 'Hour of day, 0–23.', required: false, type: 'hour', synonyms: ['hour', 'hour_of_day', 'time_bucket'] },
      { key: 'username', label: 'User', description: 'User whose request was denied.', required: false, type: 'string', synonyms: ['user', 'username', 'network_user', 'denied_user', 'login'] },
      { key: 'featureCode', label: 'Feature', description: 'Feature that was denied.', required: true, type: 'string', synonyms: ['feature', 'feature_name', 'license_feature', 'module'] },
      { key: 'count', label: 'Denial count', description: 'Number of denials in the row.', required: false, type: 'number', synonyms: ['count', 'denials', 'denial_count', 'occurrences', 'qty'] },
      { key: 'concurrentAtDenial', label: 'Concurrent at denial', description: 'Licenses in use when the request failed. Critical context — without it, a denial cannot be distinguished from a licensing-rule rejection.', required: false, type: 'number', synonyms: ['concurrent', 'in_use', 'used_at_denial', 'concurrent_at_denial', 'licenses_used'] },
      { key: 'availableAtDenial', label: 'Available at denial', description: 'Licenses free when the request failed.', required: false, type: 'number', synonyms: ['available', 'free', 'available_at_denial', 'remaining'] },
    ],
  },
};

export const IMPORT_KINDS = Object.keys(IMPORT_SCHEMAS) as ImportKind[];
