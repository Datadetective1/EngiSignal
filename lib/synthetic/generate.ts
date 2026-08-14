/**
 * Assembles the complete synthetic dataset for Aerospace Dynamics Corporation.
 *
 * Deterministic: one fixed seed, one fixed as-of date, byte-identical output on
 * every run. The demo therefore quotes specific financial figures that always
 * reproduce.
 */

import { addDays, enumerateDates } from '@/lib/analytics/dates';
import type { AnalyticsDataset } from '@/lib/domain/dataset';
import type {
  Contract,
  ContractItem,
  DailyUsage,
  DenialEvent,
  Employee,
  HourlyUsage,
  ImportMapping,
  ImportRecord,
  Organization,
  Product,
  ProductFamily,
  SoftwareFeature,
  TokenUsageDaily,
  UnmappedFeature,
  UnmatchedUser,
  UserFeatureActivity,
  Vendor,
} from '@/lib/domain/types';
import { CONTRACT_SPECS, VENDOR_CATALOG, type FeatureSpec } from './catalog';
import { DEMO_ORG, generateEmployees } from './organization';
import { createRng, type Rng } from './prng';
import {
  expandToHourly,
  generateDailyPeaks,
  generateDenials,
  generateTokenUsage,
  licenseHoursForPeak,
} from './usage';

/** Fixed analysis date for the demo organization. */
export const DEMO_AS_OF = '2026-06-30';
export const DEMO_ORG_ID = 'org-aerospace-dynamics';
const SEED = 'engisignal-aerospace-dynamics-v1';

/** Days of history generated. The default 12-month window is the last 365. */
const HISTORY_DAYS = 730;
/** Hourly detail is generated for the most recent period only. */
const HOURLY_DAYS = 90;

