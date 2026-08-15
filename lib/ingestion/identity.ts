/**
 * Identity resolution for features and users.
 *
 * DETERMINISTIC ONLY. No AI, no fuzzy similarity, no clustering.
 *
 * THE GOVERNING RULE
 *
 * Merging two identities that are not the same thing is worse than leaving
 * both unresolved. If `MECH_ENT` and `ANSYS Mechanical` are silently combined,
 * their demand curves are summed, the peak roughly doubles, and EngiSignal
 * recommends buying licenses for a feature that does not exist. If they are
 * left separate, the customer sees two features and can say "those are the
 * same" — a correctable inconvenience rather than an invisible error.
 *
 * So the only automatic merges are ones where the RAW STRINGS AGREE after
 * lossless normalization: case, surrounding whitespace, and separator style.
 * `MECH_ENT`, `mech-ent` and `Mech Ent` are the same string written three ways.
 * `MECH_ENT` and `ANSYS Mechanical` are not, and no amount of plausibility
 * makes them so without evidence the customer supplies.
 *
 * The raw value is kept permanently on every record, so a mapping decision can
 * always be revisited and never destroys what the file actually said.
 */

import type { CanonicalPersonRecord, CanonicalUsageRecord } from './canonical/types';

// ─────────────────────────────────────────────────────────────────────────────
// Features
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalize a feature string for comparison only.
 *
 * Lossless in intent: it changes presentation, never meaning. Version suffixes
 * are deliberately NOT stripped — `NX_DESIGN 12` and `NX_DESIGN 13` may well be
 * licensed separately, and collapsing them would merge two entitlements.
 */
export function normalizeFeatureKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s\-.]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

export interface FeatureIdentity {
  /** Stable id derived from the normalized key, so projection is reproducible. */
  featureId: string;
  /** The normalized comparison key. */
  key: string;
  /** Every distinct raw spelling seen, preserved verbatim. */
  rawValues: string[];
  /** Display name: the most common raw spelling, not an invented label. */
  displayName: string;
  vendor: string | null;
  product: string | null;
  observations: number;
  /**
   * Other identities whose keys are close enough to be worth a human look.
   * SUGGESTIONS ONLY — never applied automatically.
   */
  possibleRelated: string[];
}

export function featureIdFor(key: string): string {
  return `feature:${key}`;
}

/**
 * Build feature identities from canonical usage.
 *
 * @param aliases optional customer-confirmed map of raw value → canonical key.
 *   This is the only mechanism that merges spellings which do not already
 *   normalize to the same string.
 */
export function resolveFeatures(
  records: readonly CanonicalUsageRecord[],
  aliases: ReadonlyMap<string, string> = new Map(),
): FeatureIdentity[] {
  const byKey = new Map<
    string,
    {
      key: string;
      rawCounts: Map<string, number>;
      vendors: Map<string, number>;
      products: Map<string, number>;
      observations: number;
    }
  >();

  for (const record of records) {
    const raw = record.feature;
    const confirmed = aliases.get(raw.trim().toLowerCase());
    const key = confirmed ?? normalizeFeatureKey(raw);
    if (key.length === 0) continue;

    const entry =
      byKey.get(key) ??
      { key, rawCounts: new Map(), vendors: new Map(), products: new Map(), observations: 0 };
    byKey.set(key, entry);

    entry.observations += 1;
    entry.rawCounts.set(raw, (entry.rawCounts.get(raw) ?? 0) + 1);
    if (record.vendor !== null) entry.vendors.set(record.vendor, (entry.vendors.get(record.vendor) ?? 0) + 1);
    if (record.product !== null) entry.products.set(record.product, (entry.products.get(record.product) ?? 0) + 1);
  }

  const identities: FeatureIdentity[] = [...byKey.values()].map((entry) => ({
    featureId: featureIdFor(entry.key),
    key: entry.key,
    rawValues: [...entry.rawCounts.keys()].sort(),
    displayName: mostCommon(entry.rawCounts) ?? entry.key,
    vendor: mostCommon(entry.vendors),
    product: mostCommon(entry.products),
    observations: entry.observations,
    possibleRelated: [],
  }));

  // Suggestions only. Two keys are flagged when one contains the other as a
  // whole token sequence — enough to be worth asking about, never enough to act
  // on. Nothing downstream reads this field except the review screen.
  for (const identity of identities) {
    for (const other of identities) {
      if (other.key === identity.key) continue;
      if (sharesTokenPrefix(identity.key, other.key)) identity.possibleRelated.push(other.key);
    }
  }

  return identities.sort((a, b) => b.observations - a.observations || a.key.localeCompare(b.key));
}

