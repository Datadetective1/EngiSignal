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

There is deliberately no service-role key in that list. Every database call the application makes runs as the signed-in user, so Row Level Security is what enforces tenant isolation. Do not add `SUPABASE_SERVICE_ROLE_KEY` to the deployment: no code path reads it, and a key that bypasses RLS only widens the blast radius if the environment leaks.

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
