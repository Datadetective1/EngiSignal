/**
 * Shared artwork builders: the lockup, the mark and the app tile as SVG
 * strings, plus the lockup metrics other templates need in order to place it.
 *
 * Both build-logos.mjs (file exports) and build-social.mjs (inline SVG inside
 * HTML templates) draw from here, so a social banner and a downloadable logo
 * can never disagree about the artwork.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLOR, markBody, MARK_BOUNDS } from './mark.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/* The wordmark ships as pre-computed outlines. Regenerating them needs
 * opentype.js, which the kit deliberately does not depend on — see
 * outline-wordmark.mjs. */
const OUTLINE = JSON.parse(readFileSync(join(here, 'wordmark-outline.json'), 'utf8'));
export const CAP_HEIGHT = OUTLINE.capHeight;

/** Scale the stored 100em outline to `fontSize`. */
function outline(fontSize) {
  const k = fontSize / OUTLINE.fontSize;
  return {
    scale: k,
    width: OUTLINE.width * k,
    d: OUTLINE.d,
  };
}

/* logo.tsx sets the wordmark at 0.66x the mark size with a 10px gap and
 * centres it with items-center. Centring the cap height on the mark's midline
 * is what that produces optically, and unlike centring the line box it stays
 * put regardless of which glyphs are in the word. */
export const MARK = 32;
export const FONT_SIZE = MARK * 0.66; // 21.12
const GAP = 10;
const TEXT_X = MARK + GAP; // 42
export const BASELINE = MARK / 2 + (FONT_SIZE * CAP_HEIGHT) / 2;
const DESCENDER = FONT_SIZE * OUTLINE.descender; // for the 'g' in Engi/Signal

export const word = outline(FONT_SIZE);

/** Tight bounds of the whole lockup, arc included. */
export const LOCKUP = {
  left: MARK_BOUNDS.left,
  right: TEXT_X + word.width,
  top: MARK_BOUNDS.top,
  bottom: Math.max(MARK_BOUNDS.bottom, BASELINE + DESCENDER),
};
LOCKUP.width = LOCKUP.right - LOCKUP.left;
LOCKUP.height = LOCKUP.bottom - LOCKUP.top;
LOCKUP.ratio = LOCKUP.width / LOCKUP.height;

export const round = (n) => Number(n.toFixed(3));

function svgOpen({ x, y, w, h, width, height }) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${round(x)} ${round(y)} ${round(w)} ${round(h)}"` +
    ` width="${width}" height="${height}" role="img" aria-label="EngiSignal">\n  <title>EngiSignal</title>`
  );
}

/** The full lockup: mark plus wordmark. */
export function lockupSvg({ bar, node, text, arc = true, px = 1024 }) {
  const height = Math.round((px * LOCKUP.height) / LOCKUP.width);
  return [
    svgOpen({ x: LOCKUP.left, y: LOCKUP.top, w: LOCKUP.width, h: LOCKUP.height, width: px, height }),
    markBody({ bar, node, arc }),
    `  <path transform="translate(${TEXT_X} ${round(BASELINE)}) scale(${round(word.scale)})" d="${word.d}" fill="${text}"/>`,
    '</svg>',
    '',
  ].join('\n');
}

/** The mark alone. `arc: false` is the site rule for anything below 24px. */
export function markSvg({ bar, node, arc = true, px = 512 }) {
  const right = arc ? MARK_BOUNDS.rightWithArc : MARK_BOUNDS.rightNoArc;
  const w = right - MARK_BOUNDS.left;
  const h = MARK_BOUNDS.bottom - MARK_BOUNDS.top;
  const open = svgOpen({
    x: MARK_BOUNDS.left,
    y: MARK_BOUNDS.top,
    w,
    h,
    width: px,
    height: Math.round((px * h) / w),
  });
  return [open, markBody({ bar, node, arc }), '</svg>', ''].join('\n');
}

export const MARK_RATIO = {
  withArc: (MARK_BOUNDS.rightWithArc - MARK_BOUNDS.left) / (MARK_BOUNDS.bottom - MARK_BOUNDS.top),
  noArc: (MARK_BOUNDS.rightNoArc - MARK_BOUNDS.left) / (MARK_BOUNDS.bottom - MARK_BOUNDS.top),
};

/** The wordmark alone, cap top to descender. */
export function wordmarkSvg({ text, px = 1024 }) {
  const capTop = BASELINE - FONT_SIZE * CAP_HEIGHT;
  const h = FONT_SIZE * CAP_HEIGHT + DESCENDER;
  const open = svgOpen({ x: 0, y: capTop, w: word.width, h, width: px, height: Math.round((px * h) / word.width) });
  return [
    open,
    `  <path transform="translate(0 ${round(BASELINE)}) scale(${round(word.scale)})" d="${word.d}" fill="${text}"/>`,
    '</svg>',
    '',
  ].join('\n');
}

/**
 * The app tile: the mark on a graphite square. Transcribed from public/icon.svg
 * including its 0.5 short-bar opacity, which differs by a hair from the
 * lockup's 0.55. Both are shipped artwork; neither is corrected here.
 */
export function tileSvg({ px = 512, radiusRatio = 7 / 32, bg = COLOR.graphite, scale = 0.84 }) {
  const inset = round((32 * (1 - scale)) / 2);
  return [
    svgOpen({ x: 0, y: 0, w: 32, h: 32, width: px, height: px }),
    `  <rect width="32" height="32" rx="${round(32 * radiusRatio)}" fill="${bg}"/>`,
    `  <g transform="translate(${inset}, ${inset}) scale(${scale})">`,
    markBody({ bar: COLOR.paper, node: COLOR.accentDark, arc: false, shortBarOpacity: 0.5, indent: '    ' }),
    '  </g>',
    '</svg>',
    '',
  ].join('\n');
}
