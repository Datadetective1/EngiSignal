/**
 * The one-page brand guide, rendered as a sheet.
 *
 * A guide that is itself built from the system it documents cannot drift from
 * it: every swatch, every logo and every type sample on this page is produced
 * by the same modules that produce the assets. Change a token and the guide
 * changes with it.
 *
 * A4 at 200dpi (1654 x 2339), so it prints without resampling.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLOR } from './mark.mjs';
import { page, lockup, mark, datum, titleBlock } from './components.mjs';
import { shootAll } from './render.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const W = 1654;
const H = 2339;
const PAD = 92;

/* ── Section furniture ────────────────────────────────────────────────── */

function section(n, title, body, { note = '' } = {}) {
  return `
    <section>
      <div class="shead">
        <span class="snum">${n}</span>
        <h2>${title}</h2>
        ${note ? `<span class="snote">${note}</span>` : ''}
      </div>
      <div class="sbody">${body}</div>
    </section>`;
}

/** A logo shown on the background it is made for, with its filename. */
function logoSwatch({ bg, file, caption, art, border = false }) {
  return `
    <div class="swatch">
      <div class="plate" style="background:${bg};${border ? 'border-color:var(--border-strong)' : ''}">${art}</div>
      <div class="fname">${file}</div>
      <div class="fcap">${caption}</div>
    </div>`;
}

function colourSwatch(name, hex, use) {
  return `
    <div class="col">
      <div class="chip2" style="background:${hex}"></div>
      <div class="cname">${name}</div>
      <div class="chex">${hex.toUpperCase()}</div>
      <div class="cuse">${use}</div>
    </div>`;
}

const usageRows = [
  ['LinkedIn company logo', '400 × 400', '03-linkedin/…-avatar-400x400.png'],
  ['LinkedIn cover', '1128 × 191', '03-linkedin/…-cover-1128x191-a|b'],
  ['X profile photo', '400 × 400', '04-x/…-avatar-400x400.png'],
  ['X header', '1500 × 500', '04-x/…-header-1500x500-a|b'],
  ['Square feed post', '1200 × 1200', '05-post-templates/…-1200x1200'],
  ['Wide feed post', '1600 × 900', '05-post-templates/…-1600x900'],
  ['Link preview card', '1200 × 630', '05-post-templates/…-og-image'],
  ['Site favicon', '16 – 512', '02-favicon/'],
];

/* ── The sheet ────────────────────────────────────────────────────────── */

