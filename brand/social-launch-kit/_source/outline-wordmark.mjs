/**
 * Regenerate wordmark-outline.json from Inter-SemiBold.ttf.
 *
 * This runs rarely — only if the wordmark text, the typeface or the tracking
 * changes — so opentype.js is not a dependency of the kit. Install it just for
 * the run:
 *
 *   npm i --no-save opentype.js
 *   node outline-wordmark.mjs
 *
 * The site renders the wordmark as live Inter SemiBold with -0.021em tracking
 * (components/brand/logo.tsx). Logo files have to survive machines without
 * Inter installed, so the shipped SVGs carry outlines rather than <text>.
 *
 * opentype.js cannot shape Inter — its ccmp lookup uses a substitution format
 * the library rejects — so glyphs are mapped one to one instead. "EngiSignal"
 * has no ligatures and no combining marks, so one-to-one mapping is exactly
 * what shaping would have produced.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const opentype = require(process.env.OPENTYPE_PATH || 'opentype.js');

const TEXT = 'EngiSignal';
const TRACKING = -0.021; // matches tracking-[-0.021em]
const FONT_SIZE = 100; // outline at a round em; consumers scale it

const font = opentype.parse(readFileSync(join(here, 'Inter-SemiBold.ttf')).buffer);
const EM = font.unitsPerEm;
const scale = FONT_SIZE / EM;

function kern(a, b) {
  try {
    return font.getKerningValue(a, b) || 0;
  } catch {
    return 0;
  }
}

const glyphs = [...TEXT].map((ch) => font.charToGlyph(ch));
const path = new opentype.Path();
let x = 0;

glyphs.forEach((glyph, i) => {
  path.extend(glyph.getPath(x, 0, FONT_SIZE));
  x += glyph.advanceWidth * scale + TRACKING * FONT_SIZE;
  const next = glyphs[i + 1];
  if (next) x += kern(glyph, next) * scale;
});

const outline = {
  text: TEXT,
  font: 'Inter SemiBold (Google Fonts v20 static instance)',
  tracking: TRACKING,
  fontSize: FONT_SIZE,
  // Trailing tracking is not part of the logo, so it comes back off the width.
  width: Number((x - TRACKING * FONT_SIZE).toFixed(4)),
  capHeight: Number((font.tables.os2.sCapHeight / EM).toFixed(6)),
  descender: 0.241,
  d: path.toPathData(3),
};

writeFileSync(join(here, 'wordmark-outline.json'), `${JSON.stringify(outline, null, 2)}\n`, 'utf8');
console.log(`wordmark-outline.json — width ${outline.width} at ${FONT_SIZE}em, cap ${outline.capHeight}`);
