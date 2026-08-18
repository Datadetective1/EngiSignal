-- ── THE PROJECTION BECOMES A JOB ────────────────────────────────────────────
--
-- Applied to production in three parts; kept together here because they are one
-- change. Ingestion already had durable jobs: claimed, leased, heartbeated,
-- reaped. The projection had a claim and a lease and no scheduler, so it was
-- started by whoever rendered a page.
--
-- HOW THE DATABASE KNOWS A BUILD IS OWED
--
-- Staleness is an evidence key computed in TypeScript from stored counts,
-- import ids and confirmations. Reimplementing that hash in SQL would create
-- two definitions of one fact. So the database records only that evidence
-- CHANGED, and the worker computes the key exactly as the reader does.

alter table public.analytics_projections
  add column if not exists dirty_since timestamptz;

comment on column public.analytics_projections.dirty_since is
  'When this tenant''s evidence last changed. Non-null means a build is owed.';

create index if not exists analytics_projections_dirty_idx
  on public.analytics_projections (dirty_since)
  where dirty_since is not null;

-- Creates the row if this is the tenant's first import: a projection that does
-- not exist yet is the most stale a projection can be.
create or replace function public.mark_projection_dirty(org uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.analytics_projections as p
    (organization_id, version, state, dirty_since, build_attempt)
  values (org, 0, 'failed', now(), 0)
  on conflict (organization_id) do update
    set dirty_since = now(), updated_at = now();
$$;
revoke all on function public.mark_projection_dirty(uuid) from public, anon, authenticated;

-- complete_import_job now marks the tenant dirty in the same statement that
-- marks the import complete, so there is no window where rows are durable and
-- nothing knows the analysis is stale. (Full body applied in production; it is
-- the Phase 2G function with `perform public.mark_projection_dirty(org);`
-- added after the status update.)

-- ── WHAT THE WORKER MAY DO ──────────────────────────────────────────────────
--
-- claim_projection_job takes no organization argument, exactly like the
-- ingestion claim: the worker asks what needs building and is given one. Every
-- read is then scoped by that token, so its reach is the claim it currently
-- holds rather than a standing grant -- it still has zero table privileges.
--
--   claim_projection_job(lease_seconds)  -> (organization_id, name, token, attempt)
--   heartbeat_projection_job(token)      -> bool
--   publish_projection_job(token, ...)   -> ready | superseded | integrity_failed
--   fail_projection_job(token, reason)   -> failed | superseded
--   projection_rows(token, which)        -> setof jsonb
--   projection_stored_counts(token)      -> jsonb
--
-- publish clears dirty_since only when nothing arrived while the build ran:
--
--   dirty_since = case when dirty > started then dirty else null end
--
-- Evidence landing mid-build therefore leaves the tenant dirty and it is
-- claimed again, so a customer is never shown an analysis of rows that have
-- already changed.
--
-- projection_rows returns jsonb so the worker maps rows with the same code that
-- maps rows arriving over PostgREST. Two mappers for one shape is how a column
-- quietly ends up in the wrong place.
--
-- All six are revoked from public, anon and authenticated, and granted only to
-- ingestion_worker. Verified in production: the role still holds zero table
-- privileges, and none of these is reachable by a signed-in customer.
