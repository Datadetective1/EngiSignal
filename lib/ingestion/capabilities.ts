/**
 * THE capability matrix.
 *
 * ONE definition of what EngiSignal can answer, used by the analytics layer,
 * the import workflow and the Data page alike. There were briefly two — one
 * here and one in project.ts — which is precisely the drift risk this file now
 * exists to remove: two answers to "can we compute P95" would eventually
 * disagree, and the customer would see a capability offered on one screen and
 * withheld on another.
 *
 * THE DISTINCTION THAT MATTERS MOST
 *
 * "Not supplied" and "zero" are different answers and must never be conflated.
 * A file with no denial column does not prove demand was met — it proves nobody
 * logged denials. Rendering that as "0 denials" would tell a customer their
 * capacity is comfortable on the strength of data that does not exist, which is
 * the most expensive lie this product could tell.
 *
 * The same applies to cost: a licence-manager export never carries price, so
 * financial opportunity is withheld rather than computed from an assumed zero.
 */

import type { CoverageSummary } from './store/types';

export type CoverageState = 'complete' | 'partial' | 'missing' | 'not_supplied';

export interface CoverageLine {
  label: string;
  state: CoverageState;
  detail: string;
}

/** Every input family EngiSignal can consume. */
export type DataInput = 'usage' | 'concurrency' | 'entitlements' | 'denials' | 'cost' | 'people';

export interface CapabilityLine {
  key: CapabilityKey;
  label: string;
  available: boolean;
  /** Why it is unavailable. Null when available. */
  requires: string | null;
}

export type CapabilityKey =
  | 'usageTrends'
  | 'dailyDemand'
  | 'percentileDemand'
  | 'capacityHeadroom'
  | 'utilization'
  | 'denialAnalysis'
  | 'financialOpportunity'
  | 'organizationAllocation';

/** Days of history below which a percentile is arithmetic rather than evidence. */
export const MIN_DAYS_FOR_PERCENTILE = 14;

export interface CapabilityInput {
  coverage: CoverageSummary;
  /** Distinct observation dates actually present. */
  distinctDates: number;
  /** True when at least one contract line carries a price. */
  hasCost: boolean;
  /** Usernames that resolved to a person record. */
  resolvedPeople: number;
}

/**
 * The declarative matrix.
 *
 * `needs` is the honest requirement list. Nothing is granted by a flag set
 * elsewhere; availability is derived from these requirements alone, so the
 * matrix published in documentation and the behaviour in the product cannot
 * drift apart.
 */
export const CAPABILITY_MATRIX: {
  key: CapabilityKey;
  label: string;
  needs: DataInput[];
  /** Extra condition beyond the presence of the inputs. */
  note?: string;
}[] = [
  { key: 'usageTrends', label: 'Usage trends', needs: ['usage'] },
  { key: 'dailyDemand', label: 'Daily demand', needs: ['usage'] },
  {
    key: 'percentileDemand',
    label: 'P90 / P95 / P99 demand',
    needs: ['usage', 'concurrency'],
    note: `at least ${MIN_DAYS_FOR_PERCENTILE} days of history`,
  },
  { key: 'capacityHeadroom', label: 'Capacity headroom', needs: ['usage', 'concurrency', 'entitlements'] },
  { key: 'utilization', label: 'Utilization', needs: ['usage', 'concurrency', 'entitlements'] },
  { key: 'denialAnalysis', label: 'Unmet demand', needs: ['usage', 'denials'] },
  { key: 'financialOpportunity', label: 'Financial opportunity', needs: ['usage', 'entitlements', 'cost'] },
  { key: 'organizationAllocation', label: 'Organization allocation', needs: ['usage', 'people'] },
];

const INPUT_LABEL: Record<DataInput, string> = {
  usage: 'usage data',
  concurrency: 'concurrent demand',
  entitlements: 'entitlements',
  denials: 'denial data',
  cost: 'contract or cost data',
  people: 'employee context',
};

/** Which input families the tenant currently has. */
export function availableInputs(input: CapabilityInput): Set<DataInput> {
  const { coverage, hasCost, resolvedPeople } = input;
  const present = new Set<DataInput>();

  if (coverage.usageRecords > 0) present.add('usage');
  if (coverage.hasConcurrency) present.add('concurrency');
  if (coverage.entitlementRecords > 0) present.add('entitlements');
  if (coverage.hasDenials) present.add('denials');
  if (hasCost) present.add('cost');
  if (resolvedPeople > 0) present.add('people');

  return present;
}

