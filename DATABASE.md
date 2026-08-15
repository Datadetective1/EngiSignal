# EngiSignal — Database

Postgres 17. Four migrations in `supabase/migrations/`, applied and verified against a live project.

| Migration | Purpose |
|---|---|
| `…000_init.sql` | Schema, types, indexes, triggers |
| `…001_rls.sql` | Row Level Security, policies, grants |
| `…002_harden_rls_helpers.sql` | Move helpers out of the API-exposed schema; pin `search_path` |
| `…003_fk_indexes.sql` | Covering indexes for every foreign key |

---

## 1. Design rules

1. **Every tenant table carries `organization_id`**, `NOT NULL`, indexed, and referenced by its RLS policy. No exceptions.
2. **No vendor hierarchy is hard-coded.** Vendors, families, products and features are data. A new vendor needs no schema change.
3. **`NULL` price means unpriced, never zero.** `unit_price` is nullable so the analytics layer can report "not available" honestly.
4. **Only decisions are stored, never derived analytics.** Reclaim and decision tables hold status and ownership; impact, urgency and confidence are recomputed on read so a decision can never sit behind a stale recommendation.
5. **Queues over guesses.** `unmatched_users` and `unmapped_features` exist so unresolved data is visible rather than silently assumed.

---

## 2. Entity map

```
organizations ─┬─ organization_members            (tenancy)
               │
               ├─ vendors ── product_families ── products ── software_features
               │                                                  │
               │                                    ┌─────────────┼──────────────┐
               │                            feature_aliases  contract_items  usage tables
               │                            unmapped_features      │
               │                                                contracts
               ├─ employees ── user_feature_activity
               │           └─ unmatched_users
               │
               ├─ hourly_usage · daily_usage · token_usage_daily · denials
               ├─ imports · import_mappings
               └─ reclaim_campaigns · reclaim_campaign_items · decision_items

pilot_requests   (not tenant-scoped — arrives before an organization exists)
```

---

## 3. Normalization hierarchy

```
Vendor → Product Family → Product → Feature → Raw alias
```

`feature_aliases` maps many raw license-manager strings onto one canonical feature (`unique (organization_id, raw_value)`). Anything unmapped lands in `unmapped_features` with occurrence counts and first/last seen dates.

---

## 4. Key tables

### `daily_usage`
The substrate for every concurrent recommendation. `peak` is the maximum hourly concurrent demand on that date.

```sql
unique (organization_id, feature_id, usage_date)
index  (organization_id, feature_id, usage_date)   -- the exact analytics access path
index  (feature_id)                                -- FK / cascade path
```

### `hourly_usage`
Largest table by row count. Same indexing strategy. At 42 features × 730 days × 24 hours this is ~736k rows per tenant-year — partition by `usage_date` range before multi-year retention at scale.

### `user_feature_activity`
Per-employee, per-feature summary — the named-user substrate. Carries a partial index for the reclaim query:

```sql
index (organization_id, last_used_date) where assigned = true
```

### `denials`
`concurrent_at_denial` is the critical column. Without it a genuine capacity denial cannot be distinguished from a licensing-rule rejection that buying licenses would not have prevented — which is the difference between a justified purchase and a wasted one.

### `contract_items`
`quantity` is the entitled position; `unit_price` is the annual price per unit and is nullable.

---

## 5. Enumerated types

`org_role` · `license_model` · `employee_type` · `import_kind` · `import_status` · `reclaim_status` · `decision_type` · `decision_status`

Enums rather than free text so an invalid state cannot be written, and so the TypeScript domain types and the database agree.

---

## 6. Row Level Security

Enabled on all 24 tables. `FORCE ROW LEVEL SECURITY` additionally on the nine most sensitive, so even the table owner is subject to policy.

Helpers live in a `private` schema PostgREST does not expose:

```sql
private.is_org_member(org)   -- read
private.can_write_org(org)   -- owner | admin | analyst
private.is_org_admin(org)    -- owner | admin
```

All `SECURITY DEFINER` with `search_path = ''`. `SECURITY DEFINER` is required to prevent infinite recursion when a policy on `organization_members` queries `organization_members`.

Policy shape on every tenant table:

```sql
select → private.is_org_member(organization_id)
insert → private.can_write_org(organization_id)
update → private.can_write_org(organization_id)
delete → private.can_write_org(organization_id)
```

`pilot_requests` has an insert-only policy for `anon` and **no select policy at all** — with RLS enabled and no policy, reads are denied outright. The pipeline is reachable only with the service role.

See [SECURITY.md](SECURITY.md) for the verification results.

---

## 7. Indexing strategy

Two index families, for two different consumers:

**Analytical** — composite, leading with `organization_id`, matching how the engine actually queries: one tenant, one feature, one date range.

**Referential** — single-column on every foreign key. The composite indexes do *not* serve a lookup by the referenced column alone, which is what Postgres needs on cascade delete. Without them, removing one feature would scan the entire usage history. Raised by `get_advisors(type: performance)` and fixed in migration 003.

---

## 8. Applying

```bash
# Supabase CLI
supabase link --project-ref <ref>
supabase db push
```

Or paste each migration in order into the Supabase SQL editor.

Verify afterwards:

```
get_advisors(type: "security")     → expect 0 findings
get_advisors(type: "performance")  → expect only INFO-level unused-index notes
```

---

## 9. Scaling notes

| Concern | Threshold | Action |
|---|---|---|
| `hourly_usage` volume | > ~5M rows | Range-partition by `usage_date` |
| Daily-peak reads | > ~50 features × 24 months | Materialized view per feature-month |
| Cost allocation joins | Large `user_feature_activity` | Pre-aggregate per dimension nightly |
| Import throughput | > 500k rows | Stream via `COPY` rather than row inserts |

None of these is required at the scale the ICP implies (100–5,000 technical employees).
