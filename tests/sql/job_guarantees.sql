-- ── THE GUARANTEES THE DATABASE MAKES, EXERCISED AGAINST IT ─────────────────
--
-- The runner's unit tests drive a fake that answers the way these functions are
-- believed to answer. This proves the belief. Every claim the ingestion job
-- rests on is decided by one conditional statement in Postgres, and a
-- conditional statement is either demonstrated or it is a hope:
--
--   two workers cannot hold one import
--   a superseded worker cannot advance the checkpoint
--   a re-sent slice cannot duplicate rows
--   an abandoned job returns to the queue
--   a payload cannot place a row in another tenant
--   an import cannot be completed while rows are missing
--
-- Run against the target database, as a role that may create temporary
-- functions. Substitute an organization that exists. It cleans up after itself.
--
--   psql "$DATABASE_URL" -f tests/sql/job_guarantees.sql
--
-- Every row of the result must read PASS.

create or replace function pg_temp.job_guarantees(org uuid)
returns table(scenario text, result text)
language plpgsql as $$
declare
  other_org uuid := gen_random_uuid();
  imp uuid := gen_random_uuid();
  tok uuid; tok2 uuid; n integer; rowset jsonb; mark integer; verdict text;
begin
  insert into public.imports (id, organization_id, kind, dataset, source_system, file_name,
    file_bytes, row_count, accepted_rows, rejected_rows, duplicate_rows, status,
    uploaded_at, source_path, rows_persisted)
  values (imp, org, 'usage', 'usage', 'generic', 'race.csv', 1, 3, 3, 0, 0, 'queued',
    now(), org || '/' || imp, 0);

  -- Row 1 deliberately carries a foreign organization_id. The function must
  -- take the tenant from the import row and ignore what the payload claims.
  rowset := jsonb_build_array(
    jsonb_build_object('usage_date','2026-01-01','hour',1,'raw_feature','f','source_system','generic',
                       'source_file','race.csv','source_row',1,'organization_id', other_org),
    jsonb_build_object('usage_date','2026-01-01','hour',2,'raw_feature','f','source_system','generic',
                       'source_file','race.csv','source_row',2),
    jsonb_build_object('usage_date','2026-01-01','hour',3,'raw_feature','f','source_system','generic',
                       'source_file','race.csv','source_row',3));

  select j.token into tok from public.claim_import_job(60) j where j.import_id = imp;
  scenario := 'first worker claims the job';
  result := case when tok is not null then 'PASS' else 'FAIL' end; return next;

  select count(*) into n from public.claim_import_job(60) j where j.import_id = imp;
  scenario := 'second worker is refused a live claim';
  result := case when n = 0 then 'PASS' else 'FAIL: claimed twice' end; return next;

  select public.persist_import_slice(imp, gen_random_uuid(), rowset, 0) into mark;
  scenario := 'wrong token cannot advance the checkpoint';
  result := case when mark = -1 then 'PASS' else 'FAIL: got ' || mark end; return next;

  select public.persist_import_slice(imp, tok, rowset, 99) into mark;
  scenario := 'wrong offset is refused';
  result := case when mark = -2 then 'PASS' else 'FAIL: got ' || mark end; return next;

  select public.persist_import_slice(imp, tok, rowset, 0) into mark;
  scenario := 'slice writes and moves the checkpoint';
  result := case when mark = 3 then 'PASS' else 'FAIL: got ' || mark end; return next;

  select count(*) into n from public.ingestion_usage
   where import_id = imp and organization_id = other_org;
  scenario := 'payload cannot place a row in another tenant';
  result := case when n = 0 then 'PASS' else 'FAIL: ' || n || ' rows escaped' end; return next;

  -- Rewind the checkpoint and re-send: this is exactly what a worker that died
  -- after writing but before recording does on resume.
  update public.imports set rows_persisted = 0 where id = imp;
  select public.persist_import_slice(imp, tok, rowset, 0) into mark;
  select count(*) into n from public.ingestion_usage where import_id = imp;
  scenario := 'a re-sent slice writes no duplicates';
  result := case when n = 3 then 'PASS' else 'FAIL: ' || n || ' rows stored' end; return next;

  update public.imports set lease_expires_at = now() - interval '5 minutes' where id = imp;
  select j.token into tok2 from public.claim_import_job(60) j where j.import_id = imp;
  scenario := 'an abandoned job is reclaimed by the next worker';
  result := case when tok2 is not null and tok2 <> tok then 'PASS' else 'FAIL' end; return next;

  select public.persist_import_slice(imp, tok, rowset, 3) into mark;
  scenario := 'the superseded worker is locked out';
  result := case when mark = -1 then 'PASS' else 'FAIL: got ' || mark end; return next;

  update public.imports set accepted_rows = 99 where id = imp;
  select public.complete_import_job(imp, tok2) into verdict;
  select i.status::text into result from public.imports i where i.id = imp;
  scenario := 'completion refused when stored rows do not match accepted';
  result := case when verdict = 'integrity_failed' and result = 'failed' then 'PASS'
                 else 'FAIL: ' || verdict || '/' || result end; return next;

  delete from public.imports where id = imp;
end $$;

-- Replace with an organization id that exists in the target database.
-- select * from pg_temp.job_guarantees('00000000-0000-0000-0000-000000000000');
