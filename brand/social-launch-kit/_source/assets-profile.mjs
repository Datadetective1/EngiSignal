/**
 * Profile pictures and platform banners — two options per platform.
 *
 * Each platform gets one category statement (what EngiSignal is) and one
 * outcome statement (what it does for you). Those are the two poles a
 * technical buyer needs; a third option is a decision nobody wants to make.
 *
 * Safe areas drive every layout here:
 *   LinkedIn cover  1128x191 — the company logo tile overlaps the bottom-left,
 *                   roughly x 8-208. All copy starts at x=300 and the right
 *                   side carries nothing but decoration, so a mobile side-crop
 *                   loses no information.
 *   X header        1500x500 — the avatar straddles the bottom-left, roughly
 *                   x 8-232 / y 372-500. Copy is held inside x 64-1440 and
 *                   y 40-376.
 *
 * verify.mjs measures the result rather than trusting these comments.
 */
import { COLOR } from './mark.mjs';
import { page, lockup, mark, demandChart, chartCard, datum } from './components.mjs';

/* ── Profile pictures ─────────────────────────────────────────────────── */

/**
 * A square avatar. LinkedIn renders it in a rounded square and X clips it to a
 * circle, so the mark is sized against the inscribed circle in both cases and
 * the tile is full-bleed — letting each platform apply its own mask.
 *
 * The tile carries a shallow vertical gradient rather than a flat fill. At
 * profile size it reads as a machined surface; at feed size it reads as solid.
 */
function avatar({ markHeight, arc = false }) {
  return page({
    w: 400,
    h: 400,
    grid: 25,
    glowAt: '50% 34%',
    glowSize: '58% 58%',
    gridMask: 'radial-gradient(78% 78% at 50% 46%, #000 0%, transparent 82%)',
    css: `
      .canvas { background: linear-gradient(168deg, #13161d 0%, ${COLOR.graphite} 52%, #0a0c10 100%); }
      .wrap { height: 100%; display: grid; place-items: center; }`,
    body: `<div class="wrap">${mark(markHeight, { arc })}</div>`,
  });
}

/* ── Banner copy ──────────────────────────────────────────────────────── */

export const LINKEDIN_COVER_COPY = [
  {
    slug: 'a-category',
    headline: 'Engineering Software Intelligence',
    support: 'Usage, licenses, contracts and renewals in one decision layer.',
  },
  {
    slug: 'b-defensible',
    headline: 'From usage data to<br>defensible renewal decisions',
    support: 'License optimization · Renewals · Forecasting · Demand',
  },
];

export const X_HEADER_COPY = [
  {
    slug: 'a-signals',
    eyebrow: 'Engineering Software Intelligence',
    headline: 'Engineering software.<br>Clear signals.<br>Better decisions.',
    support: 'Know what you use, what you need, and what to renew.',
  },
  {
    slug: 'b-decisions',
    eyebrow: 'Engineering Software Intelligence',
    headline: 'Smarter license,<br>renewal and spend<br>decisions.',
    support: 'Usage, licenses, contracts and forecasts in one intelligence layer.',
  },
];

/* ── Banners ──────────────────────────────────────────────────────────── */

/**
 * LinkedIn company cover, 1128x191.
 *
 * At 191px tall there is room for one headline and one support line, and
 * nothing else. The chart bleeds off the right edge behind a left-to-right
 * fade so it reads as texture rather than as a chart competing with the copy.
 */
