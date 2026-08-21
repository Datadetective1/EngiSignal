# EngiSignal — Multi-User Workspaces

Multiple people from the same company can hold their own EngiSignal accounts and
share one organization and one set of data. Authorization is decided by
**membership**, not by who created the account, and it is enforced in Postgres.

---

## 1. Architecture

### 1.1 What already existed

Most of this was here before tonight, and the work reused it rather than
building alongside it:

| Piece | State before |
|---|---|
| `organizations` | Existed |
| `organization_members` (user ↔ org ↔ role) | Existed, with an `org_role` enum |
| RLS on every tenant table, keyed on `organization_id` | Existed |
| `private.is_org_member / can_write_org / is_org_admin` | Existed |
| `bootstrap_organization()` — SECURITY DEFINER provisioning | Existed |
| Supabase Auth with real email confirmation | Existed |
| Resend transport (`lib/pilot/notify.ts`) | Existed |

The database was already multi-tenant. **What was missing was any way for a
second person to obtain a membership.** Every workspace had exactly one member —
the person who signed up.

### 1.2 What this release adds

1. An **invitation** object with a hashed, single-use, expiring, revocable token.
2. The **Owner / Admin / Member** roles the product actually needs.
3. **Database-enforced rules** about who may do what to whom.
4. A **Members** screen, an **accept** flow, and the email that carries it.
5. A fix to provisioning so an invited person is not stranded in a private
   tenant of their own.

### 1.3 Where authorization lives

In the database. The application may hide a button; it is never the thing that
stops the operation.

```
Browser ── server action ──► RPC ──► SECURITY DEFINER function
                                      │  checks caller identity from auth.uid()
                                      │  checks role via private.is_org_admin/owner
                                      │  checks invariants
                                      ▼
                              organization_members
                              (no INSERT/UPDATE/DELETE policy,
                               no grant for those verbs)
```

Server actions never read `organization_id` from a form. It comes from the
resolved workspace — and even a forged one would be refused inside the function.

---

## 2. Schema changes

### 2.1 New table: `organization_invitations`

| Column | Notes |
|---|---|
| `organization_id` | FK, `on delete cascade` |
| `email` | Stored already normalized; a CHECK enforces it |
| `role` | CHECK restricts to `admin` or `member` |
| `token_hash` | **SHA-256 hex. The token itself is never stored** |
| `invited_by`, `invited_by_email` | Who sent it |
| `created_at`, `expires_at` | CHECK enforces `expires_at > created_at` |
| `accepted_at`, `accepted_by` | Single-use marker |
| `revoked_at`, `revoked_by` | CHECK forbids both terminal states at once |

Indexes:

- `unique (token_hash)`
- `unique (organization_id, email) where accepted_at is null and revoked_at is null`
  — at most one **live** invitation per address per workspace. This is what makes
  inviting twice safe.

### 2.2 New enum value

`org_role` gains `member`. `owner` and `admin` already existed; `analyst` and
`viewer` remain valid and are labelled "(legacy)" in the interface. Nothing was
relabelled — the database and the product say the same word for the same thing.

`member` is a **writing** role: it is included in `private.can_write_org`,
because a Member is a normal user of the product who imports data and records
decisions. `viewer` remains read-only.

### 2.3 Migrations

| File | What it does |
|---|---|
| `20260101000027_member_role.sql` | Adds the `member` enum label (alone — Postgres will not let a new label be *used* in the transaction that adds it) |
| `20260101000028_workspace_invitations.sql` | The table, the five management functions, the last-owner trigger, the policy/grant lockdown, the provisioning fix, and an idempotent owner backfill |
| `20260101000029_revoke_truncate_and_trigger_grants.sql` | Removes TRUNCATE/REFERENCES/TRIGGER from `authenticated` and `anon` |
| `20260101000030_revoke_anon_on_later_tenant_tables.sql` | Revokes `anon` on seven tenant tables added after migration 1 |
| `20260101000031_invitation_read_paths.sql` | The two reads an invitee needs before they are a member, plus accept-by-id |

---

## 3. Security model

### 3.1 Membership mutation is function-only

Before this release, `organization_members` had `INSERT`/`UPDATE`/`DELETE`
policies whose only test was `is_org_admin(organization_id)`. **An admin could
therefore `PATCH /rest/v1/organization_members` and demote an owner**, because
the policy had no concept of the target row's role.

