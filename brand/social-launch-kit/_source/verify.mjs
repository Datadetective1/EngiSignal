/**
 * Verify the kit: exact dimensions, and copy that survives every crop.
 *
 * The dimension check is trivial. The safe-area check is the one that matters,
 * and it is done by measurement rather than by eye: each banner is scanned for
 * "ink" — pixels bright enough to be type or a chart line rather than the
 * background texture — and the resulting bounding box is tested against the
 * regions each platform covers with its own chrome.
 *
 * Run: node verify.mjs        (writes overlay proofs and prints a report)
 */
import { readdirSync, mkdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { capture } from './render.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const htmlDir = join(here, 'html');
const proofDir = join(root, '06-safe-area-proofs');
const tmpDir = process.env.RENDER_TMP || join(here, '.tmp');
mkdirSync(proofDir, { recursive: true });
mkdirSync(tmpDir, { recursive: true });

/* Anything at or above this luminance is treated as content. The grid texture
 * sits near 28 and the ambient glow below 40, so the threshold separates
 * design texture from type and data ink without catching either background. */
const INK_LUMA = 90;

/**
 * Platform chrome, in the coordinate space of the uploaded image.
 *
 * `covered` regions get obscured by the platform's own UI. `safe` is the box
 * all content must stay inside so that neither a mobile crop nor the profile
 * furniture eats into it.
 */
const BANNERS = {
  'engisignal-linkedin-cover-1128x191': {
    w: 1128,
    h: 191,
    // The company logo tile overlaps the cover's bottom-left on desktop.
    covered: [{ label: 'logo tile', x: 8, y: 88, w: 200, h: 103 }],
    safe: { x: 232, y: 16, w: 856, h: 159 },
  },
  'engisignal-x-header-1500x500': {
    w: 1500,
    h: 500,
    // The profile avatar straddles the header's bottom-left corner.
    covered: [{ label: 'avatar', x: 8, y: 356, w: 248, h: 144 }],
    safe: { x: 64, y: 40, w: 1376, h: 336 },
  },
};

/**
 * Re-render a banner with its deliberately-bleeding decoration hidden.
 *
 * A `.bleed` element is designed to run off the edge — losing it to a crop
 * costs nothing. Measuring it as content would report a failure that is not
 * one, and worse, would hide a real overflow behind a permanently-red check.
 * Only `.bleed` and the background texture are exempt: a chart card that sits
 * inside the layout is content and is measured like any other content.
 */
async function copyOnly(name, w, h) {
  const src = join(htmlDir, `${name}.html`);
  const html = readFileSync(src, 'utf8').replace(
    '</style>',
    '.bleed, .canvas::before, .canvas::after { display: none !important; }</style>',
  );
  const stripped = join(tmpDir, `${name}--copy-only.html`);
  writeFileSync(stripped, html, 'utf8');
  const raw = await capture({ htmlPath: stripped, w, h, rawPath: join(tmpDir, `${name}--copy-only.png`), scale: 1 });
  return raw;
}

/** Bounding box of everything bright enough to be content. */
async function inkBox(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * channels;
      // Rec. 601 luma, which is what the eye weights these channels by.
      const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (luma >= INK_LUMA) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, right: maxX, bottom: maxY };
}

/** Ink pixel count inside a rectangle. */
async function inkIn(file, rect) {
  const { data, info } = await sharp(file)
    .extract({ left: rect.x, top: rect.y, width: rect.w, height: rect.h })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let n = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] >= INK_LUMA) n += 1;
  }
  return n;
}

