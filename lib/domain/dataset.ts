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
   * Reference date for every relative calculation.
   * Injected rather than read from the clock so results are reproducible.
   */
  asOf: string;

  /** Share of usage rows resolved to an employee, 0–1. */
  employeeMappingRate: number;
  /** Share of raw feature strings mapped to a canonical feature, 0–1. */
  featureMappingRate: number;
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
