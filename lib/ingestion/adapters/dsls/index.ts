/**
 * Dassault Systèmes DSLS adapter.
 *
 * Reads usage and entitlement exports produced from DS License Server
 * administration tooling.
 *
 * SCOPE: file-based only. No DSLS server connection is made in this phase.
 *
 * TOKENS: several DS products are licensed by token weight rather than by seat,
 * so one checkout can consume several tokens. The token column is preserved
 * rather than folded into quantity — collapsing them would make a token-based
 * product look far cheaper to run than it is. Where a file carries tokens but
 * no per-feature token weight, EngiSignal records what it was given and reports
 * the gap; it does not infer a weight.
 */

import type { IngestionAdapter } from '../types';

export const dslsAdapter: IngestionAdapter = {
  source: 'dsls',
  name: 'Dassault Systèmes DSLS',
  exportDescription: 'DS License Server usage or entitlement export (CSV, TSV or Excel).',
  supports: ['usage', 'entitlements', 'people'],
  capabilities: {
    resolution: 'event',
    checkoutCheckin: true,
    denials: true,
    tokens: true,
    concurrency: true,
    entitlements: true,
    notes: [
      'Token-weighted products require the token weight per feature to convert consumption into seats; EngiSignal does not infer it.',
      'Feature names carry DS internal codes that usually need an alias before they read as a product a buyer recognizes.',
    ],
  },
  aliases: {
    usage: {
      user: ['user_id', 'userid', 'dsls_user', 'user_name', 'login'],
      feature: ['license_name', 'feature', 'dsls_feature', 'license_id', 'model_name'],
      product: ['product_line', 'product', 'application', 'brand'],
      vendor: ['vendor', 'publisher', 'editor'],
      licenseServer: ['server_id', 'dsls_server', 'license_server', 'server_name'],
      concurrent: ['in_use', 'inuse_count', 'used_count', 'current_usage'],
      available: ['max_count', 'total_count', 'license_count', 'max'],
      tokens: ['token', 'tokens', 'token_count', 'token_weight', 'credits'],
      checkoutAt: ['acquire_time', 'checkout_time', 'start_time', 'grant_time'],
      checkinAt: ['release_time', 'checkin_time', 'end_time'],
      denialCount: ['denied_count', 'denials', 'refused_count'],
      denied: ['denied', 'refused', 'status'],
      durationHours: ['duration_hours', 'usage_duration', 'elapsed_hours'],
      quantity: ['requested_count', 'count', 'checkouts'],
      pool: ['pool', 'license_pool', 'site_id'],
      hostname: ['client_host', 'host', 'hostname', 'machine', 'machine_name', 'client_machine'],
      version: ['license_version', 'version', 'release', 'product_version', 'level'],
      borrowed: ['offline', 'is_offline', 'borrowed', 'offline_mode'],
      employeeCode: ['customer_id', 'employee_id'],
    },
    entitlements: {
      feature: ['license_name', 'feature', 'license_id', 'model_name'],
      product: ['product_line', 'product', 'brand'],
      entitledQuantity: ['max_count', 'license_count', 'total_count', 'max', 'quantity'],
      licenseModel: ['license_type', 'model', 'type', 'usage_type'],
      expiresOn: ['expiration_date', 'end_date', 'expiry_date', 'valid_until'],
      licenseServer: ['server_id', 'dsls_server', 'license_server'],
      pool: ['pool', 'site_id'],
    },
    people: {
      user: ['user_id', 'dsls_user', 'user_name'],
      employeeCode: ['customer_id', 'employee_id'],
    },
  },
  coerce: {
    licenseModel(raw) {
      const value = raw.trim().toLowerCase();
      if (value.length === 0) return undefined;
      if (value.includes('token')) return 'token';
      if (value.includes('nodelock') || value.includes('node_lock') || value.includes('node locked')) {
        return 'node_locked';
      }
      if (value.includes('named')) return 'named_user';
      if (value.includes('concurrent') || value.includes('floating') || value.includes('network')) {
        return 'concurrent';
      }
      return undefined;
    },
  },
};
