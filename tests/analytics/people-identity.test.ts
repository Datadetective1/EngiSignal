import { describe, expect, it } from 'vitest';
import { buildUserReviewQueue, describeUserConfirmationEffect } from '@/lib/analytics/user-review';
import { rollUpByManager } from '@/lib/analytics/manager-rollup';
import { buildPortfolio } from '@/lib/analytics/portfolio';
import { buildDatasetFromCanonical } from '@/lib/ingestion/dataset';
import { allocateCostAutomatically } from '@/lib/analytics/allocation';
import { normalizeUserKey, resolveUsers } from '@/lib/ingestion/identity';
import { DEFAULT_ANALYSIS_OPTIONS } from '@/lib/domain/dataset';
import type {
  CanonicalContractRecord,
  CanonicalPersonRecord,
  CanonicalUsageRecord,
  Provenance,
} from '@/lib/ingestion/canonical/types';
import type { Employee, Organization } from '@/lib/domain/types';

const ORG: Organization = {
  id: 'org-people', name: 'People Test', slug: 'people-test', industry: null,
  technicalHeadcount: 50, headcountGrowthRate: null, currency: 'USD',
  isDemo: false, createdAt: '2026-01-01T00:00:00.000Z',
};

function provenance(row: number): Provenance {
  return {
    organizationId: ORG.id, importId: 'i1', importedAt: '2026-08-15T00:00:00.000Z',
    sourceFile: 'f.csv', sourceSystem: 'generic', sourceSheet: null, sourceRow: row,
  };
}

function person(user: string, extra: Partial<CanonicalPersonRecord> = {}): CanonicalPersonRecord {
  return {
    user, employeeCode: null, displayName: null, email: null,
    employmentStatus: null, employmentType: null, managerName: null, managerKey: null,
    department: null, organization: null, businessUnit: null, program: null,
    discipline: null, competency: null, location: null, region: null, costCenter: null,
    provenance: provenance(2), ...extra,
  };
}

function usage(feature: string, user: string | null, date: string, row: number): CanonicalUsageRecord {
  return {
    date, hour: 9, observedAt: null, user, employeeCode: null,
    feature, product: null, vendor: null, quantity: null, concurrent: 10,
    peak: null, available: null, durationHours: null, checkoutAt: null,
    checkinAt: null, denied: null, denialCount: null, licenseServer: null,
    pool: null, tokens: null, provenance: provenance(row),
  };
}

function contract(feature: string, quantity: number, unitPrice: number, model: 'named_user' | 'concurrent'): CanonicalContractRecord {
  return {
    feature, product: null, vendor: 'MathWorks', sku: null,
    contractNumber: 'CTR-1', agreementNumber: null, purchaseOrder: null, supplier: null,
    quantity, unitPrice, totalCost: null, annualCost: quantity * unitPrice,
    currency: 'USD', licenseModel: model, pricingUnit: null,
    contractStartDate: null, contractEndDate: null, renewalDate: '2027-02-01',
    businessUnit: null, costCenter: null, owner: null, notes: null,
    unitPriceBasis: 'supplied_unit_price', annualCostBasis: 'quantity_x_unit',
    multiYearTotal: false, provenance: provenance(2),
  };
}

