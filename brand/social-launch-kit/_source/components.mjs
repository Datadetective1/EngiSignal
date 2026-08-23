/**
 * The shared visual language for EngiSignal social graphics.
 *
 * Every surface is dark, because marketing surfaces force dark on the site.
 * Type, spacing and hierarchy carry the design; the accent appears once per
 * graphic and always to mean something (BRAND.md §5).
 *
 * The register is an engineering drawing, not a SaaS gradient. Three cues do
 * that work, and they are deliberately quiet:
 *
 *   - a two-tier drafting grid, minor and major, sitting near the noise floor
 *   - a datum rule: a measured hairline with tick marks, which is the mark's
 *     own idea of ruled measurement at page scale
 *   - a title block: the label/value strip along the foot of a drawing sheet
 *
 * The ambient glow that a dark SaaS template would lean on is turned down to
 * roughly a third of the usual strength. Aerospace, manufacturing and
 * technical-operations buyers read restraint as competence; they read bloom as
 * marketing.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLOR } from './mark.mjs';
import { lockupSvg, markSvg, MARK_RATIO, LOCKUP } from './artwork.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/** Inter, inlined so a render never depends on what is installed locally. */
const interBase64 = readFileSync(join(here, 'Inter-Variable-latin.woff2')).toString('base64');

export const FONT_FACE = `
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 100 900;
  font-display: block;
  src: url(data:font/woff2;base64,${interBase64}) format('woff2');
}`;

/** Tokens, lifted verbatim from the dark theme in app/globals.css. */
export const TOKENS = `
:root {
  --bg: ${COLOR.bgDark};
  --surface: #0f1116;
  --surface-2: #14171e;
  --surface-3: #1a1e27;
  --border: #232833;
  --border-strong: #333a48;
  --fg: ${COLOR.paper};
  --muted: ${COLOR.mutedDark};
  --subtle: #6b7488;
  --accent: ${COLOR.accentDark};
  --aqua: ${COLOR.aquaDark};
  --positive: ${COLOR.positiveDark};
  --violet: ${COLOR.violetDark};
  --warning: ${COLOR.warningDark};
  --danger: ${COLOR.dangerDark};
}`;

