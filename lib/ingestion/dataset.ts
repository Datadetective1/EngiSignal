/**
 * Canonical records → AnalyticsDataset.
 *
 * THE ADAPTER BOUNDARY. This module contains NO analytical formulas.
 *
 * P90/P95/P99, demand aggregation, right-sizing, forecasting, financial
 * translation, denial interpretation and confidence all remain in
 * lib/analytics/*, unchanged. Everything here is reshaping: canonical rows in,
 * the structures those functions already consume out.
 *
 * ── GRAIN, STATED EXPLICITLY ─────────────────────────────────────────────────
 *
 * SOURCE GRAIN differs per system:
 *   FlexNet   event-level checkout/check-in rows, often with an in-use counter
 *   RLM       event-level checkout rows with a pool in-use counter
 *   DSLS      event-level acquire/release rows, token-weighted
 *   Sentinel  INTERVAL SNAPSHOTS — state at a sample time, not events
 *   Generic   unknown; whatever the exporter chose
 *
 * CANONICAL GRAIN is one row per source observation, unchanged and unmerged,
 * with the raw feature and username preserved and full provenance attached.
 *
 * ANALYTICS GRAIN is (feature, date, hour) for hourly concurrency and
 * (feature, date) for the daily rollup, because that is what the existing
 * engine consumes.
 *
 * ── THE ONE TRANSFORMATION THAT COULD CHANGE A NUMBER ────────────────────────
 *
 * Several observations can share a (feature, date, hour). Reducing them to the
 * single `HourlyUsage.concurrent` value requires a choice, and the choice moves
 * P95 and therefore the recommended quantity. EngiSignal takes the MAXIMUM:
 * concurrent demand within an hour is a high-water mark, and understating it
 * would recommend too few licenses and cause the denials this product exists to
 * prevent. That decision lives in project.ts, in the open, and is recomputable.
 *
 * Snapshot sources are never presented as session data: `durationHours` stays
 * null when the source could not measure it, so usage-hours totals do not
 * silently acquire invented precision.
 */

import type { AnalyticsDataset } from '@/lib/domain/dataset';
import type {
  Contract,
  ContractItem,
  DenialEvent,
  Employee,
  Organization,
  Product,
  ProductFamily,
  SoftwareFeature,
  UnmappedFeature,
  UnmatchedUser,
  UserFeatureActivity,
  Vendor,
} from '@/lib/domain/types';
import type {
  CanonicalEntitlementRecord,
  CanonicalPersonRecord,
  CanonicalUsageRecord,
} from './canonical/types';
import { normalizeFeatureKey, resolveFeatures, resolveUsers } from './identity';
import { projectUsage } from './project';

const UNKNOWN_VENDOR = 'Unattributed';

/** Deterministic ids so two builds of the same data agree exactly. */
function vendorId(orgId: string, name: string): string {
  return `vendor:${orgId}:${name.trim().toLowerCase()}`;
}
function productId(orgId: string, name: string): string {
  return `product:${orgId}:${name.trim().toLowerCase()}`;
}

export interface BuildDatasetInput {
  organization: Organization;
  usage: readonly CanonicalUsageRecord[];
  entitlements: readonly CanonicalEntitlementRecord[];
  people: readonly CanonicalPersonRecord[];
  /** Customer-confirmed raw value → canonical feature key. */
  featureAliases?: ReadonlyMap<string, string>;
  /** Reference date for relative calculations. Defaults to the latest observation. */
  asOf?: string;
}

