/**
 * The complete analytical dataset for one organization.
 *
 * This is the boundary between storage and analytics. Both the mock provider
 * and the Supabase provider produce this exact shape, which is why the
 * analytics engine never needs to know which one is active.
 */

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
} from './types';
import type { AnalyzedRowCounts } from '@/lib/analytics/integrity';
import type { ContractReviewItem } from '@/lib/ingestion/contract-match';

/** What each source said a feature's quantity was. Null means "did not say". */
export interface FeatureQuantitySources {
  featureId: string;
  /** As reported by the licence-server entitlement export. */
  entitlementQuantity: number | null;
  /** As reported by the contract or purchase-order export. */
  contractQuantity: number | null;
  /** True when the contract line could not be tied to an observed feature. */
  unresolvedIdentity: boolean;
}

export interface AnalyticsDataset {
  organization: Organization;
  vendors: Vendor[];
  productFamilies: ProductFamily[];
  products: Product[];
  features: SoftwareFeature[];
  contracts: Contract[];
  contractItems: ContractItem[];
  employees: Employee[];
  dailyUsage: DailyUsage[];
  hourlyUsage: HourlyUsage[];
  tokenUsage: TokenUsageDaily[];
  activities: UserFeatureActivity[];
  denials: DenialEvent[];
  unmatchedUsers: UnmatchedUser[];
  unmappedFeatures: UnmappedFeature[];
  imports: ImportRecord[];
  importMappings: ImportMapping[];

  /**
   * Both quantity sources, kept side by side.
   *
   * `contractItems[].quantity` necessarily collapses to ONE number, because
   * utilization has to be measured against a single denominator. That choice —
   * the entitlement, since demand was measured against what the server would
   * actually issue — is correct arithmetic and an incomplete answer: the
   * difference between what was bought and what is served is one of the most
   * valuable findings a licence review produces, and collapsing it throws it
   * away. Both survive here so reconciliation can report the disagreement
   * instead of inheriting a resolution.
   */
  quantitySources: FeatureQuantitySources[];

  /**
   * Commercial lines the matcher refused to place, with the lookalikes it
   * noticed. Carried on the dataset so the review surface reads the same
   * matcher output the analytics did, rather than recomputing suggestions from
   * a second implementation that could disagree with the first.
   */
  contractReview: ContractReviewItem[];

  /**
   * Reference date for every relative calculation.
   * Injected rather than read from the clock so results are reproducible.
   */
  asOf: string;

  /** Share of usage rows resolved to an employee, 0–1. */
  employeeMappingRate: number;
  /** Share of raw feature strings mapped to a canonical feature, 0–1. */
  featureMappingRate: number;

  /**
   * How many canonical records this dataset was actually built from.
   *
   * Recorded at the point of consumption, before any grouping or projection,
   * so it answers "what did the analytics read?" rather than "what did the
   * analytics produce?". Compared against an exact database count to detect a
   * truncated read — see lib/analytics/integrity.ts.
   */
  analyzedRows: AnalyzedRowCounts;
}

/** Options that a user can change and immediately recalculate against. */
export interface AnalysisOptions {
  periodKey: '3m' | '6m' | '12m' | '24m' | 'custom';
  customDays?: number;
  /** Percentile as a ratio, e.g. 0.95. */
  percentile: number;
  /** Demand growth multiplier, e.g. 1.05. */
  growthFactor: number;
  /** Safety buffer multiplier, e.g. 1.10. */
  safetyFactor: number;
  /** Named-user inactivity threshold in days. */
  reclaimThresholdDays: number;
  /** Annual price escalation percentage applied to forecast spend. */
  priceEscalationPct: number;
}

export const DEFAULT_ANALYSIS_OPTIONS: AnalysisOptions = {
  periodKey: '12m',
  percentile: 0.95,
  growthFactor: 1.0,
  safetyFactor: 1.1,
  reclaimThresholdDays: 90,
  priceEscalationPct: 0,
};
