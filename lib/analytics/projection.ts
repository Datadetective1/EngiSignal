/**
 * ── COMPUTING THE ANSWER ONCE INSTEAD OF ONCE PER PAGE VIEW ──────────────────
 *
 * Phase 2D measured the read path at the ceiling the import page states:
 *
 *     analytics over 67,267 usage rows          12 ms
 *     getting those rows out of the database   6.9 s
 *
 * Every analytical surface paid the 6.9 seconds, on every request, to recompute
 * a result that had not changed since the last import. This module holds the
 * result instead.
 *
 * WHAT MAKES THIS SAFE TO CACHE
 *
 * The dataset is a pure function of the canonical evidence. Same rows in, same
 * dataset out — which Phase 2D verified in production by deleting a 67,267-row
 * import, re-importing it, and diffing every derived export byte for byte.
 *
 * WHAT MAKES IT SAFE TO SERVE
 *
 * A cache that can go stale silently is a worse defect than a slow page: it is
 * the "confident answer computed from the wrong evidence" failure this codebase
 * has spent four phases removing. So the projection is never trusted on age. On
 * EVERY read the caller recomputes a cheap fingerprint of the evidence that
 * exists right now, and the payload is used only if it matches exactly.
 *
 * A mismatch is not a warning, a grace period, or a background refresh. It
 * means the payload describes evidence that is no longer there, and it is
 * discarded and rebuilt before anything is rendered from it.
 *
 * WHY IT STAYS SMALL
 *
 * The projection is bounded by features × days × people, not by observations.
 * Measured on the Phase 2D estate: 1.9 MB of dataset against 18 MB of raw rows,
 * and the collections that dominate it — daily peaks, weekday/hour demand,
 * per-user activity — do not grow when a customer exports the same year at a
 * finer granularity.
 */

import { gunzipSync, gzipSync } from 'node:zlib';
import type { AnalyticsDataset } from '@/lib/domain/dataset';
import type { CoverageSummary } from '@/lib/ingestion/store/types';
import type { UserIdentity } from '@/lib/ingestion/identity';
import type { StoredRowCounts, AnalyzedRowCounts } from './integrity';

/**
 * What one projection holds.
 *
 * The coverage summary rides along because it is derived from exactly the same
 * evidence and was otherwise costing the Data page a second full read of the
 * estate — the very thing this module exists to stop.
 */
export interface ProjectionPayload {
  dataset: AnalyticsDataset;
  coverage: CoverageSummary;
  /**
   * User identities resolved WITHOUT the customer's confirmed aliases.
   *
   * The identity review queue needs these: resolving with aliases applied makes
   * a username the customer has already decided about vanish from the queue,
   * with no trace of what was decided. It was reading the whole raw estate to
   * get them, which cost that one page 7.4 seconds against 0.5 for every other.
   *
   * Bounded by distinct users, not observations - about 400 at the 68k estate
   * and 1,200 at 300k - so it belongs here like everything else.
   */
  userIdentities: UserIdentity[];
}

/**
 * Serialized shape version.
 *
 * BUMP THIS whenever AnalyticsDataset changes shape. A payload written by an
 * older build is discarded rather than deserialized into a structure that no
 * longer matches — a missing collection would read as an empty one, which is
 * exactly the "absent evidence became zero" failure the product exists to
 * refuse.
 */
export const PROJECTION_VERSION = 3;

export interface ProjectionRecord {
  version: number;
  evidenceKey: string;
  computedAt: string;
  buildMs: number | null;
  storedRows: StoredRowCounts;
  analyzedRows: AnalyzedRowCounts;
  payload: string;
  payloadBytes: number;
}

/** Where the dataset on this request came from. Never inferred, always recorded. */
export type ProjectionSource =
  /** Read from a stored projection whose evidence key matched. */
  | 'projection'
  /** Built from canonical rows on this request, because none matched. */
  | 'computed';

export type ProjectionRebuildReason =
  | 'absent'
  | 'version-changed'
  | 'evidence-changed'
  | 'unreadable'
  | 'disabled';

