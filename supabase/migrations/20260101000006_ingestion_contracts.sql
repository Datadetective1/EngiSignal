-- ============================================================================
-- EngiSignal — canonical commercial landing zone (Phase 2A)
--
-- WHY A NEW TABLE RATHER THAN WRITING INTO contracts / contract_items
--
-- public.contracts and public.contract_items are ANALYTICS-grain tables. They
-- key on vendor_id and feature_id, they hold one row per resolved feature, and
-- contracts.renewal_date is NOT NULL. A renewal spreadsheet satisfies none of
-- that on arrival:
--
--  1. IDENTITY. A commercial line names "Ansys Mechanical Enterprise" where the
--     license server says "ansys_mech_ent". Resolving one to the other is a
--     reviewable step with a real chance of being wrong, and writing straight
--     into a feature_id column would force that guess at INSERT time and lose
--     the raw string that makes it auditable.
--
--  2. NULLABILITY. Real schedules omit dates on some lines and prices on
--     others. contracts.renewal_date cannot be null, so a perpetual licence
--     would need an invented date to be storable — exactly the fabrication the
--     product exists not to commit.
--
--  3. GRAIN AND REVERSIBILITY. One feature can be bought on several POs at
--     several prices. contract_items holds one row per feature per contract, so
--     storing there would require merging lines on the way in, and a merged row
--     cannot be un-merged when one import is withdrawn.
--
-- So commercial rows land here at SOURCE GRAIN with every raw string and full
-- provenance, and Contract / ContractItem are PROJECTED from them on read — the
-- same treatment usage and entitlements already receive. Deleting an import
-- remains `delete from ingestion_contracts where import_id = $1`.
--
-- Derived values are stored ALONGSIDE their basis, never instead of it. A
-- unit_price with unit_price_basis = 'total_over_quantity' can be recomputed
-- from total_cost and quantity, which are both in the same row.
-- ============================================================================

alter type public.canonical_dataset add value if not exists 'contracts';

create table if not exists public.ingestion_contracts (
  id                  bigserial primary key,
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  import_id           uuid not null references public.imports(id) on delete cascade,

  -- Identity, exactly as the commercial document wrote it.
  raw_feature         text not null,
  raw_product         text,
  raw_vendor          text,
  sku                 text,

  contract_number     text,
  agreement_number    text,
  purchase_order      text,
  supplier            text,

  -- Commercial. Non-negative: a negative price on a schedule is a credit note
  -- or a sign convention, not a licence that costs less than nothing, and
  -- letting one through would subtract from portfolio spend.
  quantity            integer check (quantity is null or quantity >= 0),
  unit_price          numeric(14,2) check (unit_price is null or unit_price >= 0),
  total_cost          numeric(16,2) check (total_cost is null or total_cost >= 0),
  annual_cost         numeric(16,2) check (annual_cost is null or annual_cost >= 0),
  -- ISO 4217, or null when the file did not say. Never defaulted.
  currency            text check (currency is null or currency ~ '^[A-Z]{3}$'),
  license_model       text not null default 'unknown'
    check (license_model in ('concurrent','named_user','token','node_locked','unknown')),
  pricing_unit        text,

  contract_start_date date,
  contract_end_date   date,
  renewal_date        date,

  business_unit       text,
  cost_center         text,
  owner               text,
  notes               text,

  -- How each figure was obtained, so the number can be defended.
  unit_price_basis    text not null default 'none'
    check (unit_price_basis in (
      'supplied_unit_price','supplied_annual_cost','supplied_total_cost',
      'quantity_x_unit','total_over_quantity','none')),
  annual_cost_basis   text not null default 'none'
    check (annual_cost_basis in (
      'supplied_unit_price','supplied_annual_cost','supplied_total_cost',
      'quantity_x_unit','total_over_quantity','none')),
  multi_year_total    boolean not null default false,

  source_system       public.ingestion_source not null,
  source_file         text not null,
  source_sheet        text,
  source_row          integer not null,

  created_at          timestamptz not null default now(),

  -- A term cannot end before it begins. Enforced here as well as in the
  -- normalizer so a future writer cannot bypass the rule.
  constraint ingestion_contracts_term_order
    check (contract_start_date is null or contract_end_date is null
           or contract_end_date >= contract_start_date)
);

create unique index if not exists ingestion_contracts_row_key
  on public.ingestion_contracts (import_id, source_sheet, source_row)
  nulls not distinct;

create index if not exists ingestion_contracts_org_idx
  on public.ingestion_contracts (organization_id, raw_feature);
create index if not exists ingestion_contracts_import_idx
  on public.ingestion_contracts (import_id);
-- Renewal exposure scans by date within a tenant.
create index if not exists ingestion_contracts_renewal_idx
  on public.ingestion_contracts (organization_id, renewal_date)
  where renewal_date is not null;

-- ── Row Level Security ──────────────────────────────────────────────────────
-- Identical shape to the other ingestion tables: read for members, write for
-- owner/admin/analyst, organization_id named explicitly, no permissive
-- fallback, and FORCE so even a table owner is subject to it.

alter table public.ingestion_contracts enable row level security;
alter table public.ingestion_contracts force row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ingestion_contracts'
      and policyname = 'ingestion_contracts_select'
  ) then
    create policy ingestion_contracts_select on public.ingestion_contracts
      for select to authenticated
      using (private.is_org_member(organization_id));

    create policy ingestion_contracts_insert on public.ingestion_contracts
      for insert to authenticated
      with check (private.can_write_org(organization_id));

    create policy ingestion_contracts_update on public.ingestion_contracts
      for update to authenticated
      using (private.can_write_org(organization_id))
      with check (private.can_write_org(organization_id));

    create policy ingestion_contracts_delete on public.ingestion_contracts
      for delete to authenticated
      using (private.can_write_org(organization_id));
  end if;
end;
$$;

-- Import counters gain a commercial column so the reconciliation shown to the
-- customer (accepted + rejected = rows read) stays complete for this dataset.
alter table public.imports
  add column if not exists contract_records integer not null default 0;
