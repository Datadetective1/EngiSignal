# EngiSignal — Architecture

## 1. System Shape

```
┌──────────────────────────────────────────────────────────────┐
│  Marketing surface (public)                                  │
│  /  ·  /pilot                                                │
│  Runs the real analytics engine in the live calculator.      │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│  Application surface (authenticated)                         │
│  /app/*  — Intelligence, Portfolio, Renewals, Users,         │
│            Forecast, Cost, Decisions, Data, Ask, Settings    │
└──────────────────────────────────────────────────────────────┘
                            │
                 ┌──────────▼──────────┐
                 │  Analytics Engine   │  pure · deterministic · tested
                 │  lib/analytics/*    │  no I/O, no dates from clock
                 └──────────┬──────────┘
                            │
                 ┌──────────▼──────────┐
                 │  Data Provider      │  interface
                 └──────┬───────┬──────┘
                        │       │
          ┌─────────────▼─┐   ┌─▼──────────────┐
          │ MockProvider  │   │ SupabaseProvider│
          │ seeded synth  │   │ Postgres + RLS  │
          │ (default)     │   │ (env-activated) │
          └───────────────┘   └────────────────┘
```

**Principle:** the analytics engine never knows where data came from. It receives plain typed structures and returns plain typed results. This is what makes it testable, reproducible, and identical between the marketing calculator and the authenticated product.

---

## 2. Layer Responsibilities

| Layer | Path | Rule |
|---|---|---|
| Brand config | `config/brand.ts` | Single source of naming/metadata. No legal-entity hard-coding. |
| Domain types | `lib/domain/` | Types shared by every layer. No logic. |
| Analytics engine | `lib/analytics/` | **Pure.** No `fetch`, no `Date.now()`, no randomness. Any "today" is an injected parameter. |
| Data providers | `lib/data/` | I/O boundary. Implements `DataProvider`. |
| Synthetic data | `lib/synthetic/` | Seeded generation. Deterministic across runs and machines. |
| Import pipeline | `lib/import/` | Parse → suggest mapping → validate → normalize. Pure where possible. |
| Connectors | `lib/connectors/` | **Interfaces only in v1.** Registry reports `available: false`. |
| AI | `lib/ai/` | Provider-agnostic. Retrieval over deterministic metrics. Degrades to deterministic answers with no API key. |
| UI primitives | `components/ui/` | Owned components, variant-driven. |
| Charts | `components/charts/` | Custom SVG. Business-question shaped. |
| App surfaces | `app/` | Server components by default; client only where interaction demands. |

---

## 3. The Analytics Contract

### 3.1 Concurrent demand

```
usage rows (date, hour, feature, user)
  → hourly concurrent demand   Σ distinct concurrent holders per (date, hour, feature)
  → daily peak                 max over the 24 hours of a date
  → period metrics             mean / median / P90 / P95 / P99 / max of daily peaks
```

Percentile method: **linear interpolation between closest ranks** on the ascending series of daily peaks.
`rank = p × (n − 1)`, result interpolated between `floor(rank)` and `ceil(rank)`. Equivalent to Excel `PERCENTILE.INC`. Chosen so a customer can reproduce it in a spreadsheet.

### 3.2 Right-sizing

```
recommended = CEILING( P95(dailyPeaks) × growthFactor × safetyFactor )
```

Defaults: `growthFactor = 1.00`, `safetyFactor = 1.10`.
All four inputs — period, percentile, growth, safety — are user-adjustable and recalculated synchronously. The engine returns the *derivation*, not just the number, so the Evidence Drawer is a rendering of engine output rather than a re-derivation.

**Denials do not enter this formula.** They raise a separate risk classification. (Competitive Research, Finding 1.)

### 3.3 Confidence

Computed from: observation-period length, missing-date ratio, price availability, employee mapping rate, feature mapping rate, sample size, denial-data availability. Emits `High | Medium | Low` **with the specific reasons**, which are rendered verbatim in the UI.

---

## 4. Multi-Tenancy

Every tenant-owned row carries `organization_id`. Three enforcement layers:

1. **Database** — RLS policies on every tenant table; membership checked through `organization_members`.
2. **Server** — every data access resolves the active organization from the session and passes it explicitly; no ambient/global org.
3. **Type** — provider methods require an `orgId` argument. Omitting it is a compile error.

Defense in depth: a bug in any single layer does not leak data across tenants.

---

## 5. Normalization Hierarchy

```
Vendor → Product Family → Product → Feature → Raw Feature Alias
```

Raw license-manager strings map to features via `feature_aliases` (many-to-one). Unmapped raw strings enter the **Unmapped Features** queue rather than being silently dropped or guessed — silent guessing is how license analytics loses credibility. No vendor's hierarchy is hard-coded; ANSYS, MATLAB and CATIA are *data*, not schema.

---

## 6. Identity Resolution

License-manager usernames rarely equal HR identifiers. Resolution order:
`employee_id` exact → `username` exact → normalized `username` (case/domain-stripped) → email local-part → **unmatched queue**.

Match rate is an explicit input to confidence. Unmatched users are visible and manually resolvable; they are never quietly assigned.

---

## 7. Rendering Strategy

- Server components for data-dense analytical pages — compute on the server, ship HTML.
- Client components only for genuine interaction: Scenario Lab sliders, tables with sort/filter, the marketing calculator, motion.
- Scenario Lab recalculates **in the browser** using the same engine module, so slider feedback is instant with no network round-trip.

---

## 8. Security Posture

Authentication → authorization → tenant scoping → input validation (Zod at every boundary) → upload constraints (type allowlist, size cap, row cap) → audit trail on imports. Secrets are env-only; `.env.example` documents every variable. Detail in `SECURITY.md`.

---

## 9. Extension Points Designed In

| Extension | Mechanism |
|---|---|
| Live license-manager collectors | `LicenseManagerConnector` interface + registry |
| Alternative right-sizing methodologies | `RightSizingMethod` strategy; the P95 model is one registered implementation |
| Additional AI providers | `AIProvider` interface |
| New organizational dimensions | `organization_dimensions` is data-driven, not enum-driven |
| Non-Supabase Postgres | Provider interface is the only coupling point |

---

## 10. What Is Deliberately Not Built

Live collectors, compliance/audit defense, hardware or SaaS discovery, billing, SSO/SCIM, real-time streaming ingestion. Each is a defensible v2+ item; none is claimed as present.
