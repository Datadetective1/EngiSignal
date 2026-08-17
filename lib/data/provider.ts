/**
 * The storage boundary.
 *
 * Every method takes an explicit `orgId`. That is not decoration — it is the
 * type-level layer of tenant isolation described in ARCHITECTURE.md. Omitting
 * it is a compile error, so no code path can accidentally read across tenants
 * even if a database policy were misconfigured.
 */

import type { ProjectionState } from '@/lib/analytics/projection';
import type { CoverageSummary } from '@/lib/ingestion/store/types';
import type { UserIdentity } from '@/lib/ingestion/identity';
import type { StoredRowCounts } from '@/lib/analytics/integrity';
import type { AnalyticsDataset } from '@/lib/domain/dataset';
import type {
  DecisionItem,
  DecisionStatus,
  Organization,
  PilotRequest,
  ReclaimStatus,
} from '@/lib/domain/types';

/** Workflow state that lives outside the analytical dataset. */
export interface ReclaimOverride {
  status: ReclaimStatus;
  owner: string | null;
  notes: string | null;
  updatedAt: string;
}

export interface DataProvider {
  readonly kind: 'mock' | 'supabase';

  /** Organizations the given user is a member of. */
  listOrganizations(userId: string): Promise<Organization[]>;

  getOrganization(orgId: string): Promise<Organization | null>;

  /** The complete analytical dataset for one organization. */
  getDataset(orgId: string): Promise<AnalyticsDataset>;

  /**
   * The dataset, plus where this request got it from.
   *
   * Separate from getDataset because the answer must be reportable: a page that
   * renders a projection has to be able to say so, and "it was computed fresh"
   * and "it came from a stored projection whose evidence key matched" are
   * different facts about the same numbers.
   */
  getDatasetWithProjection(orgId: string): Promise<{
    dataset: AnalyticsDataset;
    coverage: CoverageSummary;
    userIdentities: UserIdentity[];
    projection: ProjectionState;
    /** Exact server-side counts, already fetched to build the evidence key. */
    storedRows: StoredRowCounts;
    /** Accepted rows over completed imports, from the same fetch. */
    acceptedRows: StoredRowCounts;
  }>;

  /**
   * What the import receipts promised, and what the database actually holds.
   *
   * Both sides come from the storage layer rather than from the dataset,
   * because the dataset is the thing under suspicion: a truncated read would
   * otherwise report its own truncated length as the expected total and
   * declare itself complete. See lib/analytics/integrity.ts.
   */
  countRowAccounting(orgId: string): Promise<{
    accepted: StoredRowCounts;
    stored: StoredRowCounts;
  }>;

  getReclaimOverrides(orgId: string): Promise<Map<string, ReclaimOverride>>;
  setReclaimOverride(orgId: string, candidateId: string, override: ReclaimOverride): Promise<void>;

  listDecisions(orgId: string): Promise<DecisionItem[]>;
  setDecisionStatus(orgId: string, decisionId: string, status: DecisionStatus, owner: string | null): Promise<void>;

  createPilotRequest(request: Omit<PilotRequest, 'id' | 'createdAt'>): Promise<PilotRequest>;
}
