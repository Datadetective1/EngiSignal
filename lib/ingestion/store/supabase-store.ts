/**
 * The Supabase ingestion store.
 *
 * Isolation is enforced at three layers, matching the rest of the product: RLS
 * in the database, an explicit organization_id filter on every statement here,
 * and the required orgId argument in the IngestionStore signature.
 *
 * COMMIT SEMANTICS
 *
 * The JS client has no multi-statement transaction, so commit is ordered to be
 * safe without one:
 *
 *   1. Insert the import row as `importing`.
 *   2. Insert canonical rows in chunks.
 *   3. On any failure, delete the import row — which cascades to every row it
 *      wrote — and surface the error. Nothing half-imported survives.
 *   4. Only then mark the import `complete`.
 *
 * A reader therefore never sees a `complete` import whose records are missing,
 * and a failed import leaves no partial data behind.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { userClient } from '@/lib/supabase/server';
import type {
  CanonicalContractRecord,
  CanonicalEntitlementRecord,
  CanonicalPersonRecord,
  CanonicalUsageRecord,
  IngestionWarning,
  QualityReport,
  SourceSystem,
} from '../canonical/types';
import type {
  CommitInput,
  CoverageSummary,
  ImportDetail,
  ImportLifecycle,
  ImportSummary,
  IngestionStore,
  StoredRowCounts,
} from './types';
import type { ProjectionRecord } from '@/lib/analytics/projection';
import { DuplicateImportError, summarizeCoverage } from './types';
import { isDuplicateImportError } from '../fingerprint';
import { readAllRows, readAllRowsByCursor } from './paging';
export { hasSupabaseEnv } from '@/lib/supabase/server';
/**
 * The request-scoped client.
 *
 * Carries the signed-in user's JWT, so every statement below is additionally
 * governed by Row Level Security. The previous implementation used a bare anon
 * client with no session: `auth.uid()` was null, every policy evaluated false,
 * and nothing was readable at all. Isolation is therefore enforced twice - by
 * the explicit organization_id filter here, and by the database itself.
 */
