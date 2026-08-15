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

/**
 * How confidently a username was tied to a person.
 *
 * `ambiguous` is the state that matters. When two people records claim the same
 * identifier the honest answer is "we do not know which", and silently taking
 * the last one seen — which a Map does by default — would attribute one
 * person's licence usage to another and route a reclaim decision to the wrong
 * manager. Ambiguity is surfaced for a human instead.
 */
export type IdentityStatus = 'matched' | 'unmatched' | 'ambiguous' | 'confirmed';

export type IdentityBasis = 'username' | 'employee_code' | 'email' | 'confirmed' | null;

/** Organizational context, carried only where the people file supplied it. */
export interface OrgContext {
  department: string | null;
  organization: string | null;
  businessUnit: string | null;
  program: string | null;
  discipline: string | null;
  competency: string | null;
  location: string | null;
  region: string | null;
  costCenter: string | null;
  managerName: string | null;
  managerKey: string | null;
  employmentStatus: string | null;
  employmentType: string | null;
}

export const EMPTY_ORG_CONTEXT: OrgContext = {
  department: null,
  organization: null,
  businessUnit: null,
  program: null,
  discipline: null,
  competency: null,
  location: null,
  region: null,
  costCenter: null,
  managerName: null,
  managerKey: null,
  employmentStatus: null,
  employmentType: null,
};

