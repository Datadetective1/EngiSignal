-- ── LOADING ROWS AS A SET, NOT AS A SENTENCE ────────────────────────────────
--
-- Measured against production at 68,008 rows, twice, through the deployed
-- product:
--
--   chunk 500    135 round trips    117.6 ms each    15,875 ms total
--   chunk 5,000   14 round trips   2,787.0 ms each   39,028 ms total
--
-- Ten times the rows per request cost 23.7 times the time. That is the shape
-- that matters: per-request cost grows as roughly n^2.2, so total time gets
-- WORSE as the chunk gets bigger, and the obvious optimisation -- send more
-- rows at once -- is the wrong one. A first attempt at exactly that shipped
-- and made production two and a half times slower.
--
-- The cause is not the database doing more work per row. It is the SQL text.
-- PostgREST turns an array of N rows into one INSERT carrying N tuples of
-- literals, and the cost of parsing and planning that statement grows faster
-- than N. Meanwhile the actual insert is cheap: 500 rows cost about ten
-- milliseconds more than one.
--
-- So the rows travel as DATA instead of as syntax. One jsonb parameter, one
-- statement of fixed size however many rows it carries, and the expansion done
-- by the database with jsonb_populate_recordset. Parse and plan cost stop
-- depending on the batch at all.
--
-- SECURITY INVOKER -- the default, stated here because it is load-bearing.
-- These run as the calling user, so every row inserted is still checked by the
-- same Row Level Security policy that governs a single-row insert. Making them
-- SECURITY DEFINER would have made the implementation no easier and would have
-- handed the ingestion path a standing capability to write into any tenant.

-- `organization_id` is taken from the argument rather than trusted from the
-- payload. A caller who mixed two tenants' rows into one array would otherwise
-- have them inserted as sent, and RLS would only object to the rows that
-- happen to name someone else -- so the column is overwritten, not validated.
create or replace function public.bulk_insert_usage(rows jsonb, org uuid, imp uuid)
returns integer
language sql
as $$
  with inserted as (
    insert into public.ingestion_usage (
      organization_id, import_id, usage_date, hour, observed_at, raw_user,
      employee_code, raw_feature, raw_product, raw_vendor, quantity, concurrent,
      peak, available, duration_hours, checkout_at, checkin_at, denied,
      denial_count, license_server, pool, tokens, source_system, source_file,
      source_sheet, source_row
    )
    select
      org, imp, r.usage_date, r.hour, r.observed_at, r.raw_user,
      r.employee_code, r.raw_feature, r.raw_product, r.raw_vendor, r.quantity,
      r.concurrent, r.peak, r.available, r.duration_hours, r.checkout_at,
      r.checkin_at, r.denied, r.denial_count, r.license_server, r.pool,
      r.tokens, r.source_system, r.source_file, r.source_sheet, r.source_row
    from jsonb_populate_recordset(null::public.ingestion_usage, rows) as r
    returning 1
  )
  select count(*)::integer from inserted;
$$;

create or replace function public.bulk_insert_entitlements(rows jsonb, org uuid, imp uuid)
returns integer
language sql
as $$
  with inserted as (
    insert into public.ingestion_entitlements (
      organization_id, import_id, raw_feature, raw_product, raw_vendor,
      entitled_quantity, license_model, license_server, pool, expires_on,
      source_system, source_file, source_sheet, source_row
    )
    select
      org, imp, r.raw_feature, r.raw_product, r.raw_vendor,
      r.entitled_quantity, r.license_model, r.license_server, r.pool,
      r.expires_on, r.source_system, r.source_file, r.source_sheet, r.source_row
    from jsonb_populate_recordset(null::public.ingestion_entitlements, rows) as r
    returning 1
  )
  select count(*)::integer from inserted;
$$;

create or replace function public.bulk_insert_people(rows jsonb, org uuid, imp uuid)
returns integer
language sql
as $$
  with inserted as (
    insert into public.ingestion_people (
      organization_id, import_id, raw_user, employee_code, display_name, email,
      source_system, source_file, source_sheet, source_row, employment_status,
      employment_type, manager_name, manager_key, department, organization,
      business_unit, program, discipline, competency, location, region,
      cost_center
    )
    select
      org, imp, r.raw_user, r.employee_code, r.display_name, r.email,
      r.source_system, r.source_file, r.source_sheet, r.source_row,
      r.employment_status, r.employment_type, r.manager_name, r.manager_key,
      r.department, r.organization, r.business_unit, r.program, r.discipline,
      r.competency, r.location, r.region, r.cost_center
    from jsonb_populate_recordset(null::public.ingestion_people, rows) as r
    returning 1
  )
  select count(*)::integer from inserted;
