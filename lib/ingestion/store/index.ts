/**
 * Ingestion store selection.
 *
 * Mirrors lib/data/index.ts: Supabase activates only when explicitly selected
 * AND credentialed, so a half-configured environment falls back to the local
 * store rather than failing. The UI reports which one is active — durability is
 * a promise, and an evaluation environment must not appear to make it.
 */

import 'server-only';
import { memoryIngestionStore } from './memory-store';
import { hasSupabaseEnv, supabaseIngestionStore } from './supabase-store';
import type { IngestionStore } from './types';

export function getIngestionStore(): IngestionStore {
  if (process.env.ENGISIGNAL_DATA_PROVIDER === 'supabase' && hasSupabaseEnv()) {
    return supabaseIngestionStore;
  }
  return memoryIngestionStore;
}

export function isEphemeralStore(): boolean {
  return getIngestionStore().kind === 'memory';
}

export type {
  CommitInput,
  CoverageSummary,
  ImportDetail,
  ImportLifecycle,
  ImportSummary,
  IngestionStore,
} from './types';
export { summarizeCoverage } from './types';
