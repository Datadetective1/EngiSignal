# EngiSignal — Analytics Methodology

Every quantitative figure EngiSignal shows is produced by a pure, deterministic, tested function. This document is the complete specification of how. It is written so a license administrator can reproduce any recommendation in a spreadsheet and get the same answer — if they cannot, that is a bug.

---

## 1. Non-negotiable principles

1. **Deterministic.** No randomness, no wall-clock reads. The analysis date is always an injected parameter.
2. **Reproducible.** The same inputs produce the same outputs on every machine, in every timezone, forever.
3. **Explainable.** Every recommendation exposes its inputs, its assumptions and its derivation.
4. **Inspectable.** The Evidence Drawer renders what the engine already computed. It never recomputes, so the drawer and the page cannot disagree.
5. **AI never computes.** A language model may phrase an answer; it may not produce a quantity, price or utilization figure.
6. **Assumptions visible.** Percentile, period, growth and safety are shown wherever a recommendation appears.
7. **Data quality affects confidence.** Confidence is computed from measurable conditions, not asserted.
8. **Missing is missing.** Where a figure cannot be calculated it is reported as unavailable, never estimated.

---

## 2. Concurrent demand

### 2.1 The chain

```
hourly concurrent demand
  → daily peak          max over the 24 hours of a date
  → period distribution mean / median / P90 / P95 / P99 / max of daily peaks
```

Daily peak is the correct unit because a concurrent pool must be sized for the worst moment of a day, not the average of the day.

### 2.2 Percentile

**Linear interpolation between closest ranks**, equivalent to Excel `PERCENTILE.INC` and the NumPy default.

```
rank   = p × (n − 1)
lower  = floor(rank), upper = ceil(rank)
result = sorted[lower] + (sorted[upper] − sorted[lower]) × (rank − lower)
```

This method was chosen specifically so a customer re-deriving it in Excel gets the same number.

### 2.3 Derived metrics

| Metric | Definition |
|---|---|
| Utilization | `P95 ÷ entitled × 100` |
| Available capacity | `entitled − P95` (negative means structurally short) |
| Saturation days | Days where `peak ≥ entitled` |
| Saturation % | `saturation days ÷ observed days × 100` |
| Volatility | Coefficient of variation (sample sd ÷ mean) — dimensionless, so features of any size compare |
| Trend | OLS slope over daily peaks, annualized: `slope × 365 ÷ mean × 100` |
| Standard deviation | Sample (n − 1). Observed peaks are a sample of demand behaviour, not the full population |

---

## 3. Right-sizing

### 3.1 The default model

```
recommended = CEILING( Pxx(daily peaks) × growthFactor × safetyFactor )
```

Defaults: percentile **P95**, growth **1.00**, safety **1.10**, period **12 months**.

Worked example — the flagship demo position:

```
P95 daily peak         275
× growth factor       1.05     (+5% expected headcount growth)
× safety factor       1.10     (+10% protective buffer)
= unrounded        317.625
→ recommended          318
current entitlement    400
surplus                 82
× unit price        $5,000
= annual opportunity  $410,000
```

### 3.2 The ceiling is not `Math.ceil`

`CEILING` is implemented as `ceilPrecise`, which rounds to 9 decimal places before ceiling.

This is not defensive decoration. In IEEE-754, `100 × 1.0 × 1.1 === 110.00000000000001`, so a naive `Math.ceil` returns **111** — one extra license recommended purely as a rounding artifact. The same happens for P95 values of 50, 90, 100, 110, 170, 180, 190, 200, 210, 220 and many others under a 10% buffer. At $5,000 per license that is a $5,000 error caused by binary floating point.

`275 × 1.20 × 1.10` evaluates to `363.00000000000006`; EngiSignal returns 363, not 364.

### 3.3 A specification discrepancy, documented

The product specification states the formula as `CEILING(P95 × Growth × Safety)` (multiplicative) but its worked example pairs *P95 = 276, growth 5%, safety 10%* with *recommended 318*. Those are inconsistent:

- Multiplicative: `276 × 1.05 × 1.10 = 318.78 → 319`
- Additive: `276 × (1 + 0.05 + 0.10) = 317.4 → 318`

**Resolution:** the explicit formula is normative, so the engine is multiplicative — growth and buffer genuinely compound. The demo dataset is calibrated to P95 = **275**, which reproduces the specification's memorable outcome exactly (**318** recommended, **82** surplus, **$410,000** opportunity) with fully consistent arithmetic.

### 3.4 Alternative methodologies

Right-sizing is a strategy registry, not a hard-coded formula. Two models ship:

- `percentile-growth-safety` (default)
- `maximum-observed` — sizes to the highest observed peak, for organizations where a denied license halts a certification run

Adding a model requires no change to any caller.

### 3.5 Named-user sizing is a different model

Named-user seats are **not** sized from a concurrent peak — every assigned seat is consumed whether used or not. The basis is the count of users with activity inside the threshold:

```
recommended = CEILING( activeUsers × growthFactor × safetyFactor )
```

This is deliberately a separate function rather than the concurrent model with different inputs, so the methodology sentence shown to the customer is always literally true. A named-user recommendation never claims to be "P95 of daily peak demand".

---

## 4. Named-user intelligence

- Default reclaim threshold: **90 days** without recorded activity (configurable).
- A seat **never used since assignment** is a candidate regardless of threshold — absence of any activity is stronger evidence than a lapse.
- `active + inactive = assigned`, always. The two figures are defined against the same threshold so they reconcile.
- Reclaim value = `candidates × unit price`, or null when unpriced.