/** Evaluate the matrix against what the tenant actually has. */
export function capabilityLines(input: CapabilityInput): CapabilityLine[] {
  const present = availableInputs(input);
  const enoughHistory = input.distinctDates >= MIN_DAYS_FOR_PERCENTILE;

  return CAPABILITY_MATRIX.map((entry) => {
    const missing = entry.needs.filter((need) => !present.has(need));

    // History is a property of the data, not an input family, so it is checked
    // separately — a year of one-day-a-week sampling is still thin evidence.
    const historyShort = entry.key === 'percentileDemand' && missing.length === 0 && !enoughHistory;

    const available = missing.length === 0 && !historyShort;
    const requires = available
      ? null
      : historyShort
        ? `requires ${MIN_DAYS_FOR_PERCENTILE} days of history`
        : `requires ${missing.map((need) => INPUT_LABEL[need]).join(' and ')}`;

    return { key: entry.key, label: entry.label, available, requires };
  });
}

/** Convenience lookup for a single capability. */
export function hasCapability(input: CapabilityInput, key: CapabilityKey): boolean {
  return capabilityLines(input).find((line) => line.key === key)?.available ?? false;
}

export function coverageLines(input: CapabilityInput): CoverageLine[] {
  const { coverage, resolvedPeople } = input;

  const peopleState: CoverageState =
    coverage.peopleRecords === 0
      ? 'missing'
      : resolvedPeople === 0 || resolvedPeople < coverage.distinctUsers
        ? 'partial'
        : 'complete';

  return [
    {
      label: 'Usage',
      state: coverage.usageRecords > 0 ? 'complete' : 'missing',
      detail:
        coverage.usageRecords > 0
          ? `${coverage.usageRecords.toLocaleString('en-US')} records`
          : 'No usage imported',
    },
    {
      label: 'Concurrent demand',
      state: coverage.hasConcurrency ? 'complete' : 'not_supplied',
      detail: coverage.hasConcurrency ? 'Available' : 'Not supplied by the source',
    },
    {
      label: 'Entitlements',
      state: coverage.entitlementRecords > 0 ? 'complete' : 'missing',
      detail:
        coverage.entitlementRecords > 0
          ? `${coverage.entitlementRecords.toLocaleString('en-US')} records`
          : 'Missing',
    },
    {
      label: 'People',
      state: peopleState,
      detail:
        coverage.peopleRecords === 0
          ? 'Missing'
          : `${resolvedPeople.toLocaleString('en-US')} of ${coverage.distinctUsers.toLocaleString('en-US')} usernames resolved`,
    },
    {
      label: 'Denials',
      // Never "0". Either the source reported denials or it did not.
      state: coverage.hasDenials ? 'complete' : 'not_supplied',
      detail: coverage.hasDenials ? 'Available' : 'Denial data not supplied',
    },
    {
      label: 'Contracts',
      state: coverage.entitlementRecords > 0 ? 'partial' : 'missing',
      detail: coverage.entitlementRecords > 0 ? 'Quantities only, no terms' : 'Missing',
    },
    {
      label: 'Cost',
      state: input.hasCost ? 'complete' : 'missing',
      detail: input.hasCost ? 'Available' : 'Missing',
    },
  ];
}

/** Overall data-quality banding, from what is actually present. */
export function qualityBand(input: CapabilityInput): 'High' | 'Medium' | 'Low' {
  const lines = capabilityLines(input);
  const core: CapabilityKey[] = ['usageTrends', 'dailyDemand', 'percentileDemand'];
  const met = lines.filter((line) => core.includes(line.key) && line.available).length;

  if (met === core.length) return 'High';
  if (met > 0) return 'Medium';
  return 'Low';
}

/** What is still missing, phrased as the next thing to import. */
export function unlockSuggestions(input: CapabilityInput): { capability: string; needs: string }[] {
  const present = availableInputs(input);
  const suggestions: { capability: string; needs: string }[] = [];

  for (const entry of CAPABILITY_MATRIX) {
    const missing = entry.needs.filter((need) => !present.has(need));
    if (missing.length === 0) continue;
    suggestions.push({
      capability: entry.label,
      needs: `Add ${missing.map((need) => INPUT_LABEL[need]).join(' and ')}`,
    });
  }

  return suggestions;
}
