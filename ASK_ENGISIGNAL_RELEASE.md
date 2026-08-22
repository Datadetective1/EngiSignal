# EngiSignal — Ask EngiSignal with OpenAI

Release evidence for the grounded explanation layer. Companion to
[MULTI_USER_RELEASE.md](MULTI_USER_RELEASE.md) and
[CONNECTOR_ARCHITECTURE.md](CONNECTOR_ARCHITECTURE.md).

**Verified against https://www.engisignal.com on 22 Aug 2026 with the model
live** — `OPENAI_MODEL=gpt-5.4-mini`, Settings reporting *OpenAI · Connected*.

---

## 1. What the model is and is not allowed to do

| | |
|---|---|
| **Source of truth** | The deterministic analytics engine. Every quantity, price, percentile, forecast, right-sizing result and recommendation |
| **The model's job** | Phrase evidence that has already been computed |
| **What it receives** | A FACTS block assembled by the retrieval layer. Never the database |
| **When evidence is absent** | It is not called at all. The refusal is deterministic |

The gate is in `app/api/ask/route.ts`: when retrieval grades evidence as `none`,
no request is made. Handing a model an empty FACTS block and an instruction to
admit ignorance relies on obedience under exactly the conditions that most
invite the opposite.

---

## 2. Deployment

The variables were already live when verification began — no redeploy was
needed. Settings rendered:

> **Explanation layer** — OpenAI
> **Status** — Connected. Model: gpt-5.4-mini. Requests carry no retention (store: false).

---

## 3. Test tenant

Meridian Aerostructures was **not** signed into; its password is not held, and
resetting a real tenant's credential to run a test is not a trade worth making.
A throwaway tenant was loaded through the real import flow with the Partner
Test A estate, which carries richer priced evidence than Meridian actually has:

| Dataset | Rows | Result |
|---|---|---|
| Usage | 10,682 | accepted, persisted, analysed |
| People | 68 | accepted, persisted, analysed |
| Entitlements | 4 | accepted, persisted, analysed |
| Contracts | 3 | accepted, persisted, analysed |

`reconciles: true`. Meridian was used as the **other side** of the cross-tenant
isolation test, read-only, and was never modified.

---

## 4. The ten checks

### 4.1 Evidence-backed question ✅

*"Why is STARCCM_POWER recommended at that quantity?"* → `explain-recommendation`,
evidence `sufficient`, phrased by the model.

> STARCCM_POWER is recommended at 153 because the sizing uses the P95 daily peak
> demand of 139.0, applies no assumed growth, adds the 10% safety buffer, and
> rounds the unrounded result of 152.90 up to a whole license. That sits below
> the entitled quantity of 220, with utilization at P95 of 63.2% and 0 saturation
> days, so 153 is the deterministic recommendation.

Every figure — 153, 139.0, 152.90, 220, 63.2%, 0 — is verbatim from the fact
list. "Applies no assumed growth" is a correct reading of `Growth factor=1.00`.

### 4.2 Savings / optimization ✅

*"What is driving our largest optimization opportunity?"* → named the driver,
not just the total: **220 entitled vs 153 recommended, 67 surplus**, from a
**P95 of 139.0** over **229 days** at **63.2%** utilization.

### 4.3 Renewal prioritisation ✅

→ `renewal-priority`. "Prioritise Siemens first. It is the nearest renewal at 51
days out, and it also has the highest current value and opportunity value among
the priced renewals." Ranking and reasoning both traceable to the fact list.

### 4.4 Executive summary ✅

→ `executive-brief`. Served capacity, purchased commitment, the $287,150
opportunity, the largest single position at $281,400, capacity risk, and the
nearest renewal — all from evidence.

### 4.5 Missing evidence ✅

→ `missing-evidence`. "1 feature with no price supplied, 1 feature with no usage
observed, and 3 features with under 300 days of history… and 3 usernames not
tied to a person." Exact match to the fact list.

### 4.6 Software that does not exist in the tenant ✅

*"How many SolidWorks Premium and Zemax OpticStudio licences do we own?"*

→ `no-evidence`, `phrasedBy: deterministic`. **The model was never called.**

> EngiSignal holds no evidence about "SolidWorks". Nothing imported into this
> workspace matches "SolidWorks"… EngiSignal will not answer for it from
> anything other than your own data.

It still correctly reported *Features analysed in this workspace = 4*, so it
knows it holds data — just not that data — and named what would answer the
question.

### 4.7 Cross-tenant isolation ✅

The QA session's own JWT, straight at PostgREST, against the real tenants:

| Probe | Result |
|---|---|
| `GET /organizations` | only `QA Ask Verification` — other tenants not enumerable |
| Meridian organization / members / contracts / projections / usage | `200 []` |
| Acme organization | `200 []` |
| Insert usage into Meridian | **403** RLS policy violation |
| `mark_own_projection_dirty(Meridian)` | **403** not permitted |

Across 12 model-phrased answers, no response contained any string from another
tenant.

### 4.8 Outage and invalid-key degradation ✅

Not testable in production without tampering with the live deployment's
credentials, so exercised locally against the **real** OpenAI SDK and API:

| Condition | Behaviour |
|---|---|
| Invalid API key | returns null, does not throw |
| Model the account cannot use | returns null, does not throw |
| No key configured | reports `not_configured`, returns null |

In every case `app/api/ask` renders the deterministic narrative, and the answer
— headline, facts, links — is unchanged.

### 4.9 Rate limiting and circuit breaker ✅ (with a caveat, §5.2)

**Sequential, one warm instance** — the limiter behaves exactly as designed:

```
1:M 2:M 3:M … 18:M 19:M 20:D 21:D 22:D 23:D 24:D 25:D 26:D
```

Model through request 19; deterministic from request 20 — the 20/minute ceiling,
landing precisely. Every fallback answer still carried the same headline, the
same evidence grade and a complete narrative.

**Circuit breaker** — opens after four consecutive failures; ten subsequent
calls completed in **1 ms** total, i.e. without touching the network, and
`openaiHealth()` reported `cooling_down` (which Settings renders distinctly from
"not configured", so an operator is not sent hunting the wrong problem).

### 4.10 No unintended persistence or client exposure ✅

| Check | Result |
|---|---|
| API key in any client bundle (9 scripts, 502 KB scanned) | **none** |
| `api.openai.com` or `OPENAI_API_KEY` in any bundle | **none** |
| System prompt in any bundle or page HTML | **none** |
| Model name in any bundle | **none** |
| `localStorage` / `sessionStorage` | **empty** |
| Cookies | Supabase auth only |
| `/api/ask` response keys | `evidence, facts, headline, intent, links, narrative, phrasedBy, provider` — no prompt, instructions, token usage, response id or model |
| Database tables holding prompts, questions, narratives or model output | **none exist** |
| Logging of prompts, facts or answers | **none on the AI path** |
| Retention at the provider | `store: false` on every request |

The API key is read server-side only, and `lib/ai/openai.ts` carries
`import 'server-only'` so a future client import fails the build rather than
shipping the key.

---

## 5. Fidelity of the model against the evidence

### 5.1 The measurement

Twelve questions spanning every intent. For each, every numeric token in the
model's prose was checked against the numeric tokens in the deterministic
headline and fact list.

**Result: 12/12 model-phrased, zero unsupported numbers, zero contradictions,
zero inventions.**

Two figures were initially flagged and are worth recording precisely, because
both are *re-expressions* rather than new facts:

| Model wrote | Evidence said | Verdict |
|---|---|---|
| "the 10% safety buffer" | `Safety factor = 1.10` | Correct restatement. Settings itself labels this "Safety buffer 10%" |
| "$1.723M of purchased commitment" | `Purchased commitment = $1,723,000` | Unit reformatting. The product's own headline says "$1.6M" for $1,555,000 |

Neither changes, contradicts or adds to the evidence. Both match vocabulary the
product already uses. Once the checker accounted for unit and percentage
re-expression, the unsupported count across all twelve was zero.

### 5.2 Behaviour under a retrieval miss — the most reassuring result

Asked *"How is the STARCCM_POWER recommendation derived?"*, the intent
classifier did **not** match (it keys on "why" / "how did", not "how is"), so
retrieval returned the portfolio overview instead of the feature explanation.

The model, handed real facts that did not answer the question, wrote:

> The STARCCM_POWER recommendation is not supported by the provided facts… If
> you want the derivation, I need the specific STARCCM_POWER analysis details.

It refused rather than assembling a plausible derivation from adjacent figures —
which is the failure mode that matters, because such an answer would have been
fluent, confident and wrong. **The same question phrased "Why is STARCCM_POWER
recommended…" answers correctly**, so this is a classifier coverage gap, not a
correctness defect. Retrieval rules were left unchanged, per instruction.

---

## 6. Observations, not defects

Neither was changed, because neither is a verified defect and both sit outside
the "unless a verified defect requires it" boundary.

**6.1 The rate limiter does not constrain a concurrent burst.** It is
in-process, so on serverless it is per warm instance. Thirty requests fired in
parallel were spread across instances and all thirty reached the model; the same
thirty issued sequentially tripped the limit at the twentieth. The guard
therefore bounds a single client's sequential loop, not a concurrent fan-out.
Closing that requires shared state (Redis or a Postgres counter) — a real
architectural addition, and a possible paid dependency.

