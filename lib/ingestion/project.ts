/**
 * Projection: canonical records → analytics shapes.
 *
 * THIS IS THE ADAPTER BOUNDARY between Phase 1 ingestion and the existing
 * deterministic analytics engine.
 *
 * It contains NO analytical formulas. P90/P95/P99, demand aggregation,
 * forecasting, right-sizing, financial translation, denial logic and confidence
 * all remain exactly where they were, in lib/analytics/*. This module only
 * reshapes: it groups canonical observations into the `HourlyUsage` and
 * `DailyUsage` records those functions already consume.
 *
 * THE ONE JUDGEMENT CALL, STATED PLAINLY
 *
 * Several observations can fall inside the same feature-date-hour. Reducing
 * them to the single value `HourlyUsage.concurrent` requires a choice, and the
 * choice changes P95 and therefore the recommended quantity. EngiSignal takes
 * the MAXIMUM, because:
 *
 *   - concurrent demand within an hour is a high-water mark, not an average;
 *   - understating it would recommend too few licenses and cause the denials
 *     the product exists to prevent.
 *
 * This is deliberately visible here rather than buried in an INSERT, and it is
 * recomputable: correcting a mapping or deleting an import and re-projecting
 * gives a different, equally traceable answer.
 *
 * WHAT THIS DOES NOT DO
 *
 * It does not resolve raw feature strings to canonical features, or raw
 * usernames to employees. Those are reviewable steps with their own queues
 * (feature_aliases / unmapped_features / unmatched_users). Until a customer has
 * done that, projected features are keyed by their raw string, which is honest:
 * the analysis reflects exactly what the file said.
 */

import type {
  CanonicalEntitlementRecord,
  CanonicalUsageRecord,
} from './canonical/types';
import type { DailyUsage, HourlyUsage, LicenseModel } from '@/lib/domain/types';

/** A feature discovered in canonical data, keyed by its raw string. */
export interface ProjectedFeature {
  /** Stable synthetic id derived from the raw string, so projection is deterministic. */
  featureId: string;
  rawFeature: string;
  product: string | null;
  vendor: string | null;
  licenseModel: LicenseModel;
  entitledQuantity: number | null;
}

export interface ProjectionResult {
  features: ProjectedFeature[];
  hourlyUsage: HourlyUsage[];
  dailyUsage: DailyUsage[];
  /** Observations that could not contribute a concurrency figure. */
  observationsWithoutConcurrency: number;
  /** True when no observation carried an hour or timestamp. */
  dailyOnly: boolean;
}

/**
 * Deterministic id for a raw feature string.
 *
 * Not a UUID: it must be reproducible across processes so two projections of
 * the same data agree, and so a projected id can be traced back to the string
 * that produced it.
 */
export function projectedFeatureId(rawFeature: string): string {
  return `raw:${rawFeature.trim().toLowerCase()}`;
}

/** Concurrency contributed by one observation, or null when it carries none. */
function concurrencyOf(record: CanonicalUsageRecord): number | null {
  if (record.concurrent !== null) return record.concurrent;
  if (record.peak !== null) return record.peak;
  // `quantity` is a checkout count, not a concurrency figure. Treating it as
  // one would inflate demand for event-level exports where each row is a
  // single checkout, so it is deliberately not used here.
  return null;
}

/** Hour for an observation: explicit hour wins, else the timestamp's UTC hour. */
function hourOf(record: CanonicalUsageRecord): number | null {
  if (record.hour !== null) return record.hour;
  const stamp = record.observedAt ?? record.checkoutAt;
  if (stamp === null) return null;
  const parsed = new Date(stamp);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getUTCHours();
}

