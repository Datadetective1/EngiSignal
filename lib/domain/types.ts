/**
 * EngiSignal domain types.
 *
 * These mirror the database schema closely enough that the Supabase provider is
 * a thin mapping, while staying free of any storage concern so the analytics
 * engine can consume them as plain data.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tenancy
// ─────────────────────────────────────────────────────────────────────────────

export interface Organization {
  id: string;
  name: string;
  slug: string;
  industry: string | null;
  /** Total technical headcount — denominator for cost-per-engineer metrics. */
  technicalHeadcount: number | null;
  /** Expected annual headcount growth as a ratio, e.g. 0.05 for +5%. */
  headcountGrowthRate: number | null;
  currency: string;
  isDemo: boolean;
  createdAt: string;
}

export type OrgRole = 'owner' | 'admin' | 'analyst' | 'viewer';

export interface OrganizationMember {
  id: string;
  organizationId: string;
  userId: string;
  email: string;
  displayName: string | null;
  role: OrgRole;
}

// ─────────────────────────────────────────────────────────────────────────────
// Software normalization hierarchy
//   Vendor → Product Family → Product → Feature → Raw alias
// ─────────────────────────────────────────────────────────────────────────────

export interface Vendor {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
}

export interface ProductFamily {
  id: string;
  organizationId: string;
  vendorId: string;
  name: string;
}

export interface Product {
  id: string;
  organizationId: string;
  vendorId: string;
  productFamilyId: string | null;
  name: string;
  /** Broad engineering discipline this product serves, for grouping. */
  category: string | null;
}

export type LicenseModel =
  | 'concurrent'
  | 'named_user'
  | 'token'
  | 'subscription'
  | 'hybrid'
  | 'custom';

export interface SoftwareFeature {
  id: string;
  organizationId: string;
  productId: string;
  /** Human-readable feature name, e.g. "Mechanical Enterprise". */
  name: string;
  /** Canonical feature code as it appears in license-manager data. */
  code: string;
  licenseModel: LicenseModel;
  /** Tokens consumed per checkout, for token-model features. */
  tokenWeight: number | null;
}

/** Raw license-manager strings mapped onto a canonical feature. Many-to-one. */
export interface FeatureAlias {
  id: string;
  organizationId: string;
  featureId: string;
  rawValue: string;
  source: string | null;
  confidence: 'exact' | 'mapped' | 'manual';
}

/** A raw feature string seen in imported data with no alias yet. */
export interface UnmappedFeature {
  id: string;
  organizationId: string;
  rawValue: string;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  suggestedFeatureId: string | null;
  status: 'open' | 'mapped' | 'ignored';
}

// ─────────────────────────────────────────────────────────────────────────────
// People
// ─────────────────────────────────────────────────────────────────────────────

export type EmployeeType = 'employee' | 'contractor';

export interface Employee {
  id: string;
  organizationId: string;
  employeeCode: string | null;
  username: string;
  fullName: string;
  email: string | null;
  /** The manager's name, for display. Never used to build a relationship. */
  managerName: string | null;
  /**
   * The manager's employee id or email.
   *
   * The only field a reporting line may be built from. Grouping by name would
   * merge every J. Smith in the company into one manager and route other
   * people's reclaim decisions to them.
   */
  managerKey: string | null;
  department: string | null;
  /** Top-level organization or legal entity, when the HR export carries one. */
  organization: string | null;
  businessUnit: string | null;
  program: string | null;
  discipline: string | null;
  competency: string | null;
  location: string | null;
  region: string | null;
  employeeType: EmployeeType;
  status: 'active' | 'inactive';
  contractorCompany: string | null;
}

/** A username seen in usage data that could not be resolved to an employee. */
export interface UnmatchedUser {
  id: string;
  organizationId: string;
  rawUsername: string;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  suggestedEmployeeId: string | null;
  status: 'open' | 'matched' | 'ignored';
}

/** The organizational axes available for grouping and allocation. */
export type DimensionKey =
  | 'organization'
  | 'businessUnit'
  | 'program'
  | 'department'
  | 'discipline'
  | 'competency'
  | 'location'
  | 'region'
  | 'managerName'
  | 'employeeType';

// ─────────────────────────────────────────────────────────────────────────────
// Commercial
// ─────────────────────────────────────────────────────────────────────────────

