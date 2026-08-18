# EngiSignal — Deployment

Target: **Vercel** (application) + **Supabase** (database and auth). The architecture is portable — the provider interface is the only coupling point — but this is the tested path.

---

## 1. Local

```bash
npm install
npm run dev
```

No environment variables required. EngiSignal runs against the deterministic synthetic organization.

---

## 2. Validate before deploying

```bash
npm run validate    # lint → typecheck → test → build
```

All four must pass. The build must succeed locally before it is pushed.

---

## 3. Supabase

### 3.1 Create and migrate

```bash
supabase link --project-ref <your-ref>
supabase db push
```

Applies all four migrations in order. Or paste each file from `supabase/migrations/` into the SQL editor in filename order.

### 3.2 Verify security immediately

```
get_advisors(type: "security")
```

**Expect zero findings.** If anything appears, do not proceed — the isolation model depends on the policies being intact.

Then run the tenant-isolation assertions documented in [SECURITY.md](SECURITY.md) §1.2. They insert two tenants, impersonate real users via JWT claims, assert isolation, and clean up after themselves.

### 3.3 Auth settings

In the Supabase dashboard:

- Set **Site URL** to your production domain
- Add your Vercel preview domain to **Redirect URLs**
- Enable email confirmation
- Consider enforcing MFA

### 3.4 Seed an organization

Real tenants need an `organizations` row and an `organization_members` row linking a Supabase `auth.users` id. Until a member row exists, RLS correctly shows that user nothing.

---

## 4. Vercel

### 4.1 Project

Import the repository. Framework preset **Next.js** is detected automatically; no build overrides are needed.

> `outputFileTracingRoot` is pinned in `next.config.ts`. Without it Next walks up looking for a lockfile and can select a parent directory, pulling unrelated files into the build trace. Leave it set.

### 4.2 Environment variables

Minimum for a synthetic-data preview — none. It deploys and runs.

For a real deployment:

```
ENGISIGNAL_DATA_PROVIDER=supabase
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
NEXT_PUBLIC_SITE_URL=https://your-domain.com
```

Optional:

```
ENGISIGNAL_AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=<key>
ENGISIGNAL_AI_MODEL=claude-sonnet-5
NEXT_PUBLIC_SUPPORT_EMAIL=support@your-domain.com
NEXT_PUBLIC_PILOT_EMAIL=pilot@your-domain.com
NEXT_PUBLIC_LEGAL_ENTITY_NAME=<registered entity>
```

There is deliberately no service-role key in that list, and there still is not one. Every database call the application makes on behalf of a customer runs as the signed-in user, so Row Level Security is what enforces tenant isolation. Do not add `SUPABASE_SERVICE_ROLE_KEY` to the deployment: no code path reads it, and a key that bypasses RLS only widens the blast radius if the environment leaks.

#### The ingestion worker

Phase 2G added one identity that is not a signed-in customer, because it had to. Large imports are written by a worker on the database's own schedule, minutes after the request that uploaded the file, and a worker cannot borrow a session that has expired or a browser that has closed. Durability and borrowed credentials are incompatible.

That worker is **not** a service-role key, and **not** a JWT. Two variables carry it:

```
INGESTION_WORKER_DATABASE_URL=postgresql://ingestion_worker.<project-ref>:<password>@<pooler-host>:6543/postgres
CRON_SECRET=<same value as the database's Vault secret>
```

`INGESTION_WORKER_DATABASE_URL` connects as the `ingestion_worker` Postgres role through Supabase's **transaction** pooler. Verified against production, that role has:

- `EXECUTE` on exactly six job functions and no others — every one takes an import id and reads the organization from the import row, so no argument in its surface names a tenant;
- **no** privilege over any table in any schema — its reads of `imports`, `ingestion_usage`, `organizations`, `auth.users`, `storage.objects` and `vault.decrypted_secrets` are all refused by the database;
- membership of **no** other role, so `SET ROLE` to `postgres`, `service_role` or `authenticator` is impossible;
- `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOBYPASSRLS`, `NOINHERIT`, `NOREPLICATION`, connection limit 10.

