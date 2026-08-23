/**
 * Build the logo, mark, wordmark, app icon and favicon exports.
 *
 * One logo direction, in the four colourways real use demands: full colour on
 * dark (primary), full colour on light, and two single-colour versions for
 * photography and mono printing. Colourways of the same lockup are not
 * competing options; anything that was a duplicate — a fourth mark colourway,
 * a second tile radius — was cut.
 *
 * Artwork comes from artwork.mjs, which derives it from the mark geometry in
 * mark.mjs and the Inter outlines in wordmark-outline.json. There is one
 * source of truth and no hand-traced artwork anywhere in the pipeline.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { COLOR } from './mark.mjs';
import { lockupSvg, markSvg, wordmarkSvg, tileSvg, LOCKUP, round } from './artwork.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const logoDir = join(root, '01-logo');
const icoDir = join(root, '02-favicon');
[logoDir, icoDir].forEach((d) => mkdirSync(d, { recursive: true }));

/* ── The set ──────────────────────────────────────────────────────────── */

const SVGS = {
  // Primary lockup. Dark-background is primary: marketing surfaces force dark.
  'engisignal-logo-dark-bg': lockupSvg({ bar: COLOR.paper, node: COLOR.accentDark, text: COLOR.paper }),
  'engisignal-logo-light-bg': lockupSvg({ bar: COLOR.ink, node: COLOR.accentLight, text: COLOR.ink }),
  // Single colour, for photography and one-colour printing.
  'engisignal-logo-white': lockupSvg({ bar: COLOR.white, node: COLOR.white, text: COLOR.white }),
  'engisignal-logo-black': lockupSvg({ bar: COLOR.ink, node: COLOR.ink, text: COLOR.ink }),

  // Mark only, arc intact — for use at 24px and above.
  'engisignal-mark-dark-bg': markSvg({ bar: COLOR.paper, node: COLOR.accentDark }),
  'engisignal-mark-light-bg': markSvg({ bar: COLOR.ink, node: COLOR.accentLight }),

  // Mark only, arc dropped — the site rule for anything below 24px.
  'engisignal-mark-compact-dark-bg': markSvg({ bar: COLOR.paper, node: COLOR.accentDark, arc: false }),
  'engisignal-mark-compact-light-bg': markSvg({ bar: COLOR.ink, node: COLOR.accentLight, arc: false }),

  'engisignal-wordmark-white': wordmarkSvg({ text: COLOR.paper }),
  'engisignal-wordmark-black': wordmarkSvg({ text: COLOR.ink }),

  'engisignal-app-icon': tileSvg({}),
};

for (const [name, svg] of Object.entries(SVGS)) {
  writeFileSync(join(logoDir, `${name}.svg`), svg, 'utf8');
}

/* ── PNG exports ──────────────────────────────────────────────────────── */

/** Rasterise by re-declaring the SVG at the target width, so sharp renders at
 *  full resolution rather than upscaling a small bitmap. */
async function png(svg, width, out) {
  const retargeted = svg.replace(/ width="(\d+)" height="(\d+)"/, (_m, w, h) => {
    const height = Math.round((width * Number(h)) / Number(w));
    return ` width="${width}" height="${height}"`;
  });
  const buf = await sharp(Buffer.from(retargeted)).png({ compressionLevel: 9 }).toBuffer();
  writeFileSync(out, buf);
  return buf;
}

/** Two widths each: one for slides and documents, one for print and retina. */
const WIDTHS = { logo: [1024, 2048], mark: [512, 1024], wordmark: [1024, 2048], icon: [512, 1024] };

function widthsFor(name) {
  if (name.includes('app-icon')) return WIDTHS.icon;
  if (name.includes('wordmark')) return WIDTHS.wordmark;
  if (name.includes('-mark-')) return WIDTHS.mark;
  return WIDTHS.logo;
}

let pngCount = 0;
for (const [name, svg] of Object.entries(SVGS)) {
  for (const w of widthsFor(name)) {
    await png(svg, w, join(logoDir, `${name}-${w}w.png`));
    pngCount += 1;
  }
}

/* ── Favicons ─────────────────────────────────────────────────────────── */

const tile = tileSvg({});
const tileSquare = tileSvg({ radiusRatio: 0 });
const FAVICON_SIZES = [16, 32, 48, 64, 128, 180, 192, 256, 512];
const ICO_SIZES = [16, 32, 48, 64, 128, 256];
const icoBuffers = [];

for (const size of FAVICON_SIZES) {
  // Apple applies its own mask, so the touch icon ships full-bleed square.
  const source = size === 180 ? tileSquare : tile;
  const name = size === 180 ? 'apple-touch-icon-180.png' : `favicon-${size}.png`;
  const buf = await png(source, size, join(icoDir, name));
  if (ICO_SIZES.includes(size)) icoBuffers.push({ size, buf });
}

writeFileSync(join(icoDir, 'icon.svg'), tile.replace(/ width="\d+" height="\d+"/, ' width="32" height="32"'));

/** Pack the PNGs into a Vista-style .ico (PNG payloads rather than BMP). */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  let offset = 6 + entries.length * 16;
  const dir = entries.map(({ size, buf }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // 0 means 256
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // palette size
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += buf.length;
    return e;
  });

  return Buffer.concat([header, ...dir, ...entries.map((e) => e.buf)]);
}

writeFileSync(join(icoDir, 'favicon.ico'), buildIco(icoBuffers));

console.log(`logo svg   : ${Object.keys(SVGS).length}`);
console.log(`logo png   : ${pngCount}`);
console.log(`favicons   : ${FAVICON_SIZES.length} png + favicon.ico + icon.svg`);
console.log(`lockup     : ${round(LOCKUP.width)} x ${round(LOCKUP.height)} ratio units`);