export interface Contract {
  id: string;
  organizationId: string;
  vendorId: string;
  contractNumber: string;
  agreementName: string | null;
  startDate: string;
  endDate: string;
  renewalDate: string;
  purchaseOrder: string | null;
  businessOwner: string | null;
  costCenter: string | null;
  status: 'active' | 'expired' | 'pending';
}

export interface ContractItem {
  id: string;
  organizationId: string;
  contractId: string;
  featureId: string;
  sku: string | null;
  licenseModel: LicenseModel;
  /** Entitled quantity: seats for named-user, concurrent slots, or token pool. */
  quantity: number;
  /** Annual price per unit in organization currency. Null when unpriced. */
  unitPrice: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Usage
// ─────────────────────────────────────────────────────────────────────────────

/** Concurrent demand for one feature in one clock hour. */
export interface HourlyUsage {
  featureId: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  /** 0–23. */
  hour: number;
  /** Concurrent licenses in use at the peak moment of this hour. */
  concurrent: number;
}

/** Pre-aggregated daily rollup for one feature. */
export interface DailyUsage {
  featureId: string;
  date: string;
  /** Maximum hourly concurrent demand observed on this date. */
  peak: number;
  meanConcurrent: number;
  /** Total license-hours consumed. */
  usageHours: number;
  uniqueUsers: number;
}

/** Token consumption rollup for token-model features. */
export interface TokenUsageDaily {
  featureId: string;
  date: string;
  tokenHours: number;
  peakTokens: number;
}

/** Per-employee, per-feature activity summary — the named-user substrate. */
export interface UserFeatureActivity {
  organizationId: string;
  featureId: string;
  employeeId: string;
  /** Whether a named-user license is currently assigned to this employee. */
  assigned: boolean;
  assignedOn: string | null;
  lastUsedDate: string | null;
  totalSessions: number;
  totalHours: number;
  sessions30: number;
  sessions60: number;
  sessions90: number;
  sessions180: number;
}

export interface DenialEvent {
  id: string;
  organizationId: string;
  featureId: string;
  date: string;
  hour: number;
  employeeId: string | null;
  count: number;
  /** Concurrent demand at the moment of denial — context, not justification. */
  concurrentAtDenial: number | null;
  availableAtDenial: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Analytics outputs
// ─────────────────────────────────────────────────────────────────────────────

export type PeriodKey = '3m' | '6m' | '12m' | '24m' | 'custom';

export interface AnalysisWindow {
  /** Inclusive ISO start date. */
  start: string;
  /** Inclusive ISO end date. */
  end: string;
  key: PeriodKey;
  /** Calendar days in the window. */
  days: number;
}

export interface ConcurrentMetrics {
  featureId: string;
  window: AnalysisWindow;
  /** Days with observed data. */
  observedDays: number;
  /** Calendar days in the window with no observation. */
  missingDays: number;
  mean: number;
  median: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  min: number;
  stdDev: number;
  /** Coefficient of variation — dimensionless demand volatility. */
  volatility: number;
  /** Ordinary-least-squares slope expressed as % change per year. */
  trendPctPerYear: number;
  entitled: number;
  /** P95 peak ÷ entitled, as a percentage. */
  utilizationPct: number;
  /** Days where peak demand met or exceeded entitlement. */
  saturationDays: number;
  saturationPct: number;
  /** entitled − P95 peak. Negative means structurally short. */
  availableCapacity: number;
}

export interface RightSizingAssumptions {
  percentile: number;
  growthFactor: number;
  safetyFactor: number;
  periodKey: PeriodKey;
}

export interface RightSizingResult {
  /** The percentile value of daily peaks that anchors the recommendation. */
  basis: number;
  assumptions: RightSizingAssumptions;
  /** Pre-rounding product, retained so the derivation is fully inspectable. */
  rawRecommended: number;
  recommended: number;
  entitled: number;
  /** recommended − entitled. Negative = reduce, positive = increase. */
  quantityDelta: number;
  surplus: number;
  shortfall: number;
  methodology: string;
}

export interface FinancialResult {
  entitled: number;
  recommended: number;
  quantityDelta: number;
  unitPrice: number | null;
  currentAnnualCost: number | null;
  recommendedAnnualCost: number | null;
  /** Positive = annual reduction available. */
  optimizationOpportunity: number | null;
  /** Positive = additional annual spend required. */
  incrementalSpend: number | null;
  savingsPct: number | null;
  priced: boolean;
}

export type ConfidenceLevel = 'High' | 'Medium' | 'Low';

export interface ConfidenceReason {
  label: string;
  detail: string;
  impact: 'positive' | 'neutral' | 'negative';
}

/**
 * The measurements a confidence level was computed from.
 *
 * Carried alongside the score so a customer can be told WHY the level is what
 * it is, in the units they supplied, rather than being handed a badge. Null on
 * aggregates, where a single observation window does not exist.
 */
export interface ConfidenceEvidence {
  /** Days in the analysis window that contain at least one observation. */
  observedDays: number;
  /** Calendar days the analysis asked for. */
  windowDays: number;
  hasPrice: boolean;
  hasDenialData: boolean;
  employeeMappingRate: number | null;
  featureMappingRate: number | null;
}

export interface ConfidenceResult {
  level: ConfidenceLevel;
  /** 0–100. Exposed so ranking can use a continuous value. */
  score: number;
  reasons: ConfidenceReason[];
  evidence: ConfidenceEvidence | null;
}

export type RiskLevel = 'Low' | 'Moderate' | 'High' | 'Critical';

export interface DenialMetrics {
  featureId: string;
  totalDenials: number;
  denialDays: number;
  distinctUsers: number;
  /** Share of all denials falling on the single worst day, 0–1. */
  concentration: number;
  peakHour: number | null;
  firstDenial: string | null;
  lastDenial: string | null;
  /** Mean concurrent demand at the moment of denial, when recorded. */
  meanConcurrentAtDenial: number | null;
  risk: RiskLevel;
  riskRationale: string;
}

export interface NamedUserMetrics {
  featureId: string;
  assigned: number;
  activeUsers: number;
  inactiveUsers: number;
  /** Assignments with no recorded activity at all. */
  neverUsed: number;
  active30: number;
  active60: number;
  active90: number;
  active180: number;
  reclaimThresholdDays: number;
  reclaimCandidates: number;
  reclaimValue: number | null;
  utilizationPct: number;
  /**
   * Users actually seen in the usage export.
   *
   * The denominator of `utilizationPct` is what is OWNED; this is what was
   * OBSERVED. The two differ whenever seats are held by people who never
   * launched the software, and the gap between them is the honest measure of
   * how much of this analysis rests on evidence.
   */
  observedUsers: number;
  /**
   * Owned seats with no observed holder: `assigned − observedUsers`.
   *
   * Deliberately NOT counted as reclaim candidates. A seat with no observed
   * activity may be genuinely idle, or held by someone whose usage the export
   * did not cover, or not assigned to anyone at all. Naming it reclaimable
   * would recommend revoking licences from people the data never mentions.
   */
  seatsWithoutObservedUser: number;
}

export interface TokenMetrics {
  featureId: string;
  window: AnalysisWindow;
  meanTokenHours: number;
  peakTokenHours: number;
  p95TokenHours: number;
  /** Entitled token pool × 24 h × observed days. */
  availableTokenHours: number | null;
  capacityUtilizationPct: number | null;
  trendPctPerYear: number;
  forecastTokenHours: number;
  risk: RiskLevel;
}

export interface ForecastResult {
  featureId: string;
  currentEntitled: number;
  currentP95: number;
  /** Demand trend contribution as a growth ratio. */
  trendGrowth: number;
  /** Headcount contribution as a growth ratio. */
  headcountGrowth: number;
  combinedGrowth: number;
  forecastDemand: number;
  recommendedQuantity: number;
  surplus: number;
  shortfall: number;
  financialImpact: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Evidence & recommendations
// ─────────────────────────────────────────────────────────────────────────────

export interface EvidenceRow {
  label: string;
  value: string;
  note?: string;
  emphasis?: boolean;
}

export interface EvidenceRecord {
  headline: string;
  /** The derivation chain, in the order a human would reconstruct it. */
  derivation: EvidenceRow[];
  assumptions: EvidenceRow[];
  observations: EvidenceRow[];
  confidence: ConfidenceResult;
  methodology: string;
  /** Links into the underlying detail so the user is never trapped. */
  drillThrough: { label: string; href: string }[];
}

export type SignalKind =
  | 'renewal'
  | 'cost'
  | 'capacity'
  | 'usage'
  | 'forecast'
  | 'reclaim'
  | 'reconciliation'
  | 'data';

export interface Signal {
  id: string;
  kind: SignalKind;
  title: string;
  subtitle: string;
  /** Compact facts rendered on the card. */
  facts: { label: string; value: string }[];
  /** Absolute annual dollar impact, used for ranking. Null when unpriced. */
  financialImpact: number | null;
  /** Days until the decision must be made. Null when not time-bound. */
  urgencyDays: number | null;
  risk: RiskLevel;
  confidence: ConfidenceLevel;
  /** Computed ranking score — higher surfaces first. */
  score: number;
  href: string;
  cta: string;
}

export type DecisionType =
  | 'renewal'
  | 'cost'
  | 'capacity'
  | 'reclaim'
  | 'forecast'
  | 'contract'
  | 'data_quality';

export type DecisionStatus =
  | 'open'
  | 'in_review'
  | 'approved'
  | 'rejected'
  | 'complete';

export interface DecisionItem {
  id: string;
  organizationId: string;
  type: DecisionType;
  title: string;
  description: string;
  impact: number | null;
  urgencyDays: number | null;
  confidence: ConfidenceLevel;
  risk: RiskLevel;
  owner: string | null;
  recommendedAction: string;
  status: DecisionStatus;
  href: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reclaim workflow
// ─────────────────────────────────────────────────────────────────────────────

export type ReclaimStatus =
  | 'pending_review'
  | 'manager_review'
  | 'keep'
  | 'reclaim'
  | 'reassign'
  | 'complete';

export interface ReclaimCandidate {
  id: string;
  organizationId: string;
  featureId: string;
  featureName: string;
  productName: string;
  vendorName: string;
  employeeId: string;
  employeeName: string;
  managerName: string | null;
  department: string | null;
  program: string | null;
  lastUsedDate: string | null;
  daysInactive: number | null;
  annualCost: number | null;
  recommendation: string;
  owner: string | null;
  notes: string | null;
  status: ReclaimStatus;
}

// ─────────────────────────────────────────────────────────────────────────────
// Renewal
// ─────────────────────────────────────────────────────────────────────────────

export type RenewalStage =
  | 'analyze'
  | 'validate'
  | 'recommend'
  | 'negotiate'
  | 'finalize'
  | 'renewed';

export interface RenewalStageDefinition {
  stage: RenewalStage;
  label: string;
  /** Days before renewal at which this stage should begin. */
  startsAtDays: number;
  description: string;
}

export interface RenewalSummary {
  contractId: string;
  vendorId: string;
  vendorName: string;
  contractNumber: string;
  agreementName: string | null;
  renewalDate: string;
  daysRemaining: number;
  stage: RenewalStage;
  status: string;
  owner: string | null;
  itemCount: number;
  currentAnnualSpend: number | null;
  recommendedAnnualSpend: number | null;
  optimizationOpportunity: number | null;
  incrementalSpend: number | null;
  capacityExposure: number;
  /**
   * Spend-weighted annualized demand trend across the agreement's features.
   *
   * Null when no feature carries enough observed history to support one. It
   * used to fall back to 0, which reads as "demand is flat" -- a claim, not an
   * absence.
   */
  demandTrendPct: number | null;
  headcountImpactPct: number;
  confidence: ConfidenceResult;
}

// ─────────────────────────────────────────────────────────────────────────────
// Data quality
// ─────────────────────────────────────────────────────────────────────────────

export type DataQualitySeverity = 'info' | 'warning' | 'critical';

export interface DataQualityIssue {
  id: string;
  organizationId: string;
  severity: DataQualitySeverity;
  category: string;
  title: string;
  detail: string;
  affectedCount: number;
  href: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Imports
// ─────────────────────────────────────────────────────────────────────────────

export type ImportKind = 'usage' | 'employees' | 'contracts' | 'assignments' | 'denials';

export type ImportStatus = 'pending' | 'mapping' | 'validating' | 'complete' | 'failed';

export interface ImportRecord {
  id: string;
  organizationId: string;
  kind: ImportKind;
  fileName: string;
  fileBytes: number;
  rowCount: number;
  acceptedRows: number;
  rejectedRows: number;
  status: ImportStatus;
  createdAt: string;
  createdBy: string | null;
  mappingId: string | null;
  notes: string | null;
}

export interface ImportMapping {
  id: string;
  organizationId: string;
  kind: ImportKind;
  name: string;
  /** Source column header → canonical field name. */
  fields: Record<string, string>;
  createdAt: string;
  lastUsedAt: string | null;
  useCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pilot capture
// ─────────────────────────────────────────────────────────────────────────────

export interface PilotRequest {
  id: string;
  name: string;
  workEmail: string;
  company: string;
  jobTitle: string;
  approximateEmployees: string;
  engineeringEmployees: string;
  softwareSpendRange: string;
  majorVendors: string;
  renewalTiming: string;
  primaryChallenge: string;
  message: string | null;
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Composite view models used across the application
// ─────────────────────────────────────────────────────────────────────────────

/** A feature joined with its commercial position and computed analytics. */
/**
 * Whether any usage was actually imported for a feature.
 *
 * `not_supplied` is a first-class state, not an absence. A feature known only
 * from a contract is a real position — it has a cost, a quantity and a renewal
 * date — but nothing measured its demand, so every demand-derived figure on it
 * must read as unavailable rather than as zero. Zero is a measurement; this is
 * the absence of one.
 */
export type UsageEvidence = 'observed' | 'not_supplied';

export interface PortfolioRow {
  featureId: string;
  featureName: string;
  featureCode: string;
  productId: string;
  productName: string;
  vendorId: string;
  vendorName: string;
  familyName: string | null;
  licenseModel: LicenseModel;
  entitled: number;
  unitPrice: number | null;
  currentAnnualCost: number | null;
  metrics: ConcurrentMetrics | null;
  namedUser: NamedUserMetrics | null;
  tokens: TokenMetrics | null;
  denials: DenialMetrics | null;
  rightSizing: RightSizingResult | null;
  financial: FinancialResult;
  confidence: ConfidenceResult;
  risk: RiskLevel;
  renewalDate: string | null;
  daysToRenewal: number | null;
  contractId: string | null;
  /**
   * When `not_supplied`, `metrics`, `namedUser`, `tokens` and `rightSizing` are
   * all null by construction — so an existing null-check is automatically a
   * correct evidence-check, and no consumer can accidentally read a zero that
   * was never measured.
   */
  usageEvidence: UsageEvidence;

