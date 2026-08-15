/**
 * Adapter registry.
 *
 * Phase 1 scope: every adapter here reads FILES the customer already has.
 * None of them connects to a license server, polls a daemon, or synchronizes on
 * a schedule. Do not add a `connect()` to this layer — live collection is a
 * separate concern with separate credentials, and conflating the two is how a
 * roadmap capability starts looking shipped.
 */

import type { SourceSystem } from '../canonical/types';
import { dslsAdapter } from './dsls';
import { flexnetAdapter } from './flexnet';
import { genericAdapter } from './generic';
import { rlmAdapter } from './rlm';
import { sentinelAdapter } from './sentinel';
import type { IngestionAdapter } from './types';

export const ADAPTERS: Record<SourceSystem, IngestionAdapter> = {
  flexnet: flexnetAdapter,
  rlm: rlmAdapter,
  dsls: dslsAdapter,
  sentinel: sentinelAdapter,
  generic: genericAdapter,
};

export const ADAPTER_LIST: IngestionAdapter[] = [
  flexnetAdapter,
  rlmAdapter,
  dslsAdapter,
  sentinelAdapter,
  genericAdapter,
];

export function getAdapter(source: SourceSystem): IngestionAdapter {
  return ADAPTERS[source];
}
