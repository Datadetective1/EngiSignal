# EngiSignal — Social Launch Kit

Finished, production-ready assets. Everything is generated from the logo already
running on the site; no part of the identity was redesigned.

**Start here:** [`BRAND-GUIDE.md`](BRAND-GUIDE.md) — or the printable one-pager,
[`engisignal-brand-guide-1654x2339.png`](engisignal-brand-guide-1654x2339.png).
**Copy to post:** [`MESSAGING.md`](MESSAGING.md) — tagline, LinkedIn About, X bio,
ten launch posts.

---

## Folders

| | |
|---|---|
| `01-logo/` | 11 SVGs, each with PNGs at two widths |
| `02-favicon/` | Full favicon set plus `favicon.ico` |
| `03-linkedin/` | Avatar and two cover options |
| `04-x/` | Avatar and two header options |
| `05-post-templates/` | 12 post graphics |
| `06-safe-area-proofs/` | Overlay proof per banner — measured, not eyeballed |
| `_source/` | Build scripts. Edit here, never the outputs |

## Pick a file

| I need… | Use |
|---|---|
| A logo for a dark slide | `01-logo/engisignal-logo-dark-bg-1024w.png` |
| A logo for a white document | `01-logo/engisignal-logo-light-bg-1024w.png` |
| A logo over a photo | `01-logo/engisignal-logo-white-1024w.png` |
| A LinkedIn company logo | `03-linkedin/engisignal-linkedin-avatar-400x400.png` |
| A LinkedIn banner | `03-linkedin/engisignal-linkedin-cover-1128x191-a-category.png` |
| An X profile photo | `04-x/engisignal-x-avatar-400x400.png` |
| An X banner | `04-x/engisignal-x-header-1500x500-a-signals.png` |
| A launch post | `05-post-templates/engisignal-launching-soon-1200x1200.png` |
| A link preview image | `05-post-templates/engisignal-og-image-1200x630.png` |

## Banner options

Two per platform. **A states the category. B states the outcome.**

| File | Headline |
|---|---|
| `…-cover-1128x191-a-category` | Engineering Software Intelligence |
| `…-cover-1128x191-b-defensible` | From usage data to defensible renewal decisions |
| `…-header-1500x500-a-signals` | Engineering software. Clear signals. Better decisions. |
| `…-header-1500x500-b-decisions` | Smarter license, renewal and spend decisions. |

**A is the safer default on both platforms** — it says what EngiSignal is before it
says what it claims, which is the right order for a first-time visitor.

## Post templates

| File | Size | Use |
|---|---|---|
| `engisignal-post-statement-1200x1200` | 1200 × 1200 | General statement post |
| `engisignal-post-statement-1600x900` | 1600 × 900 | General statement, with the demand chart |
| `engisignal-launching-soon-1200x1200` | 1200 × 1200 | Launch teaser with CTA |
| `engisignal-launching-soon-1600x900` | 1600 × 900 | Launch teaser with the four pilot weeks |
| `engisignal-what-it-is-1600x900` | 1600 × 900 | Category explainer: what goes in, what comes out |
| `engisignal-what-it-does-1600x900` | 1600 × 900 | The four capabilities |
| `engisignal-feature-ask-engisignal-1600x900` | 1600 × 900 | Feature: Ask EngiSignal |
| `engisignal-feature-scenario-lab-1200x1200` | 1200 × 1200 | Feature: Scenario Lab |
| `engisignal-announcement-founder-1200x1200` | 1200 × 1200 | New joiner / founder announcement |
| `engisignal-announcement-partner-1600x900` | 1600 × 900 | Partnership announcement |
| `engisignal-customer-insight-1200x1200` | 1200 × 1200 | Customer pull-quote |
| `engisignal-og-image-1200x630` | 1200 × 630 | Open Graph link card |

Three templates ship with **`[bracketed placeholders]`** — founder, partner and
customer insight. Replace every bracket before publishing. See
[`BRAND-GUIDE.md`](BRAND-GUIDE.md) §7 for why they are not pre-filled.

## Favicons

`02-favicon/` holds `favicon-16/32/48/64/128/192/256/512.png`,
`apple-touch-icon-180.png`, `icon.svg` and `favicon.ico`.

