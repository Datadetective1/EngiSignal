/**
 * Render harness: HTML → exact-size PNG.
 *
 * Headless Chrome shoots every canvas at 2x and sharp resamples down to the
 * exact platform dimension. Supersampling is what keeps hairline rules and
 * tight tracking clean at sizes as short as 191px, which is where a 1x render
 * visibly breaks down.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const run = promisify(execFile);

const CHROME =
  process.env.CHROME_PATH ||
  ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(
    (p) => existsSync(p),
  );

if (!CHROME) throw new Error('No Chrome or Edge found. Set CHROME_PATH.');

const SCALE = 2;

/** Screenshot an HTML file at `scale`x. Returns the raw (scaled) PNG path. */
export async function capture({ htmlPath, w, h, rawPath, scale = SCALE }) {
  await run(
    CHROME,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--hide-scrollbars',
      '--disable-lcd-text',
      `--window-size=${w},${h}`,
      `--force-device-scale-factor=${scale}`,
      // Let webfont decoding and layout settle before the shot is taken.
      '--virtual-time-budget=2000',
      `--screenshot=${rawPath.replace(/\\/g, '/')}`,
      pathToFileURL(htmlPath).href,
    ],
    { maxBuffer: 1 << 26 },
  );
  return rawPath;
}

/**
 * Shoot one page. `htmlDir` keeps the generated HTML on disk as the editable
 * source for the asset, which is the point of shipping it alongside the PNG.
 */
export async function shoot({ name, w, h, html, outDir, htmlDir, tmpDir }) {
  mkdirSync(outDir, { recursive: true });
  mkdirSync(htmlDir, { recursive: true });
  mkdirSync(tmpDir, { recursive: true });

  const htmlPath = join(htmlDir, `${name}.html`);
  writeFileSync(htmlPath, html, 'utf8');

  const rawPath = await capture({ htmlPath, w, h, rawPath: join(tmpDir, `${name}@${SCALE}x.png`) });

  const outPath = join(outDir, `${name}.png`);
  await sharp(rawPath)
    .resize(w, h, { kernel: 'lanczos3', fit: 'fill' })
    .png({ compressionLevel: 9 })
    .toFile(outPath);

  const meta = await sharp(outPath).metadata();
  if (meta.width !== w || meta.height !== h) {
    throw new Error(`${name}: expected ${w}x${h}, produced ${meta.width}x${meta.height}`);
  }
  return { name, w, h, outPath };
}

/** Run shoots with bounded concurrency — Chrome cold-starts are the bottleneck. */
export async function shootAll(jobs, { concurrency = 4 } = {}) {
  const results = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      results.push(await shoot(job));
      process.stdout.write('.');
    }
  });
  await Promise.all(workers);
  process.stdout.write('\n');
  return results;
}
