/**
 * RLM (Reprise License Manager) adapter.
 *
 * Reads exports derived from RLM report logs or the RLM web interface.
 *
 * SCOPE: file-based only. No connection to rlm or an ISV server is made in this
 * phase.
 *
 * RLM organizes licenses by ISV — the vendor daemon name — and each ISV chooses
 * its own report-log detail. The vendor column is therefore mapped from `isv`,
 * and pooled licenses carry a distinct pool identity that must survive
 * normalization or demand from separate pools is incorrectly combined.
 */

import type { IngestionAdapter } from '../types';

export const rlmAdapter: IngestionAdapter = {
  source: 'rlm',
  name: 'Reprise License Manager (RLM)',
  exportDescription: 'RLM report-log or web-interface usage export (CSV, TSV or Excel).',
  supports: ['usage', 'entitlements', 'people'],
  capabilities: {
    resolution: 'event',
    checkoutCheckin: true,
    denials: true,
    tokens: false,
    concurrency: true,
    entitlements: true,
    notes: [
      'Report-log detail is ISV-specific; two vendors on the same RLM server can export different columns.',
      'Roaming licenses remain checked out while the host is offline and will read as active demand.',
    ],
  },
  aliases: {
    usage: {
      user: ['rlm_user', 'user', 'user_name', 'login_name'],
      feature: ['product', 'feature', 'rlm_product', 'license_name'],
      vendor: ['isv', 'isv_name', 'rlm_isv', 'vendor'],
      licenseServer: ['rlm_server', 'server_host', 'license_host', 'isv_server'],
      pool: ['pool', 'license_pool', 'rlm_pool'],
      concurrent: ['count_in_use', 'in_use', 'current_use', 'inuse_count'],
      available: ['count', 'total_count', 'licenses_available', 'pool_count'],
      checkoutAt: ['checkout_time', 'out_time', 'start_time'],
      checkinAt: ['checkin_time', 'in_time', 'end_time'],
      denialCount: ['denials', 'denied_count', 'denial_count'],
      denied: ['denied', 'status', 'result'],
      quantity: ['count_requested', 'num_requested', 'checkouts'],
      durationHours: ['duration_hours', 'hours_used', 'elapsed_hours'],
      // RLM logs the requesting host separately from the server.
      employeeCode: ['employee_id', 'emp_id'],
    },
    entitlements: {
      feature: ['product', 'feature', 'license_name'],
      vendor: ['isv', 'isv_name', 'vendor'],
      entitledQuantity: ['count', 'total_count', 'pool_count', 'licenses'],
      expiresOn: ['exp', 'exp_date', 'expiration_date', 'expires'],
      licenseServer: ['rlm_server', 'server_host', 'isv_server'],
      licenseModel: ['type', 'license_type', 'model'],
      pool: ['pool', 'license_pool'],
    },
    people: {
      user: ['rlm_user', 'user', 'user_name'],
    },
  },
  coerce: {
    denied(raw) {
      const value = raw.trim().toLowerCase();
      if (value.length === 0) return undefined;
      if (['denied', 'deny', 'fail', 'failed', 'rejected'].includes(value)) return true;
      if (['granted', 'ok', 'success', 'checkout'].includes(value)) return false;
      return undefined;
    },
  },
};
