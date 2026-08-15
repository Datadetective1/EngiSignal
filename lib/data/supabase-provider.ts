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
import { userClient } from '@/lib/supabase/server';
import { buildDatasetFromCanonical } from '@/lib/ingestion/dataset';
import { confirmedAliasMaps } from '@/lib/ingestion/confirmations';
import { supabaseIngestionStore } from '@/lib/ingestion/store/supabase-store';
import type { AnalyticsDataset } from '@/lib/domain/dataset';
import type {
  DecisionItem,
  DecisionStatus,
  Organization,
  PilotRequest,
} from '@/lib/domain/types';
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
  async getDataset(orgId: string): Promise<AnalyticsDataset> {
    const organization = await this.getOrganization(orgId);
    if (organization === null) throw new Error(`Unknown organization: ${orgId}`);

    const [usage, entitlements, people, contracts, imports, aliases] = await Promise.all([
      supabaseIngestionStore.listUsage(orgId),
      supabaseIngestionStore.listEntitlements(orgId),
      supabaseIngestionStore.listPeople(orgId),
      supabaseIngestionStore.listContracts(orgId),
      supabaseIngestionStore.listImports(orgId),
      // Customer-confirmed merges. The only thing that combines two strings the
      // matching rules would refuse to combine, and scoped to this tenant.
      confirmedAliasMaps(orgId),
    ]);

    const dataset = buildDatasetFromCanonical({
      organization,
      usage,
      entitlements,
      people,
      contracts,
      featureAliases: aliases.features,
      userAliases: aliases.users,
    });

    return {
      ...dataset,
      imports: imports.map((record) => ({
        id: record.id,
        organizationId: record.organizationId,
        kind:
          record.dataset === 'people'
            ? 'employees'
            : record.dataset === 'entitlements' || record.dataset === 'contracts'
              ? 'contracts'
              : 'usage',
        fileName: record.fileName,
        fileBytes: record.fileBytes,
        rowCount: record.totalRows,
        acceptedRows: record.acceptedRows,
        rejectedRows: record.rejectedRows,
        status: record.status === 'complete' ? 'complete' : 'failed',
        createdAt: record.uploadedAt,
        createdBy: null,
        mappingId: null,
        notes: null,
      })),
    };
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
