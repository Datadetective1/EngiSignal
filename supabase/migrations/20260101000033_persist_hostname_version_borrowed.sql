-- ============================================================================
-- Actually store hostname, version and borrowed.
--
-- Migration 32 added the columns. This is the other half, and without it the
-- product would have had a particularly nasty shape of bug: the parser reads
-- the hostname, the mapping screen shows it mapped, the accept count includes
-- it, and `persist_import_slice` — which names its columns explicitly — drops
-- it on the floor. EngiSignal would have told a customer it had captured
-- something it had not.
--
-- The column list is exhaustive by design rather than `insert ... select *`:
-- it means a future column is a deliberate edit here instead of an accident.
-- That is a good property, and the cost of it is exactly this migration.
--
-- Only the `usage` branch changes. Entitlements, people and contracts are
-- reproduced byte-for-byte from the deployed definition so this is a targeted
-- replacement rather than a rewrite.
-- ============================================================================

create or replace function public.persist_import_slice(
  job uuid,
  token uuid,
  rows jsonb,
  expected_from integer
)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  org uuid;
  ds public.canonical_dataset;
  current_mark integer;
  sent integer := jsonb_array_length(rows);
begin
  select i.organization_id, i.dataset, i.rows_persisted
    into org, ds, current_mark
  from public.imports i
  where i.id = job
    and i.worker_token = token
    and i.status = 'importing'
    and i.lease_expires_at > now()
  for update;

  if org is null then
    return -1;
  end if;

  if current_mark <> expected_from then
    return -2;
  end if;

  if ds = 'usage' then
    insert into public.ingestion_usage (
      organization_id, import_id, usage_date, hour, observed_at, raw_user,
      employee_code, raw_feature, raw_product, raw_vendor, quantity, concurrent,
      peak, available, duration_hours, checkout_at, checkin_at, denied,
      denial_count, license_server, pool, tokens, hostname, version, borrowed,
      source_system, source_file, source_sheet, source_row
    )
    select org, job, r.usage_date, r.hour, r.observed_at, r.raw_user,
           r.employee_code, r.raw_feature, r.raw_product, r.raw_vendor,
           r.quantity, r.concurrent, r.peak, r.available, r.duration_hours,
           r.checkout_at, r.checkin_at, r.denied, r.denial_count,
           r.license_server, r.pool, r.tokens, r.hostname, r.version,
           r.borrowed, r.source_system, r.source_file, r.source_sheet,
           r.source_row
    from jsonb_populate_recordset(null::public.ingestion_usage, rows) as r
    on conflict do nothing;

  elsif ds = 'entitlements' then
    insert into public.ingestion_entitlements (
      organization_id, import_id, raw_feature, raw_product, raw_vendor,
      entitled_quantity, license_model, license_server, pool, expires_on,
      source_system, source_file, source_sheet, source_row
    )
    select org, job, r.raw_feature, r.raw_product, r.raw_vendor,
           r.entitled_quantity, r.license_model, r.license_server, r.pool,
           r.expires_on, r.source_system, r.source_file, r.source_sheet,
           r.source_row
    from jsonb_populate_recordset(null::public.ingestion_entitlements, rows) as r
    on conflict do nothing;

  elsif ds = 'people' then
    insert into public.ingestion_people (
      organization_id, import_id, raw_user, employee_code, display_name, email,
      source_system, source_file, source_sheet, source_row, employment_status,
      employment_type, manager_name, manager_key, department, organization,
      business_unit, program, discipline, competency, location, region,
      cost_center
    )
    select org, job, r.raw_user, r.employee_code, r.display_name, r.email,
           r.source_system, r.source_file, r.source_sheet, r.source_row,
           r.employment_status, r.employment_type, r.manager_name,
           r.manager_key, r.department, r.organization, r.business_unit,
           r.program, r.discipline, r.competency, r.location, r.region,
           r.cost_center
    from jsonb_populate_recordset(null::public.ingestion_people, rows) as r
    on conflict do nothing;

  elsif ds = 'contracts' then
    insert into public.ingestion_contracts (
      organization_id, import_id, raw_feature, raw_product, raw_vendor, sku,
      contract_number, agreement_number, purchase_order, supplier, quantity,
      unit_price, total_cost, annual_cost, currency, license_model,
      pricing_unit, contract_start_date, contract_end_date, renewal_date,
      business_unit, cost_center, owner, notes, unit_price_basis,
      annual_cost_basis, multi_year_total, source_system, source_file,
      source_sheet, source_row
    )
    select org, job, r.raw_feature, r.raw_product, r.raw_vendor, r.sku,
           r.contract_number, r.agreement_number, r.purchase_order, r.supplier,
           r.quantity, r.unit_price, r.total_cost, r.annual_cost, r.currency,
           r.license_model, r.pricing_unit, r.contract_start_date,
           r.contract_end_date, r.renewal_date, r.business_unit, r.cost_center,
           r.owner, r.notes, r.unit_price_basis, r.annual_cost_basis,
           r.multi_year_total, r.source_system, r.source_file, r.source_sheet,
           r.source_row
    from jsonb_populate_recordset(null::public.ingestion_contracts, rows) as r
    on conflict do nothing;
  else
    raise exception 'Unknown dataset % for import %', ds, job;
  end if;

  update public.imports
  set rows_persisted = expected_from + sent,
      heartbeat_at = now(),
      lease_expires_at = greatest(lease_expires_at, now() + interval '30 seconds')
  where id = job;

  return expected_from + sent;
end;
$function$;
