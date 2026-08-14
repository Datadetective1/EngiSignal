/**
 * The software catalog for the synthetic demo organization.
 *
 * Aerospace Dynamics Corporation is entirely fictional. The vendor and product
 * names below are real engineering software products, used here only to make
 * the demo legible to someone who works in this domain — exactly as a screenshot
 * of a spreadsheet would name them. No affiliation or endorsement is implied,
 * and every quantity, price, usage figure and employee is invented.
 *
 * Prices are plausible order-of-magnitude figures for annual per-license cost.
 * They are NOT quoted, benchmarked or sourced from any vendor.
 */

import type { LicenseModel } from '@/lib/domain/types';

export type DenialProfile =
  /** No denials. */
  | 'none'
  /** Genuine capacity exhaustion — recurring, many users, at capacity. */
  | 'genuine'
  /** One user's retry loop — should be classified Low despite volume. */
  | 'burst'
  /** Denials while capacity was available — a licensing rule, not a shortage. */
  | 'rule';

export interface FeatureSpec {
  code: string;
  name: string;
  product: string;
  family: string | null;
  category: string;
  licenseModel: LicenseModel;
  /** Entitled quantity on the contract. */
  entitled: number;
  /** Annual price per license. */
  unitPrice: number;

  // ── Concurrent demand shaping ──────────────────────────────────────────────
  /** Exact P95 of daily peaks the generator will produce over the window. */
  targetP95?: number;
  /** Highest daily peak in the window. */
  maxPeak?: number;
  /** Lowest daily peak (typically a holiday). */
  minPeak?: number;
  /** Demand trend, positive or negative, as approximate percent per year. */
  trend?: number;

  // ── Named-user shaping ─────────────────────────────────────────────────────
  assignedSeats?: number;
  /** Seats idle beyond the reclaim threshold. */
  inactiveSeats?: number;
  /** Seats never used since assignment (a subset of inactiveSeats). */
  neverUsedSeats?: number;

  // ── Token shaping ──────────────────────────────────────────────────────────
  /** Mean share of the token pool consumed, 0–1. */
  tokenUtilization?: number;

  denialProfile?: DenialProfile;

  /** Engineering disciplines that use this feature, driving user attribution. */
  disciplines: string[];
}

export interface VendorSpec {
  name: string;
  slug: string;
  features: FeatureSpec[];
}

const SIM = 'Simulation';
const CAD = 'Design & CAD';
const EDA = 'Electronic Design';
const PLM = 'PLM & Data Management';
const MATH = 'Mathematics & Controls';

