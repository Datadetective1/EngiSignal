-- ── ONE COMPUTED PROJECTION PER TENANT ──────────────────────────────────────
--
-- Phase 2D measured the read path at the ceiling the import page states. The
-- analytics over 67,267 usage rows take 12 ms. Getting those rows out of the
-- database took 6.9 seconds, on every page view, to recompute an answer that
-- had not changed since the last import.
--
-- This table holds the result of that computation: the analytical dataset for
-- one organization, built once when the evidence changes and read back in a
-- single round trip. Measured on the Phase 2D estate, the projection is 1.9 MB
-- against 18 MB of raw rows, and - the property that actually matters - its
-- size is governed by features x days x people, not by how many observations
-- the customer exported.
--
-- IT IS A CACHE, NOT A SOURCE. The canonical ingestion_* tables remain the only
-- evidence. Every row here is reproducible by rebuilding from them, is verified
-- against them on every single read via `evidence_key`, and may be deleted at
-- any time with no loss beyond speed.
--
-- Deliberately NOT a warehouse: one row per tenant, one payload, no fact
-- tables, no star schema, no separate query language. EngiSignal has a fixed
-- set of analytical surfaces and they all read the same dataset object.

create table if not exists public.analytics_projections (
  organization_id uuid primary key
    references public.organizations (id) on delete cascade,

  -- Bumped whenever the serialized shape changes. A payload written by an older
  -- build is ignored rather than deserialized into a structure that no longer
  -- matches, which would be a silent wrong answer rather than a slow one.
  version integer not null,

  -- Deterministic fingerprint of the canonical evidence this was built from:
  -- stored row counts, the set of completed imports, and the customer's
  -- confirmed identity decisions. Recomputed cheaply on every read and compared
  -- before the payload is trusted. A mismatch means "rebuild", never "serve it
  -- anyway".
  evidence_key text not null,

  computed_at timestamptz not null default now(),
  build_ms integer,

  -- What the build read, and what the database held when it read it. Kept
  -- alongside the payload so the integrity accounting can be answered from the
  -- projection without re-reading the estate it summarises.
  stored_rows jsonb not null,
  analyzed_rows jsonb not null,

  -- gzip + base64. Text rather than jsonb on purpose: nothing queries inside
  -- this, and compressing it in the application keeps a 1.9 MB dataset to a few
  -- hundred kilobytes on the wire, which is the whole point of the exercise.
  payload text not null,
  payload_bytes integer not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.analytics_projections is
  'Derived analytical dataset per organization. A cache over the canonical ingestion_* tables, verified against them on every read. Never a source of truth.';

alter table public.analytics_projections enable row level security;
alter table public.analytics_projections force row level security;

-- Same tenancy rule as every other tenant table: membership decides, and it is
-- evaluated server-side from auth.uid() rather than from anything the client
-- sends. A projection is derived from one tenant's evidence and must be
-- readable by exactly that tenant.
drop policy if exists analytics_projections_select on public.analytics_projections;
create policy analytics_projections_select on public.analytics_projections
  for select using (private.is_org_member(organization_id));

drop policy if exists analytics_projections_insert on public.analytics_projections;
create policy analytics_projections_insert on public.analytics_projections
  for insert with check (private.can_write_org(organization_id));

drop policy if exists analytics_projections_update on public.analytics_projections;
create policy analytics_projections_update on public.analytics_projections
  for update using (private.can_write_org(organization_id))
  with check (private.can_write_org(organization_id));

drop policy if exists analytics_projections_delete on public.analytics_projections;
create policy analytics_projections_delete on public.analytics_projections
  for delete using (private.can_write_org(organization_id));
