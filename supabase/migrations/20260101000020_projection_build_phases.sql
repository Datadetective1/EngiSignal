-- ── MEASURE THE BUILD BEFORE MOVING IT ──────────────────────────────────────
--
-- The projection rebuild is 43 seconds at 466K rows and is the largest
-- remaining cost in the product. The obvious explanation is that
-- buildFromCanonical reads every canonical row through a 1,000-row cursor --
-- 466 sequential round trips for usage alone -- but that is a hypothesis, and
-- Phase 2G spent two production deploys on a confident hypothesis about where
-- import time went. Both were wrong. The breakdown settled it.
--
-- So the build now reports where its own time goes, per stage, and the reads
-- are timed individually rather than as one figure: they run concurrently, so a
-- total would show only the slowest, and which one is slowest is the question.
alter table public.analytics_projections
  add column if not exists build_phases jsonb;

comment on column public.analytics_projections.build_phases is
  'Per-stage timings of the last build: reads per table, compute, serialize.';

-- publish_projection_build gains one argument and one assignment.
--
-- A first attempt at this rewrote the function from memory of its behaviour
-- rather than from its source, and silently dropped the can_write_org
-- authorization check, the heartbeat clearing, and the worker_token filter on
-- the failure path -- any authenticated caller could have published a
-- projection for any organization. It is reproduced faithfully below with only
-- `build_phases = new_build_phases` added.
create or replace function public.publish_projection_build(
  org uuid,
  token uuid,
  built_evidence_key text,
  new_payload text,
  new_payload_bytes integer,
  new_version integer,
  new_stored_rows jsonb,
  new_analyzed_rows jsonb,
  build_ms integer,
  new_build_phases jsonb default null
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
        build_phases = new_build_phases,
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

-- One overload only, so two cannot diverge.
drop function if exists public.publish_projection_build(uuid, uuid, text, text, integer, integer, jsonb, jsonb, integer);

revoke all on function public.publish_projection_build(uuid, uuid, text, text, integer, integer, jsonb, jsonb, integer, jsonb) from public, anon;
grant execute on function public.publish_projection_build(uuid, uuid, text, text, integer, integer, jsonb, jsonb, integer, jsonb) to authenticated;
