-- ============================================================================
-- EngiSignal — canonical ingestion landing zone (Phase 1B)
--
-- WHY NEW TABLES RATHER THAN WRITING INTO hourly_usage / daily_usage
--
-- Three properties of the analytics tables make them the wrong destination for
-- raw ingested records:
--
--  1. GRAIN. hourly_usage is unique (organization_id, feature_id, usage_date,
--     hour) and holds ONE concurrent value per hour. A license export can carry
--     many observations inside the same hour. Writing them there would either
--     violate the constraint or force an aggregation choice — max, mean, last —
--     and that choice changes P95 demand and therefore the recommended
--     quantity. That is an analytical decision and must not be buried in an
--     INSERT.
--
--  2. IDENTITY. Analytics tables key on feature_id and employee_id. Ingested
--     records carry the raw strings the license manager wrote. Resolving them
--     is a separate, reviewable step — which is exactly why feature_aliases,
--     unmapped_features and unmatched_users already exist.
--
--  3. REVERSIBILITY. An import must be removable without disturbing others. An
--     aggregate cannot be un-aggregated: once two imports are summed into one
--     hourly row, neither can be withdrawn.
--
-- So ingested data lands here at SOURCE GRAIN with full provenance, and the
-- analytics shapes are PROJECTED from it. The projection is recomputable, which
-- means a mapping correction or an import deletion can be replayed rather than
-- reconciled by hand.
--
-- Deleting an import is `delete from ingestion_* where import_id = $1`, and the
-- accepted/rejected counts on the imports row stay reconcilable against the
-- rows actually stored.
-- ============================================================================

-- ── Import lifecycle ────────────────────────────────────────────────────────

-- Real states only. There is no queue in this implementation, so there is no
-- 'queued' state: showing one would be theatre.
alter type public.import_status add value if not exists 'analyzed';
alter type public.import_status add value if not exists 'importing';

-- The dataset an import produced, distinct from the legacy import_kind enum
-- which describes the older template-driven flow.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'canonical_dataset') then
    create type public.canonical_dataset as enum ('usage', 'entitlements', 'people');
  end if;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'ingestion_source') then
    create type public.ingestion_source as enum ('flexnet', 'rlm', 'dsls', 'sentinel', 'generic');
  end if;
end;
$$;

alter table public.imports
  add column if not exists dataset             public.canonical_dataset,
  add column if not exists source_system       public.ingestion_source,
  add column if not exists detection_confidence integer
    check (detection_confidence is null or detection_confidence between 0 and 100),
  add column if not exists detection_evidence  jsonb not null default '[]'::jsonb,
  add column if not exists detection_fell_back boolean not null default false,
  add column if not exists source_sheets       jsonb not null default '[]'::jsonb,
  add column if not exists mapping_used        jsonb not null default '{}'::jsonb,
  add column if not exists warnings            jsonb not null default '[]'::jsonb,
  add column if not exists quality             jsonb not null default '{}'::jsonb,
  add column if not exists duplicate_rows      integer not null default 0,
  add column if not exists usage_records       integer not null default 0,
  add column if not exists entitlement_records integer not null default 0,
  add column if not exists people_records      integer not null default 0,
  add column if not exists uploaded_at         timestamptz not null default now(),
  add column if not exists imported_at         timestamptz,
  add column if not exists failure_reason      text;

-- ── Canonical usage ─────────────────────────────────────────────────────────
--
-- One row per source observation. Nullable everywhere the source may not carry
-- the value: a null here means "not supplied", never zero. Interpreting an
-- absent denial column as zero denied demand would understate unmet demand and
-- make a renewal look safer than the evidence supports.

create table if not exists public.ingestion_usage (
  id               bigserial primary key,
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  import_id        uuid not null references public.imports(id) on delete cascade,

  usage_date       date not null,
  hour             smallint check (hour is null or hour between 0 and 23),
  observed_at      timestamptz,

  raw_user         text,
  employee_code    text,
  raw_feature      text not null,
  raw_product      text,
  raw_vendor       text,

  quantity         integer  check (quantity is null or quantity >= 0),
  concurrent       integer  check (concurrent is null or concurrent >= 0),
  peak             integer  check (peak is null or peak >= 0),
  available        integer  check (available is null or available >= 0),
  duration_hours   numeric(14,4) check (duration_hours is null or duration_hours >= 0),
  checkout_at      timestamptz,
  checkin_at       timestamptz,
  denied           boolean,
  denial_count     integer  check (denial_count is null or denial_count >= 0),
  license_server   text,
  pool             text,
  tokens           numeric(14,4) check (tokens is null or tokens >= 0),

  -- Provenance. source_row counts the header as row 1 so it matches what the
  -- customer sees when they open the file.
  source_system    public.ingestion_source not null,
  source_file      text not null,
  source_sheet     text,
  source_row       integer not null,

  created_at       timestamptz not null default now()
);

