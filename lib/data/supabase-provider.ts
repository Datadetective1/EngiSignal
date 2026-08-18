/**
 * The Supabase provider.
 *
 * Reads are scoped by organization at three layers (see ARCHITECTURE.md §4):
 * Row Level Security in the database, an explicit `organization_id` filter
 * here, and the required `orgId` argument in the DataProvider signature.
 * The redundancy is deliberate — a defect in any one layer does not leak data.
 *
 * This provider activates only when ENGISIGNAL_DATA_PROVIDER=supabase and the
 * Supabase environment variables are present. Without them EngiSignal runs on
 * the local synthetic dataset.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { after } from 'next/server';
import { detachedUserClient, userClient, withDetachedClient } from '@/lib/supabase/server';
import { buildDatasetFromCanonical } from '@/lib/ingestion/dataset';
import { confirmedAliasMaps } from '@/lib/ingestion/confirmations';
import { resolveUsers, type UserIdentity } from '@/lib/ingestion/identity';
import { supabaseIngestionStore } from '@/lib/ingestion/store/supabase-store';
import type { AnalyticsDataset } from '@/lib/domain/dataset';
import type { CoverageSummary, ImportSummary } from '@/lib/ingestion/store/types';
import { summarizeCoverage } from '@/lib/ingestion/store/types';
import type {
  DecisionItem,
  DecisionStatus,
  Organization,
  PilotRequest,
} from '@/lib/domain/types';
import {
  PROJECTION_VERSION,
  type ProjectionPayload,
  type ProjectionStatus,
  BUILD_LEASE_SECONDS,
  buildNeeded,
  deserializeDataset,
  evidenceKeyFor,
  projectionUsable,
} from '@/lib/analytics/projection';
import {
  runProjectionBuild,
  type BuildClient,
  type PhaseRecorder,
} from '@/lib/analytics/build-runner';
import type { StoredRowCounts } from '@/lib/analytics/integrity';
import type { DataProvider, ReclaimOverride } from './provider';

// Single definition, in config/env.ts, where blank is treated as absent.
export { hasSupabaseCredentials as hasSupabaseEnv } from '@/config/env';

/**
 * The request-scoped client.
 *
 * Carries the signed-in user's JWT so Row Level Security applies to every
 * statement. The previous implementation used a bare anon client with no
 * session: `auth.uid()` was null, every policy evaluated false, and the
 * provider could read nothing at all.
 */
async function db(): Promise<SupabaseClient> {
  return userClient();
}

/** Fetch every row of a tenant table, paging past PostgREST's row cap. */
async function fetchAll<T>(table: string, orgId: string, order?: string): Promise<T[]> {
  const pageSize = 1000;
  const out: T[] = [];
  for (let page = 0; ; page++) {
    let query = (await db())
      .from(table)
      .select('*')
      .eq('organization_id', orgId)
      .range(page * pageSize, (page + 1) * pageSize - 1);
    if (order !== undefined) query = query.order(order);

    const { data, error } = await query;
    if (error !== null) throw new Error(`Failed to read ${table}: ${error.message}`);
    if (data === null || data.length === 0) break;
    out.push(...(data as T[]));
    if (data.length < pageSize) break;
  }
  return out;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

function mapOrganization(row: any): Organization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    industry: row.industry ?? null,
    technicalHeadcount: row.technical_headcount ?? null,
    headcountGrowthRate: row.headcount_growth_rate ?? null,
    currency: row.currency ?? 'USD',
    isDemo: row.is_demo ?? false,
    createdAt: row.created_at,
  };
}