Those policies are dropped and `authenticated` holds no grant for those verbs.
Both locks are set deliberately: a policy re-added by mistake still finds no
privilege, and a grant re-added by mistake still finds no policy.

### 3.2 The five functions

All `SECURITY DEFINER`, `search_path = ''`, owned by `postgres`, `EXECUTE`
granted to `authenticated` only.

| Function | Rule it enforces |
|---|---|
| `invite_to_organization` | Caller must be owner/admin. Role must be admin or member. Rejects an existing member. Rotates the token on re-invite (retry-safe) |
| `accept_organization_invitation` | Token must be live. **The signed-in address must equal the invited address.** Membership insert is `on conflict do nothing` |
| `revoke_organization_invitation` | Caller must be owner/admin of that invitation's org. Re-revoking is a no-op, not an error |
| `remove_organization_member` | Caller must be owner/admin. **Only an Owner may remove an Owner** |
| `set_organization_member_role` | Caller must be owner/admin. **Only an Owner may change or mint an Owner** — closing the admin self-promotion path |

### 3.3 The last-owner invariant

A `BEFORE UPDATE OR DELETE` trigger on `organization_members`. It is a trigger
rather than a check inside each function because it is a property of the data —
a rule enforced in four places is one that will eventually be enforced in three.

It correctly stands aside when the parent organization is being deleted (the
cascade would otherwise make an organization undeletable).

### 3.4 Tokens

32 bytes from the platform CSPRNG, base64url (43 chars). The database stores
only `sha256(token)` and hashes the candidate itself, so the secret exists in
exactly two places: the email that carried it and the URL the recipient clicks.
**A dump of `organization_invitations` lets nobody join anything.**

### 3.5 Account-enumeration resistance

- Inviting an address behaves identically whether or not it has an EngiSignal
  account. Nothing in the response distinguishes them.
- `preview_invitation` answers only to a caller already holding a 256-bit token,
  and returns only what the invitation email already told them.
- Password reset and resend-confirmation already reported success regardless of
  whether the address exists; that is unchanged.

### 3.6 Two grants that RLS cannot filter (found and removed)

While auditing membership grants: `authenticated` held **TRUNCATE** on 31 public
tables and `anon` on 8, inherited from Supabase's default `GRANT ALL`.

SELECT/INSERT/UPDATE/DELETE are all filtered by RLS. **TRUNCATE is not** — it has
no row predicate, so no policy in this database constrains it. One statement
against `hourly_usage` would have removed every tenant's usage history while the
isolation model remained perfectly intact.

Nothing reachable could issue it (PostgREST exposes no TRUNCATE verb), which is
exactly why it should not have been standing. `REFERENCES` and `TRIGGER` went
with it, and `ALTER DEFAULT PRIVILEGES` stops future tables reacquiring them.

---

## 4. Roles and permissions

| | Owner | Admin | Member |
|---|:---:|:---:|:---:|
| See all workspace data and every page | ✅ | ✅ | ✅ |
| Import data, run analysis, record decisions, export | ✅ | ✅ | ✅ |
| Invite people | ✅ | ✅ | ❌ |
| Resend / revoke invitations | ✅ | ✅ | ❌ |
| Remove a Member or Admin | ✅ | ✅ | ❌ |
| Change a Member/Admin role | ✅ | ✅ | ❌ |
| Remove or demote an **Owner** | ✅ | ❌ | ❌ |
| Promote someone to **Owner** | ✅ | ❌ | ❌ |
| Be removed when they are the last Owner | ❌ | ❌ | — |

---

## 5. Invitation lifecycle

```
  Owner/Admin enters email + role
            │
            ▼
  invite_to_organization()          token generated in Node, only its hash stored
            │                        ├─ address already a member?  → refused
            │                        └─ live invitation exists?    → token ROTATED
            ▼
  Email sent via Resend  ──────────► /invite/<token>
            │                              │
            │                 ┌────────────┴────────────┐
            │                 │                         │
            │        has an account              brand new
            │                 │                         │
            │          sign in (token          sign up (token carried
            │           carried through)        through confirmation email)
            │                 │                         │
            │                 └────────────┬────────────┘
            │                              ▼
            │                accept_organization_invitation()
            │                   ├─ live?  ├─ email matches session?
            │                   ▼
            │                membership created  →  shared workspace
            ▼
  Revoke at any time → link dies immediately
  7 days elapse      → link dies
  Accepted           → link dies (single use)
```

