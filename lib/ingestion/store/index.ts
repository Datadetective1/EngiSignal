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

/**
 * True when the in-memory store is running on serverless infrastructure.
 *
 * This distinction is not cosmetic. On a single long-lived server the memory
 * store behaves like a real one for the life of the process: import, then read
 * it back. On Vercel each request may be served by a different function
 * instance, so an import written by one invocation is invisible to the next —
 * a customer would import successfully and then find an empty history.
 *
 * The UI must say which of those two situations it is in, because "your data
 * is gone" and "your data is on another instance" look identical and neither
 * is acceptable to leave unexplained.
 */
export function isServerlessEphemeral(): boolean {
  return isEphemeralStore() && process.env.VERCEL === '1';
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
