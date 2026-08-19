# Pilot Release — v0.1.0-pilot.2

**Verified build:** `157a4e5` · **Tested:** 19 August 2026 · **Environment:** production (`iad1`)

The `v0.1.0-pilot.2` tag sits on the commit that adds this record. Its application
code is byte-identical to `157a4e5`, the build every check below was run against —
`git diff 157a4e5..v0.1.0-pilot.2` touches this file and nothing else.

Supersedes `v0.1.0-pilot.1` (`986d3b8`). That tag remains valid for what it
recorded; everything below it still holds. This release adds the pilot-operations
audit and the hardening pass that followed it.

This file is the durable record of what was verified before EngiSignal was put in front of an
external customer. It is deliberately kept in the repository rather than in a chat transcript or a
hosted report, because the value of a release test is entirely in being able to check later what
was actually claimed.

## Verdict

Ready for external pilot.

`v0.1.0-pilot.1` recorded twelve production checkpoints passing, with one blocker
found during the run and fixed before tagging. `v0.1.0-pilot.2` adds a
pilot-operations audit of the journey as a prospect sees it, which found four
further defects — all fixed, deployed and re-verified against production. The
sections below are in two parts: the original twelve checkpoints, then what
changed after them.

## The twelve checkpoints (v0.1.0-pilot.1)

| # | Checkpoint | Observed |
|---|---|---|
| 1 | External signup | New address and company name never seen by the system. Weak and breached passwords refused before an account exists. |
| 2 | Email confirmation | Real message to a real inbox. A bare `GET` on the link left the account unconfirmed; the deliberate second step confirmed it. |
| 3 | Workspace provisioning | Organization created under the typed name. Empty state `0/0/0/0`, no `NaN`, no invented percentages. |
| 4 | Authenticated login | Session over httpOnly cookies. No access token in `localStorage`. |
| 5 | Realistic import | 8 files, 13.63 MB. 283,221 rows accepted, 4,458 rejected with reasons, every response `202`. |
| 6 | Processing to READY | 53.8 s first byte to current analysis, unattended. Accepted = stored = analysed on all four datasets. Reported itself not-current while building. |
| 7 | Dashboard correctness | All 12 application pages `200`, no `NaN`/`Infinity`/`undefined`. One fabricated figure found here — see below. |
| 8 | Refresh | 40 numeric cells captured before and after a full reload. Identical. |
| 9 | Logout and login again | Sign-out ended the session; `/app` redirected and the API returned no data. All rows still reconciled after signing back in. |
| 10 | Second-tenant isolation | A second real tenant's attempts to read (`404`), delete (`404`, target intact) and export another tenant's data were refused by the database. Storage policies scope every operation to the tenant's own folder. |
| 11 | Mobile access | At 390 px: no page scrolls sideways, navigation collapses to a menu, wide tables scroll inside their own container. |
| 12 | Deployed version | `/api/version` reported `986d3b8` on `main`, matching a clean local tree. |

## Measurements

| Stage | Figure |
|---|---|
| Accept (8 files, 13.63 MB, durable before response) | 16.3 s |
| Rows accepted | 283,221 |
| First byte to analysis current, unattended | 53.8 s |
| Projection build over the whole estate | 8.31 s |
| Reconciliation (accepted = stored = analysed) | exact |
| Cold render, heaviest page at 282K rows | 3.13 s |
| Eleven remaining application pages | ≤ 1.02 s |
| Test suite | 889 pass / 51 files |

## The blocker the twelve-point test was for

A tenant with a **$5.7M portfolio** saw, on the cost page:

```
COST PER TECHNICAL EMPLOYEE
$0
— employees
```

The headcount one line below is correctly reported as unknown, and the figure derived from that
unknown headcount is `$0`.

Three defects lined up, each hiding the next:

1. The projection worker holds **zero table privileges** by design, so it cannot read
   `organizations`. It built the dataset's organization as `{ id, name } as Organization` — a cast
   that told the compiler the remaining fields existed while leaving every one `undefined` at
   runtime.
2. `costPerEngineer` guarded with `=== null`, which `undefined` does not satisfy. The division ran
   and produced `NaN`.
3. `round` returns `0` for any non-finite input, converting that `NaN` into a figure
   indistinguishable from a computed one.

**Fix (in `986d3b8`).** The reader already fetches the authoritative organization row on every
request and was discarding it in favour of the worker's copy; it now merges it over the dataset,
which also means an edit to the organization applies on the next render instead of waiting for a
rebuild. The worker's placeholder states every field explicitly, so absent means `null` and a new
column breaks the line loudly. The guard tests for a usable number rather than for `null`
specifically. Pinned by `tests/analytics/organization-authority.test.ts`, including an assertion
that the two cells agree.

## Security posture at release

- Leaked-password protection live; verified by attempting a known-breached password against
  production (refused, no account created). Advisor warning cleared.
- Password length agrees end to end: form and database both require 10 characters, and a refusal
  explains which rule was broken.
- Tenant isolation held under direct attack — refusals came from the database, not the UI.
- The ingestion worker holds no table privileges and is a member of no role.
- Advisors: **0 errors, 4 warnings**, all previously reviewed and intentional (`pg_net` in `public`;
  three `SECURITY DEFINER` functions that each authorize the caller internally).

## What changed after v0.1.0-pilot.1

