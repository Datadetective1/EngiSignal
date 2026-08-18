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

/** Where a customer's upload waits until the worker has written its rows. */
const SOURCE_BUCKET = 'ingestion-sources';

/**
 * How long the worker's capability to read one uploaded file lasts.
 *
 * Ten years. Not because a job might take that long -- they take minutes -- but
 * because the failure this prevents is an import that stalls for a reason
 * unrelated to itself, and there is no benefit to sizing it tightly: the URL
 * covers exactly one object in one tenant, and the row that holds it is behind
 * the same Row Level Security as the import it belongs to.
 */
const SOURCE_URL_TTL_SECONDS = 60 * 60 * 24 * 365 * 10;
/** Times a single round trip so the fixed costs are visible next to the bulk ones. */
async function timed<T>(
  name: string,
  onPhase: CommitInput['onPhase'],
  work: () => Promise<T>,
): Promise<T> {
  const from = performance.now();
  try {
    return await work();
  } finally {
    onPhase?.(name, performance.now() - from);
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
      fileContent,
      parseOptions,
      onPhase,
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
      const { data: prior } = await timed('duplicateCheck', onPhase, async () =>
        (await db())
          .from('imports')
          .select('id')
          .eq('organization_id', organizationId)
          .eq('content_fingerprint', contentFingerprint)
          .eq('status', 'complete')
          .maybeSingle(),
      );
      if (prior !== null) {
        throw new DuplicateImportError((prior.id as string | undefined) ?? null);
      }
    }

    // ── THE EVIDENCE IS DURABLE BEFORE THE JOB EXISTS ─────────────────────
    //
    // The worker that writes the rows may not run for a minute, and will not be
    // this process. It re-reads the customer's own file rather than trusting
    // anything held in memory, so the file has to be stored before there is a
    // job to find it -- otherwise a job could be claimed for evidence that was
    // never saved.
    const sourcePath = `${organizationId}/${importId}`;
    let sourceUrl: string | null = null;
    if (fileContent !== undefined) {
      const upload = await timed('upload:source', onPhase, async () =>
        (await db()).storage.from(SOURCE_BUCKET).upload(sourcePath, fileContent, {
          contentType: 'application/octet-stream',
          upsert: true,
        }),
      );
      if (upload.error !== null) {
        throw new Error(`Could not store the uploaded file: ${upload.error.message}`);
      }

      // ── HOW THE WORKER WILL READ IT ────────────────────────────────────
      //
      // The worker authenticates to Postgres as a role with EXECUTE on six
      // functions and no API key at all, so it cannot call the Storage API.
      // This request can: it is already the person who owns the file. It mints
      // a capability for exactly this one object, and the worker needs no
      // storage privilege of its own.
      //
      // The expiry is deliberately far longer than any job can live. Work is
      // measured in minutes, retries cap at five, and an abandoned job is
      // reaped within a minute -- but an import that failed because its URL
      // lapsed while it sat in a queue would be failing for a reason that has
      // nothing to do with the import. `source_path` is stored alongside so a
      // fresh URL can always be minted by an authenticated request.
      const signed = await timed('sign:source', onPhase, async () =>
        (await db()).storage.from(SOURCE_BUCKET).createSignedUrl(sourcePath, SOURCE_URL_TTL_SECONDS),
      );
      if (signed.error !== null || signed.data === null) {
        throw new Error(
          `Could not prepare the uploaded file for processing: ${signed.error?.message ?? 'no URL returned'}`,
        );
      }
      sourceUrl = signed.data.signedUrl;
    }

    const uploadedAt = new Date().toISOString();
    const { error: importError } = await timed('insert:imports', onPhase, async () =>
      (await db()).from('imports').insert({
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
      // Queued, not importing: the rows are not written yet and nothing is
      // working on them. `importing` now means a worker holds a lease.
      status: 'queued',
      source_path: fileContent !== undefined ? sourcePath : null,
      source_url: sourceUrl,
      parse_options: parseOptions ?? {},
      rows_persisted: 0,
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
      }),
    );

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

    // No canonical rows are written here. At the measured 83 microseconds per
    // row a large import cannot finish inside a request, so the worker writes
    // them afterwards and the customer is told the truth in the meantime: the
    // file is accepted and stored, and nothing is analysed yet.
    return {
      id: importId,
      organizationId,
      fileName,
      fileBytes,
      dataset,
      sourceSystem: result.sourceSystem,
      detectionConfidence,
      detectionFellBack,
      status: 'queued',
      uploadedAt,
      importedAt: null,
      rowsPersisted: 0,
      attempt: 0,
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
    rowsPersisted: Number(row.rows_persisted ?? 0),
    attempt: Number(row.attempt ?? 0),
  };
}