---

## 5. Denials — the honesty constraint

**Denials are never an input to a recommended quantity.** `computeRightSizing` does not accept denial data, structurally.

Denials are the most abused metric in this category: they are noisy, and they are every vendor's favourite upsell argument. EngiSignal treats them as contextual risk for a human decision, with two guards:

1. **Capacity-not-exhausted guard.** If mean concurrent demand at the moment of denial was below 95% of entitled capacity, the denial is classified **Low** and labelled as a licensing-rule issue (options-file exclusion, borrow limit, authorization). Buying more licenses would not have prevented it.
2. **Retry-burst guard.** If ≥70% of denials fall on one day across ≤2 users, it is classified **Low** and labelled a retry burst, not a shortage.

Otherwise: `Critical` at ≥15% of days with ≥5 users, `High` at ≥7% of days or ≥8 users across ≥5 days, `Moderate` at ≥2 denial days, `Low` for isolated events.

---

## 6. Token / consumption

```
availableTokenHours = poolSize × 24 × observedDays
capacityUtilization = consumedTokenHours ÷ availableTokenHours × 100
```

The observed trend is clamped to [−50%, +100%] before extrapolation, because a short or noisy series can annualize to an implausible slope.

---

## 7. Forecasting

Two independent growth inputs, combined **multiplicatively** because they compound — 10% more engineers each doing 5% more simulation is 15.5% more demand, not 15%:

```
combinedGrowth  = (1 + trendGrowth) × (1 + headcountGrowth) − 1
forecastDemand  = baseline × (1 + combinedGrowth)
recommended     = CEILING(forecastDemand × safetyFactor)
```

The observed trend is **clamped to [−30%, +50%] per year** before extrapolation. An OLS slope fitted to a noisy series can annualize to a figure no one would defend, and a forecast a customer can immediately see is wrong destroys trust in every other number on the page. Where the clamp applies it is disclosed on the feature, not hidden.

---

## 8. Financial

| Figure | Definition |
|---|---|
| Current annual cost | `entitled × unitPrice` |
| Recommended annual cost | `recommended × unitPrice` |
| Optimization opportunity | `−quantityDelta × unitPrice` when delta < 0, else 0 |
| Incremental spend | `quantityDelta × unitPrice` when delta > 0, else 0 |
| Savings % | `opportunity ÷ currentAnnualCost × 100` |

Unpriced features return `priced: false` with every monetary field null. The **quantity** conclusion still stands without pricing.

**Unused capacity spend** is reported for *concurrent features only*: `(entitled − P95) × unitPrice`. Named-user and token models use different definitions of waste and are excluded rather than folded in, because mixing them produces a total that cannot be explained.

---

## 9. Cost allocation

**One methodology per computation, always labeled.** Silently mixing bases — usage hours for one product, assigned seats for another — is the classic chargeback failure: the total looks authoritative and cannot be defended when a department head challenges it.

| Method | Basis |
|---|---|
| Actual usage | License-hours consumed |
| Assigned licenses | Named-user seats held, used or not |
| Token consumption | Token-hours drawn |
| Proportional sessions | Session counts |

Features with no attributable activity under the chosen method are reported as **unallocated** with the reason. They are never redistributed.

---

## 10. Confidence

Starts at 100, deducts for each measurable deficiency. Thresholds: **High ≥ 80**, **Medium ≥ 55**, **Low** below.

| Condition | Deduction |
|---|---|
| Under 60 days of history | 38 |
| 60–149 days | 22 |
| 150–299 days | 10 |
| Coverage < 80% | 20 |
| Coverage 80–95% | 8 |
| No unit price | 18 |
| Employee mapping < 85% | 16 |
| Employee mapping 85–95% | 7 |
| Feature mapping < 90% | 14 |
| Feature mapping 90–98% | 6 |
| No denial data | 6 |
| No headcount forecast | 5 |

Every result carries human-readable reasons, rendered verbatim in the UI. A "Low confidence" badge with no explanation is worse than useless.

In Signal ranking, confidence is a **multiplier** (High 1.0, Medium 0.75, Low 0.5), not an addend — a large opportunity computed from poor data must not outrank a modest one computed from good data.

---

## 11. Signal ranking

```
impact    = log10(1 + |financialImpact|) ÷ log10(1 + 500,000), clamped to [0,1]
urgency   = (180 − daysRemaining) ÷ 180, clamped to [0,1]; 0.25 when not time-bound
risk      = Low 0.1 | Moderate 0.4 | High 0.75 | Critical 1.0
score     = (0.45·impact + 0.28·urgency + 0.22·risk + 0.05) × confidenceWeight × 100
```

Impact is logarithmic so a $2M opportunity outranks a $400K one without drowning it — a queue ordered by raw dollars becomes a list of the same three vendors.

---

## 12. Test coverage

281 tests. Everything that affects a purchasing recommendation is covered, including: percentile against known `PERCENTILE.INC` values, the floating-point ceiling guard across every drifting value in 1–500, hourly aggregation, daily peak, utilization, saturation, growth and safety factors, named-user inactivity and threshold boundaries, token maths, savings, incremental cost, capacity shortfall, cost allocation with each methodology, confidence scoring, denial classification including both honesty guards, forecast clamping, and the complete demo dataset against its documented figures.

Run with `npm test`.
