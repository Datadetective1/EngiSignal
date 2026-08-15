import { describe, expect, it } from 'vitest';
import {
  normalizeFeatureKey,
  normalizeUserKey,
  resolveFeatures,
  resolveUsers,
  unresolvedUsers,
} from '@/lib/ingestion/identity';
import { capabilityLines, coverageLines, qualityBand } from '@/lib/ingestion/capabilities';
import type { CanonicalPersonRecord, CanonicalUsageRecord } from '@/lib/ingestion/canonical/types';

const PROV = {
  organizationId: 'org-a',
  importId: 'import-1',
  importedAt: '2026-08-15T00:00:00.000Z',
  sourceFile: 'f.csv',
  sourceSystem: 'flexnet' as const,
  sourceSheet: null,
  sourceRow: 2,
};

function usage(feature: string, user: string | null, extra: Partial<CanonicalUsageRecord> = {}): CanonicalUsageRecord {
  return {
    date: '2026-03-02',
    hour: 9,
    observedAt: null,
    user,
    employeeCode: null,
    feature,
    product: null,
    vendor: null,
    quantity: null,
    concurrent: 10,
    peak: null,
    available: null,
    durationHours: null,
    checkoutAt: null,
    checkinAt: null,
    denied: null,
    denialCount: null,
    licenseServer: null,
    pool: null,
    tokens: null,
    provenance: PROV,
    ...extra,
  };
}

function person(user: string, extra: Partial<CanonicalPersonRecord> = {}): CanonicalPersonRecord {
  return {
    user,
    employeeCode: null,
    displayName: null,
    email: null,
    provenance: PROV,
    ...extra,
  };
}

describe('feature identity', () => {
  it('treats case and separator variations as one string written several ways', () => {
    expect(normalizeFeatureKey('MECH_ENT')).toBe('mech_ent');
    expect(normalizeFeatureKey('mech-ent')).toBe('mech_ent');
    expect(normalizeFeatureKey('Mech Ent')).toBe('mech_ent');
    expect(normalizeFeatureKey('  MECH.ENT  ')).toBe('mech_ent');
  });

  it('merges those spellings into one identity and keeps every raw value', () => {
    const identities = resolveFeatures([
      usage('MECH_ENT', 'a'),
      usage('mech-ent', 'b'),
      usage('Mech Ent', 'c'),
    ]);

    expect(identities).toHaveLength(1);
    expect(identities[0]!.rawValues).toEqual(['MECH_ENT', 'Mech Ent', 'mech-ent']);
    expect(identities[0]!.observations).toBe(3);
  });

  it('does NOT merge different features that merely look related', () => {
    // Merging these would sum two demand curves and roughly double the peak,
    // recommending licences for a feature that does not exist.
    const identities = resolveFeatures([
      usage('MECH_ENT', 'a'),
      usage('ANSYS Mechanical', 'b'),
      usage('mech_enterprise', 'c'),
    ]);

    expect(identities).toHaveLength(3);
  });

  it('does not merge a base feature with a longer variant', () => {
    const identities = resolveFeatures([usage('NX_DESIGN', 'a'), usage('NX_DESIGN_12', 'b')]);
    expect(identities).toHaveLength(2);
  });

  it('suggests related identities without acting on them', () => {
    const identities = resolveFeatures([usage('MECH_ENT', 'a'), usage('MECH_ENT_HPC', 'b')]);

    expect(identities).toHaveLength(2);
    const base = identities.find((entry) => entry.key === 'mech_ent')!;
    // Surfaced for review, not merged.
    expect(base.possibleRelated).toContain('mech_ent_hpc');
  });

  it('merges only when a confirmed alias says so', () => {
    const aliases = new Map([['ansys mechanical', 'mech_ent']]);
    const identities = resolveFeatures([usage('MECH_ENT', 'a'), usage('ANSYS Mechanical', 'b')], aliases);

    expect(identities).toHaveLength(1);
    expect(identities[0]!.key).toBe('mech_ent');
    // The original spelling survives the merge.
    expect(identities[0]!.rawValues).toContain('ANSYS Mechanical');
  });
});