export const supabaseProvider: DataProvider = {
  kind: 'supabase',

  async listOrganizations(userId: string): Promise<Organization[]> {
    const { data, error } = await (await db())
      .from('organization_members')
      .select('organizations(*)')
      .eq('user_id', userId);
    if (error !== null) throw new Error(`Failed to list organizations: ${error.message}`);
    return (data ?? []).flatMap((row: any) => (row.organizations ? [mapOrganization(row.organizations)] : []));
  },

  async getOrganization(orgId: string): Promise<Organization | null> {
    const { data, error } = await (await db()).from('organizations').select('*').eq('id', orgId).maybeSingle();
    if (error !== null) throw new Error(`Failed to read organization: ${error.message}`);
    return data === null ? null : mapOrganization(data);
  },

  /**
   * The analytical dataset for one organization.
   *
   * Built from the CANONICAL INGESTION tables, not from the legacy pre-aggregated
   * analytics tables. Phase 1 writes what customers actually upload into
   * ingestion_usage / _entitlements / _people at source grain with provenance,
   * and the analytics shapes are projected from that on read.
   *
   * The projection is deliberately not persisted: a mapping correction or an
   * import deletion changes the answer, and a stored aggregate would silently
   * disagree with the rows it came from. Recomputing keeps every number
   * traceable to the file row that produced it.
   *
   * No analytical formula lives here. See lib/ingestion/dataset.ts for the
   * grain contract and the single documented aggregation choice.
   */
  async countRowAccounting(orgId: string) {
    const [imports, stored] = await Promise.all([
      supabaseIngestionStore.listImports(orgId),
      supabaseIngestionStore.countStoredRows(orgId),
    ]);

    const accepted = { usage: 0, people: 0, entitlements: 0, contracts: 0 };
    for (const record of imports) {
      // Only completed imports have promised anything. One still in flight has
      // not, and a failed one was rolled back — counting either would fire the
      // integrity check on a healthy system and train people to ignore it.
      if (record.status !== 'complete') continue;
      accepted.usage += record.usageRecords;
      accepted.people += record.peopleRecords;
      accepted.entitlements += record.entitlementRecords;
      accepted.contracts += record.contractRecords;
    }

    return { accepted, stored };
  },

  /**
   * ── THE DATASET, COMPUTED ONCE ──────────────────────────────────────────────
   *
   * Phase 2D measured this method at the stated ceiling: 6.9 seconds to read
   * 67,267 rows, then 12 milliseconds to analyse them, on every page view, for
   * an answer that had not changed since the last import.
   *
   * The dataset is now read from a stored projection when one matches the
   * evidence, and rebuilt from canonical rows when one does not. The check is
   * not "is it recent" — a cache that goes stale quietly is the confident-wrong-
   * answer failure this codebase exists to refuse. It is an exact comparison
   * against the evidence that exists right now, on every request.
   *
   * The canonical tables remain the only source of truth. Deleting every row in
   * analytics_projections costs one slow page and nothing else.
   */
  async getDataset(orgId: string): Promise<AnalyticsDataset> {
    const loaded = await loadDataset(orgId);
    if (loaded.dataset !== null) return loaded.dataset;
    // No analysis yet. Callers of the bare getDataset have no way to express
    // "still building", so they get an empty dataset — and every analytical
    // surface goes through getDatasetWithProjection, which can say so.
    const organization = await supabaseProvider.getOrganization(orgId);
    if (organization === null) throw new Error(`Unknown organization: ${orgId}`);
    return buildDatasetFromCanonical({
      organization,
      usage: [],
      entitlements: [],
      people: [],
      contracts: [],
    });
  },

  /** The dataset plus where it came from, for surfaces that report on it. */
  async getDatasetWithProjection(orgId: string): Promise<LoadedDataset> {
    return loadDataset(orgId);
  },

  async getReclaimOverrides(orgId: string): Promise<Map<string, ReclaimOverride>> {
    const rows = await fetchAll<any>('reclaim_campaign_items', orgId);
    return new Map(
      rows.map((row) => [
        row.candidate_key as string,
        {
          status: row.status,
          owner: row.owner ?? null,
          notes: row.notes ?? null,
          updatedAt: row.updated_at,
        } satisfies ReclaimOverride,
      ]),
    );
  },

  async setReclaimOverride(orgId: string, candidateId: string, override: ReclaimOverride): Promise<void> {
    const { error } = await (await db()).from('reclaim_campaign_items').upsert(
      {
        organization_id: orgId,
        candidate_key: candidateId,
        status: override.status,
        owner: override.owner,
        notes: override.notes,
        updated_at: override.updatedAt,
      },
      { onConflict: 'organization_id,candidate_key' },
    );
    if (error !== null) throw new Error(`Failed to save reclaim decision: ${error.message}`);
  },

  async listDecisions(orgId: string): Promise<DecisionItem[]> {
    const rows = await fetchAll<any>('decision_items', orgId);
    return rows.map<DecisionItem>((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      type: row.type,
      title: row.title,
      description: row.description ?? '',
      impact: row.impact === null || row.impact === undefined ? null : Number(row.impact),
      urgencyDays: row.urgency_days ?? null,
      confidence: row.confidence ?? 'Medium',
      risk: row.risk ?? 'Low',
      owner: row.owner ?? null,
      recommendedAction: row.recommended_action ?? '',
      status: row.status ?? 'open',
      href: row.href ?? '/app/decisions',
    }));
  },

  async setDecisionStatus(
    orgId: string,
    decisionId: string,
    status: DecisionStatus,
    owner: string | null,
  ): Promise<void> {
    const { error } = await (await db()).from('decision_items').upsert(
      { organization_id: orgId, id: decisionId, status, owner },
      { onConflict: 'id' },
    );
    if (error !== null) throw new Error(`Failed to update decision: ${error.message}`);
  },

  async createPilotRequest(request: Omit<PilotRequest, 'id' | 'createdAt'>): Promise<PilotRequest> {
    const { data, error } = await (await db())
      .from('pilot_requests')
      .insert({
        name: request.name,
        work_email: request.workEmail,
        company: request.company,
        job_title: request.jobTitle,
        approximate_employees: request.approximateEmployees,
        engineering_employees: request.engineeringEmployees,
        software_spend_range: request.softwareSpendRange,
        major_vendors: request.majorVendors,
        renewal_timing: request.renewalTiming,
        primary_challenge: request.primaryChallenge,
        message: request.message,
      })
      .select()
      .single();

    if (error !== null) throw new Error(`Failed to record pilot request: ${error.message}`);
    return { ...request, id: data.id, createdAt: data.created_at };
  },
};