function employee(id: string, extra: Partial<Employee> = {}): Employee {
  return {
    id, organizationId: ORG.id, employeeCode: null, username: id,
    fullName: `Person ${id}`, email: `${id}@example.com`,
    managerName: null, managerKey: null, department: null, organization: null,
    businessUnit: null, program: null, discipline: null, competency: null,
    location: null, region: null, employeeType: 'employee', status: 'active',
    contractorCompany: null, ...extra,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// User identity review
// ─────────────────────────────────────────────────────────────────────────────

describe('the unresolved-user queue', () => {
  it('suggests a person when the usage export carried a matching employee code', () => {
    const identities = resolveUsers(
      [usage('F1', 'legacy_acct', '2026-06-01', 2)].map((record) => ({
        ...record,
        employeeCode: 'E1234',
      })),
      [person('jhalvorsen', { employeeCode: 'E9999' })],
    );

    const queue = buildUserReviewQueue({
      identities,
      employees: [employee('user:jhalvorsen', { username: 'jhalvorsen', employeeCode: 'E1234' })],
    });

    const entry = queue.users.find((user) => user.rawUsername === 'legacy_acct')!;
    expect(entry.candidates[0]!.score).toBe(100);
    expect(entry.candidates[0]!.rationale).toContain('E1234');
  });

  it('suggests a person whose username differs only in punctuation', () => {
    const identities = resolveUsers([usage('F1', 'j.halvorsen', '2026-06-01', 2)], []);
    const queue = buildUserReviewQueue({
      identities,
      employees: [employee('user:jhalvorsen', { username: 'jhalvorsen' })],
    });

    const entry = queue.users[0]!;
    expect(entry.candidates).toHaveLength(1);
    expect(entry.candidates[0]!.rationale).toContain('punctuation');
  });

  it('suggests a domain-prefixed account', () => {
    const identities = resolveUsers([usage('F1', 'EMEA\\jhalvorsen', '2026-06-01', 2)], []);
    const queue = buildUserReviewQueue({
      identities,
      employees: [employee('user:jhalvorsen', { username: 'jhalvorsen' })],
    });
    expect(queue.users[0]!.candidates[0]!.rationale).toContain('domain-prefixed');
  });

  it('NEVER suggests a person by display-name similarity', () => {
    // The whole point. "jsmith" and "J. Smith" look like a match and are not
    // evidence of one — merging them attributes usage to the wrong person.
    const identities = resolveUsers([usage('F1', 'contractor_7741', '2026-06-01', 2)], []);
    const queue = buildUserReviewQueue({
      identities,
      employees: [
        employee('user:jsmith', { username: 'jsmith', fullName: 'Contractor 7741' }),
      ],
    });

    expect(queue.users[0]!.candidates).toHaveLength(0);
  });

  it('surfaces an ambiguous identifier with both claimants named', () => {
    const identities = resolveUsers(
      [{ ...usage('F1', 'shared', '2026-06-01', 2), employeeCode: 'E9' }],
      [
        person('alpha', { employeeCode: 'E9', displayName: 'Alpha One' }),
        person('beta', { employeeCode: 'E9', displayName: 'Beta Two' }),
      ],
    );

    const queue = buildUserReviewQueue({ identities, employees: [] });
    const entry = queue.users.find((user) => user.rawUsername === 'shared')!;

    expect(entry.status).toBe('ambiguous');
    expect(entry.ambiguousBetween).toEqual(['Alpha One', 'Beta Two']);
    expect(queue.ambiguousCount).toBe(1);
  });

  it('counts the observations sitting behind unresolved identities', () => {
    const identities = resolveUsers(
      [
        usage('F1', 'ghost', '2026-06-01', 2),
        usage('F1', 'ghost', '2026-06-02', 3),
        usage('F1', 'ghost', '2026-06-03', 4),
      ],
      [],
    );
    const queue = buildUserReviewQueue({ identities, employees: [] });
    expect(queue.unattributedObservations).toBe(3);
  });

  it('stops counting a username once it has been decided', () => {
    const identities = resolveUsers([usage('F1', 'ghost', '2026-06-01', 2)], []);
    const queue = buildUserReviewQueue({
      identities,
      employees: [],
      decisions: new Map([['ghost', 'separate']]),
    });

    expect(queue.users[0]!.decision).toBe('separate');
    expect(queue.unresolvedCount).toBe(0);
    expect(queue.unattributedObservations).toBe(0);
  });

  it('states the consequence before it happens', () => {
    const identities = resolveUsers([usage('F1', 'j.halvorsen', '2026-06-01', 2)], []);
    const queue = buildUserReviewQueue({
      identities,
      employees: [
        employee('user:jhalvorsen', {
          username: 'jhalvorsen',
          fullName: 'J Halvorsen',
          department: 'Controls',
          managerName: 'M. Okafor',
        }),
      ],
    });

    const effects = describeUserConfirmationEffect(queue.users[0]!, queue.users[0]!.candidates[0]!).join(' ');
    expect(effects).toContain('J Halvorsen');
    expect(effects).toContain('Controls');
    expect(effects).toContain('M. Okafor');
    expect(effects).toContain('undone');
  });

  it('warns when the chosen person cannot make the usage allocatable either', () => {
    const identities = resolveUsers([usage('F1', 'j.halvorsen', '2026-06-01', 2)], []);
    const queue = buildUserReviewQueue({
      identities,
      employees: [employee('user:jhalvorsen', { username: 'jhalvorsen', department: null })],
    });

    const effects = describeUserConfirmationEffect(queue.users[0]!, queue.users[0]!.candidates[0]!).join(' ');
    expect(effects).toContain('no department on record');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Manager rollup
// ─────────────────────────────────────────────────────────────────────────────

describe('grouping by manager', () => {
  const base = {
    portfolio: [],
    reclaimThresholdDays: 90,
    asOf: '2026-08-15',
    activities: [],
  };

  it('groups by the identifier, not the name', () => {
    // Two different managers who happen to share a name.
    const rollup = rollUpByManager({
      ...base,
      employees: [
        employee('e1', { managerName: 'J Smith', managerKey: 'mgr-100' }),
        employee('e2', { managerName: 'J Smith', managerKey: 'mgr-200' }),
      ],
    });

    expect(rollup.groups).toHaveLength(2);
    expect(rollup.hierarchyAvailable).toBe(true);
  });

  it('merges reports that share a manager identifier', () => {
    const rollup = rollUpByManager({
      ...base,
      employees: [
        employee('e1', { managerName: 'M. Okafor', managerKey: 'mgr-1' }),
        employee('e2', { managerName: 'M Okafor', managerKey: 'mgr-1' }),
      ],
    });

    expect(rollup.groups).toHaveLength(1);
    expect(rollup.groups[0]!.reportCount).toBe(2);
  });

  it('keeps a name-only manager as a label rather than a reporting line', () => {
    const rollup = rollUpByManager({
      ...base,
      employees: [employee('e1', { managerName: 'M. Okafor', managerKey: null })],
    });

    expect(rollup.groups[0]!.linked).toBe(false);
    expect(rollup.unlinkedPeople).toBe(1);
    expect(rollup.hierarchyAvailable).toBe(false);
  });

  it('excludes people with no manager information at all', () => {
    const rollup = rollUpByManager({
      ...base,
      employees: [employee('e1'), employee('e2', { managerKey: 'mgr-1' })],
    });

    expect(rollup.peopleWithoutManager).toBe(1);
    expect(rollup.groups).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The five named-user activity states
// ─────────────────────────────────────────────────────────────────────────────

describe('named-user reclaim across every activity state', () => {
  /**
   * A: assigned, used recently          → not a candidate
   * B: assigned, idle 120 days          → a candidate
   * C: assigned, never observed         → NOT a candidate (unknown, not idle)
   * D: assigned, used 40 days ago       → not a candidate
   * E: unresolved identity              → stays unresolved, never assigned
   */
  const asOf = '2026-08-15';

  function estate() {
    const rows: CanonicalUsageRecord[] = [
      usage('MATLAB', 'user_a', '2026-08-10', 2),
      usage('MATLAB', 'user_b', '2026-04-01', 3),
      usage('MATLAB', 'user_d', '2026-07-06', 4),
      usage('MATLAB', 'ghost_e', '2026-08-01', 5),
    ];

    return buildDatasetFromCanonical({
      organization: ORG,
      usage: rows,
      entitlements: [],
      people: [
        person('user_a', { displayName: 'Active Annie', managerName: 'M. Okafor', managerKey: 'mgr-1', department: 'Controls' }),
        person('user_b', { displayName: 'Idle Ivan', managerName: 'M. Okafor', managerKey: 'mgr-1', department: 'Controls' }),
        person('user_c', { displayName: 'Never Nadia', managerName: 'M. Okafor', managerKey: 'mgr-1', department: 'Controls' }),
        person('user_d', { displayName: 'Recent Rex', managerName: 'M. Okafor', managerKey: 'mgr-1', department: 'Controls' }),
      ],
      contracts: [contract('MATLAB', 10, 900, 'named_user')],
      asOf,
    });
  }

  const dataset = estate();
  const rows = buildPortfolio({ ...dataset, asOf }, DEFAULT_ANALYSIS_OPTIONS);
  const matlab = rows.find((row) => row.featureId === 'feature:matlab')!;

  it('recognises the feature as named-user with real activity', () => {
    expect(matlab.licenseModel).toBe('named_user');
    expect(matlab.namedUser).not.toBeNull();
    expect(matlab.usageEvidence).toBe('observed');
  });

  it('counts the idle holder as a reclaim candidate', () => {
    // Ivan last used it on 1 April, 136 days before 15 August.
    expect(matlab.namedUser!.reclaimCandidates).toBeGreaterThanOrEqual(1);
  });

  it('does not count recently active holders', () => {
    // Annie (5 days) and Rex (40 days) are both inside the 90-day threshold.
    expect(matlab.namedUser!.activeUsers).toBeGreaterThanOrEqual(2);
  });

  it('never treats a seat with no observed holder as reclaimable', () => {
    // 10 seats owned, 4 usernames observed. Nadia was never seen at all, and
    // six seats have no observed holder — none of them may be reclaimed.
    expect(matlab.namedUser!.seatsWithoutObservedUser).toBeGreaterThan(0);
    expect(matlab.namedUser!.reclaimCandidates).toBeLessThanOrEqual(
      matlab.namedUser!.observedUsers,
    );
  });

  it('cannot recommend surrendering more seats than reclaim will name', () => {
    const surplus = matlab.rightSizing?.surplus ?? 0;
    expect(surplus).toBeLessThanOrEqual(matlab.namedUser!.reclaimCandidates);
  });

  it('keeps reclaim candidates within the assigned seat count', () => {
    expect(matlab.namedUser!.reclaimCandidates).toBeLessThanOrEqual(matlab.namedUser!.assigned);
  });

  it('prices the reclaim only because cost evidence exists', () => {
    expect(matlab.unitPrice).toBe(900);
    expect(matlab.namedUser!.reclaimValue).toBe(matlab.namedUser!.reclaimCandidates * 900);
  });

  it('leaves the unresolved username unresolved rather than assigning it', () => {
    const identities = resolveUsers(
      [usage('MATLAB', 'ghost_e', '2026-08-01', 5)],
      [person('user_a', { displayName: 'Active Annie' })],
    );
    const ghost = identities.find((identity) => identity.key === 'ghost_e')!;

    expect(ghost.status).toBe('unmatched');
    expect(ghost.org.department).toBeNull();
  });

  it('surfaces the candidate under the manager who can act on it', () => {
    const rollup = rollUpByManager({
      employees: dataset.employees,
      activities: dataset.activities,
      portfolio: rows,
      reclaimThresholdDays: 90,
      asOf,
    });

    const okafor = rollup.groups.find((group) => group.managerKey === 'mgr-1')!;
    expect(okafor).toBeDefined();
    expect(okafor.linked).toBe(true);
    expect(okafor.reclaimCandidates).toBeGreaterThanOrEqual(1);
    expect(okafor.reclaimValue).toBe(okafor.reclaimCandidates * 900);
  });
});

describe('reclaim value without cost evidence', () => {
  it('reports the candidate but not a dollar figure', () => {
    const dataset = buildDatasetFromCanonical({
      organization: ORG,
      usage: [usage('UNPRICED_NU', 'user_b', '2026-04-01', 2)],
      entitlements: [
        {
          feature: 'UNPRICED_NU', product: null, vendor: 'V', entitledQuantity: 5,
          licenseModel: 'named_user', licenseServer: null, pool: null,
          expiresOn: null, provenance: provenance(2),
        },
      ],
      people: [person('user_b', { managerName: 'M. Okafor', managerKey: 'mgr-1' })],
      contracts: [],
      asOf: '2026-08-15',
    });

    const rows = buildPortfolio({ ...dataset, asOf: '2026-08-15' }, DEFAULT_ANALYSIS_OPTIONS);
    const row = rows.find((entry) => entry.featureId === 'feature:unpriced_nu')!;

    expect(row.namedUser!.reclaimCandidates).toBeGreaterThanOrEqual(1);
    // Unknown value, not zero value.
    expect(row.namedUser!.reclaimValue).toBeNull();

    const rollup = rollUpByManager({
      employees: dataset.employees,
      activities: dataset.activities,
      portfolio: rows,
      reclaimThresholdDays: 90,
      asOf: '2026-08-15',
    });
    expect(rollup.groups[0]!.reclaimValue).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The confirmation round trip
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What the review screen writes must be what identity resolution reads.
 *
 * Phase 2B lost $380,000 to exactly this seam on the feature side: the screen
 * offered a display code, resolution merged on a normalized key, and the stored
 * confirmation matched neither. These tests walk the value the UI actually
 * posts — the candidate's `username` — all the way through to a resolved
 * identity and an allocated cost.
 */
describe('confirming a user alias, end to end', () => {
  const people = [
    person('jhalvorsen', {
      displayName: 'J Halvorsen', employeeCode: 'E1234',
      email: 'j.halvorsen@example.com', department: 'Controls',
      managerName: 'M. Okafor', managerKey: 'mgr-1',
    }),
  ];
  const usageRows = [usage('MATLAB', 'EMEA\J.Halvorsen', '2026-06-01', 2)];

  it('leaves the username unresolved until somebody decides', () => {
    const identity = resolveUsers(usageRows, people)[0]!;
    expect(identity.resolved).toBe(false);
    expect(identity.org.department).toBeNull();
  });

  it('resolves it once the value the UI posts is stored', () => {
    // buildUserReviewQueue produced the candidate; the component posts
    // candidate.username as canonicalKey. confirmedAliasMaps normalizes both
    // sides, so reproduce that here rather than trusting a raw string.
    const queue = buildUserReviewQueue({
      identities: resolveUsers(usageRows, people),
      employees: [employee('user:jhalvorsen', { username: 'jhalvorsen' })],
    });
    const posted = queue.users[0]!.candidates[0]!.username;

    const aliases = new Map([
      [normalizeUserKey(queue.users[0]!.rawUsername), normalizeUserKey(posted)],
    ]);

    const identity = resolveUsers(usageRows, people, aliases)[0]!;
    expect(identity.status).toBe('confirmed');
    expect(identity.basis).toBe('confirmed');
    expect(identity.org.department).toBe('Controls');
    expect(identity.org.managerKey).toBe('mgr-1');
  });

  it('carries the confirmation into cost allocation', () => {
    const aliases = new Map([['emea\j.halvorsen', 'jhalvorsen']]);
    const build = (userAliases: ReadonlyMap<string, string>) =>
      buildDatasetFromCanonical({
        organization: ORG,
        usage: usageRows,
        entitlements: [],
        people,
        contracts: [contract('MATLAB', 10, 900, 'named_user')],
        userAliases,
        asOf: '2026-08-15',
      });

    const before = build(new Map());
    const after = build(aliases);

    const rows = buildPortfolio({ ...after, asOf: '2026-08-15' }, DEFAULT_ANALYSIS_OPTIONS);
    const features = rows.map((row) => ({
      featureId: row.featureId,
      licenseModel: row.licenseModel,
      annualCost: row.financial.currentAnnualCost,
      wasteAmount: 0,
    }));

    const unallocated = allocateCostAutomatically({
      dimension: 'department',
      features,
      activities: before.activities,
      employees: before.employees,
    });
    const allocated = allocateCostAutomatically({
      dimension: 'department',
      features,
      activities: after.activities,
      employees: after.employees,
    });

    // The whole point of the decision: spend moves out of unallocated and into
    // the department that incurred it.
    expect(unallocated.rows.find((row) => row.key === 'Controls')).toBeUndefined();
    expect(allocated.rows.find((row) => row.key === 'Controls')!.allocatedSpend).toBeGreaterThan(0);
    expect(allocated.unresolvedIdentityCount).toBe(0);
    expect(allocated.reconciles).toBe(true);
  });

  it('is reversible — removing the confirmation restores the unresolved state', () => {
    const aliases = new Map([['emea\j.halvorsen', 'jhalvorsen']]);
    expect(resolveUsers(usageRows, people, aliases)[0]!.resolved).toBe(true);
    // Undo deletes the row, so the next read passes an empty map.
    expect(resolveUsers(usageRows, people, new Map())[0]!.resolved).toBe(false);
  });

  it('does not resolve a rejection', () => {
    // A rejected decision is never written into the alias map at all.
    const identity = resolveUsers(usageRows, people, new Map())[0]!;
    expect(identity.status).toBe('unmatched');
  });

  it('fails visibly rather than silently when the target cannot be found', () => {
    // A confirmation pointing at a person who is no longer in the people file.
    const aliases = new Map([['emea\j.halvorsen', 'someone_deleted']]);
    const identity = resolveUsers(usageRows, people, aliases)[0]!;

    // Unresolved, not falsely attached to whoever happened to be first.
    expect(identity.resolved).toBe(false);
    expect(identity.org.department).toBeNull();
  });

  it('resolves a person the people file identifies only by employee code', () => {
    // A people export whose username column is blank still identifies the
    // person. Confirming against their employee code must work, or the queue
    // offers a candidate the confirmation cannot honour.
    const codeOnly = [person('', { employeeCode: 'E1234', department: 'Controls', displayName: 'J Halvorsen' })];
    const aliases = new Map([['emea\j.halvorsen', 'e1234']]);
    const identity = resolveUsers(usageRows, codeOnly, aliases)[0]!;

    expect(identity.resolved).toBe(true);
    expect(identity.org.department).toBe('Controls');
  });
});

describe('the key a confirmation stores', () => {
  it('is the username when the people record has one', () => {
    const queue = buildUserReviewQueue({
      identities: resolveUsers([usage('F1', 'j.halvorsen', '2026-06-01', 2)], []),
      employees: [employee('user:jhalvorsen', { username: 'jhalvorsen' })],
    });
    expect(queue.users[0]!.candidates[0]!.confirmationKey).toBe('jhalvorsen');
  });

  it('falls back to the employee code when the username column was blank', () => {
    const identities = resolveUsers(
      [{ ...usage('F1', 'legacy_acct', '2026-06-01', 2), employeeCode: 'E1234' }],
      [],
    );
    const queue = buildUserReviewQueue({
      identities,
      employees: [employee('user:e1234', { username: '', employeeCode: 'E1234' })],
    });

    // Never blank: an empty canonical key is a decision that resolves to nobody.
    expect(queue.users[0]!.candidates[0]!.confirmationKey).toBe('E1234');
  });

  it('never offers an empty key', () => {
    const identities = resolveUsers(
      [{ ...usage('F1', 'legacy_acct', '2026-06-01', 2), employeeCode: 'E1234' }],
      [],
    );
    const queue = buildUserReviewQueue({
      identities,
      employees: [
        employee('user:anon', { username: '', employeeCode: 'E1234', email: null, fullName: null }),
      ],
    });
    for (const candidate of queue.users[0]!.candidates) {
      expect(candidate.confirmationKey.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('an employee code claimed by two people', () => {
  const duplicated = [
    person('rehire_old', { employeeCode: 'E77', displayName: 'A Nkemelu', department: 'Structures' }),
    person('rehire_new', { employeeCode: 'E77', displayName: 'B Nkemelu', department: 'Fluids' }),
  ];

  it('does not attach either person to the usage', () => {
    const identities = resolveUsers(
      [{ ...usage('F1', 'unknown_acct', '2026-06-01', 2), employeeCode: 'E77' }],
      duplicated,
    );
    const identity = identities.find((entry) => entry.key === 'unknown_acct')!;

    expect(identity.resolved).toBe(false);
    expect(identity.org.department).toBeNull();
  });

  it('keeps that cost out of both departments rather than picking one', () => {
    const dataset = buildDatasetFromCanonical({
      organization: ORG,
      usage: [{ ...usage('MATLAB', 'unknown_acct', '2026-06-01', 2), employeeCode: 'E77' }],
      entitlements: [],
      people: duplicated,
      contracts: [contract('MATLAB', 10, 900, 'named_user')],
      asOf: '2026-08-15',
    });

    const result = allocateCostAutomatically({
      dimension: 'department',
      features: [{ featureId: 'feature:matlab', licenseModel: 'named_user', annualCost: 9_000, wasteAmount: 0 }],
      activities: dataset.activities,
      employees: dataset.employees,
    });

    expect(result.rows.some((row) => row.key === 'Structures')).toBe(false);
    expect(result.rows.some((row) => row.key === 'Fluids')).toBe(false);
  });

  it('still lets a human settle it, and honours the answer', () => {
    const identities = resolveUsers(
      [{ ...usage('F1', 'unknown_acct', '2026-06-01', 2), employeeCode: 'E77' }],
      duplicated,
      new Map([['unknown_acct', 'rehire_new']]),
    );
    const identity = identities.find((entry) => entry.key === 'unknown_acct')!;

    expect(identity.status).toBe('confirmed');
    expect(identity.org.department).toBe('Fluids');
  });
});