export interface UserIdentity {
  userId: string;
  /** Normalized comparison key. */
  key: string;
  rawUsernames: string[];
  employeeCode: string | null;
  displayName: string | null;
  email: string | null;
  observations: number;
  /** True when a people record confirmed this identity. Kept for existing callers. */
  resolved: boolean;
  status: IdentityStatus;
  /** Which identifier produced the match. Null when unmatched or ambiguous. */
  basis: IdentityBasis;
  /** Candidate people when the identifier was ambiguous, for human review. */
  ambiguousCandidates: string[];
  org: OrgContext;
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
  /** Customer-confirmed raw username → people-record username. */
  confirmed: ReadonlyMap<string, string> = new Map(),
): UserIdentity[] {
  /**
   * Each index maps an identifier to EVERY person claiming it, not the last one.
   *
   * A Map<string, Person> silently keeps whichever record was read most
   * recently, which turns a genuine data conflict — two rows sharing an
   * employee code after a rehire, a shared service account, a bad export — into
   * a confident and arbitrary answer. Collecting all claimants makes the
   * conflict visible and lets it be reported rather than resolved by luck.
   */
  const byUsername = new Map<string, CanonicalPersonRecord[]>();
  const byCode = new Map<string, CanonicalPersonRecord[]>();
  const byEmail = new Map<string, CanonicalPersonRecord[]>();

  const index = (
    map: Map<string, CanonicalPersonRecord[]>,
    rawKey: string | null,
    person: CanonicalPersonRecord,
  ) => {
    if (rawKey === null) return;
    const key = normalizeUserKey(rawKey);
    if (key.length === 0) return;
    const bucket = map.get(key);
    if (bucket === undefined) map.set(key, [person]);
    else if (!bucket.includes(person)) bucket.push(person);
  };

  for (const person of people) {
    index(byUsername, person.user, person);
    index(byCode, person.employeeCode, person);
    index(byEmail, person.email, person);
  }

  /** Distinct people behind one identifier, compared on identity not object. */
  const distinct = (candidates: readonly CanonicalPersonRecord[]): CanonicalPersonRecord[] => {
    const seen = new Map<string, CanonicalPersonRecord>();
    for (const person of candidates) {
      const signature = [
        normalizeUserKey(person.user),
        person.employeeCode === null ? '' : normalizeUserKey(person.employeeCode),
        person.email === null ? '' : normalizeUserKey(person.email),
      ].join('|');
      if (!seen.has(signature)) seen.set(signature, person);
    }
    return [...seen.values()];
  };

  const orgOf = (person: CanonicalPersonRecord): OrgContext => ({
    department: person.department,
    organization: person.organization,
    businessUnit: person.businessUnit,
    program: person.program,
    discipline: person.discipline,
    competency: person.competency,
    location: person.location,
    region: person.region,
    costCenter: person.costCenter,
    managerName: person.managerName,
    managerKey: person.managerKey,
    employmentStatus: person.employmentStatus,
    employmentType: person.employmentType,
  });

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
      status: 'unmatched',
      basis: null,
      ambiguousCandidates: [],
      org: { ...EMPTY_ORG_CONTEXT },
    };
    identities.set(key, created);
    return created;
  };

  const attach = (identity: UserIdentity, person: CanonicalPersonRecord, basis: IdentityBasis) => {
    identity.resolved = true;
    identity.status = basis === 'confirmed' ? 'confirmed' : 'matched';
    identity.basis = basis;
    identity.displayName = person.displayName;
    identity.email = person.email ?? identity.email;
    identity.employeeCode = person.employeeCode ?? identity.employeeCode;
    identity.org = orgOf(person);
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

    // Already settled by an earlier observation of the same username.
    if (identity.status === 'matched' || identity.status === 'confirmed') continue;

    // 1. A human already answered this. Beats every inference.
    const confirmedTarget = confirmed.get(key);
    if (confirmedTarget !== undefined) {
      const target = byUsername.get(normalizeUserKey(confirmedTarget))?.[0];
      if (target !== undefined) {
        attach(identity, target, 'confirmed');
        continue;
      }
    }

    // 2. Exact username, 3. employee code, 4. email — in that order, because
    //    that is the order of how directly each identifies the account that
    //    checked out the licence.
    const attempts: { candidates: CanonicalPersonRecord[]; basis: IdentityBasis }[] = [
      { candidates: distinct(byUsername.get(key) ?? []), basis: 'username' },
      {
        candidates:
          record.employeeCode === null
            ? []
            : distinct(byCode.get(normalizeUserKey(record.employeeCode)) ?? []),
        basis: 'employee_code',
      },
      // A username that IS an email is common in modern directories.
      { candidates: distinct(byEmail.get(key) ?? []), basis: 'email' },
    ];

    for (const attempt of attempts) {
      if (attempt.candidates.length === 0) continue;
      if (attempt.candidates.length === 1) {
        attach(identity, attempt.candidates[0]!, attempt.basis);
        break;
      }
      // Several distinct people claim this identifier. Refuse to choose.
      identity.status = 'ambiguous';
      identity.basis = null;
      identity.ambiguousCandidates = attempt.candidates.map(
        (person) => person.displayName ?? person.user,
      );
      break;
    }
  }

  // People with no observed usage are still real people — an owned seat with no
  // activity is exactly what a reclaim review looks for.
  for (const person of people) {
    const key = normalizeUserKey(person.user);
    const identity = ensure(key);
    if (!identity.rawUsernames.includes(person.user)) identity.rawUsernames.push(person.user);
    if (identity.status === 'ambiguous') continue;
    if (identity.status !== 'confirmed') {
      identity.status = 'matched';
      identity.basis = identity.basis ?? 'username';
    }
    identity.resolved = true;
    identity.displayName = identity.displayName ?? person.displayName;
    identity.email = identity.email ?? person.email;
    identity.employeeCode = identity.employeeCode ?? person.employeeCode;
    if (identity.org.department === null) identity.org = orgOf(person);
  }

  return [...identities.values()].sort(
    (a, b) => b.observations - a.observations || a.key.localeCompare(b.key),
  );
}

/** Usernames seen in usage that could not be tied to exactly one person. */
export function ambiguousUsers(identities: readonly UserIdentity[]): UserIdentity[] {
  return identities.filter((identity) => identity.status === 'ambiguous');
}

/** Usernames seen in usage with no matching people record. */
export function unresolvedUsers(identities: readonly UserIdentity[]): UserIdentity[] {
  return identities.filter((identity) => !identity.resolved && identity.observations > 0);
}
