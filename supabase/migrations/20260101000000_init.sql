-- ============================================================================
-- EngiSignal — core schema
--
-- Every tenant-owned table carries organization_id and is protected by Row
-- Level Security (see the companion RLS migration). The column is not a
-- convention here: it is the join key for every policy, so it is NOT NULL and
-- indexed on every table without exception.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ── Tenancy ─────────────────────────────────────────────────────────────────

create table public.organizations (
  id                    uuid primary key default gen_random_uuid(),
  name                  text        not null,
  slug                  text        not null unique,
  industry              text,
  -- Denominator for cost-per-engineer metrics.
  technical_headcount   integer     check (technical_headcount is null or technical_headcount >= 0),
  -- Expected annual headcount growth as a ratio, e.g. 0.05 for +5%.
  headcount_growth_rate numeric(6,4),
  currency              text        not null default 'USD',
  is_demo               boolean     not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create type public.org_role as enum ('owner', 'admin', 'analyst', 'viewer');

create table public.organization_members (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- References auth.users. Not a FK so the schema can be inspected and tested
  -- without the auth schema present.
  user_id         uuid not null,
  email           text not null,
  display_name    text,
  role            public.org_role not null default 'viewer',
  created_at      timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index organization_members_user_idx on public.organization_members (user_id);
create index organization_members_org_idx  on public.organization_members (organization_id);

-- ── Software normalization hierarchy ────────────────────────────────────────
-- Vendor → Product family → Product → Feature → Raw alias.
-- No vendor's hierarchy is hard-coded; all levels are data.

create table public.vendors (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  slug            text not null,
  created_at      timestamptz not null default now(),
  unique (organization_id, slug)
);

create table public.product_families (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vendor_id       uuid not null references public.vendors(id) on delete cascade,
  name            text not null,
  created_at      timestamptz not null default now(),
  unique (organization_id, vendor_id, name)
);

create table public.products (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  vendor_id         uuid not null references public.vendors(id) on delete cascade,
  product_family_id uuid references public.product_families(id) on delete set null,
  name              text not null,
  category          text,
  created_at        timestamptz not null default now(),
  unique (organization_id, vendor_id, name)
);

create type public.license_model as enum (
  'concurrent', 'named_user', 'token', 'subscription', 'hybrid', 'custom'
);

create table public.software_features (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  name            text not null,
  -- Canonical feature code as it appears in license-manager data.
  code            text not null,
  license_model   public.license_model not null default 'concurrent',
  -- Tokens consumed per checkout, for token-model features.
  token_weight    numeric(10,3),
  created_at      timestamptz not null default now(),
  unique (organization_id, code)
);

create index software_features_product_idx on public.software_features (organization_id, product_id);

-- Many raw license-manager strings may map to one canonical feature.
create table public.feature_aliases (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  feature_id      uuid not null references public.software_features(id) on delete cascade,
  raw_value       text not null,
  source          text,
  confidence      text not null default 'mapped' check (confidence in ('exact','mapped','manual')),
  created_at      timestamptz not null default now(),
  unique (organization_id, raw_value)
);

-- Raw feature strings seen in imports with no alias yet. Deliberately queued
-- rather than guessed: a silent wrong mapping overstates demand untraceably.
create table public.unmapped_features (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  raw_value            text not null,
  occurrences          integer not null default 0,
  first_seen           date not null,
  last_seen            date not null,
  suggested_feature_id uuid references public.software_features(id) on delete set null,
  status               text not null default 'open' check (status in ('open','mapped','ignored')),
  unique (organization_id, raw_value)
);

-- ── People ──────────────────────────────────────────────────────────────────

create type public.employee_type as enum ('employee', 'contractor');

create table public.employees (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  employee_code      text,
  username           text not null,
  full_name          text not null,
  email              text,
  manager_name       text,
  department         text,
  business_unit      text,
  program            text,
  discipline         text,
  competency         text,
  location           text,
  region             text,
  employee_type      public.employee_type not null default 'employee',
  status             text not null default 'active' check (status in ('active','inactive')),
  contractor_company text,
  created_at         timestamptz not null default now(),
  unique (organization_id, username)
);

create index employees_org_dept_idx    on public.employees (organization_id, department);
create index employees_org_program_idx on public.employees (organization_id, program);
create index employees_org_code_idx    on public.employees (organization_id, employee_code);

-- Usernames seen in usage data that did not resolve to an employee.
create table public.unmatched_users (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  raw_username          text not null,
  occurrences           integer not null default 0,
  first_seen            date not null,
  last_seen             date not null,
  suggested_employee_id uuid references public.employees(id) on delete set null,
  status                text not null default 'open' check (status in ('open','matched','ignored')),
  unique (organization_id, raw_username)
);

-- Organizational axes available for grouping and allocation. Data-driven so a
-- customer can add a dimension without a schema change.
create table public.organization_dimensions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key             text not null,
  label           text not null,
  sort_order      integer not null default 0,
  is_enabled      boolean not null default true,
  unique (organization_id, key)
);

-- ── Commercial ──────────────────────────────────────────────────────────────

create table public.contracts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vendor_id       uuid not null references public.vendors(id) on delete cascade,
  contract_number text not null,
  agreement_name  text,
  start_date      date not null,
  end_date        date not null,
  renewal_date    date not null,
  purchase_order  text,
  business_owner  text,
  cost_center     text,
  status          text not null default 'active' check (status in ('active','expired','pending')),
  created_at      timestamptz not null default now(),
  unique (organization_id, contract_number)
);

