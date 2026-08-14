/**
 * Provider selection.
 *
 * EngiSignal defaults to the local synthetic dataset so it is fully functional
 * with no configuration. Supabase activates only when explicitly selected AND
 * credentialed — a half-configured environment falls back rather than failing,
 * because a broken evaluation is worse than a local one.
 */

import 'server-only';
import type { DataProvider } from './provider';
import { mockProvider } from './mock-provider';
import { hasSupabaseEnv, supabaseProvider } from './supabase-provider';

export function getDataProvider(): DataProvider {
  if (process.env.ENGISIGNAL_DATA_PROVIDER === 'supabase' && hasSupabaseEnv()) {
    return supabaseProvider;
  }
  return mockProvider;
}

export function isUsingMockData(): boolean {
  return getDataProvider().kind === 'mock';
}

export type { DataProvider, ReclaimOverride } from './provider';