function sharesTokenPrefix(a: string, b: string): boolean {
  const left = a.split('_').filter((token) => token.length >= 3);
  const right = b.split('_').filter((token) => token.length >= 3);
  if (left.length === 0 || right.length === 0) return false;
  // Require a shared leading token AND a length difference, so this surfaces
  // "MECH_ENT" next to "MECH_ENT_HPC" rather than every pair sharing a word.
  return left[0] === right[0] && a !== b;
}

function mostCommon(counts: Map<string, number>): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== null && value < best)) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// Users
// ─────────────────────────────────────────────────────────────────────────────

export interface UserIdentity {
  userId: string;
  /** Normalized comparison key. */
  key: string;
  rawUsernames: string[];
  employeeCode: string | null;
  displayName: string | null;
  email: string | null;
  observations: number;
  /** True when a people record confirmed this identity. */
  resolved: boolean;
}

export function normalizeUserKey(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Build user identities.
 *
 * Matching is by identifier, never by name. Two people called "J Smith" are two
 * people until an employee code or email says otherwise; merging them would
 * attribute one person's licence usage to another and route a reclaim decision
 * to the wrong manager.
 *
 * Usernames are joined to people records on:
 *   1. exact username match, or
 *   2. exact employee code match, or
 *   3. exact email match.
 *
 * Nothing else. Unresolved usernames stay visible rather than being absorbed.
 */
export function resolveUsers(
  usage: readonly CanonicalUsageRecord[],
  people: readonly CanonicalPersonRecord[],
): UserIdentity[] {
  const byUsername = new Map<string, CanonicalPersonRecord>();
  const byCode = new Map<string, CanonicalPersonRecord>();
  const byEmail = new Map<string, CanonicalPersonRecord>();

  for (const person of people) {
    byUsername.set(normalizeUserKey(person.user), person);
    if (person.employeeCode !== null) byCode.set(normalizeUserKey(person.employeeCode), person);
    if (person.email !== null) byEmail.set(normalizeUserKey(person.email), person);
  }

  const identities = new Map<string, UserIdentity>();

  const ensure = (key: string): UserIdentity => {
    const existing = identities.get(key);
    if (existing !== undefined) return existing;
    const created: UserIdentity = {
      userId: `user:${key}`,
      key,
      rawUsernames: [],
      employeeCode: null,
      displayName: null,
      email: null,
      observations: 0,
      resolved: false,
    };
    identities.set(key, created);
    return created;
  };

  for (const record of usage) {
    if (record.user === null) continue;
    const key = normalizeUserKey(record.user);
    if (key.length === 0) continue;

    const identity = ensure(key);
    identity.observations += 1;
    if (!identity.rawUsernames.includes(record.user)) identity.rawUsernames.push(record.user);

    if (record.employeeCode !== null && identity.employeeCode === null) {
      identity.employeeCode = record.employeeCode;
    }

    const match =
      byUsername.get(key) ??
      (record.employeeCode !== null ? byCode.get(normalizeUserKey(record.employeeCode)) : undefined);

    if (match !== undefined) {
      identity.resolved = true;
      identity.displayName = match.displayName;
      identity.email = match.email;
      identity.employeeCode = match.employeeCode ?? identity.employeeCode;
    }
  }

  // People with no observed usage are still real people — an assigned seat with
  // no activity is exactly what a reclaim review looks for.
  for (const person of people) {
    const key = normalizeUserKey(person.user);
    const identity = ensure(key);
    if (!identity.rawUsernames.includes(person.user)) identity.rawUsernames.push(person.user);
    identity.resolved = true;
    identity.displayName = identity.displayName ?? person.displayName;
    identity.email = identity.email ?? person.email;
    identity.employeeCode = identity.employeeCode ?? person.employeeCode;
  }

  void byEmail;

  return [...identities.values()].sort(
    (a, b) => b.observations - a.observations || a.key.localeCompare(b.key),
  );
}

/** Usernames seen in usage with no matching people record. */
export function unresolvedUsers(identities: readonly UserIdentity[]): UserIdentity[] {
  return identities.filter((identity) => !identity.resolved && identity.observations > 0);
}
