/**
 * The unresolved-identity review queue.
 *
 * The people-side twin of the contract alias queue, and it exists for the same
 * reason: a username EngiSignal cannot place is usage it cannot attribute, and
 * every one of them is spend sitting in the unallocated bucket rather than in a
 * department's column.
 *
 * WHAT THIS MODULE WILL NOT DO
 *
 * It will not suggest a person because their name resembles the username.
 * "jsmith" and "J. Smith" look like a match and are not evidence of one — two
 * people called J. Smith are two people, and merging them attributes one
 * person's licence usage to another and routes a reclaim decision to the wrong
 * manager. Suggestions come only from structural resemblance between
 * IDENTIFIERS, and even those are ranked for a human rather than applied.
 */

import type { Employee } from '@/lib/domain/types';
import type { IdentityStatus, UserIdentity } from '@/lib/ingestion/identity';

export interface PersonCandidate {
  /** The people-record username, shown to the reviewer. May be blank. */
  username: string;
  /**
   * The identifier a confirmation stores — username, employee code or email,
   * whichever the people record actually carries. Identity resolution looks a
   * confirmed target up across all three.
   */
  confirmationKey: string;
  fullName: string | null;
  employeeCode: string | null;
  email: string | null;
  department: string | null;
  managerName: string | null;
  program: string | null;
  location: string | null;
  /** 0–100, for ordering only. Never a threshold for automatic action. */
  score: number;
  /** Why this person was suggested, in terms a reviewer can check. */
  rationale: string;
}

export interface UnresolvedUser {
  rawUsername: string;
  status: IdentityStatus;
  observations: number;
  /** Employee code the USAGE export carried, when it carried one. */
  employeeCode: string | null;
  /** Source systems the username was seen in. */
  sources: string[];
  candidates: PersonCandidate[];
  /** People named when an identifier was claimed by more than one of them. */
  ambiguousBetween: string[];
  decision: 'unresolved' | 'confirmed' | 'rejected' | 'separate';
}

export interface UserReviewQueue {
  users: UnresolvedUser[];
  unresolvedCount: number;
  ambiguousCount: number;
  /** Usage observations that cannot currently be attributed to a person. */
  unattributedObservations: number;
}

/** Case and surrounding space only — the same rule identity resolution uses. */
function key(value: string): string {
  return value.trim().toLowerCase();
}