export interface ProjectionState {
  source: ProjectionSource;
  version: number;
  /** When the payload was computed. Null when it was computed on this request. */
  computedAt: string | null;
  /** How long the build took, when this request did it or the stored row recorded it. */
  buildMs: number | null;
  /** Set when the dataset had to be rebuilt, naming why. */
  rebuiltBecause: ProjectionRebuildReason | null;
  /** Size on the wire, so a projection that has quietly grown is visible. */
  payloadBytes: number | null;
  /** Short form of the evidence fingerprint, for support and for the Data page. */
  evidenceKey: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// The evidence key
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Everything that can change a derived number without changing the code.
 *
 * Stored counts alone are not enough. Deleting one import and adding another of
 * exactly the same size leaves every count identical while changing every
 * answer, so the import identities are part of the key. Confirming that two
 * usernames are the same person changes allocation and reclaim without touching
 * a single canonical row, so the customer's identity decisions are part of it
 * too — that omission would have been a silently stale renewal recommendation.
 */
export interface EvidenceInputs {
  storedRows: StoredRowCounts;
  /** Completed imports only: one still in flight has not changed the estate yet. */
  imports: readonly { id: string; fingerprint: string | null }[];
  /** Count and latest decision timestamp over the tenant's identity confirmations. */
  confirmations: { count: number; latest: string | null };
}

/**
 * A stable string for a set of evidence.
 *
 * Sorted, so the order the database happened to return rows in cannot change
 * the key and cause a pointless rebuild — or, worse, fail to cause a needed one.
 * Hashing is not used: this is compared, never published, and a readable key is
 * worth more during an incident than a short one.
 */
export function evidenceKeyFor(inputs: EvidenceInputs): string {
  const counts = [
    `u${inputs.storedRows.usage}`,
    `p${inputs.storedRows.people}`,
    `e${inputs.storedRows.entitlements}`,
    `c${inputs.storedRows.contracts}`,
  ].join('.');

  const imports = [...inputs.imports]
    .map((record) => `${record.id}:${record.fingerprint ?? '-'}`)
    .sort()
    .join(',');

  const confirmations = `${inputs.confirmations.count}@${inputs.confirmations.latest ?? '-'}`;

  return `v${PROJECTION_VERSION}|${counts}|${confirmations}|${imports}`;
}

/** A short, log-safe form. The full key is long by design. */
export function shortEvidenceKey(key: string): string {
  let hash = 0;
  for (let index = 0; index < key.length; index++) {
    hash = (Math.imul(31, hash) + key.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// ─────────────────────────────────────────────────────────────────────────────
// Serialization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The dataset carries no class instances, no Dates and no typed arrays — every
 * field is already a primitive, a plain object or an array of them, because it
 * is built to be handed to React. JSON therefore round-trips it exactly, which
 * a test asserts by rebuilding the portfolio from a deserialized copy and
 * comparing it to the portfolio built from the original.
 *
 * The one thing JSON does not preserve is `undefined`, and that is a feature
 * here rather than a risk: this codebase uses `null` to mean "the evidence did
 * not say", everywhere, precisely so that absence survives a round trip.
 */
export function serializeDataset(content: ProjectionPayload): { payload: string; bytes: number } {
  const json = JSON.stringify(content);
  const compressed = gzipSync(Buffer.from(json, 'utf8'), { level: 6 });
  const payload = compressed.toString('base64');
  return { payload, bytes: payload.length };
}

export function deserializeDataset(payload: string): ProjectionPayload {
  const compressed = Buffer.from(payload, 'base64');
  const json = gunzipSync(compressed).toString('utf8');
  const parsed = JSON.parse(json) as ProjectionPayload;
  // A payload missing either half is not usable. Returning a dataset with an
  // absent coverage summary would render "no data imported" over a full estate.
  if (
    parsed?.dataset === undefined ||
    parsed?.coverage === undefined ||
    parsed?.userIdentities === undefined
  ) {
    throw new Error('Projection payload is incomplete.');
  }
  return parsed;
}

/**
 * Is a stored projection usable for this evidence?
 *
 * Returns the reason it is not, rather than a boolean, so the reason can be
 * shown on the Data page and recorded in the closure evidence. "It rebuilt" is
 * a fact worth being able to explain.
 */
export function projectionUsable(
  record: Pick<ProjectionRecord, 'version' | 'evidenceKey'> | null,
  evidenceKey: string,
): ProjectionRebuildReason | null {
  if (record === null) return 'absent';
  if (record.version !== PROJECTION_VERSION) return 'version-changed';
  if (record.evidenceKey !== evidenceKey) return 'evidence-changed';
  return null;
}
