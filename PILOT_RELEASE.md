# Pilot Release — v0.1.0-pilot.1

**Tagged commit:** `986d3b8` · **Tested:** 18 August 2026 · **Environment:** production (`iad1`)

This file is the durable record of what was verified before EngiSignal was put in front of an
external customer. It is deliberately kept in the repository rather than in a chat transcript or a
hosted report, because the value of a release test is entirely in being able to check later what
was actually claimed.

## Verdict

Ready for external pilot. Twelve production checkpoints passed on the tagged commit. One genuine
blocker was found during the run, fixed, deployed, and re-verified live before tagging.

## The twelve checkpoints

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

## The blocker this test was for

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

## Known limitations at tag time

None of these blocked the pilot. All are recorded so they are not rediscovered as surprises.

- **Technical headcount cannot be set by a customer.** Settings displays it read-only, no import
  populates it, provisioning leaves it null. Cost per engineer and the forecast's headcount-growth
  term therefore stay unavailable, and now read as an honest `—`.
- **`round` converts non-finite input to zero** at 88 call sites. Nearly all guard their denominator
  first; the one that did not is fixed. Behaviour is pinned by test rather than changed under a
  release deadline.
- **Confirmation emails share one Gmail thread** — same subject on every message, so Gmail collapses
  them and a search returns only the first few. Provider-side and cosmetic.