**Terminal states are distinguished.** "Invalid", "revoked", "expired" and
"already accepted" each get their own sentence on the accept page, because they
need four different next actions.

### 5.1 The provisioning fix

`bootstrap_organization` is called on sign-in *and* on every workspace load, as
the backstop guaranteeing a signed-in user always has somewhere to be. For an
invited person that guarantee was actively harmful:

> They confirm their email → the app loads → a private tenant is minted for them
> → the shared workspace is nowhere in sight → and the invitation sits pending
> forever, because accepting it would be their **second** membership and the
> resolver only ever reads the first.

A pending, unexpired, unrevoked invitation now suppresses provisioning and the
function returns `null`. `loadWorkspace` sends them to `/invitations` instead of
a 404.

---

## 6. Email

Uses the **existing verified Resend infrastructure** — deliberately the same
`PILOT_NOTIFY_RESEND_API_KEY` / `PILOT_NOTIFY_FROM` pair already configured in
production against a verified sender domain. Introducing new variable names
would have produced a deployment where invitations silently skipped until
somebody noticed.

`PILOT_NOTIFY_TO` is *not* reused — it addresses the operator mailbox, and an
invitation goes to the invitee.

`lib/pilot/notify.ts` kept its own composition; the transport is now shared via
`lib/email/send.ts`.

**When email is not configured**, the invitation is still created and the
Members screen says so explicitly, with the variable names to set. An invitation
that exists but was not delivered is the failure mode that wastes the most time,
because from the table it looks identical to one the recipient has not opened.

---

## 7. Database security proofs

`tests/sql/multiuser_guarantees.sql` runs against live Postgres, impersonating
real authenticated users by setting the JWT claim `auth.uid()` reads and
switching the session role to `authenticated`. Nothing is mocked. Fixtures are
created and destroyed by the script; emails use the reserved `.invalid` TLD.

_Executed against production Postgres 17 (`poowhigxivkfxdzomnzv`)._

| # | Assertion | Result | Observed |
|---:|---|:---:|---|
| 1 | Owner sees their organization | ✅ | 1 row |
| 2 | Admin sees the same organization | ✅ | 1 row |
| 3 | Member sees the same organization | ✅ | 1 row |
| 4 | Unrelated authenticated user sees nothing | ✅ | 0 rows |
| 5 | Forging `organization_id` fails | ✅ | denied 42501 — RLS policy violation on `employees` |
| 6 | Cross-tenant reads fail | ✅ | 0 rows |
| 7 | Cross-tenant writes fail | ✅ | UPDATE affected 0 rows |
| 8 | Cross-tenant imports fail | ✅ | denied 42501 on `ingestion_usage` |
| 9 | Cross-tenant exports fail | ✅ | 0 contract rows readable |
| 10 | Cross-tenant analysis fails | ✅ | 0 projection rows; `mark_own_projection_dirty` denied 42501 |
| 11 | Member cannot promote themselves | ✅ | function denied 42501 **and** direct DML denied ("permission denied for table") |
| 12 | Member cannot invite or remove users | ✅ | both denied 42501 |
| 13 | Admin cannot remove or demote an Owner | ✅ | both denied 42501 |
| 14 | Revoked invitation fails | ✅ | `invitation_revoked` |
| 15 | Expired invitation fails | ✅ | `invitation_expired` |
| 16 | Used invitation cannot be reused | ✅ | `invitation_already_used` |
| 16b | Superseded (rotated-away) token is dead | ✅ | `invalid_invitation` |
| 17 | Removed member immediately loses access | ✅ | 1 row before → 0 after; organization no longer visible |
| 18 | Duplicate invites cannot duplicate invitations | ✅ | 1 live invitation after inviting twice |
| 18b | Duplicate accepts cannot duplicate memberships | ✅ | 1 membership row |
| 19 | Last Owner cannot be removed | ✅ | `last_owner` check violation |

**21 of 21 passed.** Proof 11 is worth noting twice: the direct-DML half is the
one that would have failed before this release.

---

## 8. Production acceptance evidence

