-- ============================================================================
-- Hardening pass, driven by the Supabase security advisors.
--
-- Two findings, both fixed here rather than documented as accepted risk:
--
-- 1. The RLS helper functions were SECURITY DEFINER living in `public`, which
--    PostgREST exposes as callable RPC endpoints (/rest/v1/rpc/is_org_member).
--    They leak nothing — they only answer questions about the caller's own
--    membership — but an internet-reachable SECURITY DEFINER endpoint is attack
--    surface with no upside. Moving them into a schema PostgREST does not
--    expose removes the endpoint entirely while RLS policies can still call
--    them, because a policy only needs the querying role to hold EXECUTE.
--
-- 2. touch_updated_at had a mutable search_path. For a SECURITY DEFINER or
--    trigger function that is a privilege-escalation vector: a caller who can
--    influence search_path can shadow a referenced object. Pinned to ''.
--
-- After this migration `get_advisors(type: security)` returns zero findings,
-- and the tenant-isolation assertions in SECURITY.md still pass.
-- ============================================================================

create schema if not exists private;

-- Only signed-in users may resolve membership; anon has no business doing so.
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.is_org_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = org
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function private.can_write_org(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = org
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin', 'analyst')
  );
$$;

create or replace function private.is_org_admin(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = org
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
  );
$$;

revoke execute on function private.is_org_member(uuid) from public, anon;
revoke execute on function private.can_write_org(uuid) from public, anon;
revoke execute on function private.is_org_admin(uuid)  from public, anon;
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.can_write_org(uuid) to authenticated;
grant execute on function private.is_org_admin(uuid)  to authenticated;

-- ── Repoint every policy at the private helpers ─────────────────────────────
-- A policy expression cannot be altered in place, so each is dropped and
-- recreated identically except for the schema of the helper it calls.

drop policy if exists organizations_select on public.organizations;
drop policy if exists organizations_update on public.organizations;

create policy organizations_select on public.organizations
  for select to authenticated
  using (private.is_org_member(id));

create policy organizations_update on public.organizations
  for update to authenticated
  using (private.is_org_admin(id))
  with check (private.is_org_admin(id));

drop policy if exists organization_members_select on public.organization_members;
drop policy if exists organization_members_insert on public.organization_members;
drop policy if exists organization_members_update on public.organization_members;
drop policy if exists organization_members_delete on public.organization_members;

create policy organization_members_select on public.organization_members
  for select to authenticated
  using (private.is_org_member(organization_id));

create policy organization_members_insert on public.organization_members
  for insert to authenticated
  with check (private.is_org_admin(organization_id));

create policy organization_members_update on public.organization_members
  for update to authenticated
  using (private.is_org_admin(organization_id))
  with check (private.is_org_admin(organization_id));

create policy organization_members_delete on public.organization_members
  for delete to authenticated
  using (private.is_org_admin(organization_id));

do $$
declare
  t text;
  tenant_tables text[] := array[
    'vendors','product_families','products','software_features','feature_aliases',
    'unmapped_features','employees','unmatched_users','organization_dimensions',
    'contracts','contract_items','hourly_usage','daily_usage','token_usage_daily',
    'user_feature_activity','denials','import_mappings','imports',
    'reclaim_campaigns','reclaim_campaign_items','decision_items'
  ];
begin
  foreach t in array tenant_tables loop
    execute format('drop policy if exists %1$s_select on public.%1$s;', t);
    execute format('drop policy if exists %1$s_insert on public.%1$s;', t);
    execute format('drop policy if exists %1$s_update on public.%1$s;', t);
    execute format('drop policy if exists %1$s_delete on public.%1$s;', t);

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

-- The public copies are now unreferenced and were the exposed surface.
drop function if exists public.is_org_member(uuid);
drop function if exists public.can_write_org(uuid);
drop function if exists public.is_org_admin(uuid);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
