/**
 * The EngiSignal mark, in data.
 *
 * Geometry is transcribed verbatim from components/brand/logo.tsx so exported
 * files and the running site cannot drift apart. If the component changes,
 * change these numbers to match and re-run `npm run build` in this folder.
 */

/** Palette, from app/globals.css. No colour here is invented. */
export const COLOR = {
  graphite: '#0E1116',   // --es-surface (dark) — the icon tile
  ink: '#0E1420',        // --es-fg (light theme)
  paper: '#F1F3F7',      // --es-fg (dark theme)
  white: '#FFFFFF',
  accentLight: '#1F6FEB', // --es-accent (light theme)
  accentDark: '#4DA3FF',  // --es-accent (dark theme)
  bgDark: '#08090b',      // --es-bg (dark)
  bgLight: '#fbfcfd',     // --es-bg (light)
  borderDark: '#232833',
  mutedDark: '#99A2B4',
  aquaDark: '#37CFC0',
  positiveDark: '#3FC38D',
  violetDark: '#A98BFF',
  warningDark: '#E8B457',
  dangerDark: '#F4756A',
};

/** Bars, in the mark's native 32x32 grid. */
const BARS = [
  { x: 4, y: 6, w: 2.6, h: 20, o: 0.92 },      // the measurement axis
  { x: 9.2, y: 6, w: 9.4, h: 2.6, o: 0.55 },
  { x: 9.2, y: 14.7, w: 14.2, h: 2.6, o: 0.92 },
  { x: 9.2, y: 23.4, w: 7.2, h: 2.6, o: 0.55 },
];

const NODE = { cx: 25.9, cy: 16, r: 3.1 };
const ARC = 'M29.4 11.2a8.4 8.4 0 0 1 0 9.6';

/**
 * Mark body as SVG elements in the 32x32 grid.
 *
 * `arc` follows the site rule: the emitted arc drops away below 24px, where it
 * turns to mud. `shortBarOpacity` is 0.55 in the lockup (logo.tsx) and 0.5 in
 * the shipped favicon (public/icon.svg); both are reproduced as they are.
 */
export function markBody({ bar, node, arc = true, shortBarOpacity = 0.55, indent = '  ' }) {
  const rects = BARS.map((b) => {
    const o = b.o === 0.55 ? shortBarOpacity : b.o;
    return `${indent}<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="1.3" fill="${bar}" opacity="${o}"/>`;
  });
  const parts = [
    ...rects,
    `${indent}<circle cx="${NODE.cx}" cy="${NODE.cy}" r="${NODE.r}" fill="${node}"/>`,
  ];
  if (arc) {
    parts.push(
      `${indent}<path d="${ARC}" stroke="${node}" stroke-width="1.7" stroke-linecap="round" fill="none" opacity="0.45"/>`,
    );
  }
  return parts.join('\n');
}

/** Visual bounds of the mark inside its 32x32 grid. */
export const MARK_BOUNDS = {
  left: 4,
  top: 6,
  bottom: 26,
  rightWithArc: 31.76,  // arc sagitta 1.506 past x=29.4, plus half the 1.7 stroke
  rightNoArc: 29.0,     // node circle edge
};