/**
 * Build the analytical dataset from canonical rows.
 *
 * The slow path, and the authoritative one. Everything the projection serves is
 * a saved result of exactly this function.
 */
async function buildFromCanonical(
  orgId: string,
  organization: Organization,
  onPhase: PhaseRecorder = () => {},
): Promise<ProjectionPayload> {
  /** Times one stage and reports how much it moved. */
  const timed = async <T>(name: string, work: () => Promise<T>, size?: (v: T) => number) => {
    const from = performance.now();
    const value = await work();
    onPhase(name, performance.now() - from, size ? { rows: size(value) } : undefined);
    return value;
  };

  // Timed individually rather than as one figure: these run concurrently, so a
  // total would only show the slowest, and which one is slowest is the entire
  // question.
  const [usage, entitlements, people, contracts, imports, aliases] = await Promise.all([
    timed('read:usage', () => supabaseIngestionStore.listUsage(orgId), (r) => r.length),
    timed('read:entitlements', () => supabaseIngestionStore.listEntitlements(orgId), (r) => r.length),
    timed('read:people', () => supabaseIngestionStore.listPeople(orgId), (r) => r.length),
    timed('read:contracts', () => supabaseIngestionStore.listContracts(orgId), (r) => r.length),
    timed('read:imports', () => supabaseIngestionStore.listImports(orgId), (r) => r.length),
    // Customer-confirmed merges. The only thing that combines two strings the
    // matching rules would refuse to combine, and scoped to this tenant.
    timed('read:aliases', () => confirmedAliasMaps(orgId)),
  ]);

  const computeFrom = performance.now();
  const dataset = buildDatasetFromCanonical({
    organization,
    usage,
    entitlements,
    people,
    contracts,
    featureAliases: aliases.features,
    userAliases: aliases.users,
  });

  const withImports = {
    ...dataset,
    imports: imports.map((record) => ({
      id: record.id,
      organizationId: record.organizationId,
      kind:
        record.dataset === 'people'
          ? ('employees' as const)
          : record.dataset === 'entitlements' || record.dataset === 'contracts'
            ? ('contracts' as const)
            : ('usage' as const),
      fileName: record.fileName,
      fileBytes: record.fileBytes,
      rowCount: record.totalRows,
      acceptedRows: record.acceptedRows,
      rejectedRows: record.rejectedRows,
      status: (record.status === 'complete' ? 'complete' : 'failed') as 'complete' | 'failed',
      createdAt: record.uploadedAt,
      createdBy: null,
      mappingId: null,
      notes: null,
    })),
  };

  const payload = {
    dataset: withImports,
    coverage: summarizeCoverage(usage, entitlements, people, contracts),
    // Deliberately un-aliased; see ProjectionPayload.
    userIdentities: resolveUsers(usage, people),
  };
  onPhase('compute', performance.now() - computeFrom, { usageRows: usage.length });
  return payload;
}