create index contracts_org_renewal_idx on public.contracts (organization_id, renewal_date);

create table public.contract_items (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contract_id     uuid not null references public.contracts(id) on delete cascade,
  feature_id      uuid not null references public.software_features(id) on delete cascade,
  sku             text,
  license_model   public.license_model not null default 'concurrent',
  quantity        integer not null check (quantity >= 0),
  -- Annual price per unit. NULL means unpriced — never assume zero.
  unit_price      numeric(14,2) check (unit_price is null or unit_price >= 0),
  created_at      timestamptz not null default now(),
  unique (organization_id, contract_id, feature_id)
);

create index contract_items_feature_idx on public.contract_items (organization_id, feature_id);

-- ── Usage ───────────────────────────────────────────────────────────────────

-- Hourly concurrent demand. The largest table by far, so it is indexed for the
-- exact access pattern the analytics engine uses: one feature, one date range.
create table public.hourly_usage (
  id              bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  feature_id      uuid not null references public.software_features(id) on delete cascade,
  usage_date      date not null,
  hour            smallint not null check (hour between 0 and 23),
  concurrent      integer not null check (concurrent >= 0),
  unique (organization_id, feature_id, usage_date, hour)
);

create index hourly_usage_lookup_idx on public.hourly_usage (organization_id, feature_id, usage_date);

-- Daily rollup. Peak is the maximum hourly concurrent demand on the date — the
-- unit every concurrent recommendation is built from.
create table public.daily_usage (
  id              bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  feature_id      uuid not null references public.software_features(id) on delete cascade,
  usage_date      date not null,
  peak            integer not null check (peak >= 0),
  mean_concurrent numeric(12,3) not null default 0,
  usage_hours     numeric(14,2) not null default 0,
  unique_users    integer not null default 0,
  unique (organization_id, feature_id, usage_date)
);

create index daily_usage_lookup_idx on public.daily_usage (organization_id, feature_id, usage_date);

create table public.token_usage_daily (
  id              bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  feature_id      uuid not null references public.software_features(id) on delete cascade,
  usage_date      date not null,
  token_hours     numeric(14,2) not null default 0,
  peak_tokens     integer not null default 0,
  unique (organization_id, feature_id, usage_date)
);

create index token_usage_lookup_idx on public.token_usage_daily (organization_id, feature_id, usage_date);

-- Per-employee, per-feature activity summary — the named-user substrate.
create table public.user_feature_activity (
  id              bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  feature_id      uuid not null references public.software_features(id) on delete cascade,
  employee_id     uuid not null references public.employees(id) on delete cascade,
  assigned        boolean not null default false,
  assigned_on     date,
  last_used_date  date,
  total_sessions  integer not null default 0,
  total_hours     numeric(14,2) not null default 0,
  sessions_30     integer not null default 0,
  sessions_60     integer not null default 0,
  sessions_90     integer not null default 0,
  sessions_180    integer not null default 0,
  unique (organization_id, feature_id, employee_id)
);

