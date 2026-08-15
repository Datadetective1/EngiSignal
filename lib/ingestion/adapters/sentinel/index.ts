/**
 * Sentinel RMS / Sentinel adapter.
 *
 * Reads usage exports produced from Sentinel administration tooling.
 *
 * SCOPE: file-based only. No connection to a Sentinel server is made in this
 * phase.
 *
 * GRANULARITY: Sentinel exports are commonly interval snapshots rather than
 * checkout events. A snapshot reports what was in use at the moment it was
 * taken, so short demand spikes between samples are invisible. The capability
 * flags say so, and the quality report repeats it, because a P95 computed from
 * hourly snapshots understates true peak demand and a renewal position built on
 * it would be quietly too small.
 */

import type { IngestionAdapter } from '../types';

export const sentinelAdapter: IngestionAdapter = {
  source: 'sentinel',
  name: 'Sentinel RMS',
  exportDescription: 'Sentinel RMS usage or license export (CSV, TSV or Excel).',
  supports: ['usage', 'entitlements', 'people'],
  capabilities: {
    resolution: 'interval',
    // Snapshot exports report state, not transitions.
    checkoutCheckin: false,
    denials: true,
    tokens: false,
    concurrency: true,
    entitlements: true,
    notes: [
      'Interval snapshots can miss demand spikes shorter than the sampling period, which understates peak demand.',
      'Sublicense and key identifiers must be preserved or separately keyed licenses are incorrectly merged.',
    ],
  },
  aliases: {
    usage: {
      user: ['client_user', 'client_username', 'user_name', 'sentinel_user', 'user'],
      feature: ['feature_name', 'feature', 'feature_id', 'license_feature'],
      product: ['product', 'application', 'product_name'],
      vendor: ['vendor', 'publisher'],
      licenseServer: ['license_server', 'lserv_host', 'server_name', 'sentinel_server'],
      concurrent: ['licenses_in_use', 'in_use', 'used_licenses', 'current_users'],
      available: ['total_licenses', 'license_count', 'max_users', 'capacity'],
      peak: ['peak_usage', 'max_in_use', 'highest_usage', 'peak_users'],
      denialCount: ['denied_requests', 'denials', 'rejected_count'],
      denied: ['denied', 'status', 'result'],
      observedAt: ['sample_time', 'poll_time', 'snapshot_time', 'timestamp'],
      pool: ['pool', 'sublicense', 'sub_license'],
      durationHours: ['duration_hours', 'usage_hours'],
      quantity: ['requested', 'checkouts', 'count'],
      // Sentinel keys a license by feature plus version; the version alone is
      // not an employee identifier and is intentionally not mapped to one.
    },
    entitlements: {
      feature: ['feature_name', 'feature', 'feature_id'],
      product: ['product', 'application'],
      entitledQuantity: ['total_licenses', 'license_count', 'max_users', 'num_licenses', 'capacity'],
      licenseModel: ['license_type', 'type', 'model'],
      expiresOn: ['expiration_date', 'expiry_date', 'end_date', 'valid_until'],
      licenseServer: ['license_server', 'lserv_host', 'sentinel_server', 'server_name'],
      pool: ['sublicense', 'sub_license', 'pool'],
    },
    people: {
      user: ['client_user', 'client_username', 'sentinel_user', 'user_name'],
    },
  },
  coerce: {
    denied(raw) {
      const value = raw.trim().toLowerCase();
      if (value.length === 0) return undefined;
      if (['denied', 'denial', 'rejected', 'refused', 'fail', 'failed'].includes(value)) return true;
      if (['granted', 'ok', 'success', 'issued', 'allowed'].includes(value)) return false;
      return undefined;
    },
  },
};
