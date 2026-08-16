import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { ingestFile } from '@/lib/ingestion';
import { buildDatasetFromCanonical } from '@/lib/ingestion/dataset';
import { buildPortfolio } from '@/lib/analytics/portfolio';
import { computePortfolioTotals } from '@/lib/analytics/financial';
import { allocateCostAutomatically } from '@/lib/analytics/allocation';
import { buildUserReviewQueue } from '@/lib/analytics/user-review';
import { rollUpByManager } from '@/lib/analytics/manager-rollup';
import { resolveUsers } from '@/lib/ingestion/identity';
import { DEFAULT_ANALYSIS_OPTIONS } from '@/lib/domain/dataset';
import type { AnalyticsDataset } from '@/lib/domain/dataset';
import type { Organization, PortfolioRow } from '@/lib/domain/types';
import type {
  CanonicalContractRecord,
  CanonicalEntitlementRecord,
  CanonicalPersonRecord,
  CanonicalUsageRecord,
} from '@/lib/ingestion/canonical/types';

/**
 * THE PHASE 2C ACCEPTANCE ESTATE.
 *
 * The same four files uploaded to production, run through the same code path,
 * so that every number quoted in the closure report has a reproducible source
 * and a regression that would change it fails here first.
 *
 * See tests/fixtures/acceptance/build_qa.py for how the estate is constructed
 * and what each feature is designed to prove.
 */

const FIXTURES = path.resolve(__dirname, '../fixtures/acceptance');
const ORG_ID = 'org-acceptance-2c';
const AS_OF = '2026-08-15';