  /**
   * ── TWO QUANTITIES, TWO QUESTIONS ────────────────────────────────────────
   *
   * `entitled` above is the SERVED quantity — what the licence server is
   * configured to issue. It is the right denominator for utilization, because
   * demand was measured against what the server would actually hand out.
   *
   * It is the wrong basis for a spend headline. A customer with a contract for
   * 440 and a server serving 350 is committed to 440, and reporting their
   * annual commitment as 350 × price understates what they actually pay — which
   * is exactly what "Committed annually: $2.6M" did when the contract said
   * $2.8M.
   *
   * Both are kept, both are labelled, and neither is used for the other's job.
   */
  commitment: QuantityBasis;
}

/**
 * The purchased and served views of one feature, side by side.
 *
 * A figure with no stated basis is the thing this product exists not to
 * produce, so every monetary value here carries how it was derived.
 */
export interface QuantityBasis {
  /** What procurement records as bought. Null when no contract line exists. */
  purchasedQuantity: number | null;
  /** What the licence server is configured to serve. Null when unstated. */
  servedQuantity: number | null;
  /**
   * purchasedQuantity × unit price. The customer's annual commitment.
   * Null when either the quantity or the price is unknown.
   */
  purchasedAnnualCommitment: number | null;
  /**
   * servedQuantity × unit price. What the deployed capacity is worth.
   * NOT a commitment, and never labelled as one.
   */
  servedCapacityValue: number | null;
  /**
   * servedQuantity − purchasedQuantity. Negative means less is served than was
   * bought. Null when either side is missing — a difference from one number is
   * not a difference.
   */
  quantityDifference: number | null;
  /** Plain-language statement of where each number came from. */
  basis: string;
}
