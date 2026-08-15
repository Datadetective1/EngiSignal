/**
 * Grouping by manager.
 *
 * The people file carries two manager fields and they are not interchangeable:
 *
 *   managerName  is for DISPLAY. "M. Okafor" is what a reviewer reads.
 *   managerKey   is an employee id or email — the only thing a relationship
 *                can safely be built from.
 *
 * Building a hierarchy from names would merge every J. Smith in the company
 * into one manager and route other people's reclaim decisions to them. So a
 * group is keyed by `managerKey`, the name is carried only as a label, and two
 * managers with the same name and different keys stay two managers.
 *
 * Where no key was supplied, the imported manager information is preserved and
 * reported as unlinked rather than being invented into a hierarchy.
 */

import type { Employee, PortfolioRow, UserFeatureActivity } from '@/lib/domain/types';
import { round } from './stats';

export interface ManagerGroup {
  /** The stable identifier. Null for people whose file carried no manager key. */
  managerKey: string | null;
  /** For display. May be shared by two different managers; the key never is. */
  managerName: string | null;
  /** People reporting to this manager, by the key. */
  reportCount: number;
  /** Reports observed using any software. */
  activeReports: number;
  /** Named-user seats held across all reports. */
  assignedSeats: number;
  /** Seats whose holder has been idle past the reclaim threshold. */
  reclaimCandidates: number;
  /** Annual value of those seats. Null when no price evidence exists. */
  reclaimValue: number | null;
  /** Distinct features the reports were observed using. */
  featuresUsed: number;
  /**
   * True when the group was formed from `managerKey`.
   *
   * False means the people file named a manager but gave no identifier, so the
   * group is a label rather than a relationship — and must not be presented as
   * a reporting line.
   */
  linked: boolean;
}

export interface ManagerRollup {
  groups: ManagerGroup[];
  /** People whose record names a manager but carries no key. */
  unlinkedPeople: number;
  /** People with no manager information at all. */
  peopleWithoutManager: number;
  /** True when at least one group came from a real key. */
  hierarchyAvailable: boolean;
}

export interface ManagerRollupInput {
  employees: readonly Employee[];
  activities: readonly UserFeatureActivity[];
  portfolio: readonly PortfolioRow[];
  /** Inactivity threshold in days, matching the reclaim analysis. */
  reclaimThresholdDays: number;
  asOf: string;
}

function daysBetween(from: string, to: string): number | null {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

export function rollUpByManager(input: ManagerRollupInput): ManagerRollup {
  const employeeById = new Map(input.employees.map((employee) => [employee.id, employee]));

  // Unit price per feature, for valuing reclaim candidates. Null stays null:
  // an unpriced seat has an unknown value, not a zero one.
  const priceByFeature = new Map(input.portfolio.map((row) => [row.featureId, row.unitPrice]));
  const namedUserFeatures = new Set(
    input.portfolio
      .filter((row) => row.licenseModel === 'named_user' || row.licenseModel === 'subscription')
      .map((row) => row.featureId),
  );

  interface Accumulator extends ManagerGroup {
    reports: Set<string>;
    active: Set<string>;
    features: Set<string>;
    pricedReclaimValue: number;
    hasUnpricedReclaim: boolean;
  }

  const groups = new Map<string, Accumulator>();
  let unlinkedPeople = 0;
  let peopleWithoutManager = 0;

  const ensure = (managerKey: string | null, managerName: string | null): Accumulator => {
    // Keyed by the identifier when there is one. When there is not, the label
    // itself is the bucket — and `linked` records that the difference matters.
    const id = managerKey !== null ? `key:${managerKey.trim().toLowerCase()}` : `name:${managerName ?? ''}`;
    const existing = groups.get(id);
    if (existing !== undefined) return existing;

    const created: Accumulator = {
      managerKey,
      managerName,
      reportCount: 0,
      activeReports: 0,
      assignedSeats: 0,
      reclaimCandidates: 0,
      reclaimValue: null,
      featuresUsed: 0,
      linked: managerKey !== null,
      reports: new Set(),
      active: new Set(),
      features: new Set(),
      pricedReclaimValue: 0,
      hasUnpricedReclaim: false,
    };
    groups.set(id, created);
    return created;
  };

  for (const employee of input.employees) {
    const managerKey = employee.managerKey ?? null;
    const managerName = employee.managerName;

    if (managerKey === null && managerName === null) {
      peopleWithoutManager += 1;
      continue;
    }
    if (managerKey === null) unlinkedPeople += 1;

    ensure(managerKey, managerName).reports.add(employee.id);
  }

  for (const activity of input.activities) {
    const employee = employeeById.get(activity.employeeId);
    if (employee === undefined) continue;
    if (employee.managerKey === null && employee.managerName === null) continue;

    const group = ensure(employee.managerKey ?? null, employee.managerName);
    group.features.add(activity.featureId);

    const observed =
      activity.totalSessions > 0 || activity.totalHours > 0 || activity.lastUsedDate !== null;
    if (observed) group.active.add(employee.id);

    if (!activity.assigned || !namedUserFeatures.has(activity.featureId)) continue;
    group.assignedSeats += 1;

    // Only a holder EngiSignal watched sitting idle. A seat with no observed
    // activity at all is unknown, not idle — the same rule the reclaim analysis
    // applies, restated here rather than reinvented.
    const idleDays =
      activity.lastUsedDate === null ? null : daysBetween(activity.lastUsedDate, input.asOf);
    if (idleDays === null || idleDays < input.reclaimThresholdDays) continue;

    group.reclaimCandidates += 1;
    const price = priceByFeature.get(activity.featureId) ?? null;
    if (price === null) group.hasUnpricedReclaim = true;
    else group.pricedReclaimValue += price;
  }

  const out: ManagerGroup[] = [...groups.values()].map((group) => ({
    managerKey: group.managerKey,
    managerName: group.managerName,
    reportCount: group.reports.size,
    activeReports: group.active.size,
    assignedSeats: group.assignedSeats,
    reclaimCandidates: group.reclaimCandidates,
    // Null when nothing was priced at all; a partial total would read as
    // complete. A mix reports what could be valued.
    reclaimValue:
      group.reclaimCandidates === 0
        ? null
        : group.pricedReclaimValue === 0 && group.hasUnpricedReclaim
          ? null
          : round(group.pricedReclaimValue, 2),
    featuresUsed: group.features.size,
    linked: group.linked,
  }));

  out.sort(
    (a, b) =>
      b.reclaimCandidates - a.reclaimCandidates ||
      b.assignedSeats - a.assignedSeats ||
      (a.managerName ?? '').localeCompare(b.managerName ?? ''),
  );

  return {
    groups: out,
    unlinkedPeople,
    peopleWithoutManager,
    hierarchyAvailable: out.some((group) => group.linked),
  };
}
