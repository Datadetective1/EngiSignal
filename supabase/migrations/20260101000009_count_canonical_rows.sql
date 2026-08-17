-- ── COUNTING THE ESTATE WITHOUT RE-CHECKING EVERY ROW ───────────────────────
--
-- The integrity gate compares what the analytics consumed against an exact
-- count performed by the database. That count is not optional: counting the
-- length of a read that might itself have been truncated is the Phase 2C defect
-- reproduced inside its own detector.
--
-- Measured on the deployed product against a 67,267-row estate, as the
-- authenticated role:
--
--   count(*) on ingestion_usage        1,393 ms
--   count(*) on ingestion_people         282 ms
--   read the whole projection            292 ms
--   everything else                  95 - 214 ms
--
-- One count was the entire remaining cost of a page view. Row Level Security
-- evaluates `private.is_org_member(organization_id)` per row, so counting
-- 67,267 rows means answering the same membership question 67,267 times, and
-- the answer cannot change part way through: every row carries the same
-- organization_id, which the query already filters on.
--
-- This asks it once. Membership is checked at the top, from auth.uid() and
-- nothing the caller supplies, and the counts are then plain counts.
--
-- WHAT IS AND IS NOT DELEGATED
--
-- The function is SECURITY DEFINER, so it must be read as carefully as
-- bootstrap_organization was. It takes one argument, an organization id. It
-- refuses unless the CALLER is a member of that organization. It returns four
-- integers and no row content whatsoever, so a caller who somehow reached it
-- for another tenant would learn a row count and nothing else - and cannot,
-- because the membership check is the first statement. It is STABLE and writes
-- nothing. `search_path` is pinned empty so no schema in the caller's path can
-- shadow the tables or the membership helper.
--
-- The integrity guarantee is unchanged: the count is still performed by the
-- database over the stored rows, which is the only property the gate needs.

create or replace function public.count_canonical_rows(org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if org is null then
    raise exception 'organization is required' using errcode = '22023';
  end if;

  -- First statement, and derived from auth.uid() rather than from anything the
  -- caller passed alongside the id.
  if not private.is_org_member(org) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'usage',        (select count(*) from public.ingestion_usage        where organization_id = org),
    'people',       (select count(*) from public.ingestion_people       where organization_id = org),
    'entitlements', (select count(*) from public.ingestion_entitlements where organization_id = org),
    'contracts',    (select count(*) from public.ingestion_contracts    where organization_id = org)
  )
  into result;

  return result;
end;
$$;

comment on function public.count_canonical_rows(uuid) is
  'Exact canonical row counts for one organization. Checks membership once from auth.uid(), then counts. Returns counts only, never row content.';

revoke all on function public.count_canonical_rows(uuid) from public;
grant execute on function public.count_canonical_rows(uuid) to authenticated;

-- Supabase's default grants make new functions in `public` reachable by `anon`
-- as well. The function already refuses a caller who is not a member, and an
-- anonymous caller is not a member of anything - verified in production, where
-- it answers "not a member of this organization". Revoked anyway: a SECURITY
-- DEFINER function that signed-out callers can reach at all is a larger surface
-- than it needs, and it should be a decision rather than a default.
revoke execute on function public.count_canonical_rows(uuid) from anon;
