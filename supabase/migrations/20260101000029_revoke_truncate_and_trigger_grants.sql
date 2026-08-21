-- ============================================================================
-- Remove privileges that Row Level Security cannot filter.
--
-- Found while auditing the membership grants for multi-user workspaces:
--
--   authenticated  TRUNCATE, REFERENCES, TRIGGER on 31 public tables
--   anon           TRUNCATE, REFERENCES, TRIGGER on 8 public tables
--
-- These come from Supabase's default `GRANT ALL ON TABLES` for the API roles,
-- which is safe for SELECT/INSERT/UPDATE/DELETE because every one of those is
-- filtered by RLS. TRUNCATE is not. It is a table-level operation with no row
-- predicate, so no policy in this database constrains it: one statement against
-- `hourly_usage` would remove every tenant's usage history at once, and the
-- isolation model would have been intact the entire time.
--
-- Nothing reachable today can issue it — PostgREST exposes no TRUNCATE verb, so
-- the API roles have a privilege they have no way to use. That is precisely why
-- it should go: it is a standing grant whose only function is to widen the blast
-- radius of some future direct-connection path.
--
-- REFERENCES and TRIGGER go with it. Neither is used by the application, and
-- both let a caller attach something of their own to a tenant table.
--
-- The four verbs the product actually uses are untouched, so this migration
-- changes no application behaviour. It is a reduction in what is possible, not
-- a change in what happens.
-- ============================================================================

do $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format('revoke truncate, references, trigger on public.%I from authenticated, anon;', t.relname);
  end loop;
end;
$$;

-- Future tables must not reacquire them. Supabase's defaults are attached to
-- the `postgres` role, which is what migrations run as.
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from authenticated, anon;

-- ── A trigger function is not an API ────────────────────────────────────────
--
-- PostgreSQL grants EXECUTE on new functions to PUBLIC, and any function in
-- `public` is published by PostgREST at /rest/v1/rpc/<name>. That made the
-- last-owner trigger callable directly by any signed-in user. Calling it
-- outside a trigger raises rather than doing damage, but an endpoint that
-- exists only to fail is still an endpoint.
--
-- Trigger permissions are checked when the trigger is CREATED, not when it
-- fires, so removing this does not affect enforcement.
revoke execute on function public.enforce_last_owner() from public, anon, authenticated;

-- Same reasoning for the other trigger function in the schema.
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
