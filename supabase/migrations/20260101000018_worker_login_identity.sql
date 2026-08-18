-- ── THE WORKER STOPS CARRYING A TOKEN AND CARRIES A ROLE ────────────────────
--
-- The first design authenticated the worker with a JWT naming this same narrow
-- role, signed with the project's JWT secret. It was replaced before it ever
-- ran, for a reason worth recording: any key able to sign a JWT can sign one
-- that claims `service_role`. The role written inside a token does not bound
-- the authority of the key that signed it, so the credential's real blast
-- radius was "everything" no matter how narrow the role we chose.
--
-- A role password cannot escalate. Its authority is exactly the grants attached
-- to the role, and those are inspectable here rather than asserted in a claim.
-- Supabase's own guidance points the same way: the legacy JWT secret is
-- deprecated, no longer rotatable, and retires with the legacy keys end of 2026.
--
-- NOSUPERUSER and NOREPLICATION are deliberately absent below: altering either
-- requires the SUPERUSER attribute, which `postgres` does not have on this
-- platform. Both are already false, and are asserted by the audit query at the
-- foot of this file rather than set here.
--
-- NOINHERIT is kept because the role is a member of nothing. Inheritance would
-- grant it exactly nothing today, and would silently grant it whatever it was
-- ever added to tomorrow.
alter role ingestion_worker
  with login
       nocreatedb
       nocreaterole
       nobypassrls
       noinherit
       -- Bounds a serverless connection storm. The worker opens one connection
       -- per invocation; anything approaching this is a bug, not load.
       connection limit 10;

-- PostgREST is no longer how the worker reaches the database, so nothing should
-- be able to assume this role by presenting a JWT that names it.
revoke ingestion_worker from authenticator;

-- The file is now reached through a signed URL for one object, minted by the
-- request that already owns it. The worker needs no privilege over storage at
-- all, and this was its only table grant anywhere.
revoke select on storage.objects from ingestion_worker;
drop policy if exists "ingestion sources: worker reads" on storage.objects;

-- The password is NOT set here. It is set once, by hand, in the Supabase SQL
-- editor, so it never passes through a repository, a build log or a migration
-- history:
--
--   select encode(gen_random_bytes(24), 'hex') as new_password;
--   alter role ingestion_worker with password '<that value>';
--
-- Hex rather than Base64: a Base64 password can contain +, / and =, which are
-- ambiguous inside a connection URI and would have to be percent-encoded.
--
-- ── AUDIT ───────────────────────────────────────────────────────────────────
--
-- Every claim above, checked. All of these must hold:
--
--   select rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolinherit,
--          rolreplication, rolcanlogin, rolconnlimit
--     from pg_roles where rolname = 'ingestion_worker';
--   -- expect: f f f f f f t 10
--
--   select count(*) from information_schema.role_table_grants
--    where grantee = 'ingestion_worker';
--   -- expect: 0
--
--   select count(*) from pg_auth_members m join pg_roles w on w.oid = m.member
--    where w.rolname = 'ingestion_worker';
--   -- expect: 0  (SET ROLE requires membership; it has none)
--
--   select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where has_function_privilege('ingestion_worker', p.oid, 'EXECUTE')
--      and p.prosecdef;
--   -- expect: exactly the six job functions, none owned by a superuser