**Not installed.** The site currently ships only `/icon.svg`. To adopt the set, copy
into `public/` and extend the `icons` block in
[`app/layout.tsx`](../../app/layout.tsx). Left out deliberately — it changes the
running site.

## Verification

`npm run verify` checks two things and exits non-zero on either.

**Dimensions.** Every filename carries its contract — `1128x191` means exactly that,
`-1024w` means exactly that width. All 50 PNGs are checked against their own names.

**Safe areas.** Each banner is re-rendered with background texture and deliberately
bleeding artwork hidden, then scanned for pixels bright enough to be type or data ink
rather than texture. The bounding box is tested against the region each platform
covers with its own UI.

| Banner | Content box | Must stay inside | Platform covers |
|---|---|---|---|
| LinkedIn cover | x 300–836, y 42–148 | x 232–1088, y 16–175 | logo tile, x 8–208 / y 88–191 |
| X header | x 96–1378, y 78–352 | x 64–1440, y 40–376 | avatar, x 8–256 / y 356–500 |

Copy clears the LinkedIn logo tile by 92px horizontally. On the X header the avatar
zone is checked as its own rectangle, not just against the outer box: zero pixels of
copy fall inside it. The content box reaches y=352 only on the right-hand side, where
the chart card sits well clear of the avatar.

Overlay proofs are in `06-safe-area-proofs/`.

## Rebuilding

Needs Node 18+, `sharp` (already a project dependency) and Chrome or Edge.

```bash
cd brand/social-launch-kit/_source
npm run build          # logos, favicons, social assets, brand guide, then verify
```

Individually:

```bash
npm run build:logos    # SVG, PNG, favicon set, favicon.ico
npm run build:social   # avatars, banners, post templates
npm run build:guide    # the one-page brand guide
npm run verify         # dimensions + safe areas + overlay proofs
node build-social.mjs linkedin-cover    # re-render a subset by name
```

**To change copy**, edit the constants in `_source/assets-profile.mjs` or
`_source/assets-templates.mjs` and rebuild. Generated HTML in `_source/html/` is
overwritten on every build — edit the generator, not the HTML.

Rendering shoots each canvas at 2× in headless Chrome and resamples to the exact
platform size. Supersampling is what keeps hairlines and tight tracking clean at
191px tall, where a 1× render visibly breaks down.

**To regenerate the wordmark outlines** — only if the wordmark text, typeface or
tracking changes:

```bash
npm i --no-save opentype.js
npm run outline
```

`opentype.js` is intentionally not a dependency; the outlines are committed instead.

### Source files

| File | Role |
|---|---|
| `mark.mjs` | Mark geometry and the colour set, transcribed from the site |
| `artwork.mjs` | Lockup, mark, wordmark and tile as SVG — the single artwork source |
| `wordmark-outline.json` | Committed Inter SemiBold outlines for "EngiSignal" |
| `components.mjs` | Shared CSS, tokens, inlined Inter, drafting grid, datum rule, title block, chart |
| `assets-profile.mjs` | Avatars and banners, and their copy |
| `assets-templates.mjs` | Post templates and the OG card |
| `build-guide.mjs` | The one-page brand guide |
| `render.mjs` | Headless Chrome → exact-size PNG |
| `verify.mjs` | Dimension and safe-area checks, and the overlay proofs |
| `Inter-SemiBold.ttf` | Static instance used to generate the outlines (OFL) |
| `Inter-Variable-latin.woff2` | Inlined into every template render (OFL) |

Inter is licensed under the SIL Open Font License 1.1.

## What was cut from the first pass

One logo direction, two banner options per platform, and no duplicate that made a
user choose between near-identical files:

- **Logos:** dropped four redundant mark colourways (`mark-white`, `mark-black` and
  their compact pairs) and the square app tile, which survives only as the Apple touch
  icon. Dropped the 512px lockup width. 16 SVGs → 11, 44 PNGs → 22.
- **Banners:** three options per platform → two. Cut the LinkedIn "See what changed in
  your portfolio" cover and the X "From usage data to defensible renewal decisions"
  header, whose message now lives on the LinkedIn B cover.
- **Templates:** 14 → 12. Cut the square duplicates of the category and capability
  explainers, which said the same thing as their wide versions.
