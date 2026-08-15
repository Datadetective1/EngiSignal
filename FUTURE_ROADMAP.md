# EngiSignal — Future Roadmap

The MVP wedge is **engineering software renewal, usage, cost and demand intelligence**. This is the trajectory beyond it, ordered by what a customer would actually ask for next.

---

## Near term — make the wedge complete

**Live collectors.** The `LicenseManagerConnector` interface and registry ship; no implementation does, and the UI says so. FlexNet first (largest installed base), then RLM and DSLS. Each needs a parser profile per vendor daemon. Denial capture on FlexNet requires debug logging enabled — the connector must detect and report when it is not, because absent denial data silently reduces confidence.

**Persisted imports.** The parse → map → validate pipeline is real; committing rows to Postgres is the missing step. Needs `COPY`-based streaming above ~500k rows, plus idempotency so a re-run of the same export does not double-count.

**Organization preferences.** Percentile, safety buffer, reclaim threshold and right-sizing method are adjustable per analysis in Scenario Lab but not persisted per tenant. Customers will want a house methodology.

**Alerting.** Signals exist; notification does not. Email or Slack when a renewal enters a stage, when capacity risk escalates, or when a data condition appears.

**Saved views and scheduled briefs.** A monthly executive brief that arrives without anyone opening the app is the retention mechanic for this category.

---

## Medium term — deepen the analysis

**Alternative right-sizing methodologies.** The strategy registry is built for this. Candidates: cost-of-denial optimization (size to where marginal license cost equals expected productivity loss), queue-theoretic sizing for batch-solver environments, and per-shift sizing for follow-the-sun engineering.

**True active usage.** Distinguishing license *checkout* from *application interaction* materially changes the demand picture — a license held open in a background window is not demand. The data model already keeps the two separable; the collectors must supply it.

**Borrowed and offline licenses.** Currently invisible. They inflate apparent concurrent demand and need to be modelled explicitly.

**Multi-year and bundle modelling.** Real negotiations involve multi-year commitments, bundles and tiered discounts. EngiSignal deliberately applies none of these today — they are negotiation levers, not analytical outputs — but modelling *scenarios* around them is legitimate and valuable.

**Peer benchmarking.** Cost per engineer by industry and discipline. Requires enough tenants to anonymize credibly. Ethically only from aggregated, consented data.

---

## Longer term — the category trajectory

```
Engineering Software Intelligence
        ↓
Engineering Technology Intelligence
        ↓
Engineering Operations Intelligence
```

**Technology Intelligence** adds compute: HPC cluster utilization sits next to license utilization, because in simulation they are the same capacity question. A solver license is worthless without a core to run it on.

**Operations Intelligence** connects software and compute to the engineering organization itself — contractors, programmes, budgets, purchase orders, vendor spend, headcount — to answer:

> *What does this engineering organization actually cost, what is driving that cost, and what should leadership do next?*

That is a materially larger product and a different buyer. It is only credible after the wedge is unambiguously won.

---

## Platform work

| Area | Item |
|---|---|
| Auth | SSO / SAML, SCIM provisioning, enforced MFA |
| Security | Nonce-based CSP, read audit log, penetration test |
| Scale | Partition `hourly_usage` by date, materialized daily-peak views |
| Rate limiting | Move from in-process to a shared store |
| Reliability | Sentry, structured logging, synthetic monitoring |
| API | Public read API so customers can pull metrics into their own BI |
| Billing | Stripe subscriptions — sandbox only until commercially warranted |

---

## Deliberately not planned

Each of these is someone else's strength, and chasing them dilutes the wedge:

- **General ITAM / SAM breadth** — hardware and SaaS discovery, compliance and audit defence. Mature vendors own this.
- **Competing on collector breadth.** Out-featuring a 6,000-application catalogue is a losing strategy for a new entrant. Depth of *decision*, not breadth of *collection*.
- **An AI that recommends quantities.** Structurally excluded. AI locates and explains analysis; it never performs it. This constraint is a feature and should never be traded away for a demo.

---

## The line that must not move

Whatever gets built, three properties are non-negotiable:

1. **Deterministic analytics.** Every purchasing figure comes from a pure, tested function.
2. **Denials never justify a purchase.** They inform risk for a human.
3. **Nothing is guessed.** Unmapped is excluded, unpriced is unavailable, unmatched is queued.

The moment a customer catches EngiSignal inventing a number, the product is finished.
