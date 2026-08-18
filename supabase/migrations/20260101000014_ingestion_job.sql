-- ── A JOB THAT SURVIVES THE REQUEST THAT CREATED IT ─────────────────────────
--
-- Measured in production: the database needs about 83 microseconds per row, so
-- 466,000 rows is roughly forty seconds of database work before any network.
-- Add the cost of shipping the rows and no HTTP request can hold it, and no
-- choice of batch size changes that -- two attempts to tune it were measured
-- and both failed, one of them by making production two and a half times
-- slower.
--
-- So persistence stops being something a request does. The request stores the
-- customer's file and returns; a worker writes the rows afterwards, in bounded
-- slices, and may be interrupted at any point.
--
-- WHAT MAKES IT RESUMABLE RATHER THAN MERELY RESTARTABLE
--
-- `rows_persisted` is a high-water mark, advanced in the same statement that
-- writes the rows it counts. A worker that dies mid-import leaves a correct
-- number behind, and the next one starts from it rather than from zero.
--
-- WHAT MAKES IT EXACTLY-ONCE
--
-- Two things, and it needs both. The lease and token stop two workers writing
-- concurrently. The unique index on (import_id, source_sheet, source_row)
-- decides the case the lease cannot: a worker that wrote a slice and died
-- before recording it. That slice is re-sent on resume, and every row of it
-- collides and is discarded. The index was already there for correctness; here
-- it doubles as the idempotency key.
--
-- WHY A SEPARATE DATABASE ROLE
--
-- The worker runs from a scheduler, so it has no signed-in user and cannot use
-- the Row Level Security that protects every other statement in this product.
-- The alternative usually reached for -- a service-role key -- can read and
-- write every tenant's data, and DEPLOYMENT.md and SECURITY.md both said this
-- product deliberately holds no such key.
--
-- Instead `ingestion_worker` is granted EXECUTE on the functions below and
-- nothing else: no SELECT, INSERT, UPDATE or DELETE on any table in any schema.
-- It cannot read a single row of customer data directly. Every function it can
-- call takes an import id and derives the organization from the import row, so
-- there is no argument anywhere in its surface that names a tenant -- reaching
-- another organization's data is not a permission it is denied, it is a request
-- it has no way to phrase.

alter table public.imports
  -- The checkpoint. Rows of this import already durably written.
  add column if not exists rows_persisted integer not null default 0,

  -- Where the customer's file is kept until the rows are written. This is the
  -- canonical evidence, and it is durable before the job is queued.
  add column if not exists source_path text,

  -- The claim. A worker may only write while it still holds the token it
  -- claimed with, so a resumed or duplicated worker cannot advance the
  -- checkpoint of a job that has moved on without it.
  add column if not exists worker_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists heartbeat_at timestamptz,

  -- Retry accounting. Visible to the customer so a job that is being retried
  -- does not look identical to one that is stuck.
  add column if not exists attempt integer not null default 0,
  add column if not exists max_attempts integer not null default 5;

comment on column public.imports.rows_persisted is
  'High-water mark. Advanced in the same statement that writes the rows it counts.';
comment on column public.imports.worker_token is
  'Claim token. A worker may only checkpoint while it still holds this.';

-- Finding work: queued jobs, and jobs whose worker stopped beating.
create index if not exists imports_claimable_idx
  on public.imports (status, lease_expires_at)
  where status in ('queued', 'importing');

-- ── THE WORKER'S ENTIRE CAPABILITY ──────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'ingestion_worker') then
    create role ingestion_worker nologin noinherit;
  end if;
end $$;

-- PostgREST switches into this role for a request bearing a token that names
-- it, which requires the connecting role to be a member.
grant ingestion_worker to authenticator;
grant usage on schema public to ingestion_worker;

-- Stated as an assertion rather than an omission: the role is given no rights
-- over any table, and the revoke makes that survive a future default-privilege
-- change that might grant some.
revoke all on all tables in schema public from ingestion_worker;
revoke all on all sequences in schema public from ingestion_worker;

