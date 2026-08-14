/**
 * The storage boundary.
 *
 * Every method takes an explicit `orgId`. That is not decoration — it is the
 * type-level layer of tenant isolation described in ARCHITECTURE.md. Omitting
 * it is a compile error, so no code path can accidentally read across tenants
 * even if a database policy were misconfigured.
 */

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

  getReclaimOverrides(orgId: string): Promise<Map<string, ReclaimOverride>>;
  setReclaimOverride(orgId: string, candidateId: string, override: ReclaimOverride): Promise<void>;

  listDecisions(orgId: string): Promise<DecisionItem[]>;
  setDecisionStatus(orgId: string, decisionId: string, status: DecisionStatus, owner: string | null): Promise<void>;

  createPilotRequest(request: Omit<PilotRequest, 'id' | 'createdAt'>): Promise<PilotRequest>;
}
