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

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AnalyticsDataset } from '@/lib/domain/dataset';
import type {
  Contract,
  ContractItem,
  DailyUsage,
  DecisionItem,
  DecisionStatus,
  DenialEvent,
  Employee,
  HourlyUsage,
  ImportMapping,
  ImportRecord,
  Organization,
  PilotRequest,
  Product,
  ProductFamily,
  SoftwareFeature,
  TokenUsageDaily,
  UnmappedFeature,
  UnmatchedUser,
  UserFeatureActivity,
  Vendor,
} from '@/lib/domain/types';
import type { DataProvider, ReclaimOverride } from './provider';

export function hasSupabaseEnv(): boolean {
  return (
    typeof process.env.NEXT_PUBLIC_SUPABASE_URL === 'string' &&
    process.env.NEXT_PUBLIC_SUPABASE_URL.length > 0 &&
    typeof process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY === 'string' &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY.length > 0
  );
}

let client: SupabaseClient | null = null;

function db(): SupabaseClient {
  if (client === null) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (url === undefined || key === undefined) {
      throw new Error('Supabase provider selected but NEXT_PUBLIC_SUPABASE_URL / ANON_KEY are not set.');
    }
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}

/** Fetch every row of a tenant table, paging past PostgREST's row cap. */
async function fetchAll<T>(table: string, orgId: string, order?: string): Promise<T[]> {
  const pageSize = 1000;
  const out: T[] = [];
  for (let page = 0; ; page++) {
    let query = db()
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
    const { data, error } = await db()
      .from('organization_members')
      .select('organizations(*)')
      .eq('user_id', userId);
    if (error !== null) throw new Error(`Failed to list organizations: ${error.message}`);
    return (data ?? []).flatMap((row: any) => (row.organizations ? [mapOrganization(row.organizations)] : []));
  },

  async getOrganization(orgId: string): Promise<Organization | null> {
    const { data, error } = await db().from('organizations').select('*').eq('id', orgId).maybeSingle();
    if (error !== null) throw new Error(`Failed to read organization: ${error.message}`);
    return data === null ? null : mapOrganization(data);
  },

  async getDataset(orgId: string): Promise<AnalyticsDataset> {
    const organization = await this.getOrganization(orgId);
    if (organization === null) throw new Error(`Unknown organization: ${orgId}`);

    const [
      vendors,
      productFamilies,
      products,
      features,
      contracts,
      contractItems,
      employees,
      dailyUsage,
      hourlyUsage,
      tokenUsage,
      activities,
      denials,
      unmatchedUsers,
      unmappedFeatures,
      imports,
      importMappings,
    ] = await Promise.all([
      fetchAll<any>('vendors', orgId),
      fetchAll<any>('product_families', orgId),
      fetchAll<any>('products', orgId),
      fetchAll<any>('software_features', orgId),
      fetchAll<any>('contracts', orgId),
      fetchAll<any>('contract_items', orgId),
      fetchAll<any>('employees', orgId),
      fetchAll<any>('daily_usage', orgId, 'usage_date'),
      fetchAll<any>('hourly_usage', orgId, 'usage_date'),
      fetchAll<any>('token_usage_daily', orgId, 'usage_date'),
      fetchAll<any>('user_feature_activity', orgId),
      fetchAll<any>('denials', orgId, 'denial_date'),
      fetchAll<any>('unmatched_users', orgId),
      fetchAll<any>('unmapped_features', orgId),
      fetchAll<any>('imports', orgId),
      fetchAll<any>('import_mappings', orgId),
    ]);

    // The analysis date is the most recent day with observed usage. Derived
    // from the data rather than the clock, so results stay reproducible.
    const latestUsage = dailyUsage.reduce<string>(
      (latest, row) => (row.usage_date > latest ? row.usage_date : latest),
      '1970-01-01',
    );

    const mappedActivities: UserFeatureActivity[] = activities.map((row) => ({
      organizationId: row.organization_id,
      featureId: row.feature_id,
      employeeId: row.employee_id,
      assigned: row.assigned,
      assignedOn: row.assigned_on ?? null,
      lastUsedDate: row.last_used_date ?? null,
      totalSessions: row.total_sessions ?? 0,
      totalHours: Number(row.total_hours ?? 0),
      sessions30: row.sessions_30 ?? 0,
      sessions60: row.sessions_60 ?? 0,
      sessions90: row.sessions_90 ?? 0,
      sessions180: row.sessions_180 ?? 0,
    }));

    const resolvedUsers = mappedActivities.length;
    const openUnmatched = unmatchedUsers.filter((u) => u.status === 'open').length;
    const openUnmapped = unmappedFeatures.filter((f) => f.status === 'open').length;

    return {
      organization,
      vendors: vendors.map<Vendor>((row) => ({
        id: row.id,
        organizationId: row.organization_id,
        name: row.name,
        slug: row.slug,
      })),
      productFamilies: productFamilies.map<ProductFamily>((row) => ({
        id: row.id,
        organizationId: row.organization_id,
        vendorId: row.vendor_id,
        name: row.name,
      })),
      products: products.map<Product>((row) => ({
        id: row.id,
        organizationId: row.organization_id,
        vendorId: row.vendor_id,
        productFamilyId: row.product_family_id ?? null,
        name: row.name,
        category: row.category ?? null,
      })),
      features: features.map<SoftwareFeature>((row) => ({
        id: row.id,
        organizationId: row.organization_id,
        productId: row.product_id,
        name: row.name,
        code: row.code,
        licenseModel: row.license_model,
        tokenWeight: row.token_weight ?? null,
      })),
      contracts: contracts.map<Contract>((row) => ({
        id: row.id,
        organizationId: row.organization_id,
        vendorId: row.vendor_id,
        contractNumber: row.contract_number,
        agreementName: row.agreement_name ?? null,
        startDate: row.start_date,
        endDate: row.end_date,
        renewalDate: row.renewal_date,
        purchaseOrder: row.purchase_order ?? null,
        businessOwner: row.business_owner ?? null,
        costCenter: row.cost_center ?? null,
        status: row.status ?? 'active',
      })),
      contractItems: contractItems.map<ContractItem>((row) => ({
        id: row.id,
        organizationId: row.organization_id,
        contractId: row.contract_id,
        featureId: row.feature_id,
        sku: row.sku ?? null,
        licenseModel: row.license_model,
        quantity: row.quantity,
        unitPrice: row.unit_price === null || row.unit_price === undefined ? null : Number(row.unit_price),
      })),
      employees: employees.map<Employee>((row) => ({
        id: row.id,
        organizationId: row.organization_id,
        employeeCode: row.employee_code ?? null,
        username: row.username,
        fullName: row.full_name,
        email: row.email ?? null,
        managerName: row.manager_name ?? null,
        department: row.department ?? null,
        businessUnit: row.business_unit ?? null,
        program: row.program ?? null,
        discipline: row.discipline ?? null,
        competency: row.competency ?? null,
        location: row.location ?? null,
        region: row.region ?? null,
        employeeType: row.employee_type ?? 'employee',
        status: row.status ?? 'active',
        contractorCompany: row.contractor_company ?? null,
      })),
      dailyUsage: dailyUsage.map<DailyUsage>((row) => ({
        featureId: row.feature_id,
        date: row.usage_date,
        peak: row.peak,
        meanConcurrent: Number(row.mean_concurrent ?? 0),
        usageHours: Number(row.usage_hours ?? 0),
        uniqueUsers: row.unique_users ?? 0,
      })),
      hourlyUsage: hourlyUsage.map<HourlyUsage>((row) => ({
        featureId: row.feature_id,
        date: row.usage_date,
        hour: row.hour,
        concurrent: row.concurrent,
      })),
      tokenUsage: tokenUsage.map<TokenUsageDaily>((row) => ({
        featureId: row.feature_id,
        date: row.usage_date,
        tokenHours: Number(row.token_hours ?? 0),
        peakTokens: row.peak_tokens ?? 0,
      })),
      activities: mappedActivities,
      denials: denials.map<DenialEvent>((row) => ({
        id: row.id,
        organizationId: row.organization_id,
        featureId: row.feature_id,
        date: row.denial_date,
        hour: row.hour ?? 0,
        employeeId: row.employee_id ?? null,
        count: row.count ?? 1,
        concurrentAtDenial: row.concurrent_at_denial ?? null,
        availableAtDenial: row.available_at_denial ?? null,
      })),
      unmatchedUsers: unmatchedUsers.map<UnmatchedUser>((row) => ({
        id: row.id,
        organizationId: row.organization_id,
        rawUsername: row.raw_username,
        occurrences: row.occurrences ?? 0,
        firstSeen: row.first_seen,
        lastSeen: row.last_seen,
        suggestedEmployeeId: row.suggested_employee_id ?? null,
        status: row.status ?? 'open',
      })),
      unmappedFeatures: unmappedFeatures.map<UnmappedFeature>((row) => ({
        id: row.id,
        organizationId: row.organization_id,
        rawValue: row.raw_value,
        occurrences: row.occurrences ?? 0,
        firstSeen: row.first_seen,
        lastSeen: row.last_seen,
        suggestedFeatureId: row.suggested_feature_id ?? null,
        status: row.status ?? 'open',
      })),
      imports: imports.map<ImportRecord>((row) => ({
        id: row.id,
        organizationId: row.organization_id,
        kind: row.kind,
        fileName: row.file_name,
        fileBytes: row.file_bytes ?? 0,
        rowCount: row.row_count ?? 0,
        acceptedRows: row.accepted_rows ?? 0,
        rejectedRows: row.rejected_rows ?? 0,
        status: row.status ?? 'complete',
        createdAt: row.created_at,
        createdBy: row.created_by ?? null,
        mappingId: row.mapping_id ?? null,
        notes: row.notes ?? null,
      })),
      importMappings: importMappings.map<ImportMapping>((row) => ({
        id: row.id,
        organizationId: row.organization_id,
        kind: row.kind,
        name: row.name,
        fields: row.fields ?? {},
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at ?? null,
        useCount: row.use_count ?? 0,
      })),
      asOf: latestUsage === '1970-01-01' ? new Date().toISOString().slice(0, 10) : latestUsage,
      employeeMappingRate: resolvedUsers === 0 ? 1 : resolvedUsers / (resolvedUsers + openUnmatched),
      featureMappingRate: features.length === 0 ? 1 : features.length / (features.length + openUnmapped),
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
    const { error } = await db().from('reclaim_campaign_items').upsert(
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
    const { error } = await db().from('decision_items').upsert(
      { organization_id: orgId, id: decisionId, status, owner },
      { onConflict: 'id' },
    );
    if (error !== null) throw new Error(`Failed to update decision: ${error.message}`);
  },

  async createPilotRequest(request: Omit<PilotRequest, 'id' | 'createdAt'>): Promise<PilotRequest> {
    const { data, error } = await db()
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
