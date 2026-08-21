-- ============================================================================
-- Finish the job migration 1 started.
--
-- 20260101000001_rls.sql ends with an explicit `revoke all ... from anon` for
-- every tenant table that existed at the time. Tables added by later migrations
-- — the canonical ingestion set, analytics_projections, identity_confirmations —
-- never got the same treatment, so `anon` still held SELECT/INSERT/UPDATE/DELETE
-- on seven tables holding customer estate data.
--
-- Nothing leaks today. Every one of those tables has RLS enabled and not a
-- single policy naming `anon`, and RLS with no matching policy denies. The
-- grants are unusable.
--
-- They are removed anyway, because "unreachable" and "not permitted" are
-- different guarantees. The first depends on a policy list staying exactly as
-- it is; the second does not. A future migration that adds a broad policy to
-- one of these tables should not silently hand the anonymous role a way in.
--
-- pilot_requests keeps its INSERT: the marketing form has no session by design,
-- and that grant is paired with the one deliberate anon policy in the schema.
-- ============================================================================

revoke all on public.analytics_projections   from anon;
revoke all on public.identity_confirmations  from anon;
revoke all on public.ingestion_contracts     from anon;
revoke all on public.ingestion_entitlements  from anon;
revoke all on public.ingestion_people        from anon;
revoke all on public.ingestion_rejections    from anon;
revoke all on public.ingestion_usage         from anon;

-- Belt and braces for anything added later.
alter default privileges for role postgres in schema public
  revoke all on tables from anon;