const html = page({
  w: W,
  h: H,
  grid: 32,
  glowAt: '88% 4%',
  glowSize: '38% 26%',
  css: `
    .frame { height: 100%; display: flex; flex-direction: column; padding: ${PAD}px; }
    .head { display: flex; align-items: flex-end; justify-content: space-between; }
    .head .title { font-size: 15px; }
    .headrule { margin: 22px 0 0; }
    .stack { flex: 1; display: flex; flex-direction: column; justify-content: space-between; gap: 40px; padding: 42px 0 36px; min-height: 0; }

    .shead { display: flex; align-items: baseline; gap: 16px; margin-bottom: 20px; }
    .snum { font-size: 12px; font-weight: 600; letter-spacing: .16em; color: var(--accent); }
    h2 { font-size: 19px; font-weight: 600; letter-spacing: -.014em; }
    .snote { margin-left: auto; font-size: 13px; color: var(--subtle); letter-spacing: -.004em; }
    .sbody { border-top: 1px solid var(--border); padding-top: 22px; }

    /* 01 — the mark */
    .markrow { display: grid; grid-template-columns: 232px minmax(0, 1fr); gap: 44px; align-items: center; }
    .markplate { height: 200px; border-radius: 12px; background: ${COLOR.graphite};
                 border: 1px solid var(--border); display: grid; place-items: center; }
    .rules { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 40px; }
    .rules div { font-size: 15px; color: var(--muted); line-height: 1.5; letter-spacing: -.006em; }
    .rules b { color: var(--fg); font-weight: 600; }

    /* 02 — logo files */
    .swatches { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 22px; }
    .plate { height: 150px; border-radius: 10px; border: 1px solid var(--border);
             display: grid; place-items: center; padding: 0 18px; }
    .fname { margin-top: 12px; font-size: 12px; font-weight: 600; color: var(--fg); letter-spacing: -.004em; }
    .fcap { margin-top: 5px; font-size: 12px; color: var(--subtle); line-height: 1.4; }

    /* 03 — colour */
    .cols { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 18px; }
    .cols + .cols { margin-top: 24px; }
    .chip2 { height: 66px; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); }
    .cname { margin-top: 10px; font-size: 12.5px; font-weight: 600; letter-spacing: -.006em; }
    .chex { margin-top: 3px; font-size: 12px; color: var(--muted); }
    .cuse { margin-top: 5px; font-size: 11.5px; color: var(--subtle); line-height: 1.35; }

    /* 04 — typography */
    .typerow { display: grid; grid-template-columns: 420px minmax(0, 1fr); gap: 44px; align-items: center; }
    .specimen { font-size: 76px; font-weight: 600; letter-spacing: -.021em; line-height: 1; }
    .specsub { margin-top: 14px; font-size: 14px; color: var(--subtle); }
    .scale { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 10px 26px; font-size: 14.5px; }
    .scale .k { color: var(--subtle); }
    .scale .v { color: var(--muted); letter-spacing: -.006em; }

    /* 05 — where each asset goes */
    .usage { width: 100%; border-collapse: collapse; font-size: 14px; }
    .usage th { text-align: left; font-size: 10.5px; font-weight: 600; text-transform: uppercase;
                letter-spacing: .16em; color: var(--subtle); padding-bottom: 12px; }
    .usage td { padding: 17px 0; border-top: 1px solid var(--border); letter-spacing: -.006em; }
    .usage td:first-child { color: var(--fg); font-weight: 500; }
    .usage td:nth-child(2) { color: var(--muted); width: 150px; }
    .usage td:last-child { color: var(--subtle); }
  `,
  body: `
    <div class="frame">
      <div class="head">
        ${lockup(38)}
        <span class="eyebrow eyebrow-muted title">Brand Guide · One Page</span>
      </div>
      <div class="headrule">${datum({ divisions: 24 })}</div>

      <div class="stack">
        ${section(
          '01',
          'The mark',
          `<div class="markrow">
            <div class="markplate">${mark(104)}</div>
            <div class="rules">
              <div><b>Bars carry the identity.</b> An abstract E of three measurement bars — a signal-strength reading.</div>
              <div><b>The node carries the accent.</b> It is the only place the accent belongs inside the mark.</div>
              <div><b>The arc drops below 24px</b>, where it turns to mud. Use a <b>-compact-</b> file there.</div>
              <div><b>Clear space</b> equals the node's diameter on every side. Minimum lockup width 100px.</div>
            </div>
          </div>`,
          { note: 'Never recolour the bars, drop the node, or reset the wordmark' },
        )}

        ${section(
          '02',
          'Logo files',
          `<div class="swatches">
            ${logoSwatch({
              bg: COLOR.bgDark,
              art: lockup(30),
              file: 'engisignal-logo-dark-bg',
              caption: 'Primary. Use on dark surfaces.',
            })}
            ${logoSwatch({
              bg: COLOR.bgLight,
              art: `<img alt="" style="width:200px" src="">`,
              file: 'engisignal-logo-light-bg',
              caption: 'Full colour on light surfaces.',
            })}
            ${logoSwatch({
              bg: '#3a4150',
              art: `<img alt="" style="width:200px" src="">`,
              file: 'engisignal-logo-white',
              caption: 'Photography and busy surfaces.',
            })}
            ${logoSwatch({
              bg: COLOR.graphite,
              art: mark(52),
              file: 'engisignal-app-icon',
              caption: 'Avatars, favicon, app tile.',
            })}
          </div>`,
          { note: 'Eleven files in 01-logo/ — SVG plus PNG at two widths each' },
        )}

        ${section(
          '03',
          'Colour',
          `<div class="cols">
            ${colourSwatch('Background', COLOR.bgDark, 'Canvas')}
            ${colourSwatch('Graphite', COLOR.graphite, 'Avatars, icon tile')}
            ${colourSwatch('Surface', '#14171E', 'Cards')}
            ${colourSwatch('Border', '#232833', 'Hairlines, grid')}
            ${colourSwatch('Foreground', COLOR.paper, 'Headlines')}
            ${colourSwatch('Muted', COLOR.mutedDark, 'Support copy')}
            ${colourSwatch('Accent', COLOR.accentDark, 'The node. Once per graphic')}
          </div>
          <div class="cols">
            ${colourSwatch('Positive', COLOR.positiveDark, 'Cost Signal — spend down')}
            ${colourSwatch('Danger', COLOR.dangerDark, 'Capacity Signal — risk')}
            ${colourSwatch('Violet', COLOR.violetDark, 'Forecast Signal')}
            ${colourSwatch('Aqua', COLOR.aquaDark, 'Usage Signal')}
            ${colourSwatch('Warning', COLOR.warningDark, 'Data Signal')}
            ${colourSwatch('Ink', COLOR.ink, 'Logo on light')}
            ${colourSwatch('Accent light', COLOR.accentLight, 'Node on light')}
          </div>`,
          { note: 'Signal colours are semantic — never swapped for contrast' },
        )}

        ${section(
          '04',
          'Typography',
          `<div class="typerow">
            <div>
              <div class="specimen">EngiSignal</div>
              <div class="specsub">Inter SemiBold · −0.021em · outlined in all logo files</div>
            </div>
            <div class="scale">
              <div class="k">Headline</div><div class="v">Inter 600 · −0.030em · 1.10 line-height</div>
              <div class="k">Support</div><div class="v">Inter 400 · −0.008em · 1.50 line-height</div>
              <div class="k">Label / eyebrow</div><div class="v">Inter 600 · uppercase · +0.17em</div>
              <div class="k">Figures</div><div class="v">Tabular everywhere numbers stack</div>
            </div>
          </div>`,
          { note: 'Inter, the typeface the product already uses' },
        )}

        ${section(
          '05',
          'Where each asset goes',
          `<table class="usage">
            <thead><tr><th>Placement</th><th>Size</th><th>File</th></tr></thead>
            <tbody>
              ${usageRows.map(([a, b, c]) => `<tr><td>${a}</td><td>${b}</td><td>${c}</td></tr>`).join('')}
            </tbody>
          </table>`,
          { note: 'Two banner options per platform: A states the category, B states the outcome' },
        )}
      </div>

      ${titleBlock(
        [
          { k: 'Category', v: 'Engineering Software Intelligence', width: '1.6fr' },
          { k: 'Full documentation', v: 'README.md · MESSAGING.md', width: '1.4fr' },
          { k: 'Web', v: 'engisignal.com', width: '0.8fr' },
        ],
        { pad: 16, k: 10, v: 14, gap: 7 },
      )}
    </div>`,
});

/* The light-background and white lockups are SVG rather than the inline dark
 * lockup helper, so they are injected as data URIs after the fact. */
import { lockupSvg } from './artwork.mjs';

function dataUri(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

const lightLockup = dataUri(lockupSvg({ bar: COLOR.ink, node: COLOR.accentLight, text: COLOR.ink, px: 400 }));
const whiteLockup = dataUri(lockupSvg({ bar: COLOR.white, node: COLOR.white, text: COLOR.white, px: 400 }));

let filled = html.replace('<img alt="" style="width:200px" src="">', `<img alt="" style="width:200px" src="${lightLockup}">`);
filled = filled.replace('<img alt="" style="width:200px" src="">', `<img alt="" style="width:200px" src="${whiteLockup}">`);

mkdirSync(root, { recursive: true });

const done = await shootAll([
  {
    name: 'engisignal-brand-guide-1654x2339',
    w: W,
    h: H,
    html: filled,
    outDir: root,
    htmlDir: join(here, 'html'),
    tmpDir: process.env.RENDER_TMP || join(here, '.tmp'),
  },
]);

console.log(`brand guide: ${done[0].w}x${done[0].h} — ${done[0].outPath}`);
