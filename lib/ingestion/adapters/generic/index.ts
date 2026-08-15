/**
 * Generic tabular adapter.
 *
 * The fallback when detection cannot identify a license manager with enough
 * confidence, and the honest answer for hand-built spreadsheets and vendor
 * portal exports. It adds no source-specific vocabulary of its own — the shared
 * base alias table does the work — and claims no capability it cannot observe.
 */

import type { IngestionAdapter } from '../types';

export const genericAdapter: IngestionAdapter = {
  source: 'generic',
  name: 'Generic tabular export',
  exportDescription: 'Any CSV, TSV or Excel export with one row per observation.',
  supports: ['usage', 'entitlements', 'people'],
  capabilities: {
    // Unknown rather than assumed: a generic file may be event-level or a
    // daily summary, and guessing wrong would misstate peak demand.
    resolution: 'unknown',
    checkoutCheckin: true,
    denials: true,
    tokens: true,
    concurrency: true,
    entitlements: true,
    notes: [
      'Capabilities are inferred from the columns present, not from a known product behaviour.',
      'Granularity is unknown unless the file carries an hour or timestamp column.',
    ],
  },
  aliases: {
    usage: {},
    entitlements: {},
    people: {},
  },
};