-- Re-running the same import must not double-count. The natural key is the
-- import plus the exact row it came from.
create unique index if not exists ingestion_usage_row_key
  on public.ingestion_usage (import_id, source_sheet, source_row)
  nulls not distinct;

create index if not exists ingestion_usage_org_date_idx
  on public.ingestion_usage (organization_id, usage_date);
create index if not exists ingestion_usage_org_feature_idx
  on public.ingestion_usage (organization_id, raw_feature, usage_date);
create index if not exists ingestion_usage_import_idx
  on public.ingestion_usage (import_id);

-- ── Canonical entitlements ──────────────────────────────────────────────────

create table if not exists public.ingestion_entitlements (
  id                bigserial primary key,
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  import_id         uuid not null references public.imports(id) on delete cascade,

  raw_feature       text not null,
  raw_product       text,
  raw_vendor        text,
  entitled_quantity integer check (entitled_quantity is null or entitled_quantity >= 0),
  license_model     text not null default 'unknown'
    check (license_model in ('concurrent','named_user','token','node_locked','unknown')),
  license_server    text,
  pool              text,
  expires_on        date,

  source_system     public.ingestion_source not null,
  source_file       text not null,
  source_sheet      text,
  source_row        integer not null,

  created_at        timestamptz not null default now()
);

create unique index if not exists ingestion_entitlements_row_key
  on public.ingestion_entitlements (import_id, source_sheet, source_row)
  nulls not distinct;

create index if not exists ingestion_entitlements_org_idx
  on public.ingestion_entitlements (organization_id, raw_feature);
create index if not exists ingestion_entitlements_import_idx
  on public.ingestion_entitlements (import_id);

-- ── Canonical people ────────────────────────────────────────────────────────

create table if not exists public.ingestion_people (
  id              bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  import_id       uuid not null references public.imports(id) on delete cascade,

  raw_user        text not null,
  employee_code   text,
  display_name    text,
  email           text,

  source_system   public.ingestion_source not null,
  source_file     text not null,
  source_sheet    text,
  source_row      integer not null,

  created_at      timestamptz not null default now()
);

create unique index if not exists ingestion_people_row_key
  on public.ingestion_people (import_id, source_sheet, source_row)
  nulls not distinct;

create index if not exists ingestion_people_org_idx
  on public.ingestion_people (organization_id, raw_user);
create index if not exists ingestion_people_import_idx
  on public.ingestion_people (import_id);

-- ── Rejections ──────────────────────────────────────────────────────────────
--
-- Audit only. These are NOT analytical records and are never read by the
-- analytics engine — they exist so a customer can ask "what did you refuse and
-- why" months later and get an exact answer.

create table if not exists public.ingestion_rejections (
  id              bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  import_id       uuid not null references public.imports(id) on delete cascade,

  source_sheet    text,
  source_row      integer not null,
  rule            text not null,
  field           text,
  value           text,
  message         text not null,

  created_at      timestamptz not null default now()
);

create index if not exists ingestion_rejections_import_idx
  on public.ingestion_rejections (import_id);

-- ── Row Level Security ──────────────────────────────────────────────────────
--
-- Same three-layer model as every other tenant table: read for any member,
-- write for owner/admin/analyst. Policies name organization_id explicitly and
-- there is no permissive fallback.

alter table public.ingestion_usage        enable row level security;
alter table public.ingestion_entitlements enable row level security;
alter table public.ingestion_people       enable row level security;
alter table public.ingestion_rejections   enable row level security;

alter table public.ingestion_usage        force row level security;
alter table public.ingestion_entitlements force row level security;
alter table public.ingestion_people       force row level security;
alter table public.ingestion_rejections   force row level security;

do $$
declare
  t text;
  tenant_tables text[] := array[
    'ingestion_usage',
    'ingestion_entitlements',
    'ingestion_people',
    'ingestion_rejections'
  ];
begin
  foreach t in array tenant_tables loop
    execute format($f$
      create policy %1$s_select on public.%1$s
        for select to authenticated
        using (private.is_org_member(organization_id));
    $f$, t);

    execute format($f$
      create policy %1$s_insert on public.%1$s
        for insert to authenticated
        with check (private.can_write_org(organization_id));
    $f$, t);

    execute format($f$
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (private.can_write_org(organization_id))
        with check (private.can_write_org(organization_id));
    $f$, t);

    execute format($f$
      create policy %1$s_delete on public.%1$s
        for delete to authenticated
        using (private.can_write_org(organization_id));
    $f$, t);
  end loop;
end;
$$;