Run against **https://www.engisignal.com** on 21 Aug 2026, with three real
accounts created through the public signup form. No account was pre-created, no
confirmation was bypassed, and every email was received in a real mailbox.

### 8.1 The journey

| Step | Account | Result |
|---|---|---|
| Public signup → confirmation email → confirm → empty workspace | `+muowner` | ✅ Landed in `QA MultiUser Alpha` as **Owner** |
| Opened Members, invited `+muadmin` as **Admin** | `+muowner` | ✅ `notice=invited`; email delivered from `pilot@engisignal.com` |
| Opened the Admin's link **while signed in as the Owner** | `+muowner` | ✅ Refused: "This invitation is for another account", with a one-click switch |
| Signup via invite link → confirmation → accept | `+muadmin` | ✅ Joined the **same** organization as **Admin** |
| Admin opened Members and invited `+mumember` as **Member** | `+muadmin` | ✅ Email delivered |
| Signup via invite link → confirmation → accept | `+mumember` | ✅ Joined the **same** organization as **Member** |
| All three independently signed in | all | ✅ One organization, three memberships, correct roles |

Database state at the end of the chain — one organization, three people:

```
QA MultiUser Alpha | acoul1692+muowner@gmail.com  | owner
QA MultiUser Alpha | acoul1692+muadmin@gmail.com  | admin
QA MultiUser Alpha | acoul1692+mumember@gmail.com | member
```

**Three organizations existed in total**, not five — no private tenant was
minted for either invited user. That is the provisioning fix, proven live.

### 8.2 Every major page, as the Member

All 15 returned HTTP 200, all scoped to `QA MultiUser Alpha`, none containing
any string from another tenant, none showing an error:

`/app` · `/app/portfolio` · `/app/renewals` · `/app/users` · `/app/forecast` ·
`/app/cost` · `/app/decisions` · `/app/data` · `/app/ask` · `/app/scenario` ·
`/app/reclaim` · `/app/brief` · `/app/settings` · `/app/settings/members` ·
`/app/data/import`

The Member's Members screen correctly showed the roster with **no** invite form,
**no** Manage column and **no** invitations section.

### 8.3 Prohibited actions, at the API rather than the UI

These were issued with the Member's own JWT straight at PostgREST. The interface
was not involved, so nothing here is a test of a hidden button.

| Attempt | Result |
|---|---|
| `rpc/invite_to_organization` | **403** `not_authorized` |
| `rpc/set_organization_member_role` (self → owner) | **403** `not_authorized` |
| `PATCH /organization_members` (self → owner) | **403** `permission denied for table organization_members` |
| `rpc/remove_organization_member` (the Owner) | **403** `not_authorized` |
| `GET /organization_invitations` | **200 `[]`** — RLS filtered; no `token_hash` disclosed |
| `DELETE /organization_members` (own membership) | **403** no grant |

The third row is the one that matters: **that is the request that would have
succeeded before this release.**

### 8.4 Admin against Owner, at the API

| Attempt | Result |
|---|---|
| Remove the Owner | **403** `owner_protected` |
| Demote the Owner to member | **403** `owner_protected` |
| Promote self to Owner | **403** `owner_protected` |
| `PATCH` the Owner's row directly | **403** no grant |
| Invite somebody as `owner` | **400** `invalid_role` |
| Invite somebody as `viewer` | **400** `invalid_role` |
| Invite with a 5-character token | **400** `weak_token` |
| Invite with a 3650-day expiry | **400** `invalid_ttl` |
| Invite an address that is already a member | **409** `already_member` |

Roster before and after: unchanged. No junk invitation rows were created.

### 8.5 Cross-tenant, against the real production tenants

Issued with the Member's JWT against **Meridian Aerostructures** and **Acme
Aerospace**. Reads were empty rather than forbidden — RLS filters rather than
errors — and every write was refused:

| Probe | Result |
|---|---|
| Read Meridian's organization / members / employees / contracts / usage / imports / projections | **200 `[]`** (all seven) |
| Read Acme's organization | **200 `[]`** |
| `GET /organizations` (list everything visible) | **only `QA MultiUser Alpha`** — the other tenants cannot even be enumerated |
| Insert an employee into Meridian | **403** RLS policy violation |
| Insert an ingestion row into Meridian | **403** RLS policy violation |
| `rpc/mark_own_projection_dirty(Meridian)` | **403** `not permitted` |