export function buildDatasetFromCanonical(input: BuildDatasetInput): AnalyticsDataset {
  const { organization, usage, entitlements, people, featureAliases = new Map() } = input;
  const orgId = organization.id;

  // Entitlements are folded into feature discovery as synthetic observations.
  // Without this, importing entitlements BEFORE any usage produced no features
  // and therefore no contract items, so capacity headroom stayed unavailable
  // even though the customer had supplied exactly the data it needs.
  const entitlementAsUsage = entitlements.map(
    (entitlement) =>
      ({
        date: entitlement.expiresOn ?? '1970-01-01',
        hour: null,
        observedAt: null,
        user: null,
        employeeCode: null,
        feature: entitlement.feature,
        product: entitlement.product,
        vendor: entitlement.vendor,
        quantity: null,
        concurrent: null,
        peak: null,
        available: entitlement.entitledQuantity,
        durationHours: null,
        checkoutAt: null,
        checkinAt: null,
        denied: null,
        denialCount: null,
        licenseServer: entitlement.licenseServer,
        pool: entitlement.pool,
        tokens: null,
        provenance: entitlement.provenance,
      }) satisfies CanonicalUsageRecord,
  );

  // Identity resolution sees both; only real usage reaches the projection, so
  // these placeholders can never contribute demand.
  const featureIdentities = resolveFeatures([...usage, ...entitlementAsUsage], featureAliases);
  const userIdentities = resolveUsers(usage, people);

  // ── Vendors and products ───────────────────────────────────────────────────
  const vendorNames = new Set<string>();
  const productByVendor = new Map<string, Set<string>>();

  for (const identity of featureIdentities) {
    const vendor = identity.vendor ?? UNKNOWN_VENDOR;
    vendorNames.add(vendor);
    const products = productByVendor.get(vendor) ?? new Set<string>();
    productByVendor.set(vendor, products);
    products.add(identity.product ?? identity.displayName);
  }
  for (const entitlement of entitlements) {
    vendorNames.add(entitlement.vendor ?? UNKNOWN_VENDOR);
  }

  const vendors: Vendor[] = [...vendorNames].sort().map((name) => ({
    id: vendorId(orgId, name),
    organizationId: orgId,
    name,
    slug: name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
  }));

  const products: Product[] = [];
  for (const [vendor, names] of productByVendor) {
    for (const name of names) {
      products.push({
        id: productId(orgId, `${vendor}:${name}`),
        organizationId: orgId,
        vendorId: vendorId(orgId, vendor),
        productFamilyId: null,
        // Category is a curated taxonomy the import does not carry. Null is the
        // honest answer; guessing one would put features in the wrong group.
        category: null,
        name,
      });
    }
  }

  const productFamilies: ProductFamily[] = [];

  // ── Entitlements, keyed the same way features are ──────────────────────────
  const entitlementByKey = new Map<string, CanonicalEntitlementRecord>();
  for (const entitlement of entitlements) {
    const key = featureAliases.get(entitlement.feature.trim().toLowerCase())
      ?? normalizeFeatureKey(entitlement.feature);
    const existing = entitlementByKey.get(key);
    // Largest wins: summing would double-count the same licences reported by
    // two servers, and inflating entitlement understates utilization.
    if (existing === undefined || (entitlement.entitledQuantity ?? 0) > (existing.entitledQuantity ?? 0)) {
      entitlementByKey.set(key, entitlement);
    }
  }

  const features: SoftwareFeature[] = featureIdentities.map((identity) => {
    const entitlement = entitlementByKey.get(identity.key);
    const vendor = identity.vendor ?? UNKNOWN_VENDOR;
    return {
      id: identity.featureId,
      organizationId: orgId,
      productId: productId(orgId, `${vendor}:${identity.product ?? identity.displayName}`),
      name: identity.displayName,
      code: identity.displayName,
      licenseModel:
        entitlement === undefined || entitlement.licenseModel === 'unknown'
          ? 'concurrent'
          : entitlement.licenseModel === 'node_locked'
            ? 'custom'
            : entitlement.licenseModel,
      // Never inferred. A token weight the file did not state cannot be
      // guessed, and a wrong weight misprices the whole feature.
      tokenWeight: null,
    };
  });

  // ── Contracts ──────────────────────────────────────────────────────────────
  // An entitlement export states quantity, not commercial terms. A contract
  // shell is created to carry the quantity, with no invented price and no
  // invented renewal date — `unitPrice: null` means unpriced, never zero.
  const contracts: Contract[] = [];
  const contractItems: ContractItem[] = [];

  for (const [key, entitlement] of entitlementByKey) {
    const identity = featureIdentities.find((candidate) => candidate.key === key);
    if (identity === undefined) continue;

    const vendor = entitlement.vendor ?? identity.vendor ?? UNKNOWN_VENDOR;
    const contractId = `contract:${orgId}:${key}`;

    if (entitlement.expiresOn !== null) {
      contracts.push({
        id: contractId,
        organizationId: orgId,
        vendorId: vendorId(orgId, vendor),
        contractNumber: `IMPORTED-${key.toUpperCase()}`,
        agreementName: null,
        startDate: entitlement.expiresOn,
        endDate: entitlement.expiresOn,
        renewalDate: entitlement.expiresOn,
        purchaseOrder: null,
        businessOwner: null,
        costCenter: null,
        status: 'active',
      });
    }

    contractItems.push({
      id: `item:${orgId}:${key}`,
      organizationId: orgId,
      contractId,
      featureId: identity.featureId,
      sku: null,
      licenseModel: features.find((feature) => feature.id === identity.featureId)?.licenseModel ?? 'concurrent',
      quantity: entitlement.entitledQuantity ?? 0,
      unitPrice: null,
    });
  }

  // ── People ─────────────────────────────────────────────────────────────────
  // Only fields the import actually carried. HR context — department, program,
  // manager, location — is left null rather than fabricated; an allocation
  // built on invented org structure would be confidently wrong.
  const employees: Employee[] = userIdentities
    .filter((identity) => identity.resolved)
    .map((identity) => ({
      id: identity.userId,
      organizationId: orgId,
      employeeCode: identity.employeeCode,
      username: identity.rawUsernames[0] ?? identity.key,
      fullName: identity.displayName ?? identity.rawUsernames[0] ?? identity.key,
      email: identity.email,
      managerName: null,
      department: null,
      businessUnit: null,
      program: null,
      discipline: null,
      competency: null,
      location: null,
      region: null,
      employeeType: 'employee',
      status: 'active',
      contractorCompany: null,
    }));

  // ── Usage projection ───────────────────────────────────────────────────────
  const keyForRecord = (record: CanonicalUsageRecord): string =>
    featureAliases.get(record.feature.trim().toLowerCase()) ?? normalizeFeatureKey(record.feature);

  // Re-key onto resolved identities so two spellings of one confirmed feature
  // contribute to the same demand curve.
  const rekeyed: CanonicalUsageRecord[] = usage.map((record) => ({
    ...record,
    feature: keyForRecord(record),
  }));

  const projection = projectUsage(rekeyed);

  const hourlyUsage = projection.hourlyUsage.map((row) => ({
    ...row,
    featureId: `feature:${row.featureId.replace(/^raw:/, '')}`,
  }));
  const dailyUsage = projection.dailyUsage.map((row) => ({
    ...row,
    featureId: `feature:${row.featureId.replace(/^raw:/, '')}`,
  }));

  // ── Denials ────────────────────────────────────────────────────────────────
  // Only rows the source actually flagged. An absent denial column yields an
  // empty list, which the capability layer reports as "not supplied" rather
  // than as zero denied demand.
  const denials: DenialEvent[] = [];
  for (const record of usage) {
    const denied = record.denied === true;
    const count = record.denialCount ?? (denied ? 1 : 0);
    if (!denied && count <= 0) continue;

    denials.push({
      id: `denial:${record.provenance.importId}:${record.provenance.sourceRow}`,
      organizationId: orgId,
      featureId: `feature:${keyForRecord(record)}`,
      date: record.date,
      hour: record.hour ?? 0,
      employeeId: record.user === null ? null : `user:${record.user.trim().toLowerCase()}`,
      count,
      concurrentAtDenial: record.concurrent,
      availableAtDenial: record.available,
    });
  }

  // ── Named-user activity ────────────────────────────────────────────────────
  const activities: UserFeatureActivity[] = buildActivities(orgId, usage, keyForRecord);

  // ── Review queues ──────────────────────────────────────────────────────────
  const unmappedFeatures: UnmappedFeature[] = featureIdentities
    .filter((identity) => identity.possibleRelated.length > 0)
    .map((identity) => ({
      id: `unmapped:${identity.key}`,
      organizationId: orgId,
      rawValue: identity.displayName,
      occurrences: identity.observations,
      firstSeen: input.asOf ?? '',
      lastSeen: input.asOf ?? '',
      suggestedFeatureId: null,
      status: 'open',
    }));

  const unmatchedUsers: UnmatchedUser[] = userIdentities
    .filter((identity) => !identity.resolved && identity.observations > 0)
    .map((identity) => ({
      id: `unmatched:${identity.key}`,
      organizationId: orgId,
      rawUsername: identity.rawUsernames[0] ?? identity.key,
      occurrences: identity.observations,
      firstSeen: input.asOf ?? '',
      lastSeen: input.asOf ?? '',
      suggestedEmployeeId: null,
      status: 'open',
    }));

  const dates = usage.map((record) => record.date).sort();
  const asOf = input.asOf ?? dates.at(-1) ?? new Date().toISOString().slice(0, 10);

  const resolvedUserCount = userIdentities.filter((identity) => identity.resolved).length;

  return {
    organization,
    vendors,
    productFamilies,
    products,
    features,
    contracts,
    contractItems,
    employees,
    dailyUsage,
    hourlyUsage,
    tokenUsage: [],
    activities,
    denials,
    unmatchedUsers,
    unmappedFeatures,
    imports: [],
    importMappings: [],
    asOf,
    // Honest ratios, not aspirational ones.
    employeeMappingRate: userIdentities.length === 0 ? 0 : resolvedUserCount / userIdentities.length,
    featureMappingRate: featureIdentities.length === 0 ? 0 : 1,
  };
}