export const BASE_CSS = `
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { background: var(--bg); }
body {
  font-family: 'Inter', system-ui, sans-serif;
  color: var(--fg);
  -webkit-font-smoothing: antialiased;
  /* Tabular figures everywhere. Misaligned digits in a technical graphic look
     like a defect even when the numbers are right. */
  font-feature-settings: 'cv05' 1, 'tnum' 1;
  font-variant-numeric: tabular-nums;
}

.canvas {
  position: relative;
  overflow: hidden;
  background: var(--bg);
  isolation: isolate;
}

/* Drafting grid: a fine minor pitch with a major line every fifth. Two tiers
   are what separates a drawing grid from wallpaper. */
.canvas::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image:
    repeating-linear-gradient(0deg,  rgba(35,40,51,.40) 0 1px, transparent 1px var(--grid, 28px)),
    repeating-linear-gradient(90deg, rgba(35,40,51,.40) 0 1px, transparent 1px var(--grid, 28px)),
    repeating-linear-gradient(0deg,  rgba(41,48,62,.62) 0 1px, transparent 1px calc(var(--grid, 28px) * 5)),
    repeating-linear-gradient(90deg, rgba(41,48,62,.62) 0 1px, transparent 1px calc(var(--grid, 28px) * 5));
  -webkit-mask-image: var(--grid-mask, radial-gradient(120% 130% at 12% 0%, #000 0%, rgba(0,0,0,.35) 58%, transparent 92%));
          mask-image: var(--grid-mask, radial-gradient(120% 130% at 12% 0%, #000 0%, rgba(0,0,0,.35) 58%, transparent 92%));
  z-index: 0;
}

/* One ambient light, kept low. */
.canvas::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(var(--glow-size, 50% 80%) at var(--glow-at, 84% 12%), rgba(77,163,255,.085), transparent 70%);
  z-index: 0;
}

.layer { position: relative; z-index: 1; height: 100%; }

.eyebrow {
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .17em;
  color: var(--accent);
}
.eyebrow-muted { color: var(--subtle); }

h1, h2 { font-weight: 600; letter-spacing: -.03em; line-height: 1.1; }
.support { color: var(--muted); font-weight: 400; letter-spacing: -.008em; line-height: 1.5; }

.rule { height: 1px; background: var(--border); border: 0; }

/* A hairline panel, the same construction as a panel in the product. */
.card {
  background: linear-gradient(180deg, rgba(20,23,30,.94), rgba(15,17,22,.94));
  border: 1px solid var(--border);
  border-radius: 12px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: .55em;
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  color: var(--muted);
  font-weight: 500;
  letter-spacing: -.006em;
  white-space: nowrap;
}
.dot { border-radius: 50%; flex: none; }

/* ── Datum rule ────────────────────────────────────────────────────────
   A measured hairline: ticks at every twelfth, longer at every quarter. The
   mark is three ruled bars of differing length; this is the same idea at page
   scale, and it is the cue that reads as instrumentation rather than styling. */
.datum { position: relative; height: 1px; background: var(--border); }
.datum span {
  position: absolute; top: 0; width: 1px; background: var(--border-strong);
  height: 5px;
}
.datum span.major { height: 9px; background: var(--border-strong); }
.datum span.origin { height: 11px; background: var(--accent); }

/* ── Title block ───────────────────────────────────────────────────────
   The label/value strip along the foot of a drawing sheet. */
.titleblock {
  display: grid;
  border-top: 1px solid var(--border);
}
.titleblock .cell { padding-top: var(--tb-pad, 16px); padding-right: 24px; border-left: 1px solid var(--border); padding-left: 24px; }
.titleblock .cell:first-child { border-left: 0; padding-left: 0; }
.titleblock .k {
  font-size: var(--tb-k, 10px); font-weight: 600; text-transform: uppercase;
  letter-spacing: .16em; color: var(--subtle);
}
.titleblock .v {
  margin-top: var(--tb-gap, 7px); font-size: var(--tb-v, 14px); font-weight: 500;
  letter-spacing: -.008em; color: var(--muted);
}
.titleblock .cell:last-child .v { color: var(--fg); }
`;

/* ── Artwork helpers ──────────────────────────────────────────────────── */

/** The full lockup at a given rendered height. */
export function lockup(height, { mono = false } = {}) {
  const px = Math.round(height * LOCKUP.ratio);
  const svg = lockupSvg({
    bar: COLOR.paper,
    node: mono ? COLOR.paper : COLOR.accentDark,
    text: COLOR.paper,
    px,
  });
  return svg.replace('<svg ', `<svg style="display:block;width:${px}px;height:${height}px" `);
}

/** The mark alone at a given rendered height. */
export function mark(height, { arc = true, bar = COLOR.paper, node = COLOR.accentDark } = {}) {
  const ratio = arc ? MARK_RATIO.withArc : MARK_RATIO.noArc;
  const px = Math.round(height * ratio);
  const svg = markSvg({ bar, node, arc, px });
  return svg.replace('<svg ', `<svg style="display:block;width:${px}px;height:${height}px" `);
}

/** The measured hairline. `divisions` ticks, every third of them major. */
export function datum({ divisions = 12, origin = true } = {}) {
  const ticks = Array.from({ length: divisions + 1 }, (_, i) => {
    const pct = (i / divisions) * 100;
    const major = i % 3 === 0;
    const cls = origin && i === 0 ? 'origin' : major ? 'major' : '';
    return `<span class="${cls}" style="left:${pct.toFixed(4)}%"></span>`;
  }).join('');
  return `<div class="datum">${ticks}</div>`;
}