Walking the journey from outside a session — as a prospect rather than a
signed-in tester — found four defects that the twelve-point smoke test could not
have caught, because every one of them lives on a path a signed-in tester never
travels or on evidence a mature tenant never has.

### The pilot request form returned 500 for every prospect

The landing page's primary call to action failed for everyone not signed in.
`pilot_requests` held zero rows, so nothing was lost — but nothing could ever
have arrived.

Everyone using that form is `anon`, which holds INSERT on that table and nothing
else, deliberately: it contains other companies' contact details and a public
SELECT policy would publish the sales pipeline. The provider ended its insert
with `.select().single()`, and that `RETURNING` clause needs SELECT, so Postgres
refused the statement and rolled the insert back. A signed-in caller does hold
SELECT and succeeds, which is why every test passed. The id is now generated in
the application and inserted explicitly.

### A new customer's first screen described data they had never imported

An empty workspace rendered "Your data is being analysed. Your imported rows are
stored and complete", invited a reload that would never change anything, and
offered no import button. Two situations were collapsed into one message — *no
analysis exists* and *the analysis is not finished* — and the message was false
in the one every new customer starts in. `totalAccepted === 0` separates them.

### Trends annualized from too little history

Three days of usage produced "Daily peak demand is trending down 24333.3% per
year" in the executive brief. The regression was correct; answering at all was
the mistake. The same raw slope also fed capacity projections, the spend-weighted
trend across whole agreements, the forecast's growth input (where the −30% clamp
turned it into a confident contraction assumption), and the Scenario Lab caption.

`lib/analytics/trend.ts` now owns that decision. **The threshold is 30 calendar
days** — the shortest window spanning a full monthly cycle of engineering work,
so a slope measured across it reflects a repeating rhythm rather than one unusual
week. Below it, every surface says "Not enough history to calculate trend" and
projections assume no growth. Where history is sufficient the number is exactly
what it was: the guard decides whether to answer, never what the answer is.
Verified at 3, 7, 29, 30 and 365 days.

### Missing cost displayed as $0

Every money total is a sum, so a portfolio where nothing carries a price summed
to zero and rendered as "$0" — telling a customer their engineering software is
free. That is the state every pilot customer is in before contracts are uploaded.

The evidence check is the feature **count**, never the amount, because a
genuinely zero cost and an absent one are identical in the number alone. No
calculation changed; each figure is now shown only where price evidence exists,
and a real zero still prints `$0`. Applied to dashboard KPIs, the executive brief
(including the financial-opportunity waterfall), the cost page, forecasts,
renewals, reclaim, the portfolio table, Ask, evidence records, the Scenario Lab
rollup, and both CSV exports.

## Verification of v0.1.0-pilot.2

Run against production at `157a4e5`, using a tenant with three days of usage and
no prices — the exact conditions that produced both defects — and the demo tenant
with 365 days of history and real contracts.

| Check | Result |
|---|---|
| Full regression suite | 928 pass / 55 files |
| Typecheck, production build | clean |
| Anonymous pilot request (no session, curl) | HTTP 200, stored |
| Fresh signup → confirmation → workspace | passed, real inbox |
| Empty workspace first screen | names the empty state, offers Import data |
| Import → analysis → reconciliation | 5 rows, accepted = stored = analysed |
| Thin tenant: absurd trend figures | none on any page |
| Thin tenant: invented `$0` | none on any page |
| Demo tenant: money figures | $5.7M / $5.1M / $559K — unchanged |
| Demo tenant: trends | +10.7%, +13.0%, +61.5% — unchanged |
| Exports on demo tenant | trend columns still populated |
| Cross-tenant read / delete / export | refused; target data intact |
| Mobile at 390 px | no sideways scroll |
| Supabase advisors | 0 errors, 4 warnings (previously reviewed) |

## Known limitations at tag time

None of these blocks the pilot. All are recorded so they are not rediscovered as
surprises.

- **A workspace holds exactly one person.** There is no invite path and no member
  management; every signup provisions its own organization, so a colleague who
  signs up gets a separate empty workspace rather than joining the customer's.
  Accepted for the first pilots: each pilot has one designated workspace owner,
  and the executive brief is shared as PDF. Multi-user administration is a
  post-pilot capability.
- **Technical headcount cannot be set by a customer.** Settings displays it
  read-only, no import populates it, provisioning leaves it null. Cost per
  engineer and the forecast's headcount-growth term therefore stay unavailable
  and read as an honest `—`. The pilot request form already collects engineering
  headcount, so the figure is being gathered and discarded.
- **Nobody is notified when a pilot request arrives.** Requests land in
  `pilot_requests` with no email or alert. Reading that queue is a manual daily
  task.
- **Rejection reasons are not reachable after an import is committed.** Before
  committing, every rejected row is shown with its rule and an example value.
  Afterwards the data is stored and `getImport` returns it, but no page consumes
  it.
- **No license-manager connectors are implemented.** The product states this
  plainly on the Data page rather than implying a roadmap.
- **Uploads are capped at 4 MB per file** — roughly 68,000 usage rows. Larger
  estates are split by date range or license server; the demo tenant's 282K rows
  arrived as 8 files.
- **`round` converts non-finite input to zero** at 88 call sites. Nearly all
  guard their denominator first, and the two that did not are fixed. Behaviour is
  pinned by test rather than changed under a release deadline.
- **Confirmation emails share one Gmail thread** — same subject on every message,
  so Gmail collapses them and a search returns only the first few. Provider-side
  and cosmetic.
