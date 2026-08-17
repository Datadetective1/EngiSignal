-- ── PAGING A FULL ESTATE WITHOUT WALKING PAST IT EVERY TIME ─────────────────
--
-- The canonical reads page by cursor rather than by offset: each page asks for
-- the rows AFTER the last id it saw, filtered to one organization. Without an
-- index that carries both columns, Postgres seeks on the primary key and
-- filters the organization out row by row — which is fine on page one and
-- steadily worse on page sixty, and worse again once a second tenant's rows are
-- interleaved with the first tenant's.
--
-- Measured on the production table at 67,267 rows before this index: an offset
-- read of page 61 walked 61,000 rows and took 141 ms of database time, and
-- eight such pages in flight together exceeded the 8-second statement timeout
-- and returned an incomplete estate. The cursor read removes the offset; this
-- index makes the seek itself an index seek.
--
-- Additive and reversible. No column, constraint, policy or existing index is
-- changed, and nothing reads differently as a result — only faster.

create index if not exists ingestion_usage_org_id_idx
  on public.ingestion_usage (organization_id, id);

create index if not exists ingestion_people_org_id_idx
  on public.ingestion_people (organization_id, id);

create index if not exists ingestion_entitlements_org_id_idx
  on public.ingestion_entitlements (organization_id, id);

create index if not exists ingestion_contracts_org_id_idx
  on public.ingestion_contracts (organization_id, id);

-- The same page is also read filtered to a single import, on the delete and
-- re-import path. Same reasoning.
create index if not exists ingestion_usage_import_id_idx
  on public.ingestion_usage (import_id, id);
