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

/** Connectors with a working LIVE implementation. Empty in this release. */
export function availableConnectors(): LicenseManagerConnector[] {
  return CONNECTORS.filter((connector) => connector.available);
}

/**
 * ── TWO DIFFERENT QUESTIONS, PREVIOUSLY ANSWERED AS ONE ─────────────────────
 *
 * Settings used to report "0 of 8 implemented", which was true of the live
 * polling connectors above and badly wrong about the product: EngiSignal reads
 * FlexNet, RLM, DSLS and Sentinel exports today, and has done since Phase 1.
 * The registry described the network integrations and the interface described
 * the registry, so a customer looking for "do you support FlexNet?" was told no
 * while the FlexNet adapter sat in the same codebase parsing their file.
 *
 * The two capabilities are now reported separately, because a customer buying
 * on "supports FlexNet" needs to know which of them they are getting:
 *
 *   fileIngestion   Can EngiSignal read an export this vendor's tooling
 *                   produces, today, through the normal import flow?
 *   liveCollection  Can EngiSignal collect from a running licence server
 *                   without anybody exporting anything?
 *
 * ── WHAT EACH STATUS MEANS ──────────────────────────────────────────────────
 *
 *   ready         A realistic native export has been carried the whole way —
 *                 parse, detect, map, normalize, persist, analyse, reconcile —
 *                 by a test in tests/ingestion/connector-end-to-end.test.ts.
 *                 That test FAILS if anything here claims `ready` without a
 *                 case proving it, which is the only reason the word means
 *                 anything on the Settings page.
 *   beta          Parses and maps, but the end-to-end proof is thinner than the
 *                 four above: fewer native column shapes, or a format variant
 *                 not yet seen from a real customer.
 *   config        Works, but needs something from the customer first.
 *   planned       Interface exists. No implementation.
 */
export type ConnectorStatus = 'ready' | 'beta' | 'config' | 'planned';

export interface ConnectorReadiness {
  id: ConnectorId;
  fileIngestion: ConnectorStatus;
  liveCollection: ConnectorStatus;
  /** What the customer exports, in their own vocabulary. */
  fileSource: string;
  /** Why it is not higher, or what it needs. Shown verbatim in Settings. */
  detail: string;
}

export const CONNECTOR_READINESS: ConnectorReadiness[] = [
  {
    id: 'flexnet',
    fileIngestion: 'ready',
    liveCollection: 'planned',
    fileSource: 'lmstat output or report-log export (CSV, TSV, Excel)',
    detail:
      'Reads users, features, versions, client hosts, servers, checkout and check-in times, concurrency, denials and borrowed licences. Denial columns appear only where debug logging was enabled on the vendor daemon.',
  },
  {
    id: 'rlm',
    fileIngestion: 'ready',
    liveCollection: 'planned',
    fileSource: 'RLM report log or web-interface export (CSV, TSV, Excel)',
    detail:
      'Reads the ISV daemon as the vendor and keeps pooled licences in their own pool. Report-log columns are ISV-specific, so two vendors on one server can export different shapes.',
  },
  {
    id: 'dsls',
    fileIngestion: 'ready',
    liveCollection: 'planned',
    fileSource: 'DS License Server usage or entitlement export (CSV, TSV, Excel)',
    detail:
      'Token weight is preserved rather than folded into seat counts. Where a file carries tokens but no per-feature weight, EngiSignal reports the gap instead of inferring one.',
  },
  {
    id: 'sentinel',
    fileIngestion: 'ready',
    liveCollection: 'planned',
    fileSource: 'Sentinel RMS usage or license export (CSV, TSV, Excel)',
    detail:
      'Interval snapshots rather than checkout events, so demand spikes shorter than the sampling period are invisible and peak is understated. Feature version and client host are captured.',
  },
  {
    id: 'lmx',
    fileIngestion: 'beta',
    liveCollection: 'planned',
    fileSource: 'LM-X status or log export (CSV, TSV, Excel)',
    detail:
      'Imports through the generic reader, which handles the common LM-X column names. No LM-X-specific adapter or auto-detection yet, so the source must be chosen manually and the mapping reviewed.',
  },
  {
    id: 'autodesk',
    fileIngestion: 'beta',
    liveCollection: 'planned',
    fileSource: 'Autodesk usage reporting export (CSV)',
    detail:
      'Named-user reporting is daily-granular, so concurrent peak analysis does not apply and named-user reclaim is used instead. Imports through the generic reader.',
  },
  {
    id: 'bentley',
    fileIngestion: 'beta',
    liveCollection: 'planned',
    fileSource: 'Bentley usage reporting export (CSV)',
    detail:
      'Reports consumption after the fact. Suitable for trend and cost, not for capacity alerts. Imports through the generic reader.',
  },
  {
    id: 'custom',
    fileIngestion: 'config',
    liveCollection: 'planned',
    fileSource: 'Any tabular export carrying date, feature and a usage measure',
    detail:
      'The generic reader handles any file that names a date, a feature and a quantity. Column mapping is confirmed by a human before anything is committed.',
  },
];

export function connectorReadiness(id: ConnectorId): ConnectorReadiness | undefined {
  return CONNECTOR_READINESS.find((entry) => entry.id === id);
}

/** Connectors whose file ingestion is proven end to end. */
export function readyFileConnectors(): ConnectorReadiness[] {
  return CONNECTOR_READINESS.filter((entry) => entry.fileIngestion === 'ready');
}

export const CONNECTOR_STATUS_LABELS: Record<ConnectorStatus, string> = {
  ready: 'Ready',
  beta: 'Beta',
  config: 'Configuration required',
  planned: 'Planned',
};