### 8.6 Revocation and removal

**Revoked invitation.** The Owner invited `+murevoke`, the email arrived, the
Owner clicked Revoke, and the link was then opened: *"This invitation was revoked
by the workspace."* The revoked preview also stops disclosing the workspace name.

**Removed member — immediately.** The Member's live access token was captured
*before* removal. The Owner then removed them through the UI. Using that same
token afterwards:

```
tokenBelongsTo:      acoul1692+mumember@gmail.com
tokenStillUnexpired: true          <- the JWT is still cryptographically valid
orgs:                200 []
members:             200 []
employees:           200 []
contracts:           200 []
```

Access ends when the membership row goes, **not** when the token expires,
because RLS re-evaluates membership on every query.

### 8.7 The two-workspace case

The one scenario this release newly makes possible, and which nothing had ever
exercised. A QA account was given a second membership, created *after* its first,
and then asked the same question twelve times through two independent resolution
paths:

| Path | Requests | Answer |
|---|---|---|
| Page render (`loadWorkspace` → `listOrganizations[0]`) | 8 | `QA Order First` — every time |
| `/api/diagnostics/read` (resolves the organization separately) | 4 | `QA Order First` — every time |

Stable and identical across both. Before the ordering fix in §12.1, those two
paths could legitimately have disagreed.

### 8.8 A second pass, after the onboarding-copy fix

A fresh workspace (`QA Copy Check`) was created and an invitation sent, to
confirm the corrected sign-up screen in production: heading **"Join QA Copy
Check"**, panel **"Your invitation / Joining QA Copy Check"**, and the
mode-switch link reading **"Create an account"** rather than "Create a
workspace". Verified, then torn down.

---

## 9. Regression results

| Check | Result |
|---|---|
| `tsc --noEmit` | Clean |
| ESLint | No warnings or errors |
| `vitest run` | **979 passed / 979** (59 files; was 962 before, +17 new) |
| `next build` | Succeeded; `/app/settings/members`, `/invitations`, `/invite/[token]` all emitted |

Re-run clean after every subsequent change (the onboarding copy fix and the
workspace-ordering fix). **No test was weakened, skipped or replaced with a mock
to obtain a green build**, and no existing assertion was modified.

Nothing regressed at any point tonight. The two defects that were found and
fixed — §12.1 and §8.8 — were both found by production QA rather than by a
failing test, and both were fixed at the root rather than papered over.

---

## 10. Supabase advisor results

`get_advisors(type: "security")` after the final migration: **0 ERROR, 15 WARN.**

Every warning is one of three kinds, and none is a defect:

**1. `pg_net` installed in the `public` schema** (1 warning) — pre-existing,
unrelated to this release. Migration 19 already restricted its use.

**2. `SECURITY DEFINER` function callable by `authenticated`** (12 warnings) —
this is the design. Membership mutation was deliberately removed from ordinary
DML and routed through these functions, so they *must* be callable by signed-in
users. Each derives the caller from `auth.uid()`, checks role via
`private.is_org_admin` / `is_org_owner`, and refuses otherwise — proven in §7 and
§8.3–8.4. The lint's own wording is "if that is not intentional". It is.

Flagged: `invite_to_organization`, `accept_organization_invitation`,
`accept_invitation_by_id`, `revoke_organization_invitation`,
`remove_organization_member`, `set_organization_member_role`,
`my_pending_invitations`, `preview_invitation`, plus the pre-existing
`bootstrap_organization`, `count_canonical_rows`, `mark_own_projection_dirty`,
`record_pilot_notification`.

**3. `SECURITY DEFINER` function callable by `anon`** (2 warnings):

- `preview_invitation` — intentional. The person clicking a link in their email
  has not signed in yet. Authentication for this one fact is the 256-bit token,
  and it returns only what the invitation email already told them. Non-pending
  tokens return a status with **no** workspace name.
- `record_pilot_notification` — pre-existing and intentional. The public pilot
  form has no session, so `anon` genuinely calls it. It writes three columns,
  rejects any outcome outside the three known ones, and stamps only while unset.

Two trigger functions that the linter would otherwise have flagged —
`enforce_last_owner` and `touch_updated_at` — had their `EXECUTE` revoked in
migration 29 and no longer appear.

