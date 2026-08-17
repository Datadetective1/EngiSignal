/**
 * The local provider — EngiSignal's default, requiring no credentials.
 *
 * The synthetic dataset is deterministic and expensive enough to build that it
 * is cached in module scope for the lifetime of the server process. Workflow
 * mutations (reclaim decisions, decision statuses) are held in memory: they
 * persist for the session and reset on restart, which is the right behaviour
 * for an evaluation environment and is stated plainly in the UI.
 */

import type { AnalyticsDataset } from '@/lib/domain/dataset';
import type {
  DecisionItem,
  DecisionStatus,
  Organization,
  PilotRequest,
} from '@/lib/domain/types';
import { DEMO_ORG_ID, generateDemoDataset } from '@/lib/synthetic/generate';
import type { DataProvider, ReclaimOverride } from './provider';
import { PROJECTION_VERSION } from '@/lib/analytics/projection';
import { summarizeCoverage } from '@/lib/ingestion/store/types';

let cachedDataset: AnalyticsDataset | null = null;

function dataset(): AnalyticsDataset {
  if (cachedDataset === null) cachedDataset = generateDemoDataset();
  return cachedDataset;
}

const reclaimOverrides = new Map<string, Map<string, ReclaimOverride>>();
const decisionOverrides = new Map<string, Map<string, { status: DecisionStatus; owner: string | null }>>();
const pilotRequests: PilotRequest[] = [];

function orgMap<T>(store: Map<string, Map<string, T>>, orgId: string): Map<string, T> {
  const existing = store.get(orgId);
  if (existing !== undefined) return existing;
  const created = new Map<string, T>();
  store.set(orgId, created);
  return created;
}

export const mockProvider: DataProvider = {
  kind: 'mock',

  async listOrganizations(_userId: string): Promise<Organization[]> {
    return [dataset().organization];
  },

  async getOrganization(orgId: string): Promise<Organization | null> {
    const org = dataset().organization;
    return org.id === orgId ? org : null;
  },

  async countRowAccounting(orgId: string) {
    // Synthetic data is generated in memory and handed straight to the
    // analytics, so there is no transport that could drop rows between the two.
    // Reporting the dataset's own counts on both sides is honest here, and
    // would be circular against a real database — which is why the Supabase
    // provider asks the server for an exact count instead.
    const dataset = await this.getDataset(orgId);
    return { accepted: dataset.analyzedRows, stored: dataset.analyzedRows };
  },

  async getDataset(orgId: string): Promise<AnalyticsDataset> {
    const data = dataset();
    if (orgId !== data.organization.id) {
      throw new Error(`Unknown organization: ${orgId}`);
    }
    return data;
  },

  /**
   * The local path has no transport between the store and the reader, so there
   * is nothing to project and nothing to go stale. It reports 'computed'
   * honestly rather than claiming a projection it does not have — a stub that
   * said 'projection' here would make the Data page lie during development.
   */
  async getDatasetWithProjection(orgId: string) {
    const data = await this.getDataset(orgId);
    return {
      dataset: data,
      coverage: summarizeCoverage([], [], [], []),
      userIdentities: [],
      storedRows: data.analyzedRows,
      acceptedRows: data.analyzedRows,
      projection: {
        source: 'computed' as const,
        version: PROJECTION_VERSION,
        computedAt: null,
        buildMs: null,
        rebuiltBecause: 'disabled' as const,
        payloadBytes: null,
        evidenceKey: 'local',
      },
    };
  },

  async getReclaimOverrides(orgId: string): Promise<Map<string, ReclaimOverride>> {
    return new Map(orgMap(reclaimOverrides, orgId));
  },

  async setReclaimOverride(orgId: string, candidateId: string, override: ReclaimOverride): Promise<void> {
    orgMap(reclaimOverrides, orgId).set(candidateId, override);
  },

  async listDecisions(orgId: string): Promise<DecisionItem[]> {
    // Decisions are derived from analytics on read; only status and ownership
    // are stored, so a decision can never drift from the evidence behind it.
    void orgId;
    return [];
  },

  async setDecisionStatus(
    orgId: string,
    decisionId: string,
    status: DecisionStatus,
    owner: string | null,
  ): Promise<void> {
    orgMap(decisionOverrides, orgId).set(decisionId, { status, owner });
  },

  async createPilotRequest(request: Omit<PilotRequest, 'id' | 'createdAt'>): Promise<PilotRequest> {
    const created: PilotRequest = {
      ...request,
      id: `pilot-${pilotRequests.length + 1}-${Date.now().toString(36)}`,
      createdAt: new Date().toISOString(),
    };
    pilotRequests.push(created);
    return created;
  },
};

/** Decision status overrides for an organization, used when composing decisions. */
export function getDecisionOverrides(orgId: string): Map<string, { status: DecisionStatus; owner: string | null }> {
  return orgMap(decisionOverrides, orgId);
}

/** Exposed for the local pilot inbox. Never rendered publicly. */
export function listPilotRequests(): PilotRequest[] {
  return [...pilotRequests];
}

export { DEMO_ORG_ID };
