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

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { userClient } from '@/lib/supabase/server';
import { buildDatasetFromCanonical } from '@/lib/ingestion/dataset';
import type { UserIdentity } from '@/lib/ingestion/identity';
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
  type ProjectionStatus,
  BUILD_LEASE_SECONDS,
  buildNeeded,
  deserializeDataset,
  evidenceKeyFor,
  projectionUsable,
} from '@/lib/analytics/projection';
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

  /**
   * The organizations this user belongs to, oldest membership first.
   *
   * ── WHY THE ORDER IS PART OF THE CONTRACT ─────────────────────────────────
   *
   * Callers take `organizations[0]` as "the active workspace" — `loadWorkspace`
   * does when it renders a page, and `resolveIngestionContext` does when it
   * decides which tenant an upload belongs to. Those are two separate queries
   * in two separate requests.
   *
   * This query had no ORDER BY, so Postgres was free to return the rows in any
   * order it liked. For anyone belonging to ONE organization that is harmless,
   * which is why it survived: until invitations existed, nobody belonged to two.
   *
   * It stops being harmless the moment somebody is invited into a second
   * workspace. Two unordered reads can disagree, and the way that surfaces is
   * a customer uploading a licence export into the wrong company's tenant —
   * with RLS entirely satisfied, because they are a legitimate member of both.
   *
   * Ordering by the membership's own created_at makes the choice deterministic
   * and meaningful: the workspace you joined first stays the one you land in,
   * for as long as there is no switcher to say otherwise.
   */
  async listOrganizations(userId: string): Promise<Organization[]> {
    const { data, error } = await (await db())
      .from('organization_members')
      .select('created_at, organizations(*)')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
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

  /**
   * ── A PROSPECT IS NOT SIGNED IN ─────────────────────────────────────────
   *
   * Everyone who fills in this form is `anon`, and `anon` holds INSERT on
   * `pilot_requests` and nothing else -- deliberately, because the table
   * contains other companies' contact details and a public SELECT policy
   * would publish the whole sales pipeline.
   *
   * This used to end in `.select().single()`. That `RETURNING` clause needs
   * SELECT, so the statement was refused, the insert rolled back, and every
   * signed-out visitor was told "the request could not be recorded". The
   * landing page's primary call to action failed for the only people it is
   * aimed at, and it was invisible in testing because a signed-in caller has
   * SELECT and succeeds.
   *
   * The id is therefore generated here and inserted explicitly, so the row is
   * known without being read back and `anon` keeps no read access at all.
   */
  async createPilotRequest(request: Omit<PilotRequest, 'id' | 'createdAt'>): Promise<PilotRequest> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    const { error } = await (await db())
      .from('pilot_requests')
      .insert({
        id,
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
      });

    if (error !== null) throw new Error(`Failed to record pilot request: ${error.message}`);
    return { ...request, id, createdAt };
  },
};


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
  /**
   * Whether the stored counts above were actually read from the database.
   *
   * False when the count could not be taken -- it degrades badly while a large
   * import is being written -- in which case `storedRows` carries what the last
   * completed analysis described, and nothing may claim the two agree.
   */
  countsVerified: boolean;
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
 * Record that this tenant's evidence changed.
 *
 * The application's entire part in the analysis lifecycle. It does not decide
 * when a rebuild happens or who performs it -- the worker owns that, on the
 * database's own schedule -- and it cannot mark another tenant, because the
 * function checks membership from the session rather than from the argument.
 */
export async function markOwnProjectionDirty(orgId: string): Promise<void> {
  const client = await db();
  const { error } = await client.rpc('mark_own_projection_dirty', { org: orgId });
  if (error !== null) throw new Error(error.message);
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
  const [organization, countedRows, imports, confirmations, stored] = await Promise.all([
    supabaseProvider.getOrganization(orgId),
    // ── A COUNT THAT FAILS MUST NOT TAKE THE PAGE WITH IT ─────────────────
    //
    // This count proves the analysis describes the rows that exist. It is
    // about 75 ms at rest, and far slower while a large import is being
    // written, because the freshly inserted pages have no visibility map and
    // the index-only scan falls back to the heap.
    //
    // Measured against a 466,000-row import it was cancelled by the statement
    // timeout, and the customer got a 500 while watching their own import.
    // Raising the timeout only made the failure slower -- 31 seconds of blank
    // page and then the same error, which is worse.
    //
    // So a failure here is treated as what it is: we could not check. The
    // analysis is still shown, and it is labelled unverified rather than
    // presented as agreeing with storage.
    supabaseIngestionStore.countStoredRows(orgId).catch(() => null),
    supabaseIngestionStore.listImports(orgId),
    supabaseIngestionStore.countConfirmations(orgId),
    supabaseIngestionStore.readProjection(orgId),
  ]);
  if (organization === null) throw new Error(`Unknown organization: ${orgId}`);

  const countsVerified = countedRows !== null;
  // What the last completed analysis said was stored. Not a substitute for the
  // count -- it is only shown alongside `countsVerified: false`, which every
  // surface gates on.
  const storedRows: StoredRowCounts =
    countedRows ?? stored?.storedRows ?? { usage: 0, people: 0, entitlements: 0, contracts: 0 };

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
    countsVerified,
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

  // ── READING NO LONGER STARTS A BUILD ──────────────────────────────────────
  //
  // It used to. A page render was the only thing that noticed the analysis was
  // owed, so a customer who imported a large estate and closed the tab came
  // back to durable rows and no analysis.
  //
  // Phase 2H gave the projection the scheduler ingestion already had, and
  // `mark_projection_dirty` records the debt at the moment the evidence
  // changes. Leaving this call here as well would put two writers on one
  // lifecycle -- the reader claiming with the customer's session, the worker
  // with its own -- which is the second source of truth this codebase keeps
  // refusing. `needsBuild` is still computed, because it is what tells the
  // reader the analysis on screen is not current.
  void needsBuild;

  // ── WHO OWNS THE ORGANIZATION ─────────────────────────────────────────────
  //
  // The projection worker cannot read `organizations` -- it holds no table
  // privileges -- so the payload carries only the id and name it was handed on
  // the job row. The authoritative row is read on every request above, and it
  // is the one every page must see.
  //
  // Returning the payload's copy shipped a fabricated number: headcount was
  // absent, so the cost page printed "Cost per technical employee $0" beside
  // "— employees" on a $5.7M portfolio. Merging here also means an edit to the
  // organization applies on the next render rather than waiting for a rebuild.
  const withAuthoritativeOrganization = (content: AnalyticsDataset): AnalyticsDataset => ({
    ...content,
    organization,
  });

  // The happy path: a payload that describes exactly what is stored.
  if (reason === null && stored?.payload != null) {
    try {
      const content = deserializeDataset(stored.payload);
      return {
        ...base,
        dataset: withAuthoritativeOrganization(content.dataset),
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
        dataset: withAuthoritativeOrganization(content.dataset),
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

