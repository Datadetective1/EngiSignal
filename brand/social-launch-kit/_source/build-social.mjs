/**
 * Build every rendered social asset: profile pictures, platform banners and
 * post templates.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shootAll } from './render.mjs';
import { profileJobs } from './assets-profile.mjs';
import { templateJobs } from './assets-templates.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const dirs = {
  linkedinDir: join(root, '03-linkedin'),
  xDir: join(root, '04-x'),
  templateDir: join(root, '05-post-templates'),
  htmlDir: join(here, 'html'),
  tmpDir: process.env.RENDER_TMP || join(here, '.tmp'),
};

const only = process.argv[2];
let jobs = [...profileJobs(dirs), ...templateJobs(dirs)];
if (only) jobs = jobs.filter((j) => j.name.includes(only));

console.log(`rendering ${jobs.length} assets at 2x`);
const done = await shootAll(jobs);

for (const r of done.sort((a, b) => a.name.localeCompare(b.name))) {
  console.log(`  ${String(`${r.w}x${r.h}`).padEnd(10)} ${r.name}.png`);
}
console.log(`\n${done.length} assets, all verified at their target dimensions.`);