/**
 * Claim one job.
 *
 * Takes the oldest job that is either waiting or abandoned. SKIP LOCKED is what
 * makes two workers arriving together pick different rows instead of one
 * blocking; the token is what makes a third, resumed from an older invocation,
 * unable to write to either.
 */
create or replace function public.claim_import_job(lease_seconds integer default 60)
returns table (
  import_id uuid,
  organization_id uuid,
  dataset public.canonical_dataset,
  file_name text,
  source_path text,
  rows_persisted integer,
  accepted_rows integer,
  token uuid,
  attempt integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_token uuid := gen_random_uuid();
begin
  return query
  with claimable as (
    select i.id
    from public.imports i
    where i.source_path is not null
      and (
        i.status = 'queued'
        -- An abandoned job. The lease, not a human, decides this.
        or (i.status = 'importing' and (i.lease_expires_at is null or i.lease_expires_at < now()))
      )
      and i.attempt < i.max_attempts
    order by i.uploaded_at
    for update skip locked
    limit 1
  )
  update public.imports i
  set status = 'importing',
      worker_token = new_token,
      lease_expires_at = now() + make_interval(secs => lease_seconds),
      heartbeat_at = now(),
      attempt = i.attempt + 1
  from claimable c
  where i.id = c.id
  returning i.id, i.organization_id, i.dataset, i.file_name, i.source_path,
            i.rows_persisted, i.accepted_rows, new_token, i.attempt;
end;
$$;

/** Extend the lease. A worker that stops calling this becomes claimable. */
create or replace function public.heartbeat_import_job(job uuid, token uuid, lease_seconds integer default 60)
returns boolean
language sql
security definer
set search_path = ''
as $$
  update public.imports
  set heartbeat_at = now(),
      lease_expires_at = now() + make_interval(secs => lease_seconds)
  where id = job and worker_token = token and status = 'importing'
  returning true;
$$;

/**
 * Write one slice and move the checkpoint, in one statement.
 *
 * `expected_from` is the checkpoint the worker believed it was continuing from.
 * If it does not match, this slice was computed against a different view of the
 * job -- a duplicate worker, or one resumed after the job moved on -- and it is
 * refused rather than written at the wrong offset.
 *
 * The organization is read from the import row. The caller cannot name one.
 */
create or replace function public.persist_import_slice(
  job uuid,
  token uuid,
  rows jsonb,
  expected_from integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
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
    -- No claim, or it expired, or someone else holds it now.
    return -1;
  end if;

  if current_mark <> expected_from then
    return -2;
  end if;

  -- ON CONFLICT DO NOTHING against the pre-existing unique index is what makes
  -- a re-sent slice harmless: every row of it collides and none is written
  -- twice. It is deliberately not DO UPDATE -- a row already stored is the
  -- authority, and rewriting it would let a stale worker alter durable data.
  if ds = 'usage' then
    insert into public.ingestion_usage (
      organization_id, import_id, usage_date, hour, observed_at, raw_user,
      employee_code, raw_feature, raw_product, raw_vendor, quantity, concurrent,
      peak, available, duration_hours, checkout_at, checkin_at, denied,
      denial_count, license_server, pool, tokens, source_system, source_file,
      source_sheet, source_row
    )
    select org, job, r.usage_date, r.hour, r.observed_at, r.raw_user,
           r.employee_code, r.raw_feature, r.raw_product, r.raw_vendor,
           r.quantity, r.concurrent, r.peak, r.available, r.duration_hours,
           r.checkout_at, r.checkin_at, r.denied, r.denial_count,
           r.license_server, r.pool, r.tokens, r.source_system, r.source_file,
           r.source_sheet, r.source_row
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
$$;

/**
 * Finish, but only if the rows are actually there.
 *
 * The count is taken from the canonical tables, not from what the worker
 * believes it wrote. An import reaching `complete` is the promise the whole
 * product rests on, and it is not made on a worker's word.
 */
create or replace function public.complete_import_job(job uuid, token uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  ds public.canonical_dataset;
  expected integer;
  actual integer;
begin
  select i.dataset, i.accepted_rows into ds, expected
  from public.imports i
  where i.id = job and i.worker_token = token and i.status = 'importing'
  for update;

  if ds is null then
    return 'superseded';
  end if;

  select case ds
    when 'usage' then (select count(*) from public.ingestion_usage where import_id = job)
    when 'entitlements' then (select count(*) from public.ingestion_entitlements where import_id = job)
    when 'people' then (select count(*) from public.ingestion_people where import_id = job)
    when 'contracts' then (select count(*) from public.ingestion_contracts where import_id = job)
  end into actual;

  if actual <> expected then
    update public.imports
    set status = 'failed',
        failure_reason = format(
          'Refusing to complete: %s rows were accepted but %s are stored.', expected, actual),
        worker_token = null, lease_expires_at = null
    where id = job;
    return 'integrity_failed';
  end if;

  update public.imports
  set status = 'complete',
      imported_at = now(),
      rows_persisted = actual,
      failure_reason = null,
      worker_token = null,
      lease_expires_at = null
  where id = job;

  return 'complete';
end;
$$;

/**
 * Record a failure and decide whether it is terminal.
 *
 * Below the attempt limit the job returns to `queued` and will be picked up
 * again. At the limit it stays `failed`, because a job that retries for ever
 * is indistinguishable from one that is working.
 */
create or replace function public.fail_import_job(job uuid, token uuid, reason text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  tries integer;
  cap integer;
begin
  select i.attempt, i.max_attempts into tries, cap
  from public.imports i
  where i.id = job and i.worker_token = token
  for update;

  if tries is null then
    return 'superseded';
  end if;

  update public.imports
  set status = case when tries >= cap then 'failed'::public.import_status else 'queued'::public.import_status end,
      failure_reason = reason,
      worker_token = null,
      lease_expires_at = null
  where id = job;

  return case when tries >= cap then 'failed' else 'requeued' end;
end;
$$;

/**
 * Return abandoned jobs to the queue.
 *
 * The claim already reclaims an expired lease, so this exists for the one case
 * the claim cannot express: a job that has exhausted its attempts should stop
 * looking like work, and one whose worker died should have its failure recorded
 * rather than silently becoming claimable with no explanation.
 */
create or replace function public.reap_stale_import_jobs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  reaped integer;
begin
  with stale as (
    update public.imports
    set status = case when attempt >= max_attempts then 'failed'::public.import_status
                      else 'queued'::public.import_status end,
        failure_reason = coalesce(
          failure_reason,
          'The worker stopped responding and the job was returned to the queue.'),
        worker_token = null,
        lease_expires_at = null
    where status = 'importing'
      and lease_expires_at is not null
      and lease_expires_at < now() - interval '30 seconds'
    returning 1
  )
  select count(*)::integer into reaped from stale;
  return reaped;
end;
$$;

-- ── LEAST PRIVILEGE, STATED EXPLICITLY ──────────────────────────────────────
--
-- Default privileges make new functions executable by everybody, which for this
-- surface would mean any anonymous visitor could claim a customer's import. So
-- every one is revoked from PUBLIC, from anon and from authenticated first, and
-- granted only to the worker.

revoke all on function public.claim_import_job(integer) from public, anon, authenticated;
revoke all on function public.heartbeat_import_job(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.persist_import_slice(uuid, uuid, jsonb, integer) from public, anon, authenticated;
revoke all on function public.complete_import_job(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fail_import_job(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.reap_stale_import_jobs() from public, anon, authenticated;

grant execute on function public.claim_import_job(integer) to ingestion_worker;
grant execute on function public.heartbeat_import_job(uuid, uuid, integer) to ingestion_worker;
grant execute on function public.persist_import_slice(uuid, uuid, jsonb, integer) to ingestion_worker;
grant execute on function public.complete_import_job(uuid, uuid) to ingestion_worker;
grant execute on function public.fail_import_job(uuid, uuid, text) to ingestion_worker;
grant execute on function public.reap_stale_import_jobs() to ingestion_worker;
