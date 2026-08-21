# Partner Test Guide

Two self-contained, entirely fictional estates for the partner usability session.
Neither has any relationship to Bell, Meridian Aerostructures, or Acme Aerospace,
and neither reuses any real customer's data.

**Both testers sign up themselves.** No account has been pre-created and no step
has been bypassed. Jason and Ranjit each go through the public signup, confirm
their email, land in an empty workspace, and import their four files exactly as a
prospect would. Give each tester only their own four files — nothing else.

---

## Who gets which files

### Jason — Partner Test A · "Calder Marine Systems"

From `partner-test-data/partner-test-a/`:

| File | What it is |
|---|---|
| `PartnerTestA_usage.csv` | 10,682 rows of licence-server usage, 320 days |
| `PartnerTestA_entitlements.csv` | 4 features the licence server is configured to serve |
| `PartnerTestA_people.csv` | 68 HR records |
| `PartnerTestA_contracts.csv` | 3 purchased contract lines with prices and renewal dates |

### Ranjit — Partner Test B · "Halbrook Rail Engineering"

From `partner-test-data/partner-test-b/`:

| File | What it is |
|---|---|
| `PartnerTestB_usage.csv` | 8,606 rows of licence-server usage, 320 days |
| `PartnerTestB_entitlements.csv` | 5 features the licence server is configured to serve |
| `PartnerTestB_people.csv` | 76 HR records |
| `PartnerTestB_contracts.csv` | 4 purchased contract lines with prices and renewal dates |

Largest file is under 610 KB against a ~4 MB per-file ceiling, so every import
should complete in seconds. Both estates end on 2026-08-19 and the analysis dates
itself from the last observation in the data, so the figures below do not drift
if the session slips a day.

---

## What each estate should reveal

These are outcomes, not directions. Let the testers find their own way there —
where they look, how long it takes, and what they expect to see instead is the
actual signal we're collecting.

### Partner Test A — Calder Marine Systems

- **An upcoming renewal.** The largest vendor position renews in roughly seven
  weeks. A second, smaller one renews about three months out.
- **Over-provisioned capacity.** The biggest concurrent product is served at 220
  against demand that peaks near 139. Right-sizing is worth roughly **$281K a
  year** on that line alone.
- **A licence-vs-contract quantity discrepancy.** Procurement records 260
  purchased; the licence server is configured for 220. That's **$168K** of
  difference to explain — and the product should decline to call it waste.
- **Idle seats to reclaim.** Seven holders of a 40-seat named-user product have
  not touched it in four months or more. Priced, that's about **$8K**.
- **An unmatched user queue.** Three usernames in the usage file have no HR
  record, so some cost genuinely cannot be attributed to anyone.
- **A product with no contract at all.** One feature is served but appears in no
  procurement record — the tester should see served capacity that cannot be
  priced, rather than a fabricated number.
- Roughly **$1.56M** of served annual spend against **$1.72M** of purchased
  commitment, with total optimization opportunity near **$287K**. Confidence
  lands at Medium.

### Partner Test B — Halbrook Rail Engineering

Deliberately shaped differently, so the two testers don't simply confirm each
other's findings.

- **A more urgent renewal.** The nearest position renews in under a month.
- **The discrepancy runs the other way.** Here the licence server serves 180
  while procurement records only 140 purchased — an over-deployment worth
  **$152K**, which reads as compliance exposure rather than shelfware.
- **The largest over-provision in either estate.** A 300-seat product carries
  demand peaking near 112, worth roughly **$336K a year** to right-size.
- **Capacity risk with a forward-looking crossing.** One product's demand has
  climbed all year into a ceiling it is now forecast to exceed.
- **Idle seats to reclaim, priced and unpriced.** Eight idle holders on a priced
  named-user product (**~$21K**), plus five idle holders on a product with no
  contract line — where the honest answer is that the reclaim cannot be valued.
- **An unmatched user queue.** Two usernames have no HR record.
- Roughly **$1.76M** of served annual spend against **$1.61M** purchased, total
  optimization opportunity near **$420K**. Confidence lands at Medium.

---

## Verification status

Both packages were run through the current importer end to end — parse, source
detection, column mapping, normalization, then portfolio, renewal, reconciliation
and signal generation — using the same code path the app uses per request
(`lib/workspace.ts`).

- All 8 files import with **zero rejected rows and zero duplicates**.
- No required field is missing and **no column fails to map**, so the mapping
  step should present cleanly with nothing for the tester to hand-correct.
- Every discovery listed above was confirmed to actually fire, including the
  ranked signals (10 for A, 14 for B).

This verification ran in-process against the local pipeline. **No test tenant was
created, no account was registered, and nothing was written to any production
system.** Meridian Aerostructures and Acme Aerospace were not touched.

## Regenerating

`partner-test-data/_build/build_partner_test_a.py` and `build_partner_test_b.py`
are seeded and deterministic — re-running them reproduces byte-identical files,
and each script's docstring records what its estate is built to prove.