### 10.1 Performance advisors

`get_advisors(type: "performance")`: **0 ERROR, 0 WARN, 21 INFO.**

None relate to this release. `organization_invitations` has covering indexes on
both its foreign key and its lookup columns, and none of its indexes appear in
the unused-index list. The INFO entries are pre-existing: two unindexed foreign
keys on `identity_confirmations` and `ingestion_rejections`, eighteen
"unused index" notices that simply reflect near-empty tables in a young
production database, and one note that the Auth server uses an absolute rather
than percentage-based connection allocation.

### 10.2 Mobile

Checked at 390×844 (iPhone 14 class):

| Screen | Result |
|---|---|
| `/invite/[token]` (all terminal states) | No horizontal overflow; document width 390 |
| `/signin` and the invited variant | No horizontal overflow; no element extends past the viewport |
| `/invitations` | Single-column card layout, no overflow |

The Members tables use the same `TableShell` primitive as every other table in
the product, which scrolls the table inside its own container rather than
letting the page scroll sideways. The invite form collapses from a three-column
grid to stacked fields below the `sm` breakpoint.

---

## 11. QA cleanup status

**Clean. Verified by query, not by assumption.**

| Asset | Created | Removed |
|---|---|---|
| `QA MultiUser Alpha` organization | ✅ | ✅ |
| `QA Copy Check` organization | ✅ | ✅ |
| 5 QA auth users (`+muowner`, `+muadmin`, `+mumember`, `+qaown2`, `+qainv2`) | ✅ | ✅ |
| QA invitations (4, incl. one revoked) | ✅ | ✅ (cascade) |
| `_multiuser_proof` results table | ✅ | ✅ |
| SQL-proof fixtures (2 orgs, 5 `.invalid` auth users) | ✅ | ✅ (by the script) |

Final production state:

```
Acme Aerospace          | acme-aerospace          | sbzakour@gmail.com           | owner
Meridian Aerostructures | meridian-aerostructures | acoul1692+meridian@gmail.com | owner
```

2 organizations · 2 memberships · 0 invitations · 0 QA users · 0 leftover tables.
**Identical to the pre-QA state.** Meridian Aerostructures and Acme Aerospace
were never modified at any point — they were only ever read from, and only ever
to prove those reads come back empty.

---

## 12. Known limitations

**12.1 One active workspace per person; no switcher.**
The data model supports belonging to several organizations (`unique
(organization_id, user_id)` permits many rows per user), but the product resolves
a single active workspace as `organizations[0]`.

Threading a *selected* workspace through `loadWorkspace`, `resolveIngestionContext`
and every RLS-scoped call is the kind of change that cross-wires tenants if it is
rushed, so it was deliberately not attempted tonight. What *was* done is the part
that could not safely wait: **the selection is now deterministic.**
`listOrganizations` had no `ORDER BY`, so two requests could disagree about which
workspace was active — page render says A, upload endpoint says B — which for a
two-workspace user means an import landing in the wrong company's tenant with RLS
entirely satisfied. It is now ordered by the membership's `created_at`: you land
in the workspace you joined first.

**Next step:** a `?workspace=` selection persisted in a cookie, validated against
membership on every read.

**2. The confirmation email always returns to `/app`.**
Supabase's "Confirm your email address" template hardcodes `next=/app`, so the
`emailRedirectTo` the app supplies (`/invite/<token>`) is discarded. An invited
new user therefore confirms, lands on `/app`, and is routed to `/invitations` to
accept from there.

This works — it was exercised twice in production, and it is exactly why
`/invitations` and `accept_invitation_by_id` exist — but the direct path is
smoother. Fixing it is a **dashboard change you need to make** (see §14).

**3. Invitations are sent from `pilot@engisignal.com`.**
That is `PILOT_NOTIFY_FROM`, reused deliberately because it is the verified
sender already configured in production. It is correct and deliverable, but
`invites@` or `no-reply@` would read better to a prospect. Cosmetic; needs a
verified sender and an env change.

**4. No self-service "leave workspace".**
A member who wants out must ask an Owner or Admin to remove them. The
last-Owner invariant makes the self-removal case fiddly enough to be worth doing
deliberately rather than at the end of a long night.