create index ufa_feature_idx  on public.user_feature_activity (organization_id, feature_id);
create index ufa_employee_idx on public.user_feature_activity (organization_id, employee_id);
-- Partial index for the reclaim query: assigned seats ordered by last use.
create index ufa_assigned_idx on public.user_feature_activity (organization_id, last_used_date)
  where assigned = true;

-- Denials. concurrent_at_denial is the critical column: without it a genuine
-- capacity denial cannot be distinguished from a licensing-rule rejection that
-- buying more licenses would not have prevented.
create table public.denials (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  feature_id           uuid not null references public.software_features(id) on delete cascade,
  denial_date          date not null,
  hour                 smallint check (hour is null or hour between 0 and 23),
  employee_id          uuid references public.employees(id) on delete set null,
  count                integer not null default 1 check (count > 0),
  concurrent_at_denial integer,
  available_at_denial  integer
);

create index denials_lookup_idx on public.denials (organization_id, feature_id, denial_date);

-- ── Imports ─────────────────────────────────────────────────────────────────

create type public.import_kind   as enum ('usage','employees','contracts','assignments','denials');
create type public.import_status as enum ('pending','mapping','validating','complete','failed');

create table public.import_mappings (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind            public.import_kind not null,
  name            text not null,
  -- source column → canonical field key
  fields          jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  last_used_at    timestamptz,
  use_count       integer not null default 0,
  unique (organization_id, name)
);

create table public.imports (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind            public.import_kind not null,
  file_name       text not null,
  file_bytes      bigint not null default 0,
  row_count       integer not null default 0,
  accepted_rows   integer not null default 0,
  rejected_rows   integer not null default 0,
  status          public.import_status not null default 'pending',
  created_at      timestamptz not null default now(),
  created_by      text,
  mapping_id      uuid references public.import_mappings(id) on delete set null,
  notes           text
);

create index imports_org_created_idx on public.imports (organization_id, created_at desc);

-- ── Workflow ────────────────────────────────────────────────────────────────

create type public.reclaim_status as enum (
  'pending_review','manager_review','keep','reclaim','reassign','complete'
);

create table public.reclaim_campaigns (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  threshold_days  integer not null default 90,
  status          text not null default 'open',
  created_at      timestamptz not null default now(),
  created_by      text
);

-- Only the decision is stored. Everything analytical about a candidate is
-- recomputed on read, so a recorded decision can never sit behind a stale
-- recommendation.
create table public.reclaim_campaign_items (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id     uuid references public.reclaim_campaigns(id) on delete cascade,
  -- Stable key of the form "<feature_id>:<employee_id>".
  candidate_key   text not null,
  status          public.reclaim_status not null default 'pending_review',
  owner           text,
  notes           text,
  updated_at      timestamptz not null default now(),
  unique (organization_id, candidate_key)
);

create type public.decision_type as enum (
  'renewal','cost','capacity','reclaim','forecast','contract','data_quality'
);
create type public.decision_status as enum ('open','in_review','approved','rejected','complete');

create table public.decision_items (
  id                 text not null,
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  type               public.decision_type not null,
  title              text,
  description        text,
  impact             numeric(14,2),
  urgency_days       integer,
  confidence         text,
  risk               text,
  owner              text,
  recommended_action text,
  status             public.decision_status not null default 'open',
  href               text,
  updated_at         timestamptz not null default now(),
  primary key (organization_id, id)
);

-- ── Pilot requests ──────────────────────────────────────────────────────────
-- Not tenant-scoped: these arrive from the public marketing site before any
-- organization exists. Insert is public; reading is service-role only.

create table public.pilot_requests (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  work_email             text not null,
  company                text not null,
  job_title              text not null,
  approximate_employees  text,
  engineering_employees  text,
  software_spend_range   text,
  major_vendors          text,
  renewal_timing         text,
  primary_challenge      text,
  message                text,
  created_at             timestamptz not null default now()
);

create index pilot_requests_created_idx on public.pilot_requests (created_at desc);

-- ── Updated-at maintenance ──────────────────────────────────────────────────

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger organizations_touch
  before update on public.organizations
  for each row execute function public.touch_updated_at();

create trigger reclaim_items_touch
  before update on public.reclaim_campaign_items
  for each row execute function public.touch_updated_at();

create trigger decision_items_touch
  before update on public.decision_items
  for each row execute function public.touch_updated_at();
