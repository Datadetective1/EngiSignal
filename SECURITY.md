# EngiSignal — Security

## 1. Tenant isolation

Isolation is enforced in three independent layers. A defect in any one does not leak data.

| Layer | Mechanism |
|---|---|
| **Database** | Row Level Security on every tenant table, with `FORCE ROW LEVEL SECURITY` on the sensitive ones so even the table owner is subject to policy |
| **Server** | Every data access resolves the active organization from the session and passes it explicitly. There is no ambient or global organization |
| **Type** | `DataProvider` methods require an `orgId` argument. Omitting it is a compile error |

### 1.1 Policy model

Helper functions live in a `private` schema that PostgREST does not expose, so they are not reachable as RPC endpoints:

```sql
private.is_org_member(org)  -- any member
private.can_write_org(org)  -- owner | admin | analyst
private.is_org_admin(org)   -- owner | admin
```

All three are `SECURITY DEFINER` with `search_path = ''`. `SECURITY DEFINER` is required to avoid infinite recursion when a policy on `organization_members` needs to query `organization_members`. The pinned empty `search_path` prevents object-shadowing privilege escalation.

Read access is granted to any member; write access to analytical tables requires owner, admin or analyst. **A viewer cannot alter the numbers behind a purchasing decision.**

### 1.2 Verified, not assumed

Tenant isolation is proven against a live Postgres 17 instance by impersonating real authenticated users — setting the JWT claim that `auth.uid()` reads — and asserting behaviour:

| Assertion | Result |
|---|---|
| Member reads own tenant | 1 row ✅ |
| Member reads another tenant | 0 rows ✅ |
| Member lists organizations | own only ✅ |
| Second tenant reads first tenant | 0 rows ✅ |
| Viewer-role member writes analytical data | denied ✅ |
| Anonymous reads employees | denied ✅ |
| Anonymous reads organizations | denied ✅ |
| Anonymous submits a pilot request | allowed ✅ |
| Anonymous reads the pilot pipeline | denied ✅ |

Re-verified after the hardening migration repointed every policy.

**Supabase security advisors: 0 findings.**

### 1.3 Findings fixed during hardening

1. **SECURITY DEFINER functions exposed as RPC.** The RLS helpers originally lived in `public`, which PostgREST publishes at `/rest/v1/rpc/…`. They leak nothing — they only answer questions about the caller's own membership — but an internet-reachable `SECURITY DEFINER` endpoint is attack surface with no upside. Moved to `private`.
2. **Mutable `search_path` on a trigger function.** `touch_updated_at` had an unpinned search path, a privilege-escalation vector. Pinned to `''`.

---

## 2. Authentication

Two modes behind one interface.

**Supabase Auth** (production) — activated when `ENGISIGNAL_DATA_PROVIDER=supabase` and credentials are present. Sessions are Supabase-issued; RLS enforces authorization in the database.

**Evaluation session** (default) — an httpOnly, `SameSite=Lax`, `Secure`-in-production cookie holding only an email. Any work email opens the synthetic demo workspace.

> The evaluation session **is not an authentication system**. It exists so EngiSignal can be evaluated with zero setup against synthetic data. The UI states this on the sign-in page and in Settings. Do not deploy it as the auth mechanism for real tenant data — configure Supabase.

Every authenticated route calls `requireSession()` first, which redirects to `/signin`. Verified: unauthenticated requests to `/app`, `/app/*` and every `/api/export/*` route return **307 to /signin with no body**.

---

## 3. Input validation

Zod at every boundary — pilot requests, Ask questions, import requests. Server-side validation runs regardless of what the client did.

**Import validation** deserves specific mention. `parseDateValue` originally fell through to JavaScript's `new Date(value)`, which invents dates from nonsense: `new Date('bad-1')` returns 2001-01-01. Garbage in a date column would have been silently accepted and the usage placed in the wrong year — quietly removing it from the analysis window and understating demand with no trace. The parser now requires a recognizable date shape, validates calendar components, and rejects years outside 1990–2100.

---

## 4. Upload handling

| Control | Value |
|---|---|
| Accepted extensions | `.csv`, `.tsv`, `.txt`, `.xlsx`, `.xlsm` |
| Content validation | By parsing, not by filename |
| Size limit | 25 MB (`ENGISIGNAL_MAX_UPLOAD_BYTES`) |
| Row limit | 500,000 (`ENGISIGNAL_MAX_IMPORT_ROWS`) |
| Truncation | Reported explicitly, never silent |
| Auth | Required — the analyze endpoint rejects anonymous requests |

---

## 5. Output handling

**CSV injection is neutralized.** Values beginning `=`, `+`, `-` or `@` are prefixed with a single quote before export, so a product or employee name cannot execute as a formula when the file is opened in a spreadsheet.

---

## 6. Rate limiting

The public pilot endpoint is limited to 5 requests per IP per minute. It is the only unauthenticated write path.

> The current limiter is in-process. On a multi-instance deployment it limits per instance; move it to a shared store (Upstash, Redis) before relying on it at scale.

---

## 7. Secrets

- No secret is committed. `.env*.local` is gitignored.
- `.env.example` documents every variable with its purpose.
- The application holds no service-role key at all. Every database call runs as the signed-in user, so Row Level Security is the enforcement boundary rather than a second line of defence behind privileged code. `SUPABASE_SERVICE_ROLE_KEY` is not read by any code path and should not be set in the deployment environment.
- AI provider keys are read server-side only; the browser never sees them.
- Connector credentials are typed `secret?: string` with an explicit contract that they are never logged or persisted in plain text.

---

## 8. HTTP headers

Set globally in `next.config.ts`:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
X-Powered-By: removed
```

---

## 9. AI safety

The AI layer cannot fabricate a financial figure by construction:

1. Deterministic retrieval runs **first and always**, producing the facts.
2. A model, when configured, receives those facts and is asked only to phrase them.
3. The system prompt forbids calculating, estimating, rounding differently or recalling any figure.
4. A model failure falls back to the deterministic narrative — the numbers do not change.

With no API key the product is fully functional; that path is not degraded, it is the same numbers phrased from templates.

---

## 10. Known gaps

Honest inventory of what is **not** implemented:

| Gap | Impact | Recommendation |
|---|---|---|
| Evaluation auth is not real auth | Must not front real tenant data | Configure Supabase before any real data |
| In-process rate limiting | Ineffective across instances | Shared store before scale |
| No CSP header | Reduced XSS defence-in-depth | Add a nonce-based CSP |
| No audit log of reads | Cannot prove who viewed what | Add if required by customer compliance |
| No SSO/SCIM | Enterprise onboarding friction | v2 |
| No MFA enforcement | Depends on Supabase project settings | Enable in Supabase Auth |
| Workflow state in memory (mock mode) | Resets on restart | Expected for evaluation; Supabase persists |
| No penetration test | Unknown unknowns | Before production with real customer data |

---

## 11. Reporting a vulnerability

Email the address in `config/brand.ts` (`brand.contact.support`). Please do not open a public issue for a security report.