export interface LoadedDataset {
  /**
   * The analysis, or null when there is none that can honestly be shown.
   *
   * Null on a tenant whose first build has not finished. Every analytical
   * surface renders "your data is being analysed" rather than a dataset full of
   * zeroes, because zero features and no features look identical on a page and
   * only one of them is true.
   */
  dataset: AnalyticsDataset | null;
  userIdentities: UserIdentity[];
  coverage: CoverageSummary;
  projection: ProjectionStatus;
  storedRows: StoredRowCounts;
  acceptedRows: StoredRowCounts;
}

/** Accepted rows over COMPLETED imports only. */
function acceptedFrom(imports: readonly ImportSummary[]): StoredRowCounts {
  const accepted = { usage: 0, people: 0, entitlements: 0, contracts: 0 };
  for (const record of imports) {
    // An import still in flight has promised nothing, and a failed one was
    // rolled back. Counting either fires the integrity check on a healthy
    // system and trains people to ignore it.
    if (record.status !== 'complete') continue;
    accepted.usage += record.usageRecords;
    accepted.people += record.peopleRecords;
    accepted.entitlements += record.entitlementRecords;
    accepted.contracts += record.contractRecords;
  }
  return accepted;
}

/**
 * Start a build unless one is already running, and do not wait for it.
 *
 * Called from `after()`, so it runs once the response has been sent. The caller
 * gets its page; the estate gets analysed; nobody watches a spinner inside an
 * HTTP request that might time out.
 */
export async function startProjectionBuild(
  orgId: string,
  evidenceKey?: string,
  client?: SupabaseClient,
): Promise<void> {
  // Bound for the whole build, so every store call underneath uses the session
  // captured while the request was still alive rather than a cookie store that
  // has since gone away.
  const run = async () => {
    const organization = await supabaseProvider.getOrganization(orgId);
    if (organization === null) return;

    // The import path does not know the key — it has just finished changing the
    // very evidence the key describes — so it is computed from what is stored.
    const key = evidenceKey ?? (await currentEvidenceKey(orgId));

    await runProjectionBuild({
      client: (await db()) as unknown as BuildClient,
      organizationId: orgId,
      evidenceKey: key,
      build: (onPhase) => buildFromCanonical(orgId, organization, onPhase),
      countStoredRows: () => supabaseIngestionStore.countStoredRows(orgId),
    });
  };

  if (client === undefined) return run();
  return withDetachedClient(client, run);
}

/** The fingerprint of the evidence that exists right now. */
export async function currentEvidenceKey(orgId: string): Promise<string> {
  const [storedRows, imports, confirmations] = await Promise.all([
    supabaseIngestionStore.countStoredRows(orgId),
    supabaseIngestionStore.listImports(orgId),
    supabaseIngestionStore.countConfirmations(orgId),
  ]);
  return evidenceKeyFor({
    storedRows,
    imports: imports
      .filter((record) => record.status === 'complete')
      .map((record) => ({ id: record.id, fingerprint: String(record.acceptedRows) })),
    confirmations,
  });
}

/**
 * Read the analysis, and say exactly what it is.
 *
 * The evidence key is computed FIRST, from the database, so the decision about
 * a stored payload is made against what exists now rather than against what the
 * payload claims about itself. Nothing here blocks on a build: a page either
 * has an analysis of the current evidence, an analysis of a NAMED earlier
 * version, or nothing at all — and it is told which.
 */