A JWT naming the same role was rejected deliberately: any key that can sign a JWT can sign one claiming `service_role`, so the credential's real authority would be unbounded whatever role we wrote inside it. A role password cannot escalate. Supabase's own guidance agrees from the other side — the legacy JWT secret is deprecated, no longer rotatable, and retires with the legacy keys at the end of 2026.

The worker also verifies this at runtime. Before touching customer data it asserts `current_user = ingestion_worker`, that the role cannot bypass RLS, and that it holds zero memberships — and refuses to run otherwise. A credential repointed at a more privileged role fails loudly instead of quietly working.

It holds no storage credential at all. The request that accepts an upload — already authenticated as the file's owner — mints a **24-hour** signed URL for that single object and records it on the import row alongside `source_path`.

Twenty-four hours is three orders of magnitude beyond a job's real lifetime (minutes; five attempts; abandoned jobs reaped within a minute), and expiry is handled rather than avoided: if an import fails and then sits failed for longer than that, `POST /api/ingestion/imports/<id>/resume` mints a fresh URL and requeues from the existing checkpoint. That runs as the signed-in customer, so Row Level Security decides which imports are reachable. The customer sees a **Resume import** control on any failed import.

To set the role's password, generate it in the Supabase SQL editor as **hex** — Base64 can contain `+`, `/` and `=`, which are ambiguous inside a connection URI:

```sql
select encode(gen_random_bytes(24), 'hex') as new_password;
alter role ingestion_worker with password 'PASTE_VALUE_HERE';
```

`CRON_SECRET` is checked in constant time by `/api/jobs/ingestion` before it does anything, and the same value is held in the database's Vault so `pg_cron` can present it. Set both, or imports will queue and never drain.

**Neither variable may be exposed to the browser.** Never prefix either with `NEXT_PUBLIC_`.

### 4.3 Fallback behaviour

If `ENGISIGNAL_DATA_PROVIDER=supabase` is set but credentials are missing, EngiSignal **falls back to the synthetic dataset rather than failing**. A broken evaluation is worse than a local one. Confirm the active provider in **Settings → Environment** after any deploy.

---

## 5. Post-deploy checks

| Check | Expected |
|---|---|
| `/` loads, hero animates | 200 |
| Live calculator recalculates on slider move | 400 / P95 275 / 318 at +5% |
| Pilot form submits | `{ok: true}` |
| `/app` while signed out | 307 → `/signin` |
| `/api/export/portfolio` while signed out | 307, empty body |
| Sign in, open Intelligence | KPIs and Signals render |
| Evidence Drawer opens | Full derivation visible |
| Scenario Lab slider | Recommendation changes |
| CSV export | Downloads with rows |
| Settings → Environment | Correct provider shown |
| Mobile 375px | No horizontal scroll |

---

## 6. Monitoring

Sentry is the recommended target. Install:

```bash
npx @sentry/wizard@latest -i nextjs
```

Set `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`, and `SENTRY_AUTH_TOKEN` for source maps.

Worth alerting on specifically:
- `/api/import/analyze` failures — customers hit these while onboarding
- `/api/pilot` 5xx — a lost pilot request is a lost deal
- Any error inside `lib/analytics/**` — that surface is pure and tested, so an error there indicates malformed input reaching it

---

## 7. Performance notes

The landing page is statically prerendered and includes the synthetic dataset generation at build time (for the live calculator's real demand series). This adds a second or two to the build and nothing to runtime.

Application routes are server-rendered on demand because they are session-scoped. The heaviest client bundles are Scenario Lab (~8.5 kB) and the import workflow (~4.6 kB); shared JS is ~103 kB.

---

## 8. Rollback

Vercel keeps every deployment. Promote a previous one from the dashboard.

Database migrations are additive and do not drop tenant data. Migration 002 drops three helper *functions* after repointing every policy — rolling back the application without rolling back the database is safe.