describe('user identity', () => {
  it('normalizes only case and surrounding space', () => {
    expect(normalizeUserKey('  JHalvorsen ')).toBe('jhalvorsen');
  });

  it('resolves a username against a people record', () => {
    const identities = resolveUsers(
      [usage('F1', 'jhalvorsen')],
      [person('jhalvorsen', { displayName: 'J Halvorsen', email: 'jh@example.com', employeeCode: 'E1' })],
    );

    const identity = identities.find((entry) => entry.key === 'jhalvorsen')!;
    expect(identity.resolved).toBe(true);
    expect(identity.displayName).toBe('J Halvorsen');
    expect(identity.employeeCode).toBe('E1');
  });

  it('never merges two people on similar names alone', () => {
    // Two different accounts, similar display names. They must stay separate:
    // merging would attribute one person's usage to another and route a
    // reclaim decision to the wrong manager.
    const identities = resolveUsers(
      [usage('F1', 'jsmith'), usage('F1', 'jsmith2')],
      [person('jsmith', { displayName: 'J Smith' }), person('jsmith2', { displayName: 'J Smith' })],
    );

    expect(identities.filter((entry) => entry.observations > 0)).toHaveLength(2);
  });

  it('keeps unresolved usernames visible rather than absorbing them', () => {
    const identities = resolveUsers([usage('F1', 'ghost'), usage('F1', 'known')], [person('known')]);

    const unresolved = unresolvedUsers(identities);
    expect(unresolved.map((entry) => entry.key)).toEqual(['ghost']);
  });

  it('keeps people who have no observed usage', () => {
    // An assigned seat with no activity is exactly what a reclaim review is for.
    const identities = resolveUsers([], [person('dormant', { displayName: 'Dormant User' })]);

    expect(identities).toHaveLength(1);
    expect(identities[0]!.resolved).toBe(true);
    expect(identities[0]!.observations).toBe(0);
  });
});

describe('capability gating', () => {
  const baseCoverage = {
    usageRecords: 500,
    entitlementRecords: 0,
    peopleRecords: 0,
    contractRecords: 0,
    pricedContractRecords: 0,
    datedContractRecords: 0,
    currencies: [] as string[],
    distinctFeatures: 3,
    distinctUsers: 20,
    firstDate: '2026-01-01',
    lastDate: '2026-03-01',
    historyDays: 60,
    hasHourOrTimestamp: true,
    hasConcurrency: true,
    hasDenials: false,
    sources: ['flexnet' as const],
  };

  it('reports denials as not supplied, never as zero', () => {
    const lines = coverageLines({
      coverage: baseCoverage,
      distinctDates: 60,
      hasCost: false,
      resolvedPeople: 0,
    });

    const denials = lines.find((line) => line.label === 'Denials')!;
    expect(denials.state).toBe('not_supplied');
    expect(denials.detail).toBe('Denial data not supplied');
    // The word "0" must never appear as the denial answer.
    expect(denials.detail).not.toMatch(/\b0\b/);
  });

  it('withholds P95 until there is enough history', () => {
    const thin = capabilityLines({
      coverage: baseCoverage,
      distinctDates: 5,
      hasCost: false,
      resolvedPeople: 0,
    });
    expect(thin.find((line) => line.key === 'percentileDemand')!.available).toBe(false);

    const rich = capabilityLines({
      coverage: baseCoverage,
      distinctDates: 60,
      hasCost: false,
      resolvedPeople: 0,
    });
    expect(rich.find((line) => line.key === 'percentileDemand')!.available).toBe(true);
  });

  it('withholds capacity headroom until entitlements exist', () => {
    const without = capabilityLines({
      coverage: baseCoverage,
      distinctDates: 60,
      hasCost: false,
      resolvedPeople: 0,
    });
    const headroom = without.find((line) => line.key === 'capacityHeadroom')!;
    expect(headroom.available).toBe(false);
    expect(headroom.requires).toContain('entitlements');

    const withEnt = capabilityLines({
      coverage: { ...baseCoverage, entitlementRecords: 4 },
      distinctDates: 60,
      hasCost: false,
      resolvedPeople: 0,
    });
    expect(withEnt.find((line) => line.key === 'capacityHeadroom')!.available).toBe(true);
  });

  it('never offers financial opportunity without cost data', () => {
    const lines = capabilityLines({
      coverage: { ...baseCoverage, entitlementRecords: 4 },
      distinctDates: 60,
      hasCost: false,
      resolvedPeople: 10,
    });

    const financial = lines.find((line) => line.key === 'financialOpportunity')!;
    expect(financial.available).toBe(false);
    expect(financial.requires).toContain('cost');
  });

  it('bands quality from what is actually present', () => {
    expect(
      qualityBand({ coverage: baseCoverage, distinctDates: 60, hasCost: false, resolvedPeople: 0 }),
    ).toBe('High');

    expect(
      qualityBand({
        coverage: { ...baseCoverage, hasConcurrency: false },
        distinctDates: 60,
        hasCost: false,
        resolvedPeople: 0,
      }),
    ).toBe('Medium');

    expect(
      qualityBand({
        coverage: { ...baseCoverage, usageRecords: 0, hasConcurrency: false },
        distinctDates: 0,
        hasCost: false,
        resolvedPeople: 0,
      }),
    ).toBe('Low');
  });
});
