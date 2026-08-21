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

import type { AnalyticsDataset, FeatureQuantitySources } from '@/lib/domain/dataset';
import type {
  Contract,
  ContractItem,
  DenialEvent,
  Employee,
  Organization,
  Product,
  ProductFamily,
  LicenseModel,
  SoftwareFeature,
  UnmappedFeature,
  UnmatchedUser,
  UserFeatureActivity,
  Vendor,
} from '@/lib/domain/types';
import type {
  CanonicalContractRecord,
  CanonicalEntitlementRecord,
  CanonicalPersonRecord,
  CanonicalUsageRecord,
} from './canonical/types';
import { linkContracts, matchVendor, mergePositions } from './contract-match';
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
  contracts?: readonly CanonicalContractRecord[];
  /** Customer-confirmed raw value → canonical feature key. */
  featureAliases?: ReadonlyMap<string, string>;
  /** Customer-confirmed raw username → people-record username. */
  userAliases?: ReadonlyMap<string, string>;
  /** Reference date for relative calculations. Defaults to the latest observation. */
  asOf?: string;
}

export function buildDatasetFromCanonical(input: BuildDatasetInput): AnalyticsDataset {
  const {
    organization,
    usage,
    entitlements,
    people,
    contracts: contractRecords = [],
    featureAliases = new Map(),
    userAliases = new Map(),
  } = input;
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
        // An entitlement is capacity, not a checkout: there is no machine, no
        // feature version and no borrow state to report.
        hostname: null,
        version: null,
        borrowed: null,
        provenance: entitlement.provenance,
      }) satisfies CanonicalUsageRecord,
  );

  // Commercial lines discover features too, for the same reason entitlements
  // do: a customer who imports a renewal schedule first should see their
  // renewal portfolio immediately rather than an empty screen until usage
  // arrives. `concurrent` stays null so none of this reaches demand.
  const contractAsUsage = contractRecords.map(
    (record) =>
      ({
        date: record.renewalDate ?? record.contractEndDate ?? '1970-01-01',
        hour: null,
        observedAt: null,
        user: null,
        employeeCode: null,
        feature: record.feature,
        product: record.product,
        vendor: matchVendor(record),
        quantity: null,
        concurrent: null,
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
        // A commercial line names what was bought, not who ran it where.
        hostname: null,
        version: null,
        borrowed: null,
        provenance: record.provenance,
      }) satisfies CanonicalUsageRecord,
  );

  // Identity resolution sees all three; only real usage reaches the projection,
  // so these placeholders can never contribute demand.
  const featureIdentities = resolveFeatures(
    [...usage, ...entitlementAsUsage, ...contractAsUsage],
    featureAliases,
  );

  // OBSERVED features only — usage and entitlements, never the contract file
  // itself. Matching a contract line against a feature list that the same file
  // just populated would make every line match itself by name, the unmatched
  // path unreachable, and the review queue permanently empty. The question
  // being asked is "does this line correspond to something we actually see?",
  // and a list built from the line cannot answer it.
  const observedIdentities = resolveFeatures([...usage, ...entitlementAsUsage], featureAliases);

  const userIdentities = resolveUsers(usage, people, userAliases);

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

  // ── Contract positions ─────────────────────────────────────────────────────
  //
  // Merged here, before features, because the licence model below reads them.
  const contractLinks = linkContracts({
    contracts: contractRecords,
    features: observedIdentities,
    aliases: featureAliases,
  });
  const positions = mergePositions(contractLinks.links);

  // ── How each feature is licensed ───────────────────────────────────────────
  //
  // The entitlement file is the first authority: it describes how the licence
  // server actually issues the licence. But plenty of estates have no
  // entitlement export at all, and their contract file plainly states "Named
  // User" in a licence-type column. Reading that column is not inference — it
  // is the customer telling us what they bought.
  //
  // It matters far more than it looks. A named-user product analysed as
  // concurrent gets peak-concurrency right-sizing, and peak concurrency is
  // always below headcount because people do not all open the software at
  // once. That would recommend surrendering seats individual named people
  // hold — a confident recommendation, and financially wrong.
  //
  // Two contract lines that disagree are not resolved here. A position spanning
  // a named-user block and a concurrent block is a real split the customer has
  // to settle, and picking a side would fabricate the answer.
  const contractModelByKey = new Map<string, LicenseModel>();
  for (const [key, position] of positions) {
    if (position.licenseModels.length !== 1) continue;
    const model = position.licenseModels[0]!;
    if (model === 'unknown') continue;
    contractModelByKey.set(key, model === 'node_locked' ? 'custom' : model);
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
        entitlement !== undefined && entitlement.licenseModel !== 'unknown'
          ? entitlement.licenseModel === 'node_locked'
            ? 'custom'
            : entitlement.licenseModel
          : // No served model. The contract may still have stated one.
            contractModelByKey.get(identity.key) ?? 'concurrent',
      // Never inferred. A token weight the file did not state cannot be
      // guessed, and a wrong weight misprices the whole feature.
      tokenWeight: null,
    };
  });

  // ── Contracts ──────────────────────────────────────────────────────────────
  //
  // Two sources of commercial truth meet here and they answer different
  // questions:
  //
  //   ENTITLEMENTS say how many the LICENCE SERVER is configured to serve.
  //   CONTRACTS say how many were BOUGHT, for how much, and until when.
  //
  // They frequently disagree, and the disagreement is real information — a
  // server issuing 400 against a contract for 350 is over-deployment, and a
  // contract for 400 served as 350 is shelfware. Neither is reconciled away.
  //
  // Quantity precedence is the ENTITLEMENT, because utilization is measured
  // against what the server would actually issue: comparing demand to a
  // purchased number the server never honoured would compute headroom against
  // capacity that does not exist. Price and dates come from the contract, which
  // is the only source that carries them.

  const contracts: Contract[] = [];
  const contractItems: ContractItem[] = [];
  const quantitySources: FeatureQuantitySources[] = [];

  const contractKeys = new Set<string>([...entitlementByKey.keys(), ...positions.keys()]);

  for (const key of contractKeys) {
    const identity = featureIdentities.find((candidate) => candidate.key === key);
    if (identity === undefined) continue;

    const entitlement = entitlementByKey.get(key);
    const position = positions.get(key);

    const vendor = entitlement?.vendor ?? identity.vendor ?? UNKNOWN_VENDOR;
    const contractId = `contract:${orgId}:${key}`;

    // A renewal date the customer supplied beats an entitlement expiry, which
    // is a licence-file expiry and not necessarily a commercial one.
    const renewalDate = position?.renewalDate ?? entitlement?.expiresOn ?? null;

    if (renewalDate !== null) {
      contracts.push({
        id: contractId,
        organizationId: orgId,
        vendorId: vendorId(orgId, vendor),
        contractNumber: position?.contractNumbers[0] ?? `IMPORTED-${key.toUpperCase()}`,
        agreementName: null,
        // Start and end are not invented. Where the file gave only a renewal
        // date, all three carry it and the renewal date is the one used.
        startDate: renewalDate,
        endDate: renewalDate,
        renewalDate,
        purchaseOrder: position?.purchaseOrders[0] ?? null,
        businessOwner: null,
        costCenter: null,
        status: 'active',
      });
    }

    // Quantity: entitlement first, contract quantity only when no entitlement
    // exists. Zero remains the honest answer when neither source stated one.
    const quantity = entitlement?.entitledQuantity ?? position?.quantity ?? 0;

    // Both numbers are still in hand here and nowhere else, so record them
    // before the collapse. Reconciliation reads these to report a disagreement
    // rather than inheriting whichever side won above.
    quantitySources.push({
      featureId: identity.featureId,
      entitlementQuantity: entitlement?.entitledQuantity ?? null,
      contractQuantity: position?.quantity ?? null,
      unresolvedIdentity: false,
    });

    contractItems.push({
      id: `item:${orgId}:${key}`,
      organizationId: orgId,
      contractId,
      featureId: identity.featureId,
      sku: contractRecords.find((record) => normalizeFeatureKey(record.feature) === key)?.sku ?? null,
      licenseModel:
        features.find((feature) => feature.id === identity.featureId)?.licenseModel ?? 'concurrent',
      quantity,
      // The whole point of Phase 2A. Still null when the commercial file
      // carried no determinable price — an unpriced line is reported as
      // unpriced, never as zero.
      unitPrice: position?.unitPrice ?? null,
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
      // Organizational context, and ONLY where the people file supplied it.
      // Every one of these stays null when absent rather than defaulting to a
      // bucket: an allocation built on a guessed department sends a cost
      // conversation to the wrong director, and "Unknown" as a real group tells
      // them their team uses nothing.
      managerName: identity.org.managerName,
      managerKey: identity.org.managerKey,
      department: identity.org.department,
      organization: identity.org.organization,
      businessUnit: identity.org.businessUnit,
      program: identity.org.program,
      discipline: identity.org.discipline,
      competency: identity.org.competency,
      location: identity.org.location,
      region: identity.org.region,
      employeeType: readEmployeeType(identity.org.employmentType),
      status: readEmploymentStatus(identity.org.employmentStatus),
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

  // Commercial lines that could not be tied to an observed feature join the
  // same queue. They are the ones that cost money to leave unresolved: an
  // unmatched line still counts toward spend but cannot be compared against
  // demand, so it can neither be defended nor surrendered at renewal.
  for (const item of contractLinks.review) {
    unmappedFeatures.push({
      id: `unmapped-contract:${normalizeFeatureKey(item.rawValue)}`,
      organizationId: orgId,
      rawValue: item.rawValue,
      occurrences: item.occurrences,
      firstSeen: input.asOf ?? '',
      lastSeen: input.asOf ?? '',
      suggestedFeatureId: null,
      status: 'open',
    });
  }

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
    quantitySources,
    contractReview: contractLinks.review,
    asOf,
    // Honest ratios, not aspirational ones.
    // Counted at the point of consumption: the arrays this function was handed,
    // before any projection or grouping. See lib/analytics/integrity.ts.
    analyzedRows: {
      usage: usage.length,
      people: people.length,
      entitlements: entitlements.length,
      contracts: contractRecords.length,
    },
    employeeMappingRate: userIdentities.length === 0 ? 0 : resolvedUserCount / userIdentities.length,
    featureMappingRate: featureIdentities.length === 0 ? 0 : 1,
  };
}

/**
 * Employment type from whatever word the HR export used.
 *
 * Defaults to `employee` when unstated, which is the assumption already baked
 * into the domain type — but only the CLASSIFICATION is defaulted, never the
 * organizational context that drives allocation.
 */
function readEmployeeType(raw: string | null): Employee['employeeType'] {
  if (raw === null) return 'employee';
  const value = raw.trim().toLowerCase();
  if (value.includes('contract') || value.includes('contingent') || value.includes('vendor')) {
    return 'contractor';
  }
  return 'employee';
}

/**
 * Employment status.
 *
 * Only wording that plainly means "no longer working here" produces `inactive`.
 * An unrecognized value is treated as active rather than guessed, because
 * marking a working engineer inactive would put their licence on a reclaim list.
 */
function readEmploymentStatus(raw: string | null): Employee['status'] {
  if (raw === null) return 'active';
  const value = raw.trim().toLowerCase();
  const inactive = ['terminated', 'inactive', 'leaver', 'exited', 'separated', 'former', 'disabled'];
  if (inactive.some((word) => value.includes(word))) return 'inactive';
  if (value === 'false' || value === 'no' || value === '0') return 'inactive';
  return 'active';
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
        // A person observed using a named-user feature IS a licence holder —
        // that is what named-user licensing means. Reading it from the usage
        // export is not an inference.
        //
        // This was previously hard-coded false, which silently disabled the
        // entire named-user analysis for imported data: the metrics function
        // filters on `assigned`, so it always saw an empty set and reported
        // 0 active users and 0% utilization for features with real activity.
        //
        // `assignedOn` stays null because the export says who uses the feature,
        // not when the seat was granted, and those are different facts.
        assigned: true,
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