$$;

create or replace function public.bulk_insert_contracts(rows jsonb, org uuid, imp uuid)
returns integer
language sql
as $$
  with inserted as (
    insert into public.ingestion_contracts (
      organization_id, import_id, raw_feature, raw_product, raw_vendor, sku,
      contract_number, agreement_number, purchase_order, supplier, quantity,
      unit_price, total_cost, annual_cost, currency, license_model,
      pricing_unit, contract_start_date, contract_end_date, renewal_date,
      business_unit, cost_center, owner, notes, unit_price_basis,
      annual_cost_basis, multi_year_total, source_system, source_file,
      source_sheet, source_row
    )
    select
      org, imp, r.raw_feature, r.raw_product, r.raw_vendor, r.sku,
      r.contract_number, r.agreement_number, r.purchase_order, r.supplier,
      r.quantity, r.unit_price, r.total_cost, r.annual_cost, r.currency,
      r.license_model, r.pricing_unit, r.contract_start_date,
      r.contract_end_date, r.renewal_date, r.business_unit, r.cost_center,
      r.owner, r.notes, r.unit_price_basis, r.annual_cost_basis,
      r.multi_year_total, r.source_system, r.source_file, r.source_sheet,
      r.source_row
    from jsonb_populate_recordset(null::public.ingestion_contracts, rows) as r
    returning 1
  )
  select count(*)::integer from inserted;
$$;

create or replace function public.bulk_insert_rejections(rows jsonb, org uuid, imp uuid)
returns integer
language sql
as $$
  with inserted as (
    insert into public.ingestion_rejections (
      organization_id, import_id, source_sheet, source_row, rule, field, value,
      message
    )
    select
      org, imp, r.source_sheet, r.source_row, r.rule, r.field, r.value,
      r.message
    from jsonb_populate_recordset(null::public.ingestion_rejections, rows) as r
    returning 1
  )
  select count(*)::integer from inserted;
$$;

-- The count comes back so the caller can assert that what the database accepted
-- equals what it sent. A short insert would otherwise be silent, and a silently
-- short import is the failure this codebase exists to refuse.
comment on function public.bulk_insert_usage(jsonb, uuid, uuid) is
  'Set-based insert. Returns rows written so the caller can reconcile against rows sent.';

-- Supabase's default privileges grant EXECUTE to anon and authenticated at
-- creation time, directly rather than through PUBLIC, so revoking from PUBLIC
-- alone leaves anon still able to call these. RLS would refuse an anonymous
-- caller every row -- there is no membership to satisfy the policy with -- but
-- a bulk loader should not be reachable without a session at all.
revoke execute on function public.bulk_insert_usage(jsonb, uuid, uuid) from anon;
revoke execute on function public.bulk_insert_entitlements(jsonb, uuid, uuid) from anon;
revoke execute on function public.bulk_insert_people(jsonb, uuid, uuid) from anon;
revoke execute on function public.bulk_insert_contracts(jsonb, uuid, uuid) from anon;
revoke execute on function public.bulk_insert_rejections(jsonb, uuid, uuid) from anon;

revoke all on function public.bulk_insert_usage(jsonb, uuid, uuid) from public;
revoke all on function public.bulk_insert_entitlements(jsonb, uuid, uuid) from public;
revoke all on function public.bulk_insert_people(jsonb, uuid, uuid) from public;
revoke all on function public.bulk_insert_contracts(jsonb, uuid, uuid) from public;
revoke all on function public.bulk_insert_rejections(jsonb, uuid, uuid) from public;

grant execute on function public.bulk_insert_usage(jsonb, uuid, uuid) to authenticated;
grant execute on function public.bulk_insert_entitlements(jsonb, uuid, uuid) to authenticated;
grant execute on function public.bulk_insert_people(jsonb, uuid, uuid) to authenticated;
grant execute on function public.bulk_insert_contracts(jsonb, uuid, uuid) to authenticated;
grant execute on function public.bulk_insert_rejections(jsonb, uuid, uuid) to authenticated;
