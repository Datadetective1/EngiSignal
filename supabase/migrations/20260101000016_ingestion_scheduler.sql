-- ── THE SCHEDULE LIVES IN THE DATABASE ──────────────────────────────────────
--
-- Every previous attempt at background work in this codebase was tied to a
-- request. Phase 2E did the analysis inside the import. Phase 2F moved it to
-- `after()`, which runs past the response but dies with the invocation -- and
-- then to page reads, so recovery only happened if somebody happened to look.
-- Each was less coupled than the last, and each still needed a request to
-- exist.
--
-- pg_cron does not. It fires on the database's own clock, so an import makes
-- progress with no browser open, no session alive and no request in flight. A
-- customer can upload a 466,000-row file, close the tab, and come back to a
-- finished import.
--
-- pg_net posts asynchronously, so a slow or hung worker cannot block the tick
-- that would otherwise start its replacement.
--
-- The bulk loaders added earlier in this phase are dropped here: they were
-- built for a synchronous path that no longer exists, and leaving an unused
-- way to write customer rows is a surface with no purpose.

drop function if exists public.bulk_insert_usage(jsonb, uuid, uuid);
drop function if exists public.bulk_insert_entitlements(jsonb, uuid, uuid);
drop function if exists public.bulk_insert_people(jsonb, uuid, uuid);
drop function if exists public.bulk_insert_contracts(jsonb, uuid, uuid);
drop function if exists public.bulk_insert_rejections(jsonb, uuid, uuid);

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── SECRETS ARE NOT IN THIS FILE ────────────────────────────────────────────
--
-- The scheduler presents a bearer secret, and it is held in Vault rather than
-- written into the job definition -- a command in cron.job is readable by
-- anyone who can list schedules, and this repository is not where a shared
-- secret belongs either. Both values are created once, out of band:
--
--   select vault.create_secret('<CRON_SECRET>', 'ingestion_worker_secret',
--     'Bearer secret the database presents when waking the ingestion worker.');
--   select vault.create_secret('https://www.engisignal.com', 'engisignal_site_url',
--     'Origin the scheduler wakes the ingestion worker on.');
--
-- The same CRON_SECRET is set in the deployment environment, where the worker
-- endpoint compares it in constant time before doing anything at all.

create or replace function private.wake_ingestion_worker()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  site text;
  secret text;
begin
  select decrypted_secret into site
  from vault.decrypted_secrets where name = 'engisignal_site_url';
  select decrypted_secret into secret
  from vault.decrypted_secrets where name = 'ingestion_worker_secret';

  -- A missing secret must not look like an idle queue. Warned, so the reason
  -- imports are not moving is recoverable from the database's own log.
  if site is null or secret is null then
    raise warning 'Ingestion worker is not configured; no request sent.';
    return null;
  end if;

  return net.http_post(
    url := site || '/api/jobs/ingestion',
    headers := jsonb_build_object(
      'authorization', 'Bearer ' || secret,
      'content-type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
end;
$$;

revoke all on function private.wake_ingestion_worker() from public, anon, authenticated;

-- Every minute: drain whatever is queued. A tick with nothing to do costs one
-- claim that returns no rows.
select cron.schedule('drain-ingestion-queue', '* * * * *', $$select private.wake_ingestion_worker();$$);

-- Every minute: return abandoned jobs to the queue. The claim already reclaims
-- an expired lease, so this exists to record WHY a job went back -- a job that
-- silently became claimable again would look identical to one that had never
-- been started, and the customer would have no way to tell a retry from a stall.
select cron.schedule('reap-stale-imports', '* * * * *', $$select public.reap_stale_import_jobs();$$);
