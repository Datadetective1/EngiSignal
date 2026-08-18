-- ── ONE WAY TO SAY THE ANALYSIS IS OWED ─────────────────────────────────────
--
-- Completing an import marks the tenant dirty and lets the worker rebuild.
-- Deleting one still started a build directly, through the reader-path
-- functions this phase otherwise retired -- so the same lifecycle had two
-- writers again, which is exactly what the change was meant to stop. Found by
-- the production security advisor, which was still reporting four
-- SECURITY DEFINER functions callable by signed-in customers.
--
-- The application can now only say "this tenant's evidence changed". What to do
-- about that belongs to the worker, in one place.
create or replace function public.mark_own_projection_dirty(org uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  -- Membership from auth.uid(), never from the argument, so a customer can mark
  -- their own analysis stale and nobody else's.
  if not private.can_write_org(org) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  perform public.mark_projection_dirty(org);
end;
$$;

revoke all on function public.mark_own_projection_dirty(uuid) from public, anon;
grant execute on function public.mark_own_projection_dirty(uuid) to authenticated;

-- The reader-path build functions have no callers left. Dropping them removes
-- four SECURITY DEFINER functions a signed-in customer could call directly --
-- including publish_projection_build, which accepted an arbitrary payload and
-- would have let someone write nonsense as their own analysis.
drop function if exists public.claim_projection_build(uuid, text, integer);
drop function if exists public.heartbeat_projection_build(uuid, uuid);
drop function if exists public.publish_projection_build(uuid, uuid, text, text, integer, integer, jsonb, jsonb, integer, jsonb);
drop function if exists public.fail_projection_build(uuid, uuid, text);
