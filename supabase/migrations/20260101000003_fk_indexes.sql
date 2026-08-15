-- Covering indexes for foreign keys.
--
-- The analytical composite indexes lead with organization_id, which does not
-- serve a lookup by the referenced column alone. Postgres needs that lookup on
-- every cascade delete and on referential integrity checks; without it, removing
-- one feature scans the whole usage history.
--
-- Raised by `get_advisors(type: performance)` as unindexed_foreign_keys.

create index if not exists contract_items_contract_idx      on public.contract_items (contract_id);
create index if not exists contract_items_feature_fk_idx    on public.contract_items (feature_id);
create index if not exists contracts_vendor_idx             on public.contracts (vendor_id);
create index if not exists daily_usage_feature_fk_idx       on public.daily_usage (feature_id);
create index if not exists hourly_usage_feature_fk_idx      on public.hourly_usage (feature_id);
create index if not exists token_usage_feature_fk_idx       on public.token_usage_daily (feature_id);
create index if not exists denials_feature_fk_idx           on public.denials (feature_id);
create index if not exists denials_employee_fk_idx          on public.denials (employee_id);
create index if not exists feature_aliases_feature_fk_idx   on public.feature_aliases (feature_id);
create index if not exists imports_mapping_fk_idx           on public.imports (mapping_id);
create index if not exists product_families_vendor_fk_idx   on public.product_families (vendor_id);
create index if not exists products_vendor_fk_idx           on public.products (vendor_id);
create index if not exists products_family_fk_idx           on public.products (product_family_id);
create index if not exists software_features_product_fk_idx on public.software_features (product_id);
create index if not exists reclaim_items_campaign_fk_idx    on public.reclaim_campaign_items (campaign_id);
create index if not exists reclaim_campaigns_org_fk_idx     on public.reclaim_campaigns (organization_id);
create index if not exists unmapped_features_suggested_idx  on public.unmapped_features (suggested_feature_id);
create index if not exists unmatched_users_suggested_idx    on public.unmatched_users (suggested_employee_id);
create index if not exists ufa_feature_fk_idx               on public.user_feature_activity (feature_id);
create index if not exists ufa_employee_fk_idx              on public.user_feature_activity (employee_id);