export const VENDOR_CATALOG: VendorSpec[] = [
  {
    name: 'Ansys',
    slug: 'ansys',
    features: [
      {
        // ── SCENARIO A + D: the flagship over-provisioned concurrent feature. ──
        // 400 entitled, P95 275 → at +5% growth and +10% safety: 318 recommended.
        // 400 − 318 = 82 licenses × $5,000 = $410,000 annual opportunity.
        code: 'MECH_ENT',
        name: 'Mechanical Enterprise',
        product: 'Mechanical',
        family: 'Structures',
        category: SIM,
        licenseModel: 'concurrent',
        entitled: 400,
        unitPrice: 5000,
        targetP95: 275,
        maxPeak: 314,
        minPeak: 31,
        trend: 3,
        denialProfile: 'burst', // deliberately tests the retry-burst guard
        disciplines: ['Structural Analysis', 'Thermal Analysis', 'Mechanical Design'],
      },
      {
        // ── SCENARIO E: increasing demand. ──
        code: 'FLUENT',
        name: 'Fluent Solver',
        product: 'Fluent',
        family: 'Fluids',
        category: SIM,
        licenseModel: 'concurrent',
        entitled: 165,
        unitPrice: 6200,
        targetP95: 148,
        maxPeak: 171,
        minPeak: 22,
        trend: 21,
        denialProfile: 'genuine',
        disciplines: ['CFD', 'Thermal Analysis', 'Aerodynamics'],
      },
      {
        // ── SCENARIO J: denials while capacity was available (licensing rule). ──
        code: 'HFSS',
        name: 'HFSS Electromagnetics',
        product: 'HFSS',
        family: 'Electronics',
        category: SIM,
        licenseModel: 'concurrent',
        entitled: 90,
        unitPrice: 7400,
        targetP95: 52,
        maxPeak: 68,
        minPeak: 4,
        trend: -6,
        denialProfile: 'rule',
        disciplines: ['Electromagnetics', 'Electrical Design'],
      },
      {
        code: 'LSDYNA',
        name: 'LS-DYNA Explicit',
        product: 'LS-DYNA',
        family: 'Structures',
        category: SIM,
        licenseModel: 'concurrent',
        entitled: 60,
        unitPrice: 5800,
        targetP95: 44,
        maxPeak: 57,
        minPeak: 3,
        trend: 8,
        disciplines: ['Structural Analysis', 'Test'],
      },
      {
        code: 'MAXWELL',
        name: 'Maxwell Low Frequency',
        product: 'Maxwell',
        family: 'Electronics',
        category: SIM,
        licenseModel: 'concurrent',
        entitled: 45,
        unitPrice: 4900,
        targetP95: 21,
        maxPeak: 30,
        minPeak: 1,
        trend: -14,
        disciplines: ['Electromagnetics'],
      },
      {
        code: 'SPCLAIM',
        name: 'SpaceClaim Direct Modeler',
        product: 'SpaceClaim',
        family: 'Pre-processing',
        category: CAD,
        licenseModel: 'concurrent',
        entitled: 120,
        unitPrice: 1450,
        targetP95: 88,
        maxPeak: 108,
        minPeak: 9,
        trend: 5,
        disciplines: ['Mechanical Design', 'Structural Analysis'],
      },
      {
        code: 'ICEPAK',
        name: 'Icepak Thermal',
        product: 'Icepak',
        family: 'Fluids',
        category: SIM,
        licenseModel: 'concurrent',
        entitled: 30,
        unitPrice: 4200,
        targetP95: 26,
        maxPeak: 33,
        minPeak: 2,
        trend: 12,
        denialProfile: 'genuine',
        disciplines: ['Thermal Analysis', 'Electrical Design'],
      },
    ],
  },
  {
    name: 'MathWorks',
    slug: 'mathworks',
    features: [
      {
        // ── SCENARIO C: the named-user reclaim opportunity. ──
        // 420 assigned, 43 idle beyond 90 days × $2,235 = $96,105.
        code: 'MATLAB',
        name: 'MATLAB',
        product: 'MATLAB',
        family: 'Technical Computing',
        category: MATH,
        licenseModel: 'named_user',
        entitled: 420,
        unitPrice: 2235,
        assignedSeats: 420,
        inactiveSeats: 43,
        neverUsedSeats: 9,
        disciplines: ['Controls', 'Systems', 'Test', 'Electrical Design'],
      },
      {
        code: 'SIMULINK',
        name: 'Simulink',
        product: 'Simulink',
        family: 'Technical Computing',
        category: MATH,
        licenseModel: 'named_user',
        entitled: 260,
        unitPrice: 3150,
        assignedSeats: 260,
        inactiveSeats: 21,
        neverUsedSeats: 4,
        disciplines: ['Controls', 'Systems'],
      },
      {
        code: 'SL_CODER',
        name: 'Simulink Coder',
        product: 'Simulink Coder',
        family: 'Technical Computing',
        category: MATH,
        licenseModel: 'concurrent',
        entitled: 40,
        unitPrice: 4600,
        targetP95: 23,
        maxPeak: 31,
        minPeak: 1,
        trend: 4,
        disciplines: ['Controls', 'Systems'],
      },
      {
        code: 'SIGPROC',
        name: 'Signal Processing Toolbox',
        product: 'Signal Processing Toolbox',
        family: 'Toolboxes',
        category: MATH,
        licenseModel: 'concurrent',
        entitled: 55,
        unitPrice: 1250,
        targetP95: 18,
        maxPeak: 27,
        minPeak: 0,
        trend: -9,
        disciplines: ['Controls', 'Test'],
      },
      {
        code: 'CTRLSYS',
        name: 'Control System Toolbox',
        product: 'Control System Toolbox',
        family: 'Toolboxes',
        category: MATH,
        licenseModel: 'concurrent',
        entitled: 50,
        unitPrice: 1250,
        targetP95: 31,
        maxPeak: 41,
        minPeak: 1,
        trend: 6,
        disciplines: ['Controls'],
      },
      {
        code: 'STATEFLOW',
        name: 'Stateflow',
        product: 'Stateflow',
        family: 'Toolboxes',
        category: MATH,
        licenseModel: 'concurrent',
        entitled: 35,
        unitPrice: 2400,
        targetP95: 20,
        maxPeak: 28,
        minPeak: 0,
        trend: 10,
        disciplines: ['Controls', 'Systems'],
      },
    ],
  },
  {
    name: 'Dassault Systèmes',
    slug: 'dassault-systemes',
    features: [
      {
        // ── SCENARIO F: declining demand from a platform migration. ──
        code: 'CATIA_V5',
        name: 'CATIA V5 Mechanical Design',
        product: 'CATIA V5',
        family: 'CATIA',
        category: CAD,
        licenseModel: 'concurrent',
        entitled: 200,
        unitPrice: 4300,
        targetP95: 121,
        maxPeak: 158,
        minPeak: 14,
        trend: -31,
        disciplines: ['Mechanical Design', 'Manufacturing'],
      },
      {
        // The destination of that migration — rising to match.
        code: 'CATIA_3DX',
        name: 'CATIA 3DEXPERIENCE',
        product: 'CATIA 3DEXPERIENCE',
        family: 'CATIA',
        category: CAD,
        licenseModel: 'concurrent',
        entitled: 140,
        unitPrice: 5600,
        targetP95: 128,
        maxPeak: 149,
        minPeak: 11,
        trend: 34,
        denialProfile: 'genuine',
        disciplines: ['Mechanical Design', 'Manufacturing', 'Systems'],
      },
      {
        code: 'ABQ_STD',
        name: 'Abaqus/Standard',
        product: 'SIMULIA Abaqus',
        family: 'SIMULIA',
        category: SIM,
        licenseModel: 'concurrent',
        entitled: 70,
        unitPrice: 8100,
        targetP95: 49,
        maxPeak: 63,
        minPeak: 4,
        trend: 7,
        disciplines: ['Structural Analysis', 'Materials'],
      },
      {
        code: 'ABQ_EXP',
        name: 'Abaqus/Explicit',
        product: 'SIMULIA Abaqus',
        family: 'SIMULIA',
        category: SIM,
        licenseModel: 'concurrent',
        entitled: 45,
        unitPrice: 8900,
        targetP95: 28,
        maxPeak: 39,
        minPeak: 2,
        trend: 2,
        disciplines: ['Structural Analysis', 'Test'],
      },
      {
        code: 'ENOVIA',
        name: 'ENOVIA Collaborative Design',
        product: 'ENOVIA',
        family: 'ENOVIA',
        category: PLM,
        licenseModel: 'named_user',
        entitled: 300,
        unitPrice: 1150,
        assignedSeats: 300,
        inactiveSeats: 37,
        neverUsedSeats: 12,
        disciplines: ['Mechanical Design', 'Systems', 'Manufacturing'],
      },
    ],
  },
  {
    name: 'Siemens Digital Industries Software',
    slug: 'siemens',
    features: [
      {
        code: 'NX_CAD',
        name: 'NX Design',
        product: 'NX',
        family: 'NX',
        category: CAD,
        licenseModel: 'concurrent',
        entitled: 240,
        unitPrice: 4800,
        targetP95: 187,
        maxPeak: 224,
        minPeak: 19,
        trend: 6,
        disciplines: ['Mechanical Design', 'Manufacturing'],
      },
      {
        code: 'NX_CAM',
        name: 'NX Manufacturing',
        product: 'NX',
        family: 'NX',
        category: CAD,
        licenseModel: 'concurrent',
        entitled: 85,
        unitPrice: 5400,
        targetP95: 61,
        maxPeak: 79,
        minPeak: 5,
        trend: 9,
        disciplines: ['Manufacturing'],
      },
      {
        // ── SCENARIO B: the capacity-constrained application. ──
        // Entitled 100, P95 94 → 94% utilization, regular saturation, real denials.
        code: 'STARCCM',
        name: 'Simcenter STAR-CCM+',
        product: 'Simcenter STAR-CCM+',
        family: 'Simcenter',
        category: SIM,
        licenseModel: 'concurrent',
        entitled: 100,
        unitPrice: 9600,
        targetP95: 94,
        maxPeak: 108,
        minPeak: 12,
        trend: 24,
        denialProfile: 'genuine',
        disciplines: ['CFD', 'Aerodynamics', 'Thermal Analysis'],
      },
      {
        code: 'AMESIM',
        name: 'Simcenter Amesim',
        product: 'Simcenter Amesim',
        family: 'Simcenter',
        category: SIM,
        licenseModel: 'concurrent',
        entitled: 40,
        unitPrice: 6300,
        targetP95: 24,
        maxPeak: 34,
        minPeak: 1,
        trend: 3,
        disciplines: ['Systems', 'Controls', 'Thermal Analysis'],
      },
      {
        code: 'TEAMCENTER',
        name: 'Teamcenter Author',
        product: 'Teamcenter',
        family: 'Teamcenter',
        category: PLM,
        licenseModel: 'named_user',
        entitled: 750,
        unitPrice: 480,
        assignedSeats: 750,
        inactiveSeats: 96,
        neverUsedSeats: 28,
        disciplines: ['Mechanical Design', 'Manufacturing', 'Systems', 'Structural Analysis'],
      },
    ],
  },
  {
    name: 'Altair',
    slug: 'altair',
    features: [
      {
        // Token pool — the consumption model.
        code: 'HWU',
        name: 'HyperWorks Units',
        product: 'HyperWorks',
        family: 'HyperWorks',
        category: SIM,
        licenseModel: 'token',
        entitled: 2500,
        unitPrice: 92,
        tokenUtilization: 0.71,
        disciplines: ['Structural Analysis', 'CFD', 'Materials'],
      },
      {
        code: 'OPTISTRUCT',
        name: 'OptiStruct',
        product: 'OptiStruct',
        family: 'HyperWorks',
        category: SIM,
        licenseModel: 'concurrent',
        entitled: 50,
        unitPrice: 3900,
        targetP95: 33,
        maxPeak: 44,
        minPeak: 2,
        trend: 11,
        disciplines: ['Structural Analysis', 'Materials'],
      },
      {
        code: 'RADIOSS',
        name: 'Radioss',
        product: 'Radioss',
        family: 'HyperWorks',
        category: SIM,
        licenseModel: 'concurrent',
        entitled: 35,
        unitPrice: 3700,
        targetP95: 14,
        maxPeak: 22,
        minPeak: 0,
        trend: -18,
        disciplines: ['Structural Analysis'],
      },
      {
        code: 'HYPERMESH',
        name: 'HyperMesh',
        product: 'HyperMesh',
        family: 'HyperWorks',
        category: SIM,
        licenseModel: 'concurrent',
        entitled: 90,
        unitPrice: 2900,
        targetP95: 67,
        maxPeak: 83,
        minPeak: 6,
        trend: 4,
        disciplines: ['Structural Analysis', 'CFD', 'Thermal Analysis'],
      },
    ],
  },
  {
    name: 'Autodesk',
    slug: 'autodesk',
    features: [
      {
        code: 'ACAD',
        name: 'AutoCAD',
        product: 'AutoCAD',
        family: null,
        category: CAD,
        licenseModel: 'named_user',
        entitled: 300,
        unitPrice: 1900,
        assignedSeats: 300,
        inactiveSeats: 64,
        neverUsedSeats: 19,
        disciplines: ['Mechanical Design', 'Manufacturing', 'Electrical Design'],
      },
      {
        code: 'INVENTOR',
        name: 'Inventor Professional',
        product: 'Inventor',
        family: null,
        category: CAD,
        licenseModel: 'named_user',
        entitled: 180,
        unitPrice: 2300,
        assignedSeats: 180,
        inactiveSeats: 22,
        neverUsedSeats: 6,
        disciplines: ['Mechanical Design'],
      },
      {
        code: 'NAVIS',
        name: 'Navisworks Manage',
        product: 'Navisworks',
        family: null,
        category: CAD,
        licenseModel: 'named_user',
        entitled: 60,
        unitPrice: 2700,
        assignedSeats: 60,
        inactiveSeats: 14,
        neverUsedSeats: 5,
        disciplines: ['Manufacturing', 'Systems'],
      },
      {
        code: 'FUSION',
        name: 'Fusion',
        product: 'Fusion',
        family: null,
        category: CAD,
        licenseModel: 'named_user',
        entitled: 90,
        unitPrice: 800,
        assignedSeats: 90,
        inactiveSeats: 31,
        neverUsedSeats: 11,
        disciplines: ['Mechanical Design', 'Manufacturing'],
      },
    ],
  },
  {
    name: 'PTC',
    slug: 'ptc',
    features: [
      {
        code: 'CREO',
        name: 'Creo Parametric',
        product: 'Creo',
        family: 'Creo',
        category: CAD,
        licenseModel: 'concurrent',
        entitled: 150,
        unitPrice: 3600,
        targetP95: 92,
        maxPeak: 119,
        minPeak: 8,
        trend: -12,
        disciplines: ['Mechanical Design', 'Manufacturing'],
      },
      {
        code: 'CREO_SIM',
        name: 'Creo Simulation Live',
        product: 'Creo',
        family: 'Creo',
        category: SIM,
        licenseModel: 'concurrent',
        entitled: 40,
        unitPrice: 2800,
        targetP95: 12,
        maxPeak: 19,
        minPeak: 0,
        trend: -22,
        disciplines: ['Mechanical Design', 'Structural Analysis'],
      },
      {
        code: 'WINDCHILL',
        name: 'Windchill PDMLink',
        product: 'Windchill',
        family: 'Windchill',
        category: PLM,
        licenseModel: 'named_user',
        entitled: 420,
        unitPrice: 620,
        assignedSeats: 420,
        inactiveSeats: 58,
        neverUsedSeats: 17,
        disciplines: ['Mechanical Design', 'Manufacturing', 'Systems'],
      },
      {
        code: 'MATHCAD',
        name: 'Mathcad Prime',
        product: 'Mathcad',
        family: null,
        category: MATH,
        licenseModel: 'named_user',
        entitled: 220,
        unitPrice: 450,
        assignedSeats: 220,
        inactiveSeats: 51,
        neverUsedSeats: 15,
        disciplines: ['Structural Analysis', 'Thermal Analysis', 'Systems'],
      },
    ],
  },
  {
    name: 'Cadence',
    slug: 'cadence',
    features: [
      {
        code: 'ALLEGRO',
        name: 'Allegro PCB Designer',
        product: 'Allegro',
        family: 'PCB',
        category: EDA,
        licenseModel: 'concurrent',
        entitled: 45,
        unitPrice: 9200,
        targetP95: 38,
        maxPeak: 47,
        minPeak: 3,
        trend: 14,
        denialProfile: 'genuine',
        disciplines: ['Electrical Design'],
      },
      {
        code: 'VIRTUOSO',
        name: 'Virtuoso Layout Suite',
        product: 'Virtuoso',
        family: 'Custom IC',
        category: EDA,
        licenseModel: 'concurrent',
        entitled: 30,
        unitPrice: 14500,
        targetP95: 17,
        maxPeak: 25,
        minPeak: 1,
        trend: 2,
        disciplines: ['Electrical Design'],
      },
      {
        code: 'SPECTRE',
        name: 'Spectre Simulation',
        product: 'Spectre',
        family: 'Custom IC',
        category: EDA,
        licenseModel: 'concurrent',
        entitled: 40,
        unitPrice: 11800,
        targetP95: 22,
        maxPeak: 31,
        minPeak: 1,
        trend: -7,
        disciplines: ['Electrical Design', 'Electromagnetics'],
      },
      {
        code: 'SIGRITY',
        name: 'Sigrity Signal Integrity',
        product: 'Sigrity',
        family: 'PCB',
        category: EDA,
        licenseModel: 'concurrent',
        entitled: 18,
        unitPrice: 10400,
        targetP95: 9,
        maxPeak: 15,
        minPeak: 0,
        trend: 5,
        disciplines: ['Electrical Design', 'Electromagnetics'],
      },
    ],
  },
  {
    name: 'Synopsys',
    slug: 'synopsys',
    features: [
      {
        code: 'VCS',
        name: 'VCS Simulation',
        product: 'VCS',
        family: 'Verification',
        category: EDA,
        licenseModel: 'concurrent',
        entitled: 30,
        unitPrice: 13900,
        targetP95: 26,
        maxPeak: 33,
        minPeak: 2,
        trend: 17,
        denialProfile: 'genuine',
        disciplines: ['Electrical Design', 'Systems'],
      },
      {
        code: 'DC',
        name: 'Design Compiler',
        product: 'Design Compiler',
        family: 'Synthesis',
        category: EDA,
        licenseModel: 'concurrent',
        entitled: 22,
        unitPrice: 16200,
        targetP95: 13,
        maxPeak: 19,
        minPeak: 0,
        trend: 3,
        disciplines: ['Electrical Design'],
      },
      {
        code: 'PRIMETIME',
        name: 'PrimeTime Timing Analysis',
        product: 'PrimeTime',
        family: 'Signoff',
        category: EDA,
        licenseModel: 'concurrent',
        entitled: 20,
        unitPrice: 12600,
        targetP95: 8,
        maxPeak: 14,
        minPeak: 0,
        trend: -16,
        disciplines: ['Electrical Design'],
      },
    ],
  },
];

