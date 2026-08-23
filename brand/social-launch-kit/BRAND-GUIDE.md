# EngiSignal — Brand Guide

The printable version of this page is
[`engisignal-brand-guide-1654x2339.png`](engisignal-brand-guide-1654x2339.png) — A4 at
200dpi, rendered from the same modules that build the assets, so it cannot drift
from them.

Deeper background lives in [`BRAND.md`](../../BRAND.md) at the repository root. This
page is what a designer, a contractor or an agency needs in order to use the kit
correctly without reading anything else.

---

## 1. The mark

An abstract **E** built from three measurement bars of differing length — a
signal-strength reading — anchored by a node on the axis of the longest bar, with an
emitted arc.

| Rule | |
|---|---|
| **Bars carry the identity** | Never recolour them individually or change their lengths |
| **The node carries the accent** | It is the only place the accent belongs inside the mark |
| **The arc drops below 24px** | Below that it turns to mud — use a `-compact-` file |
| **Clear space** | The node's diameter on every side. At a 40px lockup, ~12px |
| **Minimum sizes** | Lockup 100px wide · mark with arc 24px · compact mark 16px |

**Never** recolour the bars, drop the node, change the wordmark's tracking, set the
wordmark in another typeface, add shadows or effects, rotate the mark, or place the
full-colour lockup on a mid-tone background where the node loses contrast.

The wordmark ships as **outlines**, so files render correctly on machines without
Inter installed.

## 2. Logo files — `01-logo/`

One direction, four colourways. Each is SVG plus PNG at two widths.

| File | Use |
|---|---|
| `engisignal-logo-dark-bg` | **Primary.** Dark surfaces. Light bars, `#4DA3FF` node |
| `engisignal-logo-light-bg` | Light surfaces. Ink bars, `#1F6FEB` node |
| `engisignal-logo-white` | Photography and busy surfaces. Single colour |
| `engisignal-logo-black` | Mono printing, faxable documents, single-colour merch |
| `engisignal-mark-dark-bg` / `-light-bg` | Mark alone, **24px and above** |
| `engisignal-mark-compact-dark-bg` / `-light-bg` | Mark alone, **below 24px** |
| `engisignal-wordmark-white` / `-black` | Wordmark alone |
| `engisignal-app-icon` | Mark on the graphite tile — avatars, favicon, app tile |

PNG widths: lockups and wordmarks `1024 / 2048`, marks and icon `512 / 1024`.
Heights follow the artwork ratio; the 1024px lockup is `1024 × 165`.

## 3. Colour

| Token | Hex | Used for |
|---|---|---|
| Background | `#08090B` | Canvas on every social graphic |
| Graphite | `#0E1116` | Avatars, app icon, favicon tile |
| Surface | `#14171E` | Cards and panels |
| Border | `#232833` | Hairlines, the drafting grid |
| Border strong | `#333A48` | Chips, axis ticks, placeholder outlines |
| Foreground | `#F1F3F7` | Headlines, wordmark on dark |
| Muted | `#99A2B4` | Support copy |
| Subtle | `#6B7488` | Labels, title-block keys |
| **Accent** | `#4DA3FF` | The node. Once per graphic |
| Ink | `#0E1420` | Wordmark on light |
| Accent light | `#1F6FEB` | The node on light backgrounds |

**Signal colours are semantic.** They come from the product and mean the same thing
everywhere. Never swap one for another to get better contrast.

| Signal | Hex | Meaning |
|---|---|---|
| Positive | `#3FC38D` | Cost Signal — a reduction in spend |
| Danger | `#F4756A` | Capacity Signal — capacity risk or added spend |
| Violet | `#A98BFF` | Forecast Signal |
| Aqua | `#37CFC0` | Usage Signal |
| Warning | `#E8B457` | Data Signal — a data condition |

Every value above is the dark theme in [`app/globals.css`](../../app/globals.css).
Nothing was invented to complete the palette.

## 4. Typography

**Inter** — the typeface the product already uses. Inlined as a variable WOFF2 in
every template, so a render never depends on what is installed locally.

| Role | Setting |
|---|---|
| Headline | Inter 600 · `-0.030em` · 1.10 line-height |
| Support | Inter 400 · `-0.008em` · 1.50 line-height |
| Label / eyebrow | Inter 600 · uppercase · `+0.17em` |
| Wordmark | Inter 600 · `-0.021em` |
| Figures | Tabular everywhere numbers stack |

## 5. The visual system

Three cues carry the register, and they are deliberately quiet. They exist because
the audience is engineering, aerospace, manufacturing and technical operations —
readers who take restraint as competence and bloom as marketing.

- **Drafting grid.** Two tiers, minor and major, near the noise floor. A single-tier
  grid is wallpaper; two tiers read as a drawing.
- **Datum rule.** A measured hairline with ticks under the brand row, the origin tick
  in accent. It is the mark's own idea — ruled measurement — at page scale.
- **Title block.** The label/value strip along the foot of a drawing sheet, carrying
  category, scope and web address.

Ambient glow is held to about a third of what a dark template would normally use.
The accent appears once, sometimes twice, per graphic.

## 6. Where each asset goes

| Placement | Size | File |
|---|---|---|
| LinkedIn company logo | 400 × 400 | `03-linkedin/engisignal-linkedin-avatar-400x400.png` |
| LinkedIn cover | 1128 × 191 | `03-linkedin/engisignal-linkedin-cover-1128x191-a|b-*.png` |
| X profile photo | 400 × 400 | `04-x/engisignal-x-avatar-400x400.png` |
| X header | 1500 × 500 | `04-x/engisignal-x-header-1500x500-a|b-*.png` |
| Square feed post | 1200 × 1200 | `05-post-templates/*-1200x1200.png` |
| Wide feed post | 1600 × 900 | `05-post-templates/*-1600x900.png` |
| Link preview card | 1200 × 630 | `05-post-templates/engisignal-og-image-1200x630.png` |
| Site favicon | 16 – 512 | `02-favicon/` |

Banner options are lettered, not numbered: **A states the category**, **B states the
outcome**. Pick per platform; do not run both at once.

## 7. Claims discipline

This is a brand rule, not a legal footnote, and it applies to anything made with this
kit.

- Never invent customers, testimonials, savings figures, partnerships or endorsements.
- Templates that would carry such a claim ship with `[bracketed placeholders]`.
  Replace every bracket before publishing.
- Illustrative figures are labelled *Illustrative* on the face of the graphic. Do not
  relabel them as a customer result.
- Third-party names are set **typographically, never as logos**. The partner template
  has a type slot for exactly this reason.
- Where vendor names appear, carry the disclosure: *Product names, logos and brands
  are property of their respective owners. Their appearance does not imply affiliation
  or endorsement.*