/** Alphanumeric core, for comparing identifiers that differ only in punctuation. */
function core(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Structural resemblance between two IDENTIFIERS.
 *
 * Deliberately narrow, and deliberately not applied to names. A username that
 * is a strict prefix or suffix of another, or differs only in punctuation, is
 * the shape of a genuine account-naming variation — `j.halvorsen` against
 * `jhalvorsen`, `EMEA\\jhalvorsen` against `jhalvorsen`. That is a reason to
 * ASK, and nothing more.
 */
function identifierResemblance(raw: string, candidate: string): { score: number; why: string } | null {
  const a = core(raw);
  const b = core(candidate);
  if (a.length === 0 || b.length === 0) return null;
  if (a === b) return { score: 95, why: 'Identical once punctuation and case are removed.' };
  if (a.length >= 4 && b.length >= 4) {
    if (a.endsWith(b)) return { score: 70, why: `Ends with the username "${candidate}", which domain-prefixed accounts often do.` };
    if (b.endsWith(a)) return { score: 60, why: `The username "${candidate}" ends with this identifier.` };
    if (a.startsWith(b) || b.startsWith(a)) return { score: 55, why: `Shares a leading form with "${candidate}".` };
  }
  return null;
}

export interface BuildUserReviewInput {
  identities: readonly UserIdentity[];
  employees: readonly Employee[];
  /** Decisions already recorded, keyed by normalized raw username. */
  decisions?: ReadonlyMap<string, 'confirmed' | 'rejected' | 'separate'>;
}

const MAX_CANDIDATES = 5;

export function buildUserReviewQueue(input: BuildUserReviewInput): UserReviewQueue {
  const decisions = input.decisions ?? new Map();

  const outstanding = input.identities.filter(
    (identity) =>
      (identity.status === 'unmatched' || identity.status === 'ambiguous') &&
      identity.observations > 0,
  );

  const users: UnresolvedUser[] = outstanding.map((identity) => {
    const raw = identity.rawUsernames[0] ?? identity.key;

    const candidates: PersonCandidate[] = input.employees
      .map((employee) => {
        // 1. The strongest reason: the usage export carried an employee code
        //    that this person's record also carries.
        if (
          identity.employeeCode !== null &&
          employee.employeeCode !== null &&
          key(identity.employeeCode) === key(employee.employeeCode)
        ) {
          return {
            employee,
            score: 100,
            why: `The usage export carried employee code ${identity.employeeCode}, which matches this person's record.`,
          };
        }

        // 2. Structural resemblance between identifiers — never between names.
        const byUsername = identifierResemblance(raw, employee.username);
        if (byUsername !== null) return { employee, score: byUsername.score, why: byUsername.why };

        // 3. The local part of an email, which is frequently the account name.
        if (employee.email !== null) {
          const local = employee.email.split('@')[0] ?? '';
          const byEmail = identifierResemblance(raw, local);
          if (byEmail !== null) {
            return {
              employee,
              score: Math.max(0, byEmail.score - 10),
              why: `${byEmail.why.replace(/"([^"]+)"/, `"${local}"`)} That is the local part of ${employee.email}.`,
            };
          }
        }

        return null;
      })
      .filter((entry): entry is { employee: Employee; score: number; why: string } => entry !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_CANDIDATES)
      .map(({ employee, score, why }) => ({
        username: employee.username,
        // What the confirmation actually stores. Usually the username, but a
        // people export can identify someone by employee code or email alone,
        // and storing an empty username would record a decision that resolves
        // to nobody.
        confirmationKey:
          [employee.username, employee.employeeCode, employee.email].find(
            (value): value is string => value !== null && value.trim().length > 0,
          ) ?? employee.id,
        fullName: employee.fullName,
        employeeCode: employee.employeeCode,
        email: employee.email,
        department: employee.department,
        managerName: employee.managerName,
        program: employee.program,
        location: employee.location,
        score,
        rationale: why,
      }));

    return {
      rawUsername: raw,
      status: identity.status,
      observations: identity.observations,
      employeeCode: identity.employeeCode,
      sources: [],
      candidates,
      ambiguousBetween: identity.ambiguousCandidates,
      decision: decisions.get(key(raw)) ?? 'unresolved',
    };
  });

  users.sort((a, b) => b.observations - a.observations);

  return {
    users,
    unresolvedCount: users.filter((user) => user.status === 'unmatched' && user.decision === 'unresolved').length,
    ambiguousCount: users.filter((user) => user.status === 'ambiguous' && user.decision === 'unresolved').length,
    unattributedObservations: users
      .filter((user) => user.decision === 'unresolved')
      .reduce((total, user) => total + user.observations, 0),
  };
}

/** What confirming would do, stated before it is done. */
export function describeUserConfirmationEffect(
  user: UnresolvedUser,
  candidate: PersonCandidate,
): string[] {
  const effects = [
    `"${user.rawUsername}" will be treated as ${candidate.fullName ?? candidate.username}.`,
    `${user.observations.toLocaleString('en-US')} usage ${user.observations === 1 ? 'observation' : 'observations'} will be attributed to them.`,
  ];

  if (candidate.department !== null) {
    effects.push(
      `Their software use will count toward ${candidate.department}${candidate.managerName === null ? '' : ` and appear under ${candidate.managerName}`}, including in cost allocation.`,
    );
  } else {
    effects.push(
      'This person has no department on record, so the usage will still not be allocatable by department.',
    );
  }

  effects.push('This can be undone, and it applies only to your organization.');
  return effects;
}