export function generateDemoDataset(): AnalyticsDataset {
  const rng = createRng(SEED);

  const organization: Organization = {
    id: DEMO_ORG_ID,
    name: DEMO_ORG.name,
    slug: DEMO_ORG.slug,
    industry: DEMO_ORG.industry,
    technicalHeadcount: DEMO_ORG.technicalHeadcount,
    headcountGrowthRate: DEMO_ORG.headcountGrowthRate,
    currency: DEMO_ORG.currency,
    isDemo: true,
    createdAt: '2026-01-12T09:00:00.000Z',
  };

  const { employees, byDiscipline } = generateEmployees(rng, DEMO_ORG_ID);
  const activeEmployees = employees.filter((e) => e.status === 'active');

  const allDates = enumerateDates(addDays(DEMO_AS_OF, -(HISTORY_DAYS - 1)), DEMO_AS_OF);
  const windowDates = allDates.slice(-365);
  const priorDates = allDates.slice(0, allDates.length - 365);
  const hourlyDates = allDates.slice(-HOURLY_DAYS);
  const hourlyDateSet = new Set(hourlyDates);

  const vendors: Vendor[] = [];
  const productFamilies: ProductFamily[] = [];
  const products: Product[] = [];
  const features: SoftwareFeature[] = [];
  const contracts: Contract[] = [];
  const contractItems: ContractItem[] = [];
  const dailyUsage: DailyUsage[] = [];
  const hourlyUsage: HourlyUsage[] = [];
  const tokenUsage: TokenUsageDaily[] = [];
  const activities: UserFeatureActivity[] = [];
  const denials: DenialEvent[] = [];

  const familyIdByKey = new Map<string, string>();
  const productIdByKey = new Map<string, string>();

  for (const vendorSpec of VENDOR_CATALOG) {
    const vendorId = `ven-${vendorSpec.slug}`;
    vendors.push({ id: vendorId, organizationId: DEMO_ORG_ID, name: vendorSpec.name, slug: vendorSpec.slug });

    const contractSpec = CONTRACT_SPECS.find((c) => c.vendorSlug === vendorSpec.slug);
    let contractId: string | null = null;

    if (contractSpec !== undefined) {
      contractId = `con-${vendorSpec.slug}`;
      const renewalDate = addDays(DEMO_AS_OF, contractSpec.renewalInDays);
      contracts.push({
        id: contractId,
        organizationId: DEMO_ORG_ID,
        vendorId,
        contractNumber: contractSpec.contractNumber,
        agreementName: contractSpec.agreementName,
        startDate: addDays(renewalDate, -contractSpec.termMonths * 30),
        endDate: renewalDate,
        renewalDate,
        purchaseOrder: contractSpec.purchaseOrder,
        businessOwner: contractSpec.businessOwner,
        costCenter: contractSpec.costCenter,
        status: 'active',
      });
    }

    for (const spec of vendorSpec.features) {
      // ── Normalization hierarchy ──────────────────────────────────────────
      let familyId: string | null = null;
      if (spec.family !== null) {
        const key = `${vendorSpec.slug}:${spec.family}`;
        const existing = familyIdByKey.get(key);
        if (existing === undefined) {
          familyId = `fam-${vendorSpec.slug}-${slugify(spec.family)}`;
          familyIdByKey.set(key, familyId);
          productFamilies.push({ id: familyId, organizationId: DEMO_ORG_ID, vendorId, name: spec.family });
        } else {
          familyId = existing;
        }
      }

      const productKey = `${vendorSpec.slug}:${spec.product}`;
      let productId = productIdByKey.get(productKey);
      if (productId === undefined) {
        productId = `prd-${vendorSpec.slug}-${slugify(spec.product)}`;
        productIdByKey.set(productKey, productId);
        products.push({
          id: productId,
          organizationId: DEMO_ORG_ID,
          vendorId,
          productFamilyId: familyId,
          name: spec.product,
          category: spec.category,
        });
      }

      const featureId = `ftr-${slugify(spec.code)}`;
      features.push({
        id: featureId,
        organizationId: DEMO_ORG_ID,
        productId,
        name: spec.name,
        code: spec.code,
        licenseModel: spec.licenseModel,
        tokenWeight: spec.licenseModel === 'token' ? 1 : null,
      });

      if (contractId !== null) {
        contractItems.push({
          id: `ci-${featureId}`,
          organizationId: DEMO_ORG_ID,
          contractId,
          featureId,
          sku: `${vendorSpec.slug.toUpperCase().slice(0, 3)}-${spec.code}`,
          licenseModel: spec.licenseModel,
          quantity: spec.entitled,
          unitPrice: spec.unitPrice,
        });
      }

      const eligible = eligibleEmployees(byDiscipline, activeEmployees, spec);

      // ── Demand generation per license model ──────────────────────────────
      if (spec.licenseModel === 'token') {
        tokenUsage.push(
          ...generateTokenUsage(rng, featureId, allDates, spec.entitled, spec.tokenUtilization ?? 0.6),
        );
        activities.push(...tokenActivities(rng, featureId, eligible, spec));
        continue;
      }

      if (spec.licenseModel === 'named_user' || spec.licenseModel === 'subscription') {
        activities.push(...namedUserActivities(rng, featureId, eligible, spec));
        continue;
      }

      // Concurrent-family models.
      const targetP95 = spec.targetP95 ?? Math.max(1, Math.round(spec.entitled * 0.6));
      const maxPeak = spec.maxPeak ?? Math.round(targetP95 * 1.15);
      const minPeak = spec.minPeak ?? 0;
      const trend = spec.trend ?? 0;

      const windowPeaks = generateDailyPeaks({
        rng,
        dates: windowDates,
        targetP95,
        maxPeak,
        minPeak,
        trend,
      });

      // The preceding year sits where the trend implies it did.
      const priorScale = 1 / (1 + trend / 100);
      const priorPeaks = generateDailyPeaks({
        rng,
        dates: priorDates,
        targetP95: Math.max(1, Math.round(targetP95 * priorScale)),
        maxPeak: Math.max(1, Math.round(maxPeak * priorScale)),
        minPeak: Math.round(minPeak * priorScale),
        trend,
      });

      const allPeaks = new Map<string, number>([...priorPeaks, ...windowPeaks]);

      for (const [date, peak] of allPeaks) {
        const usageHours = licenseHoursForPeak(peak);
        dailyUsage.push({
          featureId,
          date,
          peak,
          meanConcurrent: Math.round((usageHours / 24) * 100) / 100,
          usageHours: Math.round(usageHours),
          uniqueUsers: Math.max(peak, Math.round(peak * 1.8)),
        });
        if (hourlyDateSet.has(date)) {
          hourlyUsage.push(...expandToHourly(rng, featureId, date, peak));
        }
      }

      const windowHours = windowDates.reduce(
        (acc, date) => acc + licenseHoursForPeak(windowPeaks.get(date) ?? 0),
        0,
      );
      activities.push(...concurrentActivities(rng, featureId, eligible, targetP95, windowHours));

      if (spec.denialProfile !== undefined && spec.denialProfile !== 'none') {
        denials.push(
          ...generateDenials({
            rng,
            organizationId: DEMO_ORG_ID,
            featureId,
            dates: windowDates,
            peaks: windowPeaks,
            entitled: spec.entitled,
            profile: spec.denialProfile,
            employeeIds: eligible.slice(0, 40).map((e) => e.id),
          }),
        );
      }
    }
  }

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
    tokenUsage,
    activities,
    denials,
    unmatchedUsers: buildUnmatchedUsers(rng),
    unmappedFeatures: buildUnmappedFeatures(rng),
    imports: buildImportHistory(),
    importMappings: buildImportMappings(),
    asOf: DEMO_AS_OF,
    employeeMappingRate: 0.99,
    featureMappingRate: 0.98,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Employees plausibly able to use a feature, based on its disciplines. */
function eligibleEmployees(
  byDiscipline: Map<string, Employee[]>,
  fallback: Employee[],
  spec: FeatureSpec,
): Employee[] {
  const out: Employee[] = [];
  for (const discipline of spec.disciplines) {
    const bucket = byDiscipline.get(discipline);
    if (bucket !== undefined) out.push(...bucket.filter((e) => e.status === 'active'));
  }
  return out.length > 0 ? out : fallback;
}

/**
 * Named-user seat assignments.
 *
 * Inactive and never-used counts are placed exactly, because the demo quotes
 * them: MATLAB's 43 idle seats × $2,235 = $96,105 of reclaim value.
 */
function namedUserActivities(
  rng: Rng,
  featureId: string,
  eligible: Employee[],
  spec: FeatureSpec,
): UserFeatureActivity[] {
  const seats = Math.min(spec.assignedSeats ?? spec.entitled, eligible.length);
  const inactive = Math.min(spec.inactiveSeats ?? 0, seats);
  const neverUsed = Math.min(spec.neverUsedSeats ?? 0, inactive);
  const holders = rng.shuffle(eligible).slice(0, seats);

  return holders.map((employee, index) => {
    const isNeverUsed = index >= seats - neverUsed;
    const isLapsed = !isNeverUsed && index >= seats - inactive;

    if (isNeverUsed) {
      return {
        organizationId: DEMO_ORG_ID,
        featureId,
        employeeId: employee.id,
        assigned: true,
        assignedOn: addDays(DEMO_AS_OF, -rng.int(120, 500)),
        lastUsedDate: null,
        totalSessions: 0,
        totalHours: 0,
        sessions30: 0,
        sessions60: 0,
        sessions90: 0,
        sessions180: 0,
      };
    }

    const idleDays = isLapsed ? rng.int(91, 430) : rng.int(0, 88);
    const intensity = isLapsed ? rng.float(0.1, 0.4) : rng.float(0.5, 1);
    const totalSessions = Math.round(rng.int(20, 240) * intensity);

    return {
      organizationId: DEMO_ORG_ID,
      featureId,
      employeeId: employee.id,
      assigned: true,
      assignedOn: addDays(DEMO_AS_OF, -rng.int(200, 700)),
      lastUsedDate: addDays(DEMO_AS_OF, -idleDays),
      totalSessions,
      totalHours: Math.round(totalSessions * rng.float(1.4, 5.2)),
      sessions30: idleDays <= 30 ? Math.round(totalSessions * 0.14) : 0,
      sessions60: idleDays <= 60 ? Math.round(totalSessions * 0.26) : 0,
      sessions90: idleDays <= 90 ? Math.round(totalSessions * 0.38) : 0,
      sessions180: idleDays <= 180 ? Math.round(totalSessions * 0.64) : 0,
    };
  });
}

/**
 * Usage attribution for concurrent features.
 *
 * License-hours are distributed with a heavy skew, because engineering software
 * consumption really is concentrated: a minority of specialists drive most of
 * the demand. That shape is what makes the "who drives this product" question
 * worth asking.
 */
function concurrentActivities(
  rng: Rng,
  featureId: string,
  eligible: Employee[],
  targetP95: number,
  totalWindowHours: number,
): UserFeatureActivity[] {
  const population = Math.min(eligible.length, Math.max(4, Math.round(targetP95 * 3.2)));
  if (population === 0) return [];

  const users = rng.shuffle(eligible).slice(0, population);
  const weights = users.map(() => Math.pow(rng.float(0.05, 1), 2.1));
  const weightTotal = weights.reduce((acc, w) => acc + w, 0) || 1;

  return users.map((employee, index) => {
    const share = (weights[index] ?? 0) / weightTotal;
    const hours = Math.round(totalWindowHours * share);
    const sessions = Math.max(hours > 0 ? 1 : 0, Math.round(hours / rng.float(2.5, 6)));
    // Heavier users are more likely to have used the product recently.
    const idleDays = hours > totalWindowHours / population ? rng.int(0, 21) : rng.int(0, 150);

    return {
      organizationId: DEMO_ORG_ID,
      featureId,
      employeeId: employee.id,
      assigned: false,
      assignedOn: null,
      lastUsedDate: sessions === 0 ? null : addDays(DEMO_AS_OF, -idleDays),
      totalSessions: sessions,
      totalHours: hours,
      sessions30: idleDays <= 30 ? Math.round(sessions * 0.16) : 0,
      sessions60: idleDays <= 60 ? Math.round(sessions * 0.3) : 0,
      sessions90: idleDays <= 90 ? Math.round(sessions * 0.44) : 0,
      sessions180: idleDays <= 180 ? Math.round(sessions * 0.72) : 0,
    };
  });
}

function tokenActivities(
  rng: Rng,
  featureId: string,
  eligible: Employee[],
  spec: FeatureSpec,
): UserFeatureActivity[] {
  const population = Math.min(eligible.length, 180);
  const users = rng.shuffle(eligible).slice(0, population);
  const poolHours = spec.entitled * 24 * 365 * (spec.tokenUtilization ?? 0.6);
  const weights = users.map(() => Math.pow(rng.float(0.05, 1), 1.9));
  const weightTotal = weights.reduce((acc, w) => acc + w, 0) || 1;

  return users.map((employee, index) => {
    const hours = Math.round((poolHours * (weights[index] ?? 0)) / weightTotal);
    const sessions = Math.max(1, Math.round(hours / rng.float(40, 90)));
    return {
      organizationId: DEMO_ORG_ID,
      featureId,
      employeeId: employee.id,
      assigned: false,
      assignedOn: null,
      lastUsedDate: addDays(DEMO_AS_OF, -rng.int(0, 60)),
      totalSessions: sessions,
      totalHours: hours,
      sessions30: Math.round(sessions * 0.2),
      sessions60: Math.round(sessions * 0.35),
      sessions90: Math.round(sessions * 0.5),
      sessions180: Math.round(sessions * 0.8),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Data-quality artefacts — every real import produces some of these
// ─────────────────────────────────────────────────────────────────────────────

const ORPHAN_USERNAMES = [
  'svc_batchsolve', 'cae_pipeline', 'jenkins_sim', 'ttadeyemi_old', 'contractor_tmp3',
  'nx_migration', 'aholm', 'rverma2', 'hpc_scheduler', 'lab_workstation_07',
  'mgrimaldi', 'kfischer', 'batch_optimizer', 'testrig_04', 'dpatel_temp',
  'legacy_cad01', 'eng_intern_22', 'sim_farm_node9',
];

function buildUnmatchedUsers(rng: Rng): UnmatchedUser[] {
  return ORPHAN_USERNAMES.map((rawUsername, index) => ({
    id: `unm-${index}`,
    organizationId: DEMO_ORG_ID,
    rawUsername,
    occurrences: rng.int(24, 1840),
    firstSeen: addDays(DEMO_AS_OF, -rng.int(200, 360)),
    lastSeen: addDays(DEMO_AS_OF, -rng.int(0, 40)),
    suggestedEmployeeId: null,
    status: 'open',
  }));
}

const UNMAPPED_RAW_FEATURES = [
  'ansys_hpc_pack', 'cfd_base_solver', 'MECHENT_TRIAL', 'nx_translator_step',
  'abaqus_cae_token', 'hw_solver_unit', 'CATIA_FTA_LIC',
];

function buildUnmappedFeatures(rng: Rng): UnmappedFeature[] {
  return UNMAPPED_RAW_FEATURES.map((rawValue, index) => ({
    id: `unf-${index}`,
    organizationId: DEMO_ORG_ID,
    rawValue,
    occurrences: rng.int(40, 2600),
    firstSeen: addDays(DEMO_AS_OF, -rng.int(120, 350)),
    lastSeen: addDays(DEMO_AS_OF, -rng.int(0, 25)),
    suggestedFeatureId: null,
    status: 'open',
  }));
}

function buildImportHistory(): ImportRecord[] {
  const rows: { kind: ImportRecord['kind']; file: string; days: number; total: number; rejected: number }[] = [
    { kind: 'usage', file: 'flexnet_usage_2026_H1.csv', days: 4, total: 1_284_910, rejected: 12_402 },
    { kind: 'contracts', file: 'engineering_contracts_fy26.xlsx', days: 11, total: 42, rejected: 0 },
    { kind: 'employees', file: 'hr_technical_roster_jun2026.csv', days: 12, total: 3850, rejected: 0 },
    { kind: 'assignments', file: 'named_user_assignments_q2.xlsx', days: 12, total: 3000, rejected: 4 },
    { kind: 'denials', file: 'flexnet_denials_2026_H1.csv', days: 4, total: 611, rejected: 0 },
    { kind: 'usage', file: 'rlm_usage_2025_H2.csv', days: 96, total: 942_117, rejected: 8104 },
  ];

  return rows.map((row, index) => ({
    id: `imp-${index}`,
    organizationId: DEMO_ORG_ID,
    kind: row.kind,
    fileName: row.file,
    fileBytes: row.total * 84,
    rowCount: row.total,
    acceptedRows: row.total - row.rejected,
    rejectedRows: row.rejected,
    status: 'complete',
    createdAt: `${addDays(DEMO_AS_OF, -row.days)}T08:${String(10 + index * 7).padStart(2, '0')}:00.000Z`,
    createdBy: 'Priya Raghunathan',
    mappingId: row.kind === 'usage' ? 'map-flexnet-usage' : null,
    notes: row.rejected > 0 ? `${row.rejected.toLocaleString('en-US')} rows rejected — unmatched user or feature` : null,
  }));
}

function buildImportMappings(): ImportMapping[] {
  return [
    {
      id: 'map-flexnet-usage',
      organizationId: DEMO_ORG_ID,
      kind: 'usage',
      name: 'FlexNet daily usage export',
      fields: {
        USAGE_DATE: 'date',
        HOUR_OF_DAY: 'hour',
        NETWORK_USER: 'username',
        FEATURE_NAME: 'featureCode',
        VENDOR_DAEMON: 'vendor',
        LIC_SERVER: 'licenseServer',
        MAX_CONCURRENT: 'peakUsage',
        CHECKOUT_COUNT: 'sessions',
      },
      createdAt: '2026-02-18T10:22:00.000Z',
      lastUsedAt: addDays(DEMO_AS_OF, -4),
      useCount: 9,
    },
    {
      id: 'map-hr-roster',
      organizationId: DEMO_ORG_ID,
      kind: 'employees',
      name: 'HR technical roster',
      fields: {
        EMPL_ID: 'employeeCode',
        NTWK_ID: 'username',
        FULL_NAME: 'fullName',
        SUPERVISOR: 'managerName',
        DEPT_DESC: 'department',
        BUS_UNIT: 'businessUnit',
        PROGRAM_CD: 'program',
        JOB_FAMILY: 'discipline',
        WORK_LOCATION: 'location',
        WORKER_TYPE: 'employeeType',
      },
      createdAt: '2026-02-19T14:05:00.000Z',
      lastUsedAt: addDays(DEMO_AS_OF, -12),
      useCount: 3,
    },
    {
      id: 'map-contracts',
      organizationId: DEMO_ORG_ID,
      kind: 'contracts',
      name: 'Procurement contract extract',
      fields: {
        SUPPLIER: 'vendor',
        PRODUCT_DESC: 'product',
        LICENSE_SKU: 'sku',
        QTY: 'quantity',
        UNIT_COST_ANNUAL: 'unitPrice',
        AGREEMENT_NO: 'contractNumber',
        TERM_END: 'renewalDate',
        PO_NUMBER: 'purchaseOrder',
        COST_CENTER: 'costCenter',
      },
      createdAt: '2026-02-20T09:41:00.000Z',
      lastUsedAt: addDays(DEMO_AS_OF, -11),
      useCount: 2,
    },
  ];
}
