-- ============================================================================
-- Membership lifecycle (Phase 1D)
--
-- organization_members.user_id referenced auth.users by convention only, with
-- no foreign key. Deleting a user therefore left the membership behind, and
-- with it an organization nobody could reach but whose imports and canonical
-- records still occupied the tenant tables. That was observed in production:
-- removing two accounts left two organizations and five imports orphaned.
--
-- The original rationale for omitting the key was that the schema should be
-- inspectable without the auth schema present. That is preserved by guarding
-- the constraint: it is only added where auth.users actually exists.
--
-- Organizations are deliberately NOT deleted when their last member goes. An
-- organization is a tenant's data, and removing one administrator must never
-- destroy it. Orphaned organizations are unreachable under RLS and are left
-- for an explicit administrative decision.
-- ============================================================================

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'auth' and table_name = 'users'
  ) and not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'organization_members_user_id_fkey'
      and table_schema = 'public' and table_name = 'organization_members'
  ) then
    delete from public.organization_members m
    where not exists (select 1 from auth.users u where u.id = m.user_id);

    alter table public.organization_members
      add constraint organization_members_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end;
$$;

-- Surfaces tenants left without any administrator, so residue is visible
-- rather than silent. Read-only; it deletes nothing.
create or replace view public.orphaned_organizations as
select o.id, o.name, o.slug, o.created_at,
       (select count(*) from public.imports i where i.organization_id = o.id) as import_count
from public.organizations o
where not exists (
  select 1 from public.organization_members m where m.organization_id = o.id
);

revoke all on public.orphaned_organizations from anon, authenticated;
