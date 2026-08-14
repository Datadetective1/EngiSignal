# EngiSignal — Build Plan

**Product:** EngiSignal — Engineering Software Intelligence
**Promise:** Know what engineering software you actually need before your next renewal.

---

## Guiding Constraints

1. **Determinism first.** Every number a customer could spend money on is produced by a pure, tested function. AI never produces a quantity.
2. **Runs without credentials.** The app is fully functional locally against a deterministic synthetic dataset. Supabase is additive, not required.
3. **No claimed capability that does not exist.** Connector *interfaces* ship; connector *implementations* do not, and the UI says so.
4. **Explainability is a feature, not documentation.** If a number appears in the UI, its derivation is reachable in ≤ 1 click.

---

## Phase Sequence

### Phase 0 — Research & Design Foundation ✅
- `COMPETITIVE_RESEARCH.md` — 8 vendors × 30 dimensions, 7 cross-cutting findings
- `BUILD_PLAN.md`, `ARCHITECTURE.md`
- Positioning conclusion: decision layer, not another monitor

### Phase 1 — Foundations
- Next.js 15 (App Router) + React 19 + TypeScript strict + Tailwind v4
- `config/brand.ts` — single source of brand truth
- Original EngiSignal mark (signal-node geometry), favicon, app icon
- Design system: tokens, type scale, primitives (no external UI kit dependency)
- Vitest + ESLint + typecheck wired before feature code

### Phase 2 — Analytics Engine  ← *the product*
Pure functions, no I/O, exhaustively tested.
- `stats` — percentile (linear interpolation), median, mean, max, trend, volatility
- `concurrent` — hourly demand → daily peak → period metrics, utilization, saturation
- `rightsizing` — `CEILING(P95 × growth × safety)`, surplus/shortfall, alternative methodologies pluggable
- `namedUser` — inactivity windows, reclaim candidacy, reclaim value
- `tokens` — token-hours, capacity utilization, forecast consumption
- `denials` — denial metrics + **contextual** risk (never auto-justifies purchase)
- `financial` — quantity delta, opportunity, incremental spend, cost per engineer/active user
- `confidence` — multi-input scoring with human-readable reasons
- `allocation` — cost allocation, single declared methodology per computation
- `forecast` — trend + headcount growth
- `signals` — generation and impact/urgency/risk/confidence ranking
- `evidence` — assembles the derivation record for any recommendation

### Phase 3 — Synthetic Demo Organization
Aerospace Dynamics Corporation — 3,850 technical employees, ~$18.4M spend, 42 products, 9 vendors.
Seeded PRNG → byte-identical output on every run. 12 months hourly.
All ten required scenarios deliberately engineered into the data (overcapacity, capacity-constrained, reclaim, major renewal, rising demand, declining demand, program concentration, department concentration, headcount-driven growth, denial patterns).

### Phase 4 — Data Layer & Tenancy
- Provider interface: `MockProvider` (local, default) | `SupabaseProvider` (production)
- Full Postgres schema + migrations + RLS policies for every tenant table
- Auth abstraction: demo session locally, Supabase Auth in production

### Phase 5 — Authenticated Application
P0: Intelligence Home · Signals · Portfolio · Renewal Command Center · Scenario Lab · Evidence Drawer
P1: Users · Reclaim Campaigns · Forecast · Cost Intelligence · Decisions · Data Center · Executive Brief
P2: Ask EngiSignal · Guided Tour

### Phase 6 — Import Pipeline
CSV/XLSX parse → intelligent field-mapping with suggestion → validation → normalization → saved reusable mappings → unmatched users / unmapped features queues → downloadable templates.

### Phase 7 — Landing Page & Pilot
Animated intelligence-network hero · vendor typographic treatment · problem cards · pipeline · **live calculator running the real engine** · scroll story · signals showcase · AI section · pilot request capture.

### Phase 8 — Validation
`lint` → `typecheck` → `test` → `build`. All green before done.

---

## Key Decisions & Assumptions

Recorded here rather than asked, per the autonomy directive.

| # | Decision | Rationale |
|---|---|---|
| 1 | **Custom SVG chart layer, not Recharts** | Required chart types (capacity bands, bullet, variance, waterfall, forecast ranges, heatmap) need precise control; avoids a heavy dependency and React-19 peer friction. Satisfies "Recharts *or equivalent*". |
| 2 | **Hand-built primitives, not shadcn CLI** | shadcn's generator is interactive and network-dependent. Same architectural pattern (owned components, Tailwind, variants) without install risk. |
| 3 | **Framer Motion on the marketing surface only** | Motion where it communicates; the app stays fast and analytically calm. |
| 4 | **Percentile = linear interpolation between closest ranks** | Matches Excel `PERCENTILE.INC` / NumPy default, so a license manager reproducing the math in a spreadsheet gets the same answer. Documented in `ANALYTICS_METHODOLOGY.md`. |
| 5 | **Hourly concurrency stored as typed arrays in the mock path** | 42 features × 8,760 hours stays under ~1 MB and generates in well under a second. |
| 6 | **Demo auth accepts any email locally** | Zero-friction evaluation. Supabase Auth is wired and swaps in via env. |
| 7 | **Vendor names rendered typographically** | No scraping, no fabrication, no brand-guideline risk. Ownership disclosure in footer. |
| 8 | **Denials never auto-increase a recommendation** | Direct consequence of Competitive Research Finding 1. Denials raise risk and are surfaced as context for a human decision. |
| 9 | **One allocation methodology per computation, always labeled** | Borrowed discipline from TBM practice; silent mixing is the classic chargeback failure. |
| 10 | **Confidence is computed, not asserted** | Data quality is an input to every recommendation's trustworthiness. |

---

## Definition of Done

The 41-point acceptance list in the master specification, verified end-to-end, with `lint`, `typecheck`, `test` and `build` all passing.
