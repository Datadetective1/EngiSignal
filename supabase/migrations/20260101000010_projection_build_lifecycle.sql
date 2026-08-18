-- ── AN EXPLICIT LIFECYCLE FOR BUILDING INTELLIGENCE ─────────────────────────
--
-- Phase 2E moved the analytical computation off the read path and onto the
-- import that caused it. That was the right trade and it is finished: a page
-- read no longer traverses the estate, and a 282k-row estate reads as fast as a
-- 68k one. What it did not do is make the WRITE safe at arbitrary size. The
-- rebuild is 21.9 seconds at 282k, inside an HTTP request, and that number
-- grows with the estate while the function timeout does not.
--
-- WHY THE NEW STATES LIVE HERE AND NOT ON THE IMPORT
--
-- The suggested lifecycle was UPLOADING -> VALIDATING -> BUILDING -> READY. The
-- first two already exist: public.import_status has uploaded, analyzed,
-- mapping_review, validated, importing, complete and failed, and an import is
-- already `complete` at exactly the moment its canonical rows are durable.
-- Adding UPLOADING and VALIDATING to a second table would be two sources of
-- truth for one fact.
--
-- What genuinely does not exist is the state of the BUILD. So that is all this
-- adds, and only three stored values:
--
--   building   a build is in flight for `building_evidence_key`
--   ready      `payload` is a complete analysis of `evidence_key`
--   failed     the last attempt did not finish; `build_error` says why
--
-- STALE IS DELIBERATELY NOT STORED. A projection is stale exactly when
-- `evidence_key` differs from the evidence that exists right now, which the
-- reader already computes on every request. Storing it would create a second
-- version of that fact which could disagree with the first - and the whole
-- point of the evidence key is that staleness cannot be a matter of opinion.
--
-- The READY payload and the in-flight build are kept side by side on one row on
-- purpose: a customer who has just imported can keep reading the previous
-- analysis, correctly labelled with the evidence it came from, while its
-- replacement is built.

create type public.projection_state as enum ('building', 'ready', 'failed');

alter table public.analytics_projections
  -- Existing rows hold a complete payload for their evidence key, so they are
  -- ready by definition. A nullable column with a backfill would leave the
  -- oldest rows in an undefined state.
  add column if not exists state public.projection_state not null default 'ready',

  -- The evidence a build is working towards. Distinct from `evidence_key`,
  -- which describes the payload that is currently readable.
  add column if not exists building_evidence_key text,

  add column if not exists build_started_at timestamptz,
  add column if not exists build_finished_at timestamptz,
  add column if not exists build_attempt integer not null default 0,
  add column if not exists build_error text,

  -- The claim. A worker may only write a result while it still holds the token
  -- it claimed with, so a duplicate or resumed worker cannot overwrite a newer
  -- build's output.
  add column if not exists worker_token uuid,

  -- Liveness. A build whose heartbeat has expired may be claimed by another
  -- worker; without this a crashed request would leave a tenant BUILDING
  -- forever with no way back.
  add column if not exists heartbeat_at timestamptz;

comment on column public.analytics_projections.state is
  'building | ready | failed. Staleness is NOT stored - it is evidence_key vs the evidence that exists now.';
comment on column public.analytics_projections.worker_token is
  'Claim token. A build may only publish its result while it still holds this.';
comment on column public.analytics_projections.heartbeat_at is
  'Liveness of the in-flight build. An expired heartbeat makes the claim reclaimable.';

-- A projection row may now exist before any payload does, for a tenant whose
-- very first import is still building. There is nothing honest to put in
-- `payload` at that moment, and an empty string would deserialize into an empty
-- analysis - absence read as zero, which is the failure this codebase exists to
-- refuse.
alter table public.analytics_projections
  alter column payload drop not null,
  alter column payload_bytes drop not null,
  alter column stored_rows drop not null,
  alter column analyzed_rows drop not null,
  -- And this one, which was missed first time round: at claim time there is no
  -- key for the readable payload because there is no readable payload, and the
  -- key being built lives in building_evidence_key. Omitting it meant the very
  -- first claim for any tenant died on a not-null violation, so no build ever
  -- started - found against production, with 67,267 rows durably imported and
  -- no analysis ever produced.
  alter column evidence_key drop not null;

-- A readable payload and a state of `ready` must agree. This is the invariant
-- the whole phase rests on: nothing can be marked ready without the analysis
-- that justifies it.
alter table public.analytics_projections
  drop constraint if exists analytics_projections_ready_has_payload;
alter table public.analytics_projections
  add constraint analytics_projections_ready_has_payload
  check (state <> 'ready' or (payload is not null and evidence_key is not null));

-- Finding work to recover: tenants stuck building past their lease.
create index if not exists analytics_projections_building_idx
  on public.analytics_projections (state, heartbeat_at)
  where state = 'building';
