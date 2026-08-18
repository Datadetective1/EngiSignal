-- ── THE INTEGRITY COUNT NEEDS LONGER THAN A PAGE QUERY USUALLY SHOULD ───────
--
-- Every signed-in page proves stored rows equal accepted rows before showing a
-- number, and this function is the proof. At rest it takes about 75 ms on an
-- index-only scan.
--
-- While a large import is being written that scan degrades: the visibility map
-- is not set for freshly inserted pages, so it falls back to the heap for
-- nearly every row. Measured against a 466,000-row import it reached 6.8
-- seconds, and the `authenticated` role's 8-second statement_timeout cancelled
-- it -- which the customer saw as a 500 while their own import was running. The
-- database log showed exactly as many cancellations as there were 500s.
--
-- Remembering the count instead of taking it would defeat the purpose: a
-- remembered number cannot detect the truncation this exists to rule out. So it
-- keeps doing the work and is given room.
--
-- SIX SECONDS, AND A CORRECTION. This was first set to 30 seconds on the theory
-- that the count simply needed room. Measured, that was wrong and made things
-- worse: the page sat blank for 31 seconds and then returned the same error.
-- Raising a timeout does not turn a failure into a success, it turns a fast
-- failure into a slow one.
--
-- The read path now survives a failed count and reports the check as not done,
-- so the count should give up promptly instead. Six seconds is inside the
-- role's own 8-second limit, which keeps the failure ours to describe rather
-- than an unexplained cancellation.
--
-- The body below is the original verbatim. An earlier attempt in this session
-- rewrote it from memory and dropped the null-organization guard -- the same
-- mistake made once already with publish_projection_build. Checked against the
-- source this time before it reached anything.
create or replace function public.count_canonical_rows(org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '6s'
as $$
declare
  result jsonb;
begin
  if org is null then
    raise exception 'organization is required' using errcode = '22023';
  end if;

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

revoke all on function public.count_canonical_rows(uuid) from public, anon;
grant execute on function public.count_canonical_rows(uuid) to authenticated;