/** The drawing title block. Cells are `{ k, v }`. */
export function titleBlock(cells, { pad = 16, k = 10, v = 14, gap = 7 } = {}) {
  const cols = cells.map((c) => c.width || '1fr').join(' ');
  const body = cells
    .map((c) => `<div class="cell"><div class="k">${c.k}</div><div class="v">${c.v}</div></div>`)
    .join('');
  return `<div class="titleblock" style="grid-template-columns:${cols};--tb-pad:${pad}px;--tb-k:${k}px;--tb-v:${v}px;--tb-gap:${gap}px">${body}</div>`;
}

/* ── Data visuals ─────────────────────────────────────────────────────── */

/**
 * Daily peak concurrent demand against an entitlement ceiling — the single
 * chart the whole product argument rests on.
 *
 * Drawn as an instrument readout rather than a marketing curve: a labelled y
 * axis, tick marks on both axes, and the entitlement and P95 lines called out
 * where they cross. The series comes from a fixed formula so every rebuild
 * produces the identical picture, and it is labelled illustrative wherever it
 * carries numbers, because inventing customer results is off limits
 * (BRAND.md §9).
 */
export function demandChart({ w, h, entitled = 400, p95 = 275, axis = true, showLabels = true }) {
  const padT = 14;
  const padB = axis ? 24 : 14;
  const padR = showLabels ? 92 : 12;
  const padL = axis ? 40 : 4;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const N = 46;
  const ceiling = entitled * 1.1;
  const yFor = (v) => padT + plotH * (1 - v / ceiling);

  const series = Array.from({ length: N }, (_, i) => {
    const t = i / (N - 1);
    const v =
      196 +
      64 * Math.sin(t * Math.PI * 2.15 + 0.55) +
      31 * Math.sin(t * Math.PI * 6.4 + 1.9) +
      13 * Math.sin(t * Math.PI * 13.1 + 0.3) +
      46 * t;
    return { x: padL + plotW * t, y: yFor(Math.max(96, Math.min(322, v))) };
  });

  const line = series.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L${(padL + plotW).toFixed(1)} ${padT + plotH} L${padL} ${padT + plotH} Z`;
  const yEnt = yFor(entitled);
  const yP95 = yFor(p95);
  const uid = `c${w}x${h}`;

  // Y scale: 0 to entitled in four steps, so the entitlement line lands on a
  // labelled gridline rather than floating between two.
  const steps = [0, entitled / 4, entitled / 2, (entitled * 3) / 4, entitled];
  const yAxis = axis
    ? steps
        .map((v) => {
          const y = yFor(v).toFixed(1);
          return `<line x1="${padL - 5}" y1="${y}" x2="${padL}" y2="${y}" stroke="#333a48" stroke-width="1"/>
        <line x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}" stroke="#232833" stroke-width="1" opacity=".55"/>
        <text x="${padL - 10}" y="${Number(y) + 4}" text-anchor="end" fill="#6b7488" font-size="11" font-weight="500" font-family="Inter">${v}</text>`;
        })
        .join('')
    : '';

  const xTicks = axis
    ? Array.from({ length: 7 }, (_, i) => {
        const x = (padL + (plotW * i) / 6).toFixed(1);
        return `<line x1="${x}" y1="${padT + plotH}" x2="${x}" y2="${padT + plotH + 5}" stroke="#333a48" stroke-width="1"/>`;
      }).join('')
    : '';

  const labels = showLabels
    ? `<text x="${w - padR + 12}" y="${yEnt + 4}" fill="${COLOR.mutedDark}" font-size="12.5" font-weight="500" font-family="Inter">${entitled} entitled</text>
    <text x="${w - padR + 12}" y="${yP95 + 4}" fill="${COLOR.accentDark}" font-size="12.5" font-weight="600" font-family="Inter">P95 ${p95}</text>`
    : '';

  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block" role="img" aria-label="Daily peak concurrent demand tracking below an entitlement ceiling of ${entitled} licenses, with a 95th percentile of ${p95}.">
    <defs>
      <linearGradient id="${uid}-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${COLOR.accentDark}" stop-opacity=".22"/>
        <stop offset="100%" stop-color="${COLOR.accentDark}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${yAxis}
    <path d="${area}" fill="url(#${uid}-fill)"/>
    <line x1="${padL}" y1="${yEnt}" x2="${padL + plotW}" y2="${yEnt}" stroke="${COLOR.mutedDark}" stroke-width="1.25" stroke-dasharray="6 5" opacity=".7"/>
    <line x1="${padL}" y1="${yP95}" x2="${padL + plotW}" y2="${yP95}" stroke="${COLOR.accentDark}" stroke-width="1" stroke-dasharray="2 4" opacity=".6"/>
    <path d="${line}" stroke="${COLOR.accentDark}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="#333a48" stroke-width="1"/>
    ${xTicks}
    ${labels}
  </svg>`;
}