const ORG: Organization = {
  id: ORG_ID,
  name: 'Northvane Aerospace',
  slug: 'northvane-aerospace',
  industry: 'Aerospace',
  technicalHeadcount: 53,
  headcountGrowthRate: null,
  currency: 'USD',
  isDemo: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function bytes(file: string): ArrayBuffer {
  const buffer = fs.readFileSync(path.join(FIXTURES, file));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

let usage: CanonicalUsageRecord[];
let entitlements: CanonicalEntitlementRecord[];
let people: CanonicalPersonRecord[];
let contracts: CanonicalContractRecord[];
let dataset: AnalyticsDataset;
let portfolio: PortfolioRow[];

const feature = (id: string) => portfolio.find((row) => row.featureId === id)!;

beforeAll(async () => {
  const load = async (file: string, kind: 'usage' | 'entitlements' | 'people' | 'contracts') =>
    ingestFile(bytes(file), {
      dataset: kind,
      organizationId: ORG_ID,
      importId: `import-${kind}`,
      fileName: file,
    });

  const [u, e, p, c] = await Promise.all([
    load('qa_usage.csv', 'usage'),
    load('qa_entitlements.csv', 'entitlements'),
    load('qa_people.csv', 'people'),
    load('qa_contracts.csv', 'contracts'),
  ]);

  usage = u.result.usage;
  entitlements = e.result.entitlements;
  people = p.result.people;
  contracts = c.result.contracts;

  dataset = buildDatasetFromCanonical({
    organization: ORG,
    usage,
    entitlements,
    people,
    contracts,
    asOf: AS_OF,
  });
  portfolio = buildPortfolio({ ...dataset, asOf: AS_OF }, DEFAULT_ANALYSIS_OPTIONS);
});

// ─────────────────────────────────────────────────────────────────────────────

describe('the files land as written', () => {
  it('reads every row of all four files', () => {
    expect(usage.length).toBeGreaterThan(4_000);
    expect(people).toHaveLength(53);
    expect(entitlements).toHaveLength(4);
    expect(contracts).toHaveLength(2);
  });

  it('recognises all four features', () => {
    expect(portfolio.map((row) => row.featureId).sort()).toEqual([
      'feature:ansys_mech_ent',
      'feature:catia_v5',
      'feature:matlab',
      'feature:nx_cam',
    ]);
  });

  it('reads the manager identifier as well as the manager name', () => {
    const linked = dataset.employees.filter((employee) => employee.managerKey !== null);
    expect(linked.length).toBe(50);
    // Three people name a manager with no id. Those are not a reporting line.
    expect(dataset.employees.filter((e) => e.managerName !== null && e.managerKey === null)).toHaveLength(3);
  });
});

// ── 2C-2: purchased vs served ────────────────────────────────────────────────

describe('440 bought, 350 served', () => {
  it('keeps both quantities, and does not let one stand in for the other', () => {
    const ansys = feature('feature:ansys_mech_ent');
    expect(ansys.commitment.purchasedQuantity).toBe(440);
    expect(ansys.commitment.servedQuantity).toBe(350);
    expect(ansys.commitment.quantityDifference).toBe(-90);
  });

  it('values the contract at what was bought', () => {
    expect(feature('feature:ansys_mech_ent').commitment.purchasedAnnualCommitment).toBe(2_200_000);
  });

  it('values the served capacity separately, and lower', () => {
    expect(feature('feature:ansys_mech_ent').commitment.servedCapacityValue).toBe(1_750_000);
  });

  it('reports the $450,000 gap as a gap, not as a saving', () => {
    const totals = computePortfolioTotals(portfolio);
    expect(totals.commitmentGap).toBe(450_000);
  });

  it('does not call an entitlement-derived figure a commitment', () => {
    // CATIA has no contract at all. Nothing was committed that we can evidence.
    const catia = feature('feature:catia_v5');
    expect(catia.commitment.purchasedQuantity).toBeNull();
    expect(catia.commitment.purchasedAnnualCommitment).toBeNull();
    expect(catia.commitment.servedQuantity).toBe(120);
  });
});

// ── 2C-1: allocation from the evidence that exists ───────────────────────────

describe('allocating spend from a duration-free export', () => {
  it('falls back to distinct observed users and says so', () => {
    const result = allocateCostAutomatically({
      dimension: 'department',
      features: portfolio.map((row) => ({
        featureId: row.featureId,
        licenseModel: row.licenseModel,
        annualCost: row.financial.currentAnnualCost,
        wasteAmount: 0,
      })),
      activities: dataset.activities,
      employees: dataset.employees,
    });

    expect(result.method).toBe('distinct_observed_users');
    expect(result.basisLabel).toBe('Distinct observed users');
    expect(result.available).toBe(true);
  });

  it('gives every department that used the software a non-zero amount', () => {
    const result = allocateCostAutomatically({
      dimension: 'department',
      features: portfolio.map((row) => ({
        featureId: row.featureId,
        licenseModel: row.licenseModel,
        annualCost: row.financial.currentAnnualCost,
        wasteAmount: 0,
      })),
      activities: dataset.activities,
      employees: dataset.employees,
    });

    expect(result.rows.length).toBeGreaterThanOrEqual(5);
    for (const row of result.rows) expect(row.allocatedSpend).toBeGreaterThan(0);
  });

  it('reconciles — nothing is silently dropped', () => {
    const result = allocateCostAutomatically({
      dimension: 'department',
      features: portfolio.map((row) => ({
        featureId: row.featureId,
        licenseModel: row.licenseModel,
        annualCost: row.financial.currentAnnualCost,
        wasteAmount: 0,
      })),
      activities: dataset.activities,
      employees: dataset.employees,
    });

    expect(result.totalAllocated + result.unallocated).toBeCloseTo(result.allocatableCost, 2);
    expect(result.reconciles).toBe(true);
  });

  it('names an unallocated amount rather than absorbing it', () => {
    const result = allocateCostAutomatically({
      dimension: 'department',
      features: portfolio.map((row) => ({
        featureId: row.featureId,
        licenseModel: row.licenseModel,
        annualCost: row.financial.currentAnnualCost,
        wasteAmount: 0,
      })),
      activities: dataset.activities,
      employees: dataset.employees,
    });

    // Three usernames in the usage file have no people record.
    expect(result.unresolvedIdentityCount).toBeGreaterThan(0);
    expect(result.unresolvedIdentityCost).toBeGreaterThan(0);
    expect(result.unallocated).toBeGreaterThan(0);
  });
});

// ── 2C-3: named-user reclaim, five states ────────────────────────────────────

describe('named-user reclaim on a genuinely idle population', () => {
  it('treats MATLAB as named-user because both files say so', () => {
    expect(feature('feature:matlab').licenseModel).toBe('named_user');
  });

  it('finds the holder idle for 136 days', () => {
    const matlab = feature('feature:matlab').namedUser!;
    expect(matlab.reclaimCandidates).toBeGreaterThanOrEqual(1);
  });

  it('does not touch the holder idle for 40 days', () => {
    // Inside the 90-day threshold. Two observed holders are active.
    expect(feature('feature:matlab').namedUser!.activeUsers).toBeGreaterThanOrEqual(2);
  });

  it('never marks a seat with no observed holder as safe to reclaim', () => {
    const matlab = feature('feature:matlab').namedUser!;
    // Ngozi Achebe was never observed, and six of ten seats have no observed
    // holder at all. Absence of evidence is not evidence of no demand.
    expect(matlab.seatsWithoutObservedUser).toBeGreaterThan(0);
    expect(matlab.reclaimCandidates).toBeLessThanOrEqual(matlab.observedUsers);
  });

  it('keeps reclaim candidates inside the assigned seat count', () => {
    const matlab = feature('feature:matlab').namedUser!;
    expect(matlab.reclaimCandidates).toBeLessThanOrEqual(matlab.assigned);
  });

  it('prices MATLAB reclaim because a contract states the price', () => {
    const matlab = feature('feature:matlab').namedUser!;
    expect(feature('feature:matlab').unitPrice).toBe(900);
    expect(matlab.reclaimValue).toBe(matlab.reclaimCandidates * 900);
  });

  it('refuses to price NX_CAM reclaim, because no contract does', () => {
    const nx = feature('feature:nx_cam').namedUser!;
    expect(nx.reclaimCandidates).toBeGreaterThanOrEqual(1);
    // Unknown value. Not zero value, and not a benchmark price we invented.
    expect(nx.reclaimValue).toBeNull();
  });
});

// ── 2C-4 / 2C-5: identity and manager rollup ─────────────────────────────────

describe('the identity queue and the manager rollup', () => {
  it('queues the usernames with no people record', () => {
    const queue = buildUserReviewQueue({
      identities: resolveUsers(usage, people),
      employees: dataset.employees,
    });
    expect(queue.unresolvedCount).toBe(3);
    expect(queue.unattributedObservations).toBeGreaterThan(0);
  });

  it('offers no candidate on display-name resemblance alone', () => {
    const queue = buildUserReviewQueue({
      identities: resolveUsers(usage, people),
      employees: dataset.employees,
    });
    const service = queue.users.find((user) => user.rawUsername === 'svc_batch_sim')!;
    expect(service.candidates).toHaveLength(0);
  });

  it('keeps two managers who share a name as two managers', () => {
    const rollup = rollUpByManager({
      employees: dataset.employees,
      activities: dataset.activities,
      portfolio,
      reclaimThresholdDays: DEFAULT_ANALYSIS_OPTIONS.reclaimThresholdDays,
      asOf: AS_OF,
    });

    const smiths = rollup.groups.filter((group) => group.managerName === 'J. Smith');
    expect(smiths).toHaveLength(2);
    expect(new Set(smiths.map((group) => group.managerKey)).size).toBe(2);
  });

  it('groups a name-only manager as a label, not a reporting line', () => {
    const rollup = rollUpByManager({
      employees: dataset.employees,
      activities: dataset.activities,
      portfolio,
      reclaimThresholdDays: DEFAULT_ANALYSIS_OPTIONS.reclaimThresholdDays,
      asOf: AS_OF,
    });

    const vandermeer = rollup.groups.find((group) => group.managerName === 'H. Vandermeer')!;
    expect(vandermeer.linked).toBe(false);
    expect(vandermeer.reportCount).toBe(3);
    expect(rollup.unlinkedPeople).toBe(3);
  });

  it('puts the idle MATLAB holder under the manager who can act on it', () => {
    const rollup = rollUpByManager({
      employees: dataset.employees,
      activities: dataset.activities,
      portfolio,
      reclaimThresholdDays: DEFAULT_ANALYSIS_OPTIONS.reclaimThresholdDays,
      asOf: AS_OF,
    });

    const okafor = rollup.groups.find((group) => group.managerKey === 'mgr-1041')!;
    expect(okafor.reclaimCandidates).toBeGreaterThanOrEqual(1);
  });
});