**5. `analyst` and `viewer` remain in the enum.**
No new membership is created with either. Both are labelled "(legacy)" in the
interface rather than being folded into "Member", because a `viewer` genuinely
cannot write and saying otherwise would misdescribe a permission. No production
row currently uses either.

**6. Invitation expiry is fixed at 7 days.**
The database accepts 1–30 (`invalid_ttl` outside that); the interface does not
offer the choice.

**7. No audit log.**
Who invited, revoked, removed or changed a role is recoverable from
`organization_invitations` (`invited_by`, `revoked_by`, `accepted_by`) but there
is no event history for membership changes themselves, and no UI for any of it.

---

## 13. Saturday demo — inviting two partners into one workspace

Click-by-click. Allow ten minutes.

### Before you start

Decide which workspace the partners are joining. **If you want them in a clean
workspace rather than Meridian Aerostructures, create one first:** sign out, go
to `https://www.engisignal.com/signin?mode=signup`, register with an address you
control, name the Organization (for example `Partner Demo`), and confirm the
email. Otherwise sign in as the Owner of the workspace you want to use.

### Invite them

1. Sign in at **https://www.engisignal.com/signin**.
2. Go to **Settings** in the left sidebar, then click **Manage members**
   (or go straight to `https://www.engisignal.com/app/settings/members`).
3. Under **Invite someone**, type the first partner's email — Jason's real
   address, the one he will use to sign up.
4. Set **Role**. Choose **Member** unless you want them able to invite others,
   in which case choose **Admin**.
5. Click **Send invitation**. A green bar reads *"Invitation sent."*
6. Repeat 3–5 for Ranjit.
7. Both now appear under **Pending invitations** with the date sent and the
   expiry. If you mistype an address, click **Revoke** on that row — the link
   dies immediately — and invite the correct one.

### What each partner does

8. They receive an email from **pilot@engisignal.com**, subject *"<your email>
   invited you to <workspace> on EngiSignal"*.
9. They click **Accept invitation**.
10. They click **Create an account** and set a password. The email field must be
    **the address you invited** — the invitation will not accept any other.
11. They get a second email, *"Confirm your email address"*, and click
    **Confirm my email**.
12. They land on a page headed **"You have an invitation"**. They click
    **Accept**.
13. They are in the shared workspace.

### Confirm it worked

14. Reload your **Members** page. Both partners now appear under **Members**
    with their role and joined date, and **Pending invitations** is empty.
15. Ask each of them what workspace name appears at the top-left of their
    sidebar. It must match yours exactly.

### If something goes wrong

| Symptom | What it means | What to do |
|---|---|---|
| "This invitation is for another account" | They are signed in as somebody else | They click the **Sign in as …** button on that page |
| "This invitation has expired" | More than 7 days passed | Invite them again — same form, same address |
| "This invitation was revoked" | It was revoked | Invite them again |
| They land in an empty workspace with their own company name | They signed up **without** using the invitation link first | Remove that account, then have them redo step 9 from the email. Tell them not to sign up separately |
| Email never arrives | Check spam for `pilot@engisignal.com` | Click **Resend** on the pending row — this issues a **new** link and kills the old one |

### One thing to avoid

**Do not have them sign up at the marketing site first and then look for the
invitation.** A person who creates an account without an invitation pending gets
their own separate workspace, and they will not see your data. The email link is
the entry point.

---

## 14. What needs your decision

Nothing is blocked. These are yours to make.

1. **Fix the confirmation-email redirect (5 minutes, recommended before
   Saturday).** In the Supabase dashboard → *Authentication* → *Email Templates*
   → *Confirm signup*, the link is hardcoded with `next=/app`. Changing that tail
   to `next={{ .RedirectTo }}` lets an invited user land directly on their
   invitation instead of going via `/invitations`. Both paths work; this one is
   tidier. I did not change it because auth templates are account configuration
   rather than code, and a bad edit there breaks signup for everybody.

2. **A dedicated sender for invitations.** Currently `pilot@engisignal.com`.
   If you want `invites@engisignal.com`, verify it in Resend and I will add the
   env var.

3. **The workspace switcher.** Worth building if you expect anyone to belong to
   two workspaces — a consultant, or you yourself across Meridian and a customer.
   Say the word and it is a contained piece of work.

4. **Whether `analyst` and `viewer` should be retired.** No production row uses
   them. Removing the labels is a migration; leaving them costs nothing.
