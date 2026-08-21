-- ============================================================================
-- Three things every major licence manager reports and EngiSignal was dropping.
--
-- hostname  The client machine a licence was issued to. FlexNet, RLM and LM-X
--           all name it. It is how an administrator distinguishes one engineer
--           on two workstations from two engineers, and the only way to find a
--           licence pinned to a machine that no longer exists.
--
-- version   A feature version is part of the licence identity, not decoration.
--           FlexNet issues MECH_ENT v2024 and MECH_ENT v2025 from separate
--           pools; collapsing them reports one product with twice the demand
--           and recommends a quantity for a pool that does not exist.
--
-- borrowed  A borrowed (or roamed) licence is checked out to an offline machine
--           and unavailable to anyone else — but nobody is using it. Counting
--           it as demand overstates the peak and buys capacity the estate does
--           not need.
--
-- ── WHY ALL THREE ARE NULLABLE WITH NO DEFAULT ──────────────────────────────
--
-- `borrowed boolean` without a default is the important one. A default of false
-- would silently assert "nothing was borrowed" about every row from every
-- source that cannot report borrowing at all, which is the exact class of
-- fabricated zero this product exists not to produce. NULL means "not
-- reported", and the analytics layer can tell the two apart.
--
-- Purely additive: existing rows get NULL, nothing is rewritten, and no
-- analysis changes until a file actually carries these columns.
-- ============================================================================

alter table public.ingestion_usage
  add column if not exists hostname text,
  add column if not exists version  text,
  add column if not exists borrowed boolean;

-- Borrowed licences are looked up as a subset of a tenant's usage, never
-- globally, so the index is partial: it indexes only the rows that said
-- anything at all, which on most estates is none of them.
create index if not exists ingestion_usage_borrowed_idx
  on public.ingestion_usage (organization_id, raw_feature)
  where borrowed is true;

comment on column public.ingestion_usage.hostname is
  'Client machine the licence was issued to. NULL when the source did not report one.';
comment on column public.ingestion_usage.version is
  'Feature version as reported by the licence manager. NULL when not reported.';
comment on column public.ingestion_usage.borrowed is
  'TRUE when borrowed/roamed, FALSE when explicitly not, NULL when the source cannot report borrowing.';