/** The chart in a product panel, with the label it needs. */
export function chartCard({ w, h, title = 'Daily peak concurrent demand', unit = 'Concurrent licenses', pad = 22, ...rest }) {
  const headH = 40;
  return `<div class="card" style="width:${w}px;padding:${pad}px">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:${headH - 22}px">
      <span style="font-size:13.5px;font-weight:600;letter-spacing:-.012em">${title}</span>
      <span class="eyebrow eyebrow-muted" style="font-size:10px">Illustrative</span>
    </div>
    ${demandChart({ w: w - pad * 2, h: h - pad * 2 - headH, ...rest })}
    <div style="margin-top:12px;font-size:10.5px;font-weight:600;letter-spacing:.15em;text-transform:uppercase;color:var(--subtle)">${unit}</div>
  </div>`;
}

/** A stack of Signal rows, mirroring the product's own vocabulary. */
export function signalRows(rows, { fontSize = 17, gap = 12 } = {}) {
  const items = rows
    .map(
      (r) => `
      <li style="display:flex;align-items:center;gap:${fontSize * 0.8}px;padding:${fontSize * 0.72}px ${fontSize}px;border:1px solid var(--border);border-radius:${fontSize * 0.5}px;background:rgba(20,23,30,.72)">
        <span class="dot" style="width:${fontSize * 0.44}px;height:${fontSize * 0.44}px;background:${r.color}"></span>
        <span style="font-weight:500;letter-spacing:-.012em;color:var(--fg)">${r.label}</span>
        <span style="margin-left:auto;font-weight:600;color:${r.color};letter-spacing:-.012em">${r.value}</span>
      </li>`,
    )
    .join('');
  return `<ul style="list-style:none;display:flex;flex-direction:column;gap:${gap}px;font-size:${fontSize}px">${items}</ul>`;
}

/** Chips for the capability set. */
export function chips(labels, { fontSize = 17, gap = 12 } = {}) {
  const items = labels
    .map(
      (l) =>
        `<span class="chip" style="font-size:${fontSize}px;padding:${fontSize * 0.44}px ${fontSize * 0.95}px"><span class="dot" style="width:${fontSize * 0.34}px;height:${fontSize * 0.34}px;background:var(--accent)"></span>${l}</span>`,
    )
    .join('');
  return `<div style="display:flex;flex-wrap:wrap;gap:${gap}px">${items}</div>`;
}

/** Wrap a body in a complete, self-contained document at an exact size. */
export function page({
  w,
  h,
  body,
  css = '',
  grid = 28,
  glowAt = '84% 12%',
  glowSize = '50% 80%',
  gridMask = 'radial-gradient(120% 130% at 12% 0%, #000 0%, rgba(0,0,0,.35) 58%, transparent 92%)',
}) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<style>${FONT_FACE}${TOKENS}${BASE_CSS}
.canvas { width: ${w}px; height: ${h}px; --grid: ${grid}px; --glow-at: ${glowAt}; --glow-size: ${glowSize}; --grid-mask: ${gridMask}; }
${css}
</style></head>
<body><div class="canvas"><div class="layer">${body}</div></div></body></html>`;
}