export function projectUsage(
  records: readonly CanonicalUsageRecord[],
  entitlements: readonly CanonicalEntitlementRecord[] = [],
): ProjectionResult {
  const featureMeta = new Map<string, ProjectedFeature>();

  const entitlementByFeature = new Map<string, CanonicalEntitlementRecord>();
  for (const entitlement of entitlements) {
    const key = projectedFeatureId(entitlement.feature);
    const existing = entitlementByFeature.get(key);
    // Largest entitlement wins when a feature appears more than once; summing
    // would double-count the same licenses reported by two servers.
    if (existing === undefined || (entitlement.entitledQuantity ?? 0) > (existing.entitledQuantity ?? 0)) {
      entitlementByFeature.set(key, entitlement);
    }
  }

  // feature → date → hour → max concurrent
  const hourly = new Map<string, Map<string, Map<number, number>>>();
  // feature → date → daily accumulators
  const daily = new Map<
    string,
    Map<string, { peak: number; sum: number; count: number; hours: number; users: Set<string> }>
  >();

  let withoutConcurrency = 0;
  let sawHour = false;

  for (const record of records) {
    const featureId = projectedFeatureId(record.feature);

    if (!featureMeta.has(featureId)) {
      const entitlement = entitlementByFeature.get(featureId);
      featureMeta.set(featureId, {
        featureId,
        rawFeature: record.feature,
        product: record.product,
        vendor: record.vendor,
        licenseModel: (entitlement?.licenseModel ?? 'unknown') as LicenseModel,
        entitledQuantity: entitlement?.entitledQuantity ?? null,
      });
    }

    const dayMap = daily.get(featureId) ?? new Map();
    daily.set(featureId, dayMap);
    const dayEntry =
      dayMap.get(record.date) ?? { peak: 0, sum: 0, count: 0, hours: 0, users: new Set<string>() };
    dayMap.set(record.date, dayEntry);

    if (record.user !== null) dayEntry.users.add(record.user.toLowerCase());
    if (record.durationHours !== null) dayEntry.hours += record.durationHours;

    const concurrency = concurrencyOf(record);
    if (concurrency === null) {
      withoutConcurrency += 1;
      continue;
    }

    dayEntry.peak = Math.max(dayEntry.peak, concurrency);
    dayEntry.sum += concurrency;
    dayEntry.count += 1;

    const hour = hourOf(record);
    if (hour === null) continue;
    sawHour = true;

    const featureHours = hourly.get(featureId) ?? new Map();
    hourly.set(featureId, featureHours);
    const dateHours = featureHours.get(record.date) ?? new Map<number, number>();
    featureHours.set(record.date, dateHours);

    // The maximum, for the reason documented at the top of this file.
    dateHours.set(hour, Math.max(dateHours.get(hour) ?? 0, concurrency));
  }

  const hourlyUsage: HourlyUsage[] = [];
  for (const [featureId, dates] of hourly) {
    for (const [date, hours] of dates) {
      for (const [hour, concurrent] of hours) {
        hourlyUsage.push({ featureId, date, hour, concurrent });
      }
    }
  }

  const dailyUsage: DailyUsage[] = [];
  for (const [featureId, dates] of daily) {
    for (const [date, entry] of dates) {
      dailyUsage.push({
        featureId,
        date,
        peak: entry.peak,
        meanConcurrent: entry.count === 0 ? 0 : Number((entry.sum / entry.count).toFixed(3)),
        usageHours: Number(entry.hours.toFixed(2)),
        uniqueUsers: entry.users.size,
      });
    }
  }

  hourlyUsage.sort(
    (a, b) => a.featureId.localeCompare(b.featureId) || a.date.localeCompare(b.date) || a.hour - b.hour,
  );
  dailyUsage.sort((a, b) => a.featureId.localeCompare(b.featureId) || a.date.localeCompare(b.date));

  return {
    features: [...featureMeta.values()].sort((a, b) => a.rawFeature.localeCompare(b.rawFeature)),
    hourlyUsage,
    dailyUsage,
    observationsWithoutConcurrency: withoutConcurrency,
    dailyOnly: !sawHour,
  };
}

/**
 * What the projected data can and cannot support.
 *
 * Drives the customer-facing "EngiSignal can now analyze" list. Each capability
 * is granted only when the underlying data genuinely exists — an empty
 * entitlement set means headroom cannot be computed, and saying otherwise would
 * put a number behind a renewal that nothing supports.
 */
export interface AnalysisCapabilities {
  usageTrends: boolean;
  dailyDemand: boolean;
  percentileDemand: boolean;
  capacityUtilization: boolean;
  financialOpportunity: boolean;
  organizationalBreakdown: boolean;
  denialAnalysis: boolean;
  missing: { capability: string; needs: string }[];
}

export function assessCapabilities({
  projection,
  entitlementCount,
  peopleCount,
  hasDenials,
  distinctDates,
}: {
  projection: ProjectionResult;
  entitlementCount: number;
  peopleCount: number;
  hasDenials: boolean;
  distinctDates: number;
}): AnalysisCapabilities {
  const hasUsage = projection.dailyUsage.length > 0;
  const hasConcurrency = projection.dailyUsage.some((row) => row.peak > 0);
  // A percentile over a handful of days is arithmetic, not evidence.
  const enoughHistory = distinctDates >= 14;

  const missing: { capability: string; needs: string }[] = [];
  if (entitlementCount === 0) {
    missing.push({ capability: 'Capacity headroom', needs: 'Add entitlement data' });
  }
  missing.push({ capability: 'Financial opportunity', needs: 'Add contract and cost data' });
  if (peopleCount === 0) {
    missing.push({ capability: 'Usage by organization', needs: 'Add employee data' });
  }
  if (!hasDenials) {
    missing.push({ capability: 'Unmet demand', needs: 'Add denial records' });
  }

  return {
    usageTrends: hasUsage,
    dailyDemand: hasUsage,
    percentileDemand: hasConcurrency && enoughHistory,
    capacityUtilization: hasConcurrency && entitlementCount > 0,
    // Cost never arrives through a license-manager export, so this is always
    // false in Phase 1 rather than optimistically true.
    financialOpportunity: false,
    organizationalBreakdown: peopleCount > 0,
    denialAnalysis: hasDenials,
    missing,
  };
}