async function db(): Promise<SupabaseClient> {
  return userClient();
}
/** Chunked so a large import does not exceed request limits. */
const INSERT_CHUNK = 500;
async function insertChunked(table: string, rows: Record<string, unknown>[]): Promise<void> {
  for (let index = 0; index < rows.length; index += INSERT_CHUNK) {
    const chunk = rows.slice(index, index + INSERT_CHUNK);
    const { error } = await (await db()).from(table).insert(chunk);
    if (error !== null) throw new Error(`${table}: ${error.message}`);
  }
}
export const supabaseIngestionStore: IngestionStore = {
  kind: 'supabase',
  async commitImport(input: CommitInput): Promise<ImportSummary> {
    const {
      organizationId,
      importId,
      fileName,
      fileBytes,
      dataset,
      result,
      detectionConfidence,
      detectionEvidence,
      detectionFellBack,
      sourceSheets,
      mappingUsed,
      contentFingerprint,
    } = input;
    // Every family, including contracts — which carry the money, and were
    // missed when the commercial dataset was added.
    for (const record of [
      ...result.usage,
      ...result.entitlements,
      ...result.people,
      ...result.contracts,
    ]) {
      if (record.provenance.organizationId !== organizationId) {
        throw new Error('Refusing to commit records belonging to another organization.');
      }
    }
    // Checked BEFORE inserting anything. The unique index is partial on
    // status='complete', so without this the collision only surfaces on the
    // final status update — after every canonical row has been written and
    // then rolled back. Correct, but wasteful and it surfaced a raw database
    // message to the caller instead of a clean duplicate response.
    if (contentFingerprint !== undefined) {
      const { data: prior } = await (await db())
        .from('imports')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('content_fingerprint', contentFingerprint)
        .eq('status', 'complete')
        .maybeSingle();
      if (prior !== null) {
        throw new DuplicateImportError((prior.id as string | undefined) ?? null);
      }
    }

    const uploadedAt = new Date().toISOString();
    const { error: importError } = await (await db()).from('imports').insert({
      id: importId,
      organization_id: organizationId,
      // The legacy template enum still constrains this column; canonical
      // datasets are recorded in `dataset` alongside it.
      kind:
        dataset === 'people'
          ? 'employees'
          : dataset === 'entitlements' || dataset === 'contracts'
            ? 'contracts'
            : 'usage',
      dataset,
      source_system: result.sourceSystem,
      file_name: fileName,
      file_bytes: fileBytes,
      row_count: result.totalRows,
      accepted_rows: result.acceptedRows,
      rejected_rows: result.rejectedRows,
      duplicate_rows: result.duplicateRows,
      status: 'importing',
      detection_confidence: detectionConfidence,
      detection_evidence: detectionEvidence,
      detection_fell_back: detectionFellBack,
      source_sheets: sourceSheets,
      mapping_used: mappingUsed,
      warnings: result.warnings,
      quality: result.quality,
      usage_records: result.usage.length,
      entitlement_records: result.entitlements.length,
      people_records: result.people.length,
      contract_records: result.contracts.length,
      uploaded_at: uploadedAt,
      content_fingerprint: contentFingerprint ?? null,
    });

    if (importError !== null) {
      // A unique violation on the fingerprint index means this exact content,
      // dataset and mapping is already committed. That is a duplicate upload,
      // not a failure, and must not double-count demand.
      if (isDuplicateImportError(importError)) {
        const { data: existing } = await (await db())
          .from('imports')
          .select('id')
          .eq('organization_id', organizationId)
          .eq('content_fingerprint', contentFingerprint ?? '')
          .maybeSingle();
        throw new DuplicateImportError((existing?.id as string | undefined) ?? null);
      }
      throw new Error(`Could not record the import: ${importError.message}`);
    }

    try {
      await insertChunked(
        'ingestion_usage',
        result.usage.map((record) => ({
          organization_id: organizationId,
          import_id: importId,
          usage_date: record.date,
          hour: record.hour,
          observed_at: record.observedAt,
          raw_user: record.user,
          employee_code: record.employeeCode,
          raw_feature: record.feature,
          raw_product: record.product,
          raw_vendor: record.vendor,
          quantity: record.quantity,
          concurrent: record.concurrent,
          peak: record.peak,
          available: record.available,
          duration_hours: record.durationHours,
          checkout_at: record.checkoutAt,
          checkin_at: record.checkinAt,
          denied: record.denied,
          denial_count: record.denialCount,
          license_server: record.licenseServer,
          pool: record.pool,
          tokens: record.tokens,
          source_system: record.provenance.sourceSystem,
          source_file: record.provenance.sourceFile,
          source_sheet: record.provenance.sourceSheet,
          source_row: record.provenance.sourceRow,
        })),
      );
      await insertChunked(
        'ingestion_entitlements',
        result.entitlements.map((record) => ({
          organization_id: organizationId,
          import_id: importId,
          raw_feature: record.feature,
          raw_product: record.product,
          raw_vendor: record.vendor,
          entitled_quantity: record.entitledQuantity,
          license_model: record.licenseModel,
          license_server: record.licenseServer,
          pool: record.pool,
          expires_on: record.expiresOn,
          source_system: record.provenance.sourceSystem,
          source_file: record.provenance.sourceFile,
          source_sheet: record.provenance.sourceSheet,
          source_row: record.provenance.sourceRow,
        })),
      );
      await insertChunked(
        'ingestion_people',
        result.people.map((record) => ({
          organization_id: organizationId,
          import_id: importId,
          raw_user: record.user,
          employee_code: record.employeeCode,
          display_name: record.displayName,
          email: record.email,
          employment_status: record.employmentStatus,
          employment_type: record.employmentType,
          manager_name: record.managerName,
          manager_key: record.managerKey,
          department: record.department,
          organization: record.organization,
          business_unit: record.businessUnit,
          program: record.program,
          discipline: record.discipline,
          competency: record.competency,
          location: record.location,
          region: record.region,
          cost_center: record.costCenter,
          source_system: record.provenance.sourceSystem,
          source_file: record.provenance.sourceFile,
          source_sheet: record.provenance.sourceSheet,
          source_row: record.provenance.sourceRow,
        })),
      );
      await insertChunked(
        'ingestion_contracts',
        result.contracts.map((record) => ({
          organization_id: organizationId,
          import_id: importId,
          raw_feature: record.feature,
          raw_product: record.product,
          raw_vendor: record.vendor,
          sku: record.sku,
          contract_number: record.contractNumber,
          agreement_number: record.agreementNumber,
          purchase_order: record.purchaseOrder,
          supplier: record.supplier,
          quantity: record.quantity,
          unit_price: record.unitPrice,
          total_cost: record.totalCost,
          annual_cost: record.annualCost,
          currency: record.currency,
          license_model: record.licenseModel,
          pricing_unit: record.pricingUnit,
          contract_start_date: record.contractStartDate,
          contract_end_date: record.contractEndDate,
          renewal_date: record.renewalDate,
          business_unit: record.businessUnit,
          cost_center: record.costCenter,
          owner: record.owner,
          notes: record.notes,
          unit_price_basis: record.unitPriceBasis,
          annual_cost_basis: record.annualCostBasis,
          multi_year_total: record.multiYearTotal,
          source_system: record.provenance.sourceSystem,
          source_file: record.provenance.sourceFile,
          source_sheet: record.provenance.sourceSheet,
          source_row: record.provenance.sourceRow,
        })),
      );
      // Rejections are audit records, never analytical ones.
      await insertChunked(
        'ingestion_rejections',
        result.rejections.slice(0, 5000).map((rejection) => ({
          organization_id: organizationId,
          import_id: importId,
          source_sheet: rejection.sourceSheet,
          source_row: rejection.sourceRow,
          rule: rejection.rule,
          field: rejection.field,
          value: rejection.value,
          message: rejection.message,
        })),
      );
    } catch (error) {
      // Cascade removes every row this import wrote.
      await (await db()).from('imports').delete().eq('id', importId).eq('organization_id', organizationId);
      throw error instanceof Error ? error : new Error('The import could not be stored.');
    }
    const importedAt = new Date().toISOString();
    const { error: finalizeError } = await (await db())
      .from('imports')
      .update({ status: 'complete', imported_at: importedAt })
      .eq('id', importId)
      .eq('organization_id', organizationId);
    if (finalizeError !== null) {
      await (await db()).from('imports').delete().eq('id', importId).eq('organization_id', organizationId);
      // Two commits of the same content racing: the loser lands here. It is a
      // duplicate, not a server error, and the rows it wrote are already gone.
      if (isDuplicateImportError(finalizeError)) {
        throw new DuplicateImportError(null);
      }
      throw new Error(`Could not finalize the import: ${finalizeError.message}`);
    }
    return {
      id: importId,
      organizationId,
      fileName,
      fileBytes,
      dataset,
      sourceSystem: result.sourceSystem,
      detectionConfidence,
      detectionFellBack,
      status: 'complete',
      uploadedAt,
      importedAt,
      totalRows: result.totalRows,
      acceptedRows: result.acceptedRows,
      rejectedRows: result.rejectedRows,
      duplicateRows: result.duplicateRows,
      usageRecords: result.usage.length,
      entitlementRecords: result.entitlements.length,
      peopleRecords: result.people.length,
      contractRecords: result.contracts.length,
      failureReason: null,
    };
  },
  async listImports(orgId: string): Promise<ImportSummary[]> {
    // Paged for the same reason the canonical reads are: a truncated import
    // history hides imports the customer can no longer find to delete.
    const client = await db();
    const data = await readAllRows<Record<string, unknown>>(() =>
      client
        .from('imports')
        .select('*')
        .eq('organization_id', orgId)
        .order('uploaded_at', { ascending: false }),
    );
    return data.map(rowToSummary);
  },
  async getImport(orgId: string, importId: string): Promise<ImportDetail | null> {
    const { data, error } = await (await db())
      .from('imports')
      .select('*')
      .eq('organization_id', orgId)
      .eq('id', importId)
      .maybeSingle();
    if (error !== null) throw new Error(error.message);
    if (data === null) return null;
    const { data: rejections } = await (await db())
      .from('ingestion_rejections')
      .select('source_sheet, source_row, rule, field, value, message')
      .eq('organization_id', orgId)
      .eq('import_id', importId)
      .order('source_row', { ascending: true })
      .limit(200);
    return {
      ...rowToSummary(data),
      contentFingerprint: (data.content_fingerprint ?? null) as string | null,
      detectionEvidence: asStringArray(data.detection_evidence),
      sourceSheets: asStringArray(data.source_sheets),
      mappingUsed: (data.mapping_used ?? {}) as Record<string, string>,
      warnings: (data.warnings ?? []) as IngestionWarning[],
      quality: (data.quality ?? null) as QualityReport | null,
      rejections: (rejections ?? []).map((row) => ({
        sourceSheet: row.source_sheet as string | null,
        sourceRow: row.source_row as number,
        rule: row.rule as string,
        field: row.field as string | null,
        value: row.value as string | null,
        message: row.message as string,
      })),
    };
  },
  async deleteImport(orgId: string, importId: string): Promise<boolean> {
    // Scoped by organization as well as id: an id alone must never be enough
    // to reach another tenant's import.
    const { data, error } = await (await db())
      .from('imports')
      .delete()
      .eq('organization_id', orgId)
      .eq('id', importId)
      .select('id');
    if (error !== null) throw new Error(error.message);
    return (data ?? []).length > 0;
  },
  async countStoredRows(orgId: string): Promise<StoredRowCounts> {
    // Counted BY THE DATABASE, which is the whole point: counting the length of
    // a read that might itself have been truncated is the Phase 2C defect
    // reproduced inside its own detector.
    //
    // Done through count_canonical_rows rather than four `head: true` selects.
    // Row Level Security evaluates the membership predicate PER ROW, so an
    // exact count over 67,267 usage rows answered the same question 67,267
    // times and cost 1,464 ms - measured in production, and the entire
    // remaining cost of a page view. The function checks membership once, from
    // auth.uid(), then counts: same numbers, ~150 ms, one round trip instead of
    // four.
    const { data, error } = await (await db()).rpc('count_canonical_rows', { org: orgId });
    if (error !== null) throw new Error(`count_canonical_rows: ${error.message}`);

    const counts = (data ?? {}) as Partial<Record<keyof StoredRowCounts, number>>;
    const required: (keyof StoredRowCounts)[] = ['usage', 'people', 'entitlements', 'contracts'];
    for (const key of required) {
      // A missing count must never read as zero. Zero stored rows and "the
      // count did not come back" are different facts, and the integrity gate
      // would report the second as a healthy empty estate.
      if (typeof counts[key] !== 'number') {
        throw new Error(`count_canonical_rows returned no ${key} count.`);
      }
    }

    return {
      usage: counts.usage as number,
      people: counts.people as number,
      entitlements: counts.entitlements as number,
      contracts: counts.contracts as number,
    };
  },
  async listUsage(orgId, options): Promise<CanonicalUsageRecord[]> {
    const client = await db();
    const data = await readAllRowsByCursor<Record<string, unknown> & { id: number }>(
      (afterId, size) => {
        let query = client.from('ingestion_usage').select('*').eq('organization_id', orgId);
        if (options?.importId !== undefined) query = query.eq('import_id', options.importId);
        // Ordered by id so the cursor means something; see paging.ts.
        return query.gt('id', afterId).order('id', { ascending: true }).limit(size);
      }, { limit: options?.limit },
    );
    return data.map((row) => ({
      date: row.usage_date as string,
      hour: row.hour as number | null,
      observedAt: row.observed_at as string | null,
      user: row.raw_user as string | null,
      employeeCode: row.employee_code as string | null,
      feature: row.raw_feature as string,
      product: row.raw_product as string | null,
      vendor: row.raw_vendor as string | null,
      quantity: row.quantity as number | null,
      concurrent: row.concurrent as number | null,
      peak: row.peak as number | null,
      available: row.available as number | null,
      durationHours: numberOrNull(row.duration_hours),
      checkoutAt: row.checkout_at as string | null,
      checkinAt: row.checkin_at as string | null,
      denied: row.denied as boolean | null,
      denialCount: row.denial_count as number | null,
      licenseServer: row.license_server as string | null,
      pool: row.pool as string | null,
      tokens: numberOrNull(row.tokens),
      provenance: {
        organizationId: row.organization_id as string,
        importId: row.import_id as string,
        importedAt: row.created_at as string,
        sourceFile: row.source_file as string,
        sourceSystem: row.source_system as SourceSystem,
        sourceSheet: row.source_sheet as string | null,
        sourceRow: row.source_row as number,
      },
    }));
  },
  async listEntitlements(orgId, options): Promise<CanonicalEntitlementRecord[]> {
    const client = await db();
    const data = await readAllRowsByCursor<Record<string, unknown> & { id: number }>(
      (afterId, size) => {
        let query = client.from('ingestion_entitlements').select('*').eq('organization_id', orgId);
        if (options?.importId !== undefined) query = query.eq('import_id', options.importId);
        // Ordered by id so the cursor means something; see paging.ts.
        return query.gt('id', afterId).order('id', { ascending: true }).limit(size);
      },
    );
    return data.map((row) => ({
      feature: row.raw_feature as string,
      product: row.raw_product as string | null,
      vendor: row.raw_vendor as string | null,
      entitledQuantity: row.entitled_quantity as number | null,
      licenseModel: row.license_model as CanonicalEntitlementRecord['licenseModel'],
      licenseServer: row.license_server as string | null,
      pool: row.pool as string | null,
      expiresOn: row.expires_on as string | null,
      provenance: {
        organizationId: row.organization_id as string,
        importId: row.import_id as string,
        importedAt: row.created_at as string,
        sourceFile: row.source_file as string,
        sourceSystem: row.source_system as SourceSystem,
        sourceSheet: row.source_sheet as string | null,
        sourceRow: row.source_row as number,
      },
    }));
  },
  async listPeople(orgId, options): Promise<CanonicalPersonRecord[]> {
    const client = await db();
    const data = await readAllRowsByCursor<Record<string, unknown> & { id: number }>(
      (afterId, size) => {
        let query = client.from('ingestion_people').select('*').eq('organization_id', orgId);
        if (options?.importId !== undefined) query = query.eq('import_id', options.importId);
        // Ordered by id so the cursor means something; see paging.ts.
        return query.gt('id', afterId).order('id', { ascending: true }).limit(size);
      },
    );
    return data.map((row) => ({
      user: row.raw_user as string,
      employeeCode: row.employee_code as string | null,
      displayName: row.display_name as string | null,
      email: row.email as string | null,
      employmentStatus: row.employment_status as string | null,
      employmentType: row.employment_type as string | null,
      managerName: row.manager_name as string | null,
      managerKey: row.manager_key as string | null,
      department: row.department as string | null,
      organization: row.organization as string | null,
      businessUnit: row.business_unit as string | null,
      program: row.program as string | null,
      discipline: row.discipline as string | null,
      competency: row.competency as string | null,
      location: row.location as string | null,
      region: row.region as string | null,
      costCenter: row.cost_center as string | null,
      provenance: {
        organizationId: row.organization_id as string,
        importId: row.import_id as string,
        importedAt: row.created_at as string,
        sourceFile: row.source_file as string,
        sourceSystem: row.source_system as SourceSystem,
        sourceSheet: row.source_sheet as string | null,
        sourceRow: row.source_row as number,
      },
    }));
  },
  async listContracts(orgId, options): Promise<CanonicalContractRecord[]> {
    const client = await db();
    const data = await readAllRowsByCursor<Record<string, unknown> & { id: number }>(
      (afterId, size) => {
        let query = client.from('ingestion_contracts').select('*').eq('organization_id', orgId);
        if (options?.importId !== undefined) query = query.eq('import_id', options.importId);
        // Ordered by id so the cursor means something; see paging.ts.
        return query.gt('id', afterId).order('id', { ascending: true }).limit(size);
      },
    );
    return data.map((row) => ({
      feature: row.raw_feature as string,
      product: row.raw_product as string | null,
      vendor: row.raw_vendor as string | null,
      sku: row.sku as string | null,
      contractNumber: row.contract_number as string | null,
      agreementNumber: row.agreement_number as string | null,
      purchaseOrder: row.purchase_order as string | null,
      supplier: row.supplier as string | null,
      quantity: numberOrNull(row.quantity),
      // Postgres returns numeric as a string to preserve exactness. Coercing
      // through Number here rather than trusting the driver keeps money out of
      // string concatenation, where "5000" + 1 becomes "50001".
      unitPrice: numberOrNull(row.unit_price),
      totalCost: numberOrNull(row.total_cost),
      annualCost: numberOrNull(row.annual_cost),
      currency: row.currency as string | null,
      licenseModel: row.license_model as CanonicalContractRecord['licenseModel'],
      pricingUnit: row.pricing_unit as string | null,
      contractStartDate: row.contract_start_date as string | null,
      contractEndDate: row.contract_end_date as string | null,
      renewalDate: row.renewal_date as string | null,
      businessUnit: row.business_unit as string | null,
      costCenter: row.cost_center as string | null,
      owner: row.owner as string | null,
      notes: row.notes as string | null,
      unitPriceBasis: row.unit_price_basis as CanonicalContractRecord['unitPriceBasis'],
      annualCostBasis: row.annual_cost_basis as CanonicalContractRecord['annualCostBasis'],
      multiYearTotal: Boolean(row.multi_year_total),
      provenance: {
        organizationId: row.organization_id as string,
        importId: row.import_id as string,
        importedAt: row.created_at as string,
        sourceFile: row.source_file as string,
        sourceSystem: row.source_system as SourceSystem,
        sourceSheet: row.source_sheet as string | null,
        sourceRow: row.source_row as number,
      },
    }));
  },
  async getCoverage(orgId: string): Promise<CoverageSummary> {
    const [usage, entitlements, people, contracts] = await Promise.all([
      this.listUsage(orgId),
      this.listEntitlements(orgId),
      this.listPeople(orgId),
      this.listContracts(orgId),
    ]);
    return summarizeCoverage(usage, entitlements, people, contracts);
  },

  async countConfirmations(orgId: string): Promise<{ count: number; latest: string | null }> {
    // One round trip, not two: the exact count and the newest decision come
    // back together. Every extra query here is paid on every page view.
    const { data, count, error } = await (await db())
      .from('identity_confirmations')
      .select('decided_at', { count: 'exact' })
      .eq('organization_id', orgId)
      .order('decided_at', { ascending: false })
      .limit(1);
    if (error !== null) throw new Error(`identity_confirmations: ${error.message}`);

    const latest = data?.[0]?.decided_at;
    return { count: count ?? 0, latest: typeof latest === 'string' ? latest : null };
  },

  async readProjection(orgId: string): Promise<ProjectionRecord | null> {
    const { data, error } = await (await db())
      .from('analytics_projections')
      .select('*')
      .eq('organization_id', orgId)
      .maybeSingle();

    // A projection that cannot be read is a cache miss, never a page failure:
    // the canonical rows are still there and still authoritative.
    if (error !== null || data === null) return null;

    return {
      version: Number(data.version),
      evidenceKey: data.evidence_key === null ? null : String(data.evidence_key),
      computedAt: data.computed_at === null ? null : String(data.computed_at),
      buildMs: data.build_ms === null ? null : Number(data.build_ms),
      storedRows: data.stored_rows as ProjectionRecord['storedRows'],
      analyzedRows: data.analyzed_rows as ProjectionRecord['analyzedRows'],
      // Null while a first build is still in flight. Never coerced to '': an
      // empty payload deserializes into an empty analysis, which is the
      // absence-read-as-zero failure this product exists to refuse.
      payload: data.payload === null ? null : String(data.payload),
      payloadBytes: data.payload_bytes === null ? null : Number(data.payload_bytes),
      state: (data.state ?? 'ready') as ProjectionRecord['state'],
      buildingEvidenceKey: data.building_evidence_key === null ? null : String(data.building_evidence_key),
      buildStartedAt: data.build_started_at === null ? null : String(data.build_started_at),
      buildFinishedAt: data.build_finished_at === null ? null : String(data.build_finished_at),
      buildAttempt: Number(data.build_attempt ?? 0),
      buildError: data.build_error === null ? null : String(data.build_error),
      heartbeatAt: data.heartbeat_at === null ? null : String(data.heartbeat_at),
    };
  },

  async writeProjection(orgId: string, record: ProjectionRecord): Promise<void> {
    const { error } = await (await db()).from('analytics_projections').upsert(
      {
        organization_id: orgId,
        version: record.version,
        evidence_key: record.evidenceKey,
        computed_at: record.computedAt,
        build_ms: record.buildMs,
        stored_rows: record.storedRows,
        analyzed_rows: record.analyzedRows,
        payload: record.payload,
        payload_bytes: record.payloadBytes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'organization_id' },
    );
    // Failing to STORE a projection must not fail the request that computed it.
    // The answer is already correct; only the next read is slower.
    if (error !== null) return;
  },

  async clearProjection(orgId: string): Promise<void> {
    await (await db()).from('analytics_projections').delete().eq('organization_id', orgId);
  },
};
function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}
function rowToSummary(row: Record<string, unknown>): ImportSummary {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    fileName: row.file_name as string,
    fileBytes: Number(row.file_bytes ?? 0),
    dataset: (row.dataset ?? 'usage') as ImportSummary['dataset'],
    sourceSystem: (row.source_system ?? 'generic') as SourceSystem,
    detectionConfidence: Number(row.detection_confidence ?? 0),
    detectionFellBack: Boolean(row.detection_fell_back),
    status: (row.status ?? 'complete') as ImportLifecycle,
    uploadedAt: (row.uploaded_at ?? row.created_at) as string,
    importedAt: (row.imported_at ?? null) as string | null,
    totalRows: Number(row.row_count ?? 0),
    acceptedRows: Number(row.accepted_rows ?? 0),
    rejectedRows: Number(row.rejected_rows ?? 0),
    duplicateRows: Number(row.duplicate_rows ?? 0),
    usageRecords: Number(row.usage_records ?? 0),
    entitlementRecords: Number(row.entitlement_records ?? 0),
    peopleRecords: Number(row.people_records ?? 0),
    contractRecords: Number(row.contract_records ?? 0),
    failureReason: (row.failure_reason ?? null) as string | null,
  };
}

