/**
 * What the imported data can actually support.
 *
 * Every entry is computed from persisted records. None is a hard-coded label.
 *
 * THE DISTINCTION THAT MATTERS MOST
 *
 * "Not supplied" and "zero" are different answers and must never be conflated.
 * A file with no denial column does not prove demand was met — it proves
 * nobody logged denials. Rendering that as "0 denials" would tell a customer
 * their capacity is comfortable on the strength of data that does not exist,
 * which is the single most expensive lie this product could tell.
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

export interface CapabilityLine {
  label: string;
  available: boolean;
  /** Why it is unavailable. Null when it is available. */
  requires: string | null;
}

/** Days of history below which a percentile is arithmetic rather than evidence. */
export const MIN_DAYS_FOR_PERCENTILE = 14;

export interface CapabilityInput {
  coverage: CoverageSummary;
  /** Distinct observation dates actually present. */
  distinctDates: number;
  /** True when at least one contract line carries a price. */
  hasCost: boolean;
  /** People records that resolved to a usage identity. */
  resolvedPeople: number;
}

export function coverageLines(input: CapabilityInput): CoverageLine[] {
  const { coverage, resolvedPeople } = input;

  const peopleState: CoverageState =
    coverage.peopleRecords === 0
      ? 'missing'
      : resolvedPeople === 0
        ? 'partial'
        : resolvedPeople < coverage.distinctUsers
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

export function capabilityLines(input: CapabilityInput): CapabilityLine[] {
  const { coverage, distinctDates, hasCost, resolvedPeople } = input;

  const hasUsage = coverage.usageRecords > 0;
  const hasConcurrency = hasUsage && coverage.hasConcurrency;
  const enoughHistory = distinctDates >= MIN_DAYS_FOR_PERCENTILE;
  const hasEntitlements = coverage.entitlementRecords > 0;

  return [
    { label: 'Usage trends', available: hasUsage, requires: hasUsage ? null : 'requires usage data' },
    { label: 'Daily demand', available: hasUsage, requires: hasUsage ? null : 'requires usage data' },
    {
      label: 'P95 demand',
      available: hasConcurrency && enoughHistory,
      requires: !hasConcurrency
        ? 'requires concurrent demand'
        : !enoughHistory
          ? `requires at least ${MIN_DAYS_FOR_PERCENTILE} days of history`
          : null,
    },
    {
      label: 'Capacity headroom',
      available: hasConcurrency && hasEntitlements,
      requires: !hasEntitlements ? 'requires entitlements' : !hasConcurrency ? 'requires concurrent demand' : null,
    },
    {
      label: 'Utilization',
      available: hasConcurrency && hasEntitlements,
      requires: !hasEntitlements ? 'requires entitlements' : !hasConcurrency ? 'requires concurrent demand' : null,
    },
    {
      label: 'Unmet demand',
      available: coverage.hasDenials,
      requires: coverage.hasDenials ? null : 'requires denial data',
    },
    {
      label: 'Financial opportunity',
      available: hasCost,
      // Licence exports never carry price, so this stays unavailable until
      // contract or cost data is imported. It is not computed from zero.
      requires: hasCost ? null : 'requires contract or cost data',
    },
    {
      label: 'Organization allocation',
      available: resolvedPeople > 0,
      requires: resolvedPeople > 0 ? null : 'requires employee context',
    },
  ];
}

/** Overall data-quality banding, from what is actually present. */
export function qualityBand(input: CapabilityInput): 'High' | 'Medium' | 'Low' {
  const capabilities = capabilityLines(input);
  const core = capabilities.filter((entry) =>
    ['Usage trends', 'Daily demand', 'P95 demand'].includes(entry.label),
  );
  const met = core.filter((entry) => entry.available).length;
  if (met === core.length) return 'High';
  if (met > 0) return 'Medium';
  return 'Low';
}
