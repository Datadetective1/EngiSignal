-- ── CLAIMING A BUILD ────────────────────────────────────────────────────────
--
-- Two things can try to build the same tenant's projection at the same moment:
-- the request that committed an import, and any later page read that notices
-- there is work to do. A retry after a failure is a third. All of them must be
-- safe, and none of them may produce two projections or half of one.
--
-- The claim is a single conditional UPDATE, so Postgres decides the winner with
-- a row lock and there is no window between checking and acting. A caller that
-- does not get the row does not build - it simply returns, because somebody
-- else already is.
--
-- A claim may be taken when:
--   * there is no row yet, or
--   * the row is not building, or
--   * the row IS building but its heartbeat has expired, which means the worker
--     that held it died. Without this a crashed request would leave a tenant
--     stuck BUILDING forever with no route back.
--
-- The lease is deliberately generous relative to the work: a 282k-row build
-- takes about 22 seconds, so 90 seconds of silence means dead rather than slow.
-- Reclaiming a live worker would be worse than waiting, because both would then
-- be building and only the token holder could publish - wasted work, not wrong
-- results, but wasted work at 20 seconds a time.

create or replace function public.claim_projection_build(
  org uuid,
  target_evidence_key text,
  lease_seconds integer default 90
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  token uuid := gen_random_uuid();
  claimed uuid;
begin
  if org is null or target_evidence_key is null then
    raise exception 'organization and evidence key are required' using errcode = '22023';
  end if;

  -- Membership first, from auth.uid() and nothing the caller supplied. A build
  -- is a write against one tenant's analytics; only that tenant may start one.
  if not private.can_write_org(org) then
    raise exception 'not permitted to build for this organization' using errcode = '42501';
  end if;

  insert into public.analytics_projections as p
    (organization_id, version, evidence_key, state, building_evidence_key,
     build_started_at, build_attempt, worker_token, heartbeat_at, stored_rows, analyzed_rows)
  values
    (org, 0, null, 'building', target_evidence_key,
     now(), 1, token, now(), null, null)
  on conflict (organization_id) do update
    set state = 'building',
        building_evidence_key = excluded.building_evidence_key,
        build_started_at = now(),
        build_finished_at = null,
        build_error = null,
        build_attempt = p.build_attempt + 1,
        worker_token = excluded.worker_token,
        heartbeat_at = now(),
        updated_at = now()
    where p.state <> 'building'
       or p.heartbeat_at is null
       or p.heartbeat_at < now() - make_interval(secs => lease_seconds)
  returning p.worker_token into claimed;

  -- Null means somebody else holds a live claim. That is a normal outcome, not
  -- an error: the caller stands down and the build still happens.
  return claimed;
end;
$$;

comment on function public.claim_projection_build(uuid, text, integer) is
  'Atomically claim the right to build one tenant projection. Returns a token, or null when a live claim already exists.';

revoke all on function public.claim_projection_build(uuid, text, integer) from public;
revoke all on function public.claim_projection_build(uuid, text, integer) from anon;
grant execute on function public.claim_projection_build(uuid, text, integer) to authenticated;


-- ── KEEPING A CLAIM ALIVE ───────────────────────────────────────────────────
--
-- Long builds must say they are still working, or the lease expires underneath
-- them and a second worker starts duplicating the effort.

create or replace function public.heartbeat_projection_build(org uuid, token uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  updated integer;
begin
  if not private.can_write_org(org) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  update public.analytics_projections
    set heartbeat_at = now()
    where organization_id = org
      and worker_token = token
      and state = 'building';

  get diagnostics updated = row_count;
  -- False means the claim was lost. The caller should stop rather than finish a
  -- build it is no longer entitled to publish.
  return updated > 0;
end;
$$;

revoke all on function public.heartbeat_projection_build(uuid, uuid) from public;
revoke all on function public.heartbeat_projection_build(uuid, uuid) from anon;
grant execute on function public.heartbeat_projection_build(uuid, uuid) to authenticated;


-- ── PUBLISHING A RESULT ─────────────────────────────────────────────────────
--
-- The only path from `building` to `ready`, and it refuses in three ways.
--
--   * The token must still be held. A worker that was superseded cannot publish
--     over the newer build's result.
--   * The evidence key it built must still be the one being built. If the
--     estate changed mid-build, this result is already out of date and must not
--     be presented as current.
--   * `analyzed` must equal `stored`. This is the integrity gate, enforced in
--     the database at the moment of publication rather than trusted from the
--     application - a projection built from a truncated read can never reach
--     `ready`.

create or replace function public.publish_projection_build(
  org uuid,
  token uuid,
  built_evidence_key text,
  new_payload text,
  new_payload_bytes integer,
  new_version integer,
  new_stored_rows jsonb,
  new_analyzed_rows jsonb,
  build_ms integer
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  updated integer;
begin
  if not private.can_write_org(org) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  if new_stored_rows is distinct from new_analyzed_rows then
    -- Recorded as a failure rather than silently kept building, so the customer
    -- is told the analysis did not reconcile instead of waiting forever.
    update public.analytics_projections
      set state = 'failed',
          build_finished_at = now(),
          build_error = 'Analysed rows did not equal stored rows: '
                        || new_analyzed_rows::text || ' vs ' || new_stored_rows::text,
          heartbeat_at = null,
          updated_at = now()
      where organization_id = org and worker_token = token;
    return 'integrity_failed';
  end if;

  update public.analytics_projections
    set payload = new_payload,
        payload_bytes = new_payload_bytes,
        version = new_version,
        evidence_key = built_evidence_key,
        stored_rows = new_stored_rows,
        analyzed_rows = new_analyzed_rows,
        state = 'ready',
        building_evidence_key = null,
        build_finished_at = now(),
        build_ms = publish_projection_build.build_ms,
        build_error = null,
        worker_token = null,
        heartbeat_at = null,
        computed_at = now(),
        updated_at = now()
    where organization_id = org
      and worker_token = token
      and building_evidence_key = built_evidence_key;

  get diagnostics updated = row_count;
  if updated = 0 then
    return 'superseded';
  end if;
  return 'ready';
end;
$$;

revoke all on function public.publish_projection_build(uuid, uuid, text, text, integer, integer, jsonb, jsonb, integer) from public;
revoke all on function public.publish_projection_build(uuid, uuid, text, text, integer, integer, jsonb, jsonb, integer) from anon;
grant execute on function public.publish_projection_build(uuid, uuid, text, text, integer, integer, jsonb, jsonb, integer) to authenticated;


-- ── RECORDING A FAILURE ─────────────────────────────────────────────────────
--
-- A build that throws must leave the tenant in a state a human can read and a
-- retry can act on, not stuck at `building` until the lease expires.

create or replace function public.fail_projection_build(org uuid, token uuid, reason text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  updated integer;
begin
  if not private.can_write_org(org) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  update public.analytics_projections
    set state = 'failed',
        build_finished_at = now(),
        build_error = left(coalesce(reason, 'Unknown build failure'), 500),
        worker_token = null,
        heartbeat_at = null,
        updated_at = now()
    where organization_id = org and worker_token = token;

  get diagnostics updated = row_count;
  return updated > 0;
end;
$$;

revoke all on function public.fail_projection_build(uuid, uuid, text) from public;
revoke all on function public.fail_projection_build(uuid, uuid, text) from anon;
grant execute on function public.fail_projection_build(uuid, uuid, text) to authenticated;
