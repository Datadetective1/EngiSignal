/**
 * License manager connector architecture.
 *
 * IMPORTANT: these are INTERFACES AND A REGISTRY ONLY. No connector is
 * implemented in this release, and every entry reports `available: false`.
 *
 * EngiSignal will not claim an integration that does not exist. The registry is
 * here so the shape is settled — a connector can be added later without any
 * change to the analytics engine, which consumes `CollectedUsage` regardless of
 * where it came from.
 */

import type { DenialEvent, HourlyUsage } from '@/lib/domain/types';

export type ConnectorId =
  | 'flexnet'
  | 'rlm'
  | 'sentinel'
  | 'dsls'
  | 'lmx'
  | 'autodesk'
  | 'bentley'
  | 'custom';

export interface CollectedUsage {
  hourly: HourlyUsage[];
  denials: DenialEvent[];
  /** Raw feature strings observed, for the normalization queue. */
  rawFeatures: string[];
  /** Raw usernames observed, for identity resolution. */
  rawUsernames: string[];
  collectedAt: string;
}

export interface ConnectorCredentials {
  host?: string;
  port?: number;
  /** Never logged, never persisted in plain text. */
  secret?: string;
  options?: Record<string, string>;
}

export interface LicenseManagerConnector {
  id: ConnectorId;
  name: string;
  /** What the connector reads from, in the operator's own vocabulary. */
  sourceDescription: string;
  /** True only when a working implementation ships. */
  available: boolean;
  /** Whether the source can report denial events at all. */
  supportsDenials: boolean;
  supportsTokens: boolean;
  /** Finest time resolution the source can provide. */
  resolution: 'event' | 'hourly' | 'daily';
  /** Notes an implementer must respect. */
  notes: string;

  test?(credentials: ConnectorCredentials): Promise<{ ok: boolean; message: string }>;
  collect?(credentials: ConnectorCredentials, since: string): Promise<CollectedUsage>;
}

/**
 * The registry.
 *
 * `notes` capture the real-world constraints that determine whether the data a
 * connector returns can support high-confidence recommendations — for example,
 * FlexNet denial capture requires debug logging to be enabled, so denial data
 * is frequently absent even where the connector works perfectly.
 */
export const CONNECTORS: LicenseManagerConnector[] = [
  {
    id: 'flexnet',
    name: 'FlexNet / FLEXlm',
    sourceDescription: 'lmstat polling and report log files',
    available: false,
    supportsDenials: true,
    supportsTokens: true,
    resolution: 'event',
    notes:
      'Denial capture requires debug logging enabled on the vendor daemon. Without it, unmet demand is invisible and confidence is reduced accordingly.',
  },
  {
    id: 'rlm',
    name: 'Reprise License Manager',
    sourceDescription: 'RLM web service and report logs',
    available: false,
    supportsDenials: true,
    supportsTokens: false,
    resolution: 'event',
    notes: 'ISV-specific report log formats vary; each vendor daemon needs its own parser profile.',
  },
  {
    id: 'sentinel',
    name: 'Sentinel RMS',
    sourceDescription: 'Sentinel admin interface',
    available: false,
    supportsDenials: true,
    supportsTokens: false,
    resolution: 'hourly',
    notes: 'Polling frequency determines peak accuracy — hourly polling can under-report short demand spikes.',
  },
  {
    id: 'dsls',
    name: 'Dassault Systèmes DSLS',
    sourceDescription: 'DSLS licensing server',
    available: false,
    supportsDenials: true,
    supportsTokens: true,
    resolution: 'event',
    notes: 'Token-based products require the token weight per feature to interpret consumption correctly.',
  },
  {
    id: 'lmx',
    name: 'LM-X License Manager',
    sourceDescription: 'LM-X server status and logs',
    available: false,
    supportsDenials: true,
    supportsTokens: false,
    resolution: 'event',
    notes: 'Borrowed licenses must be distinguished from active checkouts or demand is overstated.',
  },
  {
    id: 'autodesk',
    name: 'Autodesk licensing',
    sourceDescription: 'Autodesk usage reporting',
    available: false,
    supportsDenials: false,
    supportsTokens: true,
    resolution: 'daily',
    notes:
      'Named-user reporting is daily-granular, so concurrent peak analysis does not apply. Named-user models are used instead.',
  },
  {
    id: 'bentley',
    name: 'Bentley licensing',
    sourceDescription: 'Bentley usage reporting',
    available: false,
    supportsDenials: false,
    supportsTokens: false,
    resolution: 'daily',
    notes: 'Reports consumption after the fact; suitable for trend and cost, not for real-time capacity alerts.',
  },
  {
    id: 'custom',
    name: 'Custom collector',
    sourceDescription: 'Any source that can produce the EngiSignal usage shape',
    available: false,
    supportsDenials: true,
    supportsTokens: true,
    resolution: 'hourly',
    notes: 'Implement the LicenseManagerConnector interface and register it here.',
  },
];

export function getConnector(id: ConnectorId): LicenseManagerConnector | undefined {
  return CONNECTORS.find((connector) => connector.id === id);
}

/** Connectors with a working implementation. Empty in this release, by design. */
export function availableConnectors(): LicenseManagerConnector[] {
  return CONNECTORS.filter((connector) => connector.available);
}
