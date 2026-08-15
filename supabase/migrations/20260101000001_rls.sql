-- ============================================================================
-- EngiSignal — Row Level Security
--
-- Tenant isolation is enforced in three independent layers (ARCHITECTURE.md §4).
-- This file is the deepest one: even a compromised or buggy application server
-- using the anon key cannot read another tenant's rows.
--
-- Design notes:
--
-- 1. is_org_member() is SECURITY DEFINER. Without it, a policy on
--    organization_members that queries organization_members would recurse.
--    search_path is pinned to public so the function cannot be hijacked by a
--    caller-controlled search_path.
--
-- 2. Read access is granted to any member. Write access to analytical tables is
--    restricted to owner/admin/analyst — a viewer must not be able to alter the
--    numbers behind a purchasing decision.
--
-- 3. Every policy names organization_id explicitly. There is no "allow all"
--    policy anywhere in this file, including for service operations: the
--    service role bypasses RLS by design and does not need one.
-- ============================================================================

-- ── Helper functions ────────────────────────────────────────────────────────

create or replace function public.is_org_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = org
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.can_write_org(org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = org
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin', 'analyst')
  );
$$;

create or replace function public.is_org_admin(org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = org
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
  );
$$;

revoke execute on function public.is_org_member(uuid)  from public;
revoke execute on function public.can_write_org(uuid)  from public;
revoke execute on function public.is_org_admin(uuid)   from public;
grant  execute on function public.is_org_member(uuid)  to authenticated;
grant  execute on function public.can_write_org(uuid)  to authenticated;
grant  execute on function public.is_org_admin(uuid)   to authenticated;

-- ── Enable RLS everywhere ───────────────────────────────────────────────────

alter table public.organizations            enable row level security;
alter table public.organization_members     enable row level security;
alter table public.vendors                  enable row level security;
alter table public.product_families         enable row level security;
alter table public.products                 enable row level security;
alter table public.software_features        enable row level security;
alter table public.feature_aliases          enable row level security;
alter table public.unmapped_features        enable row level security;
alter table public.employees                enable row level security;
alter table public.unmatched_users          enable row level security;
alter table public.organization_dimensions  enable row level security;
alter table public.contracts                enable row level security;
alter table public.contract_items           enable row level security;
alter table public.hourly_usage             enable row level security;
alter table public.daily_usage              enable row level security;
alter table public.token_usage_daily        enable row level security;
alter table public.user_feature_activity    enable row level security;
alter table public.denials                  enable row level security;
alter table public.import_mappings          enable row level security;
alter table public.imports                  enable row level security;
alter table public.reclaim_campaigns        enable row level security;
alter table public.reclaim_campaign_items   enable row level security;
alter table public.decision_items           enable row level security;
alter table public.pilot_requests           enable row level security;

-- Force RLS so even the table owner is subject to policies. Prevents an
-- accidental privileged connection from bypassing isolation.
alter table public.organizations          force row level security;
alter table public.organization_members   force row level security;
alter table public.employees              force row level security;
alter table public.contracts              force row level security;
alter table public.contract_items         force row level security;
alter table public.hourly_usage           force row level security;
alter table public.daily_usage            force row level security;
alter table public.user_feature_activity  force row level security;
alter table public.denials                force row level security;

-- ── Organizations ───────────────────────────────────────────────────────────

create policy organizations_select on public.organizations
  for select to authenticated
  using (public.is_org_member(id));

create policy organizations_update on public.organizations
  for update to authenticated
  using (public.is_org_admin(id))
  with check (public.is_org_admin(id));

-- ── Organization members ────────────────────────────────────────────────────
-- A member sees the membership rows of organizations they belong to. Only
-- owners and admins may change membership.

create policy organization_members_select on public.organization_members
  for select to authenticated
  using (public.is_org_member(organization_id));

create policy organization_members_insert on public.organization_members
  for insert to authenticated
  with check (public.is_org_admin(organization_id));

create policy organization_members_update on public.organization_members
  for update to authenticated
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

create policy organization_members_delete on public.organization_members
  for delete to authenticated
  using (public.is_org_admin(organization_id));

-- ── Tenant tables ───────────────────────────────────────────────────────────
-- Generated uniformly: read for any member, write for owner/admin/analyst.

do $$
declare
  t text;
  tenant_tables text[] := array[
    'vendors',
    'product_families',
    'products',
    'software_features',
    'feature_aliases',
    'unmapped_features',
    'employees',
    'unmatched_users',
    'organization_dimensions',
    'contracts',
    'contract_items',
    'hourly_usage',
    'daily_usage',
    'token_usage_daily',
    'user_feature_activity',
    'denials',
    'import_mappings',
    'imports',
    'reclaim_campaigns',
    'reclaim_campaign_items',
    'decision_items'
  ];
begin
  foreach t in array tenant_tables loop
    execute format($f$
      create policy %1$s_select on public.%1$s
        for select to authenticated
        using (public.is_org_member(organization_id));
    $f$, t);

    execute format($f$
      create policy %1$s_insert on public.%1$s
        for insert to authenticated
        with check (public.can_write_org(organization_id));
    $f$, t);

    execute format($f$
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (public.can_write_org(organization_id))
        with check (public.can_write_org(organization_id));
    $f$, t);

    execute format($f$
      create policy %1$s_delete on public.%1$s
        for delete to authenticated
        using (public.can_write_org(organization_id));
    $f$, t);
  end loop;
end;
$$;

-- ── Pilot requests ──────────────────────────────────────────────────────────
-- Public insert (the marketing form has no session), no public read. Reading
-- the pipeline requires the service role, which bypasses RLS.

create policy pilot_requests_insert on public.pilot_requests
  for insert to anon, authenticated
  with check (true);

-- Deliberately NO select/update/delete policy: with RLS enabled and no policy,
-- these operations are denied to anon and authenticated roles entirely.

-- ── Grants ──────────────────────────────────────────────────────────────────
-- RLS filters rows; grants control which verbs are reachable at all. Both are
-- needed — RLS on a table with no grant is unreachable, and a grant with no
-- policy returns nothing.

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant insert on public.pilot_requests to anon;
grant usage, select on all sequences in schema public to authenticated;

-- Anonymous visitors get nothing except the ability to submit a pilot request.
revoke all on public.organizations          from anon;
revoke all on public.organization_members   from anon;
revoke all on public.employees              from anon;
revoke all on public.contracts              from anon;
revoke all on public.contract_items         from anon;
revoke all on public.hourly_usage           from anon;
revoke all on public.daily_usage            from anon;
revoke all on public.token_usage_daily      from anon;
revoke all on public.user_feature_activity  from anon;
revoke all on public.denials                from anon;
revoke all on public.vendors                from anon;
revoke all on public.products               from anon;
revoke all on public.product_families       from anon;
revoke all on public.software_features      from anon;
revoke all on public.feature_aliases        from anon;
revoke all on public.unmapped_features      from anon;
revoke all on public.unmatched_users        from anon;
revoke all on public.organization_dimensions from anon;
revoke all on public.import_mappings        from anon;
revoke all on public.imports                from anon;
revoke all on public.reclaim_campaigns      from anon;
revoke all on public.reclaim_campaign_items from anon;
revoke all on public.decision_items         from anon;
revoke select, update, delete on public.pilot_requests from anon;
