-- ── WHERE THE EVIDENCE WAITS ────────────────────────────────────────────────
--
-- Persistence now happens after the request returns, which means the rows have
-- to be reconstructable minutes later by a process that was not there when the
-- customer clicked import. The customer's own file is what makes that safe: it
-- is stored before the job is queued, and the worker re-reads exactly the bytes
-- that were uploaded rather than anything held in memory or reconstructed.
--
-- Objects are keyed {organization_id}/{import_id}, so the first path segment is
-- the tenant and every policy below pivots on it, using the same membership
-- predicates that already govern the imports table itself.

insert into storage.buckets (id, name, public, file_size_limit)
values ('ingestion-sources', 'ingestion-sources', false, 104857600)
on conflict (id) do update set public = false, file_size_limit = 104857600;

drop policy if exists "ingestion sources: tenant writes own folder" on storage.objects;
create policy "ingestion sources: tenant writes own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'ingestion-sources'
    and private.can_write_org(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "ingestion sources: tenant reads own folder" on storage.objects;
create policy "ingestion sources: tenant reads own folder"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'ingestion-sources'
    and private.is_org_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "ingestion sources: tenant deletes own folder" on storage.objects;
create policy "ingestion sources: tenant deletes own folder"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'ingestion-sources'
    and private.can_write_org(((storage.foldername(name))[1])::uuid)
  );

-- The worker reads uploads and nothing else. This is the only table privilege
-- it holds anywhere in the database, and the policy confines it to one bucket.
grant select on storage.objects to ingestion_worker;
drop policy if exists "ingestion sources: worker reads" on storage.objects;
create policy "ingestion sources: worker reads"
  on storage.objects for select to ingestion_worker
  using (bucket_id = 'ingestion-sources');