function linkedinCover({ headline, support }) {
  return page({
    w: 1128,
    h: 191,
    grid: 24,
    glowAt: '82% 45%',
    glowSize: '38% 150%',
    gridMask: 'linear-gradient(102deg, #000 0%, rgba(0,0,0,.4) 30%, transparent 52%)',
    css: `
      .wrap { height: 100%; display: flex; align-items: center; padding: 0 64px 0 300px; }
      .block { display: flex; align-items: stretch; gap: 26px; }
      /* An accent bar in place of an eyebrow: the company name is already the
         profile name, and the mark's own bars are the cue that belongs here.
         It stretches, so it measures the copy however many lines that runs to. */
      .tick { width: 3px; border-radius: 2px; background: var(--accent); flex: none; }
      h1 { font-size: 33px; max-width: 640px; letter-spacing: -.028em; }
      .support { font-size: 15px; margin-top: 12px; max-width: 640px; }
      /* Decoration only, and held clear of the copy — a mobile side-crop can
         take all of it without losing anything. */
      .bleed {
        position: absolute; top: 0; right: -50px; width: 420px; height: 191px;
        opacity: .58;
        -webkit-mask-image: linear-gradient(90deg, transparent 14%, #000 70%);
                mask-image: linear-gradient(90deg, transparent 14%, #000 70%);
      }`,
    body: `
      <!-- .bleed marks artwork that is meant to run off the canvas. verify.mjs
           excludes it when measuring safe areas; nothing else may use it. -->
      <div class="bleed">${demandChart({ w: 420, h: 191, axis: false, showLabels: false })}</div>
      <div class="wrap">
        <div class="block">
          <div class="tick"></div>
          <div>
            <h1>${headline}</h1>
            <div class="support">${support}</div>
          </div>
        </div>
      </div>`,
  });
}

/**
 * X header, 1500x500.
 *
 * The lockup rides the top-left because X's own avatar takes the bottom-left.
 * A datum rule runs under the brand row, which is what turns the header from a
 * dark card into a measured sheet.
 */
function xHeader({ eyebrow, headline, support }) {
  return page({
    w: 1500,
    h: 500,
    grid: 28,
    glowAt: '78% 38%',
    glowSize: '40% 90%',
    css: `
      .wrap {
        height: 100%;
        display: grid;
        grid-template-columns: minmax(0, 1fr) 470px;
        gap: 72px;
        align-items: center;
        /* The avatar straddles the bottom-left corner from about y=372 down.
           This bottom padding is what holds every line of copy above it. */
        padding: 78px 96px 166px;
      }
      /* Lockup and category on one row: the vertical budget under a 500px
         header with a 130px dead zone does not stretch to a separate eyebrow. */
      .brandline { display: flex; align-items: center; gap: 20px; }
      .brandline .bar { width: 1px; height: 20px; background: var(--border-strong); }
      .eyebrow { font-size: 12px; }
      .datum { margin: 20px 0 30px; }
      h1 { font-size: 45px; letter-spacing: -.033em; }
      .support { font-size: 17.5px; margin-top: 22px; max-width: 720px; }
      .viz { display: flex; justify-content: flex-end; }`,
    body: `
      <div class="wrap">
        <div>
          <div class="brandline">${lockup(30)}<span class="bar"></span><span class="eyebrow">${eyebrow}</span></div>
          ${datum({ divisions: 12 })}
          <h1>${headline}</h1>
          <div class="support">${support}</div>
        </div>
        <div class="viz">${chartCard({ w: 470, h: 248 })}</div>
      </div>`,
  });
}

/* ── Jobs ─────────────────────────────────────────────────────────────── */

export function profileJobs({ linkedinDir, xDir, htmlDir, tmpDir }) {
  const jobs = [
    {
      name: 'engisignal-linkedin-avatar-400x400',
      w: 400,
      h: 400,
      html: avatar({ markHeight: 196 }),
      outDir: linkedinDir,
      htmlDir,
      tmpDir,
    },
    {
      // Smaller mark: X clips to a circle, so the artwork sits inside it.
      name: 'engisignal-x-avatar-400x400',
      w: 400,
      h: 400,
      html: avatar({ markHeight: 172 }),
      outDir: xDir,
      htmlDir,
      tmpDir,
    },
  ];

  for (const copy of LINKEDIN_COVER_COPY) {
    jobs.push({
      name: `engisignal-linkedin-cover-1128x191-${copy.slug}`,
      w: 1128,
      h: 191,
      html: linkedinCover(copy),
      outDir: linkedinDir,
      htmlDir,
      tmpDir,
    });
  }

  for (const copy of X_HEADER_COPY) {
    jobs.push({
      name: `engisignal-x-header-1500x500-${copy.slug}`,
      w: 1500,
      h: 500,
      html: xHeader(copy),
      outDir: xDir,
      htmlDir,
      tmpDir,
    });
  }

  return jobs;
}
