/**
 * FlexNet / FLEXlm adapter.
 *
 * Reads exports produced from FlexNet tooling — report-log summaries written by
 * lmstat or a reporting layer, exported to CSV/XLSX by the customer.
 *
 * SCOPE: file-based only. EngiSignal does not talk to lmgrd or a vendor daemon
 * in this phase, does not poll, and does not claim real-time visibility.
 *
 * Denials: FlexNet only records denial events when debug logging is enabled on
 * the vendor daemon. A file with no denial column therefore means "not logged",
 * not "no unmet demand" — the quality report says so rather than letting the
 * absence read as zero.
 */

import type { IngestionAdapter } from '../types';

export const flexnetAdapter: IngestionAdapter = {
  source: 'flexnet',
  name: 'FlexNet / FLEXlm',
  exportDescription: 'Report-log or lmstat-derived usage export (CSV, TSV or Excel).',
  supports: ['usage', 'entitlements', 'people'],
  capabilities: {
    resolution: 'event',
    checkoutCheckin: true,
    denials: true,
    tokens: true,
    concurrency: true,
    entitlements: true,
    notes: [
      'Denial events require debug logging on the vendor daemon; absent denial data does not mean demand was met.',
      'Borrowed and linger licenses can appear as active checkouts and will overstate concurrent demand if the export does not separate them.',
    ],
  },
  aliases: {
    usage: {
      user: ['flex_user', 'lm_user', 'checkout_user', 'user_name', 'display_user'],
      feature: ['feature', 'feature_name', 'lic_feature', 'flex_feature'],
      vendor: ['vendor_daemon', 'vendordaemon', 'daemon', 'isv'],
      licenseServer: ['server_host', 'license_host', 'lmgrd_host', 'flex_server'],
      // FlexNet exports name the client workstation "host" or "display", which
      // is not the license server. Mapping it to server would attribute demand
      // to the wrong pool.
      pool: ['license_pool', 'server_group', 'triad'],
      checkoutAt: ['checkout_time', 'out_time', 'start'],
      checkinAt: ['checkin_time', 'in_time', 'stop', 'return_time'],
      concurrent: ['licenses_in_use', 'in_use_count', 'users_current'],
      available: ['licenses_issued', 'issued', 'users_total', 'total_licenses'],
      denied: ['denied', 'denial', 'status'],
      denialCount: ['denials', 'denial_count', 'num_denied'],
      durationHours: ['duration_hours', 'usage_hours', 'elapsed_hours'],
      tokens: ['tokens', 'token_count'],
      quantity: ['num_lic', 'numlic', 'licenses_requested', 'checkouts'],
    },
    entitlements: {
      feature: ['feature', 'feature_name', 'lic_feature'],
      vendor: ['vendor_daemon', 'daemon', 'isv'],
      entitledQuantity: ['licenses_issued', 'issued', 'num_lic', 'users_total', 'count'],
      expiresOn: ['expiry_date', 'exp_date', 'expiration'],
      licenseServer: ['server_host', 'license_host', 'flex_server'],
      licenseModel: ['license_type', 'lic_type', 'model'],
    },
    people: {
      user: ['flex_user', 'lm_user', 'user_name'],
    },
  },
  coerce: {
    denied(raw) {
      const value = raw.trim().toLowerCase();
      if (value.length === 0) return undefined;
      if (['denied', 'deny', 'denial', 'fail', 'failed', 'reject', 'rejected'].includes(value)) return true;
      if (['granted', 'ok', 'success', 'issued', 'checkout', 'checked_out'].includes(value)) return false;
      return undefined;
    },
  },
};
