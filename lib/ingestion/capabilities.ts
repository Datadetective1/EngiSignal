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
export type DataInput =
  | 'usage'
  | 'concurrency'
  | 'entitlements'
  | 'denials'
  | 'cost'
  | 'people'
  | 'contractDates'
  | 'namedUser';

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
  | 'recommendedRenewalSpend'
  | 'renewalExposure'
  | 'reclaimOpportunity'
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
  /** True when at least one entitlement or contract line is named-user. */
  hasNamedUserLicensing?: boolean;
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
  {
    key: 'recommendedRenewalSpend',
    label: 'Recommended renewal spend',
    needs: ['usage', 'concurrency', 'entitlements', 'cost'],
    note: `at least ${MIN_DAYS_FOR_PERCENTILE} days of history`,
  },
  // Deliberately needs no usage. A renewal calendar is answerable from the
  // commercial file alone, and a customer who has only uploaded contracts
  // should get something useful on the first import rather than a locked screen.
  { key: 'renewalExposure', label: 'Renewal exposure', needs: ['contractDates'] },
  {
    key: 'reclaimOpportunity',
    label: 'Reclaim opportunity',
    needs: ['usage', 'people', 'namedUser', 'cost'],
  },
  { key: 'organizationAllocation', label: 'Organization allocation', needs: ['usage', 'people'] },
];

const INPUT_LABEL: Record<DataInput, string> = {
  usage: 'usage data',
  concurrency: 'concurrent demand',
  entitlements: 'entitlements',
  denials: 'denial data',
  cost: 'contract or cost data',
  people: 'employee context',
  contractDates: 'contract renewal or end dates',
  namedUser: 'named-user licensing',
};

/** Which input families the tenant currently has. */
export function availableInputs(input: CapabilityInput): Set<DataInput> {
  const { coverage, hasCost, resolvedPeople } = input;
  const present = new Set<DataInput>();

  if (coverage.usageRecords > 0) present.add('usage');
  if (coverage.hasConcurrency) present.add('concurrency');
  if (coverage.entitlementRecords > 0) present.add('entitlements');
  if (coverage.hasDenials) present.add('denials');
  // Cost is present when a projected contract line carries a price OR when the
  // commercial import itself produced priced records. The two agree once the
  // lines are matched; before matching, the second is the honest answer for a
  // single-file preview, where there is nothing yet to match against.
  if (hasCost || coverage.pricedContractRecords > 0) present.add('cost');
  if (resolvedPeople > 0) present.add('people');
  if (coverage.datedContractRecords > 0) present.add('contractDates');
  if (input.hasNamedUserLicensing === true) present.add('namedUser');

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
    // Recommended renewal spend inherits the same floor: it is a percentile
    // multiplied by a price, and a percentile from four days of data does not
    // become defensible by having a dollar sign in front of it.
    const historyShort =
      (entry.key === 'percentileDemand' || entry.key === 'recommendedRenewalSpend') &&
      missing.length === 0 &&
      !enoughHistory;

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
      state:
        coverage.contractRecords > 0
          ? 'complete'
          : coverage.entitlementRecords > 0
            ? 'partial'
            : 'missing',
      detail:
        coverage.contractRecords > 0
          ? `${coverage.contractRecords.toLocaleString('en-US')} commercial lines`
          : coverage.entitlementRecords > 0
            ? 'Quantities only, no commercial terms'
            : 'Missing',
    },
    {
      label: 'Renewal dates',
      // Never "0 days to renewal". Either a date was supplied or it was not.
      state:
        coverage.datedContractRecords > 0
          ? coverage.contractRecords > coverage.datedContractRecords
            ? 'partial'
            : 'complete'
          : 'missing',
      detail:
        coverage.datedContractRecords > 0
          ? `${coverage.datedContractRecords.toLocaleString('en-US')} of ${coverage.contractRecords.toLocaleString('en-US')} lines dated`
          : 'Renewal date not supplied',
    },
    {
      label: 'Cost',
      state:
        input.hasCost || coverage.pricedContractRecords > 0
          ? coverage.contractRecords > coverage.pricedContractRecords && coverage.contractRecords > 0
            ? 'partial'
            : 'complete'
          : 'missing',
      detail:
        input.hasCost || coverage.pricedContractRecords > 0
          ? coverage.contractRecords > 0
            ? `${coverage.pricedContractRecords.toLocaleString('en-US')} of ${coverage.contractRecords.toLocaleString('en-US')} lines priced`
            : 'Available'
          : 'Cost data not supplied',
    },
    {
      label: 'Currency',
      state:
        coverage.currencies.length === 1
          ? 'complete'
          : coverage.currencies.length > 1
            ? 'partial'
            : 'not_supplied',
      detail:
        coverage.currencies.length === 1
          ? coverage.currencies[0]!
          : coverage.currencies.length > 1
            ? // Summing across currencies without a rate would be arithmetic on
              // incomparable units. The mix is reported instead of a total.
              `Mixed: ${coverage.currencies.join(', ')} — amounts are not summed across currencies`
            : 'Not stated, amounts reported as supplied',
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
