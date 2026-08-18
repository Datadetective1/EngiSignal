-- ── A CLEAN YIELD SHOULD COST NOTHING. IT WAS COSTING A LEASE. ──────────────
--
-- The runner stops at its time budget and returns `yielded`, under a comment
-- claiming that "stopping here costs nothing but a scheduling round trip". It
-- did not. It returned while still holding the claim, and claim_import_job only
-- takes an `importing` job whose lease has EXPIRED -- so the successor it woke
-- could not continue the work, and the job stalled until the lease lapsed.
--
-- This is what the 466K run showed as abandoned claims, attempt 2, and workers
-- apparently cut off mid-write. Nothing was ever cut off. Every one of them had
-- stopped politely, exactly as designed, and was then locked out by its own
-- lease. Diagnosed only after checking the yield path against the claim
-- condition; the Vercel logs for this project are not readable from here, and
-- guessing at a platform timeout would have been wrong.
--
-- Two faults, both fixed here.
--
-- RELEASING. A worker that yields hands the claim back, so the next invocation
-- resumes from the checkpoint at once rather than waiting out the lease.
--
-- COUNTING. `attempt` decides when an import has failed too often, and every
-- claim incremented it -- including claims that were ordinary progress. A large
-- estate that yields three times spent three of its five attempts succeeding.
-- A yield is not an attempt, so the counter is returned as well.
create or replace function public.release_import_job(job uuid, token uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  update public.imports
  set worker_token = null,
      lease_expires_at = now() - interval '1 second',
      attempt = greatest(0, attempt - 1),
      heartbeat_at = now()
  where id = job and worker_token = token and status = 'importing'
  returning true;
$$;

revoke all on function public.release_import_job(uuid, uuid) from public, anon, authenticated;
grant execute on function public.release_import_job(uuid, uuid) to ingestion_worker;
