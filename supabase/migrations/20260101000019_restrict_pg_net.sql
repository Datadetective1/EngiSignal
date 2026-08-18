-- ── WHAT ENABLING pg_net GRANTED, AND WHAT COULD BE TAKEN BACK ──────────────
--
-- Creating pg_net for the scheduler had a consequence I did not anticipate:
-- Supabase's platform grants USAGE on schema `net` and EXECUTE on
-- net.http_post / http_get / http_delete to `anon` and `authenticated`. In
-- principle that lets a holder of those roles make the DATABASE issue arbitrary
-- HTTP requests -- server-side request forgery from inside the network
-- boundary, reaching addresses no external caller can.
--
-- WHAT THIS MIGRATION ACHIEVES, AND WHAT IT DOES NOT
--
-- The grants were made BY supabase_admin. `postgres` is not a superuser on this
-- platform and cannot revoke another role's grants, so the statements below do
-- not remove them, and the ACL still reads:
--
--   net: anon=U/supabase_admin | authenticated=U/supabase_admin
--
-- They are kept because they are correct in intent, they remove anything
-- granted through PUBLIC, and they document the attempt. Removing the
-- supabase_admin grants requires supabase_admin.
--
-- WHY THIS IS NOT REACHABLE ANYWAY -- verified against production
--
-- `anon` and `authenticated` are PostgREST roles, and PostgREST exposes only
-- the `public` schema. Called with the project's publishable key:
--
--   POST /rest/v1/rpc/http_post   -> 404 PGRST202 (no such function in schema cache)
--   GET  /rest/v1/_http_response  -> 404 PGRST205 (no such table in schema cache)
--
-- Reaching these would need a direct Postgres session as anon or authenticated,
-- and no such credential exists: the publishable key is a JWT for PostgREST,
-- not a database password. The one database login this product issues is
-- `ingestion_worker`, which is explicitly denied below.
--
-- Recorded as a known limitation rather than presented as fixed.

revoke execute on all functions in schema net from public;
revoke usage on schema net from public;

-- The worker connects directly and never asks the database to make requests.
revoke execute on all functions in schema net from ingestion_worker;
revoke usage on schema net from ingestion_worker;

-- private.wake_ingestion_worker() is SECURITY DEFINER owned by postgres, which
-- reached net.http_post through the PUBLIC grant removed above. Granted back
-- explicitly so the scheduler keeps working -- verified: ticks continued
-- without interruption immediately after this ran.
grant usage on schema net to postgres;
grant execute on all functions in schema net to postgres;