/**
 * Per-user, per-feature activity.
 *
 * Session and hour totals come only from what the source recorded. A snapshot
 * export has no sessions, so its totals stay zero rather than being inferred
 * from the number of rows — row count is a property of the sampling interval,
 * not of how much anyone worked.
 */
function buildActivities(
  orgId: string,
  usage: readonly CanonicalUsageRecord[],
  keyFor: (record: CanonicalUsageRecord) => string,
): UserFeatureActivity[] {
  const map = new Map<string, UserFeatureActivity>();

  for (const record of usage) {
    if (record.user === null) continue;
    const employeeId = `user:${record.user.trim().toLowerCase()}`;
    const featureId = `feature:${keyFor(record)}`;
    const composite = `${featureId}|${employeeId}`;

    const entry =
      map.get(composite) ??
      {
        organizationId: orgId,
        featureId,
        employeeId,
        assigned: false,
        assignedOn: null,
        lastUsedDate: null,
        totalSessions: 0,
        totalHours: 0,
        sessions30: 0,
        sessions60: 0,
        sessions90: 0,
        sessions180: 0,
      };
    map.set(composite, entry);

    if (entry.lastUsedDate === null || record.date > entry.lastUsedDate) {
      entry.lastUsedDate = record.date;
    }
    // A checkout is a session. An interval snapshot is not, so only rows that
    // recorded a checkout or an explicit count contribute.
    if (record.checkoutAt !== null) entry.totalSessions += 1;
    else if (record.quantity !== null) entry.totalSessions += record.quantity;

    if (record.durationHours !== null) entry.totalHours += record.durationHours;
  }

  return [...map.values()];
}