async function loadDataset(orgId: string): Promise<LoadedDataset> {
  // One wave. Everything needed to decide what may be shown, including the
  // payload itself, which is discarded if it turns out not to match. A wasted
  // 130 KB on the occasional rebuild is cheaper than a second round trip on
  // every page view — measured at about 1.6 seconds when it was three waves.
  const [organization, storedRows, imports, confirmations, stored] = await Promise.all([
    supabaseProvider.getOrganization(orgId),
    supabaseIngestionStore.countStoredRows(orgId),
    supabaseIngestionStore.listImports(orgId),
    supabaseIngestionStore.countConfirmations(orgId),
    supabaseIngestionStore.readProjection(orgId),
  ]);
  if (organization === null) throw new Error(`Unknown organization: ${orgId}`);

  const evidenceKey = evidenceKeyFor({
    storedRows,
    imports: imports
      .filter((record) => record.status === 'complete')
      // id changes when an import is added, disappears when one is deleted, and
      // the accepted count moves if a row is ever rewritten in place.
      .map((record) => ({ id: record.id, fingerprint: String(record.acceptedRows) })),
    confirmations,
  });

  const acceptedRows = acceptedFrom(imports);
  const reason = projectionUsable(stored, evidenceKey);

  // Kick a build when one is needed and nobody live is doing it. Deliberately
  // not awaited by the caller — see startProjectionBuild.
  const needsBuild = reason !== null && buildNeeded(stored, evidenceKey);

  const base = {
    storedRows,
    acceptedRows,
    coverage: summarizeCoverage([], [], [], []),
    userIdentities: [] as UserIdentity[],
  };

  const status = (over: Partial<ProjectionStatus>): ProjectionStatus => ({
    source: 'none',
    state: stored?.state ?? null,
    version: stored?.version ?? PROJECTION_VERSION,
    computedAt: stored?.computedAt ?? null,
    buildMs: stored?.buildMs ?? null,
    buildPhases: stored?.buildPhases ?? null,
    payloadBytes: stored?.payloadBytes ?? null,
    evidenceKey: stored?.evidenceKey ?? null,
    currentEvidenceKey: evidenceKey,
    stale: (stored?.evidenceKey ?? null) !== evidenceKey,
    buildingEvidenceKey: stored?.buildingEvidenceKey ?? null,
    buildLive:
      stored?.state === 'building' &&
      stored.heartbeatAt !== null &&
      Date.now() - Date.parse(stored.heartbeatAt) <= BUILD_LEASE_SECONDS * 1000,
    buildStartedAt: stored?.buildStartedAt ?? null,
    buildFinishedAt: stored?.buildFinishedAt ?? null,
    buildAttempt: stored?.buildAttempt ?? 0,
    buildError: stored?.buildError ?? null,
    startedBecause: needsBuild ? reason : null,
    analyticsCurrent: false,
    ...over,
  });

  if (needsBuild) await scheduleBuild(orgId, evidenceKey);

  // The happy path: a payload that describes exactly what is stored.
  if (reason === null && stored?.payload != null) {
    try {
      const content = deserializeDataset(stored.payload);
      return {
        ...base,
        dataset: content.dataset,
        coverage: content.coverage,
        userIdentities: content.userIdentities,
        projection: status({ source: 'current', stale: false, analyticsCurrent: true }),
      };
    } catch {
      // A payload that will not inflate is a corrupt cache, not a corrupt
      // estate. Fall through: a build is already queued above.
    }
  }

  // A complete analysis of an EARLIER evidence version. Shown, because it is
  // internally consistent and useful, and because withholding everything for
  // twenty seconds after each import teaches people the product is broken. But
  // never as current: analyticsCurrent stays false and the UI names the
  // evidence it describes.
  if (stored?.payload != null && stored.evidenceKey !== null) {
    try {
      const content = deserializeDataset(stored.payload);
      return {
        ...base,
        dataset: content.dataset,
        coverage: content.coverage,
        userIdentities: content.userIdentities,
        projection: status({ source: 'superseded', stale: true, analyticsCurrent: false }),
      };
    } catch {
      // Fall through to nothing-to-show.
    }
  }

  // Nothing readable. The first import of a tenant's life, still building.
  return { ...base, dataset: null, projection: status({ source: 'none' }) };
}

/**
 * ── SCHEDULING THE BUILD WHERE THE NEED IS DISCOVERED ──────────────────────
 *
 * The first version handed the decision back to `loadWorkspace`, which drained
 * it and scheduled the work. That silently excluded every caller that is not a
 * page: the diagnostics endpoint, and the exports, could see that a build was
 * needed and never start one.
 *
 * Production showed the consequence. A tenant sat at `superseded` for five
 * minutes with no build running and none scheduled — correct figures for an
 * old evidence version, honestly labelled, and no route back to a current one
 * except a page load that nobody was making.
 *
 * So it is scheduled here instead, once per request, by whoever reads.
 *
 * The client is captured NOW, while the request is alive; after the response
 * there is no cookie store to read a session from. `after()` outside a request
 * scope throws, which is caught: a background build is a nice-to-have on any
 * path that has no response to outlive.
 */
async function scheduleBuild(orgId: string, evidenceKey: string): Promise<void> {
  try {
    const detached = await detachedUserClient();
    if (detached === null) return;
    after(async () => {
      try {
        await startProjectionBuild(orgId, evidenceKey, detached);
      } catch {
        // The runner records its own failures against the tenant.
      }
    });
  } catch {
    // No request scope to attach to. The next read will try again.
  }
}