**6.2 A cross-tenant read of a large table is slow, and once returned 500.**
Reading Meridian's 281,995-row usage table as a non-member returned `200 []` in
~5–6 s versus ~810 ms for a nonexistent organization, and under concurrent load
one attempt hit the statement timeout (`57014`). **No data is returned in either
case** — the difference is timing, and it reveals only that some tenant holds
many rows, never whose or what. Pre-existing behaviour of RLS filtering a large
table, unrelated to this release.

**6.3 Intent classifier coverage.** ~~"How is X derived?" does not route to the
explanation intent.~~ **Fixed — see §9.**

---

## 7. Regression results

| Check | Result |
|---|---|
| `tsc --noEmit` | Clean |
| ESLint | No warnings or errors |
| `vitest run` | **1018 passed / 1018** (61 files) |
| `next build` | Compiled successfully |
| Supabase security advisors | **0 ERROR**, 15 WARN — unchanged set, every one a deliberate `SECURITY DEFINER` grant or the pre-existing `pg_net` placement |

No test was weakened, skipped or mocked to obtain a pass. Two temporary tests
that call the live OpenAI API were used for §4.8 and deleted after the run — a
committed test that depends on an external service fails for reasons unrelated
to the code.

---

## 8. QA cleanup

| Asset | Created | Removed |
|---|---|---|
| `QA Ask Verification` organization | ✅ | ✅ |
| `acoul1692+qaai@gmail.com` account | ✅ | ✅ |
| 10,757 imported rows across four datasets | ✅ | ✅ (cascade) |
| Temporary OpenAI degradation tests | ✅ | ✅ |

Final production state: **2 organizations, 2 memberships, 0 invitations, 0 QA
users**, Meridian's **281,995 usage rows intact**. Identical to the pre-test
state. Meridian and Acme were read from only, and only to prove those reads come
back empty.

---

## 9. Follow-up: the derivation-phrasing gap (§6.3) — fixed

Routing only. Retrieval, grounding, the OpenAI path, tenant isolation, rate
limiting and every analytics formula are untouched: the same branch produces the
same evidence, it is simply reached by more of the ways people ask.

### 9.1 What changed

One matcher in `classify()`. The additions anchor on the **verb of derivation** —
`deriv`, `calculat`, `comput`, `determin`, `worked out`, `arrived at`,
`comes from`, `how do you get` — rather than on a bare `how is`.

That distinction is the whole care of the change. `explain-recommendation` is
classified *before* `demand-drivers`, so a bare `how is` would have silently
taken "How is MATLAB demand distributed across teams?" — a question about who
uses a product, answered as though it were about how a number was reached.

**A bare `recommend` was tried and reverted.** It reads as an obvious member of
the set and is not: "Is the MATLAB recommendation low confidence?" is a
*confidence* question, and adding the word took it. The guard test caught it
before it left the machine. Asking for a figure is not asking how it was derived.

### 9.2 Tests added

`tests/ai/grounding.test.ts` gains three cases:

- eleven phrasings all reach `explain-recommendation` and carry
  `Recommended quantity`;
- nine neighbouring intents — demand-drivers, what-if, confidence, savings,
  renewals, renewal-priority, executive-brief, missing-evidence — are pinned
  where they were, so a future widening cannot take them quietly;
- a derivation question about software the tenant does not hold still returns
  `no-evidence`. Widening the matcher must not widen what counts as evidence.

### 9.3 Production verification

Disposable tenant `QA Derivation Routing`, loaded through the real import flow
with the Partner Test A estate (10,682 usage · 4 entitlements · 3 contracts,
`analyticsCurrent: true`).

**Nine derivation phrasings** — all `explain-recommendation`, all evidence
`sufficient`, all model-phrased, all carrying `Recommended quantity`, and **zero
unsupported numbers** in any narrative:

> How is the … derived? · How did you calculate …? · Where does … come from? ·
> How was … computed? · What determines …? · How did you arrive at …? ·
> How do you get …? · On what basis is … recommended? · Why is … recommended?

**Thirteen neighbouring intents re-checked in production: zero regressions**,
including both refusals for software the tenant does not hold.

The question that failed in §5.2 now answers from the evidence:

> The recommendation is derived from the P95 daily peak demand of 139.0, with no
> assumed growth and a 10% safety buffer applied, which gives an unrounded result
> of 152.90. That value is then rounded up to the whole license, producing the
> recommended quantity of 153.

### 9.4 Regression and cleanup

`tsc` clean · ESLint clean · **1021 passed / 1021** (was 1018, +3) ·
`next build` compiled successfully.

Test tenant and account removed. Production back to **2 organizations, 0 QA
users, 0 invitations**, Meridian's **281,995 usage rows intact**.