/** Contract terms per vendor, driving the Renewal Command Center. */
export interface ContractSpec {
  vendorSlug: string;
  contractNumber: string;
  agreementName: string;
  /** Days from the analysis date until renewal. */
  renewalInDays: number;
  termMonths: number;
  purchaseOrder: string;
  businessOwner: string;
  costCenter: string;
}

export const CONTRACT_SPECS: ContractSpec[] = [
  // ── SCENARIO D: the major renewal, 58 days out. ──
  {
    vendorSlug: 'ansys',
    contractNumber: 'ADC-ANS-2024-118',
    agreementName: 'Enterprise Simulation Agreement',
    renewalInDays: 58,
    termMonths: 12,
    purchaseOrder: 'PO-884201',
    businessOwner: 'Priya Raghunathan',
    costCenter: 'CC-4400 Engineering Tools',
  },
  {
    vendorSlug: 'siemens',
    contractNumber: 'ADC-SIE-2024-076',
    agreementName: 'Digital Industries Master Agreement',
    renewalInDays: 96,
    termMonths: 12,
    purchaseOrder: 'PO-871355',
    businessOwner: 'Priya Raghunathan',
    costCenter: 'CC-4400 Engineering Tools',
  },
  {
    vendorSlug: 'mathworks',
    contractNumber: 'ADC-MWK-2024-032',
    agreementName: 'Concurrent and Named User Agreement',
    renewalInDays: 41,
    termMonths: 12,
    purchaseOrder: 'PO-869004',
    businessOwner: 'Daniel Osei',
    costCenter: 'CC-4410 Controls & Software',
  },
  {
    vendorSlug: 'dassault-systemes',
    contractNumber: 'ADC-DSS-2023-209',
    agreementName: '3DEXPERIENCE Transition Agreement',
    renewalInDays: 152,
    termMonths: 24,
    purchaseOrder: 'PO-855417',
    businessOwner: 'Marta Villanueva',
    costCenter: 'CC-4402 Design Systems',
  },
  {
    vendorSlug: 'autodesk',
    contractNumber: 'ADC-ADK-2024-141',
    agreementName: 'Named User Subscription',
    renewalInDays: 23,
    termMonths: 12,
    purchaseOrder: 'PO-887730',
    businessOwner: 'Marta Villanueva',
    costCenter: 'CC-4402 Design Systems',
  },
  {
    vendorSlug: 'altair',
    contractNumber: 'ADC-ALT-2024-058',
    agreementName: 'HyperWorks Units Pool',
    renewalInDays: 209,
    termMonths: 12,
    purchaseOrder: 'PO-872118',
    businessOwner: 'Priya Raghunathan',
    costCenter: 'CC-4400 Engineering Tools',
  },
  {
    vendorSlug: 'ptc',
    contractNumber: 'ADC-PTC-2024-095',
    agreementName: 'Creo and Windchill Agreement',
    renewalInDays: 121,
    termMonths: 12,
    purchaseOrder: 'PO-874962',
    businessOwner: 'Marta Villanueva',
    costCenter: 'CC-4402 Design Systems',
  },
  {
    vendorSlug: 'cadence',
    contractNumber: 'ADC-CDN-2024-017',
    agreementName: 'Electronic Design Tools Agreement',
    renewalInDays: 77,
    termMonths: 12,
    purchaseOrder: 'PO-866543',
    businessOwner: 'Daniel Osei',
    costCenter: 'CC-4415 Electronics',
  },
  {
    vendorSlug: 'synopsys',
    contractNumber: 'ADC-SYN-2024-064',
    agreementName: 'Verification and Signoff Agreement',
    renewalInDays: 268,
    termMonths: 12,
    purchaseOrder: 'PO-870881',
    businessOwner: 'Daniel Osei',
    costCenter: 'CC-4415 Electronics',
  },
];

export const ALL_FEATURES: FeatureSpec[] = VENDOR_CATALOG.flatMap((v) => v.features);
