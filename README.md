<div align="center">

# EngiSignal

**Engineering Software Intelligence**

*Know what engineering software you actually need before your next renewal.*

</div>

---

EngiSignal connects engineering software usage, the people who generate it, the contracts that pay for it, and the forecast ahead — and turns them into decisions you can defend in a vendor negotiation.

It is not another license monitor. That market is mature and technically deep. EngiSignal is the **decision layer**: renewal-first, explainable, organization-aware, and executive-legible.

## Run it

```bash
npm install
npm run dev
```

Open <http://localhost:3000>, click **Explore EngiSignal**, and sign in with any work email.

**No configuration is required.** With no environment variables EngiSignal runs against a complete synthetic organization — 3,850 technical employees, 42 features, 9 vendors, $18.4M of annual spend, 24 months of daily demand history. Every figure is deterministic and reproduces exactly on any machine.

## The product moment

Open **Portfolio → Mechanical → Mechanical Enterprise**:

```
Current licenses              400
P95 daily peak demand         275     (maximum observed 314)
EngiSignal recommendation     303     at the default 0% growth, 10% buffer
Annual opportunity       $485,000
Confidence                   High     100/100
```

Then open **Why this recommendation?** and the full derivation is there — percentile, growth factor, safety factor, the unrounded product, the rounding, the unit price, the arithmetic. Change the assumptions in **Scenario Lab** and it recalculates in the browser using the identical engine. At +5% growth it becomes **318** and **$410,000**.

The customer should never wonder where a number came from.

## What is built

**Analytics engine** — concurrent demand (hourly → daily peak → P90/P95/P99), right-sizing as a pluggable strategy, named-user reclaim, token consumption, denial risk, financial translation, cost allocation, forecasting, confidence scoring. 281 tests.

**Application** — Intelligence Home with a ranked Signals queue · Portfolio with drill-through · Renewal Command Centre with decision timeline and a ten-section negotiation brief · Scenario Lab · Users · Reclaim campaigns · Forecast · Cost Intelligence · Decisions · Data Centre with intelligent import mapping · Ask EngiSignal · Executive Brief.

**Marketing site** — animated intelligence-network hero, a live calculator running the production engine on real data, scroll-driven explanation, pilot capture.

**Database** — complete Postgres schema, RLS on every tenant table, verified tenant isolation, zero Supabase security advisories.

## Three things that make it trustworthy

**1. The ceiling guard.** `100 × 1.0 × 1.1` is `110.00000000000001` in IEEE-754, so a naive `Math.ceil` recommends **111** — an extra license, at $5,000, caused purely by binary floating point. It happens for P95 values of 50, 90, 100, 110, 200 and many more. EngiSignal rounds to 9 decimals first.

**2. Denials never justify a purchase.** `computeRightSizing` does not accept denial data, structurally. Denials are the category's most abused metric — noisy, and every vendor's favourite upsell argument. EngiSignal classifies them as contextual risk, with explicit guards that recognise a single user's retry loop and denials that occurred while capacity was free.

**3. Nothing is guessed.** Unmapped features are excluded from demand rather than guessed into a product — exclusion understates demand, which surfaces immediately as saturation; a silent wrong mapping overstates it and nobody ever finds it. Same for usernames, and same for prices: an unpriced feature reports "not available", never zero.

## Commands

```bash
npm run dev        # development server
npm run build      # production build
npm test           # 281 tests
npm run typecheck  # strict TypeScript
npm run lint       # ESLint
npm run validate   # all four, in order
```

## Documentation

| | |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System shape and layer contracts |
| [ANALYTICS_METHODOLOGY.md](ANALYTICS_METHODOLOGY.md) | Every formula, with worked examples |
| [DATABASE.md](DATABASE.md) | Schema, indexes, RLS model |
| [SECURITY.md](SECURITY.md) | Isolation proof, controls, known gaps |
| [DATA_IMPORT_GUIDE.md](DATA_IMPORT_GUIDE.md) | Getting your own data in |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Vercel + Supabase |
| [COMPETITIVE_RESEARCH.md](COMPETITIVE_RESEARCH.md) | 8 vendors × 30 dimensions |
| [BUILD_PLAN.md](BUILD_PLAN.md) | Phases and recorded decisions |
| [BRAND.md](BRAND.md) | Identity and voice |
| [FUTURE_ROADMAP.md](FUTURE_ROADMAP.md) | What comes next |

## Stack

Next.js 15 · React 19 · TypeScript (strict) · Tailwind CSS v4 · Framer Motion · Postgres / Supabase · Zod · Vitest. Charts are hand-built SVG — the required marks (capacity bands, saturation shading, labelled reference lines, cost bridges) need exact control and cost no client JavaScript.

---

*Product names, logos and brands referenced anywhere in this project are property of their respective owners. Their appearance does not imply affiliation or endorsement. Aerospace Dynamics Corporation is fictional.*
