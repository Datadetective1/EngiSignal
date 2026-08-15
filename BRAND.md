# EngiSignal — Brand

All brand configuration lives in [`config/brand.ts`](config/brand.ts). Nothing below is hard-coded elsewhere, and legal entity information is environment-driven so it can be set once a company is registered.

---

## 1. Position

**Name** — EngiSignal
**Category** — Engineering Software Intelligence
**Tagline** — Turn engineering software data into signals you can act on.
**Promise** — Know what engineering software you actually need before your next renewal.

**Hero** — *Engineering software. Clear signals. Better decisions.*
**Support** — *Know what you use, what you need, and what to renew.*

The name is the thesis: engineering organizations already emit thousands of signals — usage, licenses, contracts, denials, headcount. The product does not create data, it makes the existing data mean something.

---

## 2. The mark

An abstract **E** built from three measurement bars of differing length — a signal-strength reading — anchored by a node that sits on the axis of the longest bar, with an emitted arc.

The idea is engineering precision meeting signal: the bars are ruled and exact, the node is where measurement becomes something you can act on.

**Behaviour**
- Bars carry the identity; the node carries the accent
- The arc drops away below 24px, where it would turn to mud
- `monochrome` renders entirely in `currentColor` for single-colour contexts
- The favicon sets the mark on a graphite tile so it holds against light or dark browser chrome

Deliberately **not**: a swoosh, a globe, a lightbulb, a circuit board, a gradient blob, or anything that would read as gaming, crypto, cybersecurity or telecom.

---

## 3. Product vocabulary

Signal types are used where they carry meaning, not everywhere:

| | |
|---|---|
| **Renewal Signal** | An upcoming financial commitment requiring attention |
| **Cost Signal** | Overspending or an optimization opportunity |
| **Capacity Signal** | A product approaching or exceeding capacity |
| **Usage Signal** | A material change in consumption behaviour |
| **Forecast Signal** | A future demand change |
| **Reclaim Signal** | Inactive named-user licenses |
| **Data Signal** | A data condition affecting confidence |

Also: **Ask EngiSignal**, **Scenario Lab**, **Evidence Drawer**, **Renewal Command Centre**, **Intelligence Home**.

Not every noun becomes a Signal. Portfolio is Portfolio.

---

## 4. Voice

Plain, specific, quantified. Short sentences. No adjectives doing work that a number should do.

**Say** — "P95 daily peak demand was 275 against 400 entitled licenses."
**Not** — "Significant optimization potential was identified across your portfolio."

**Say** — "No unit price recorded for this feature."
**Not** — "$0"

**Say** — "43 seats idle for 90+ days, worth $96,105 annually."
**Not** — "Substantial savings available."

Where something is uncertain, say so and say why. Confidence is always accompanied by its reasons.

---

## 5. Colour

Sophistication comes from typography, spacing and hierarchy — not saturation. The accent is used sparingly and always means something.

| Token | Light | Dark |
|---|---|---|
| Background | `#fbfcfd` | `#08090b` |
| Surface | `#ffffff` | `#0f1116` |
| Foreground | `#0e1420` | `#f1f3f7` |
| Muted | `#57617a` | `#99a2b4` |
| Accent | `#1f6feb` | `#4da3ff` |
| Positive | `#12805c` | `#3fc38d` |
| Warning | `#a8620a` | `#e8b457` |
| Danger | `#c33a2c` | `#f4756a` |
| Aqua | `#0d9488` | `#37cfc0` |
| Violet | `#7c5cf0` | `#a98bff` |

Marketing surfaces force dark. The application follows the viewer's system preference.

Semantic use is consistent everywhere: **positive** is a reduction in spend, **danger** is capacity risk or additional spend, **warning** is a data condition, **violet** is forecast.

---

## 6. Typography

**Inter**, variable, via `next/font`. Tabular figures (`.tnum`) wherever numbers are compared vertically — every table, every KPI, every metric row. Misaligned digits in a financial table look like a bug even when the numbers are right.

Headlines are tightly tracked (`-0.02em` to `-0.035em`). Mobile headline sizes are restrained so a visitor is not scrolling past giant type to reach content.

---

## 7. Motion

Motion communicates or it does not ship.

**Earns its place** — number transitions when an assumption changes (the travel shows size and direction), scroll reveals, the hero network's data flow, the scroll story, signal card entrances.

**Does not** — bouncing, typewriter effects, constant ambient movement, page-load sequences, anything that delays reading.

`prefers-reduced-motion` is honoured globally: marquees stop, parallax is removed, transitions collapse. **No information is ever conveyed by animation alone** — the scroll story becomes a static stacked list with every number present.

---

## 8. Third-party vendor names

Vendor names are rendered **typographically**, never as logos.

EngiSignal does not scrape, reproduce or fabricate third-party brand assets. A clean textual treatment carries the same message — this product is built for these tools — with no brand-guideline or endorsement risk.

The vendor section is never labelled *Customers*, *Trusted by*, *Partners* or *Official integrations*, because none of those is true.

Required disclosure, present in the footer and every generated brief:

> Product names, logos and brands are property of their respective owners. Their appearance does not imply affiliation or endorsement.

---

## 9. Claims discipline

Never invent customers, testimonials, savings statistics, partnerships, integrations, endorsements or analyst recognition.

The demo organization is labelled synthetic wherever it appears. Connector interfaces exist, and the UI states plainly that **no connector is implemented** rather than implying integrations that do not exist.

Capability is the proof. Nothing else is claimed.