/** An overlay proof: what the platform covers, and where content is allowed. */
async function writeProof(file, spec, ink) {
  const { w, h, covered, safe } = spec;
  const rects = covered
    .map(
      (c) => `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" fill="#f4756a" fill-opacity=".28" stroke="#f4756a" stroke-width="2"/>
        <text x="${c.x + 8}" y="${c.y + 20}" fill="#f4756a" font-size="13" font-family="sans-serif" font-weight="700">${c.label.toUpperCase()}</text>`,
    )
    .join('');

  const overlay = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <rect x="${safe.x}" y="${safe.y}" width="${safe.w}" height="${safe.h}" fill="none" stroke="#3fc38d" stroke-width="2" stroke-dasharray="8 6"/>
      <text x="${safe.x + 8}" y="${safe.y + 20}" fill="#3fc38d" font-size="13" font-family="sans-serif" font-weight="700">SAFE AREA</text>
      ${rects}
      <rect x="${ink.x}" y="${ink.y}" width="${ink.w}" height="${ink.h}" fill="none" stroke="#4da3ff" stroke-width="1.5"/>
      <text x="${ink.x + 6}" y="${ink.bottom - 6}" fill="#4da3ff" font-size="12" font-family="sans-serif" font-weight="700">CONTENT</text>
    </svg>`,
  );

  const out = join(proofDir, `${basename(file, '.png')}-proof.png`);
  await sharp(file).composite([{ input: overlay }]).png().toFile(out);
  return out;
}

/* ── Dimension sweep ──────────────────────────────────────────────────── */

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) return entry === '_source' || entry === '06-safe-area-proofs' ? [] : walk(p);
    return p.endsWith('.png') ? [p] : [];
  });
}

const failures = [];
const files = walk(root).sort();
let dimChecked = 0;

for (const file of files) {
  const name = basename(file, '.png');
  const meta = await sharp(file).metadata();

  // Names carry their contract: WxH means exactly that, Nw means that width.
  const exact = name.match(/(\d+)x(\d+)/);
  const widthOnly = name.match(/-(\d+)w$/);
  const favicon = name.match(/^(?:favicon|apple-touch-icon)-(\d+)$/);

  if (exact) {
    const [, w, h] = exact.map(Number);
    dimChecked += 1;
    if (meta.width !== w || meta.height !== h) {
      failures.push(`${name}: declared ${w}x${h}, file is ${meta.width}x${meta.height}`);
    }
  } else if (widthOnly) {
    dimChecked += 1;
    if (meta.width !== Number(widthOnly[1])) {
      failures.push(`${name}: declared ${widthOnly[1]}px wide, file is ${meta.width}px`);
    }
  } else if (favicon) {
    const s = Number(favicon[1]);
    dimChecked += 1;
    if (meta.width !== s || meta.height !== s) {
      failures.push(`${name}: expected ${s}x${s}, file is ${meta.width}x${meta.height}`);
    }
  }
}

console.log(`dimensions : ${dimChecked} of ${files.length} files carry a size in their name; all checked`);

/* ── Safe areas ───────────────────────────────────────────────────────── */

console.log('\nsafe areas');
for (const file of files) {
  const name = basename(file, '.png');
  const key = Object.keys(BANNERS).find((k) => name.startsWith(k));
  if (!key) continue;

  const spec = BANNERS[key];
  const measured = await copyOnly(name, spec.w, spec.h);
  const ink = await inkBox(measured);
  if (!ink) {
    failures.push(`${name}: no content found at all`);
    continue;
  }

  const problems = [];
  for (const c of spec.covered) {
    const n = await inkIn(measured, c);
    if (n > 0) problems.push(`${n}px of copy under the ${c.label}`);
  }
  const { safe } = spec;
  if (ink.x < safe.x) problems.push(`content starts at x=${ink.x}, safe area starts at x=${safe.x}`);
  if (ink.y < safe.y) problems.push(`content starts at y=${ink.y}, safe area starts at y=${safe.y}`);
  if (ink.right > safe.x + safe.w) problems.push(`content ends at x=${ink.right}, safe area ends at x=${safe.x + safe.w}`);
  if (ink.bottom > safe.y + safe.h) problems.push(`content ends at y=${ink.bottom}, safe area ends at y=${safe.y + safe.h}`);

  await writeProof(file, spec, ink);
  const verdict = problems.length ? `FAIL — ${problems.join('; ')}` : 'ok';
  console.log(`  ${verdict.padEnd(6)} ${name}`);
  console.log(`         content x ${ink.x}..${ink.right}, y ${ink.y}..${ink.bottom}  (safe x ${safe.x}..${safe.x + safe.w}, y ${safe.y}..${safe.y + safe.h})`);
  if (problems.length) failures.push(`${name}: ${problems.join('; ')}`);
}

console.log(`\nproofs written to ${proofDir}`);

if (failures.length) {
  console.error(`\n${failures.length} problem(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nall checks passed');
