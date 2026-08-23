/**
 * Post templates, explainer graphics and the site OG card.
 *
 * Twelve templates, each earning its place: two general statements, two launch
 * teasers, two explainers, two feature spotlights, three announcement formats
 * and the link card. Duplicate size variants of the same idea were cut — a
 * social team choosing between two near-identical files is a cost, not a
 * choice.
 *
 * Two rules shape the copy:
 *
 *  - Anything that would be a claim about a real person, customer or partner
 *    ships as a bracketed placeholder. Customers, testimonials, savings figures
 *    and partnerships are never invented (BRAND.md §9), and a template that
 *    ships with a plausible fake is exactly how a fake ends up published.
 *  - Third-party names are set typographically, never as logos (BRAND.md §8),
 *    so the partner template has a type slot rather than a logo slot.
 *
 * Everything else is real product copy from config/brand.ts.
 */
import { page, lockup, chips, signalRows, chartCard, datum, titleBlock } from './components.mjs';

const URL = 'engisignal.com';

/* Signal colours follow the product's semantics exactly: positive is a
 * reduction in spend, danger is capacity risk, violet is forecast. */
const SIGNAL = {
  renewal: 'var(--accent)',
  cost: 'var(--positive)',
  capacity: 'var(--danger)',
  usage: 'var(--aqua)',
  forecast: 'var(--violet)',
  data: 'var(--warning)',
};

/**
 * The standard sheet every template shares: a brand row, a datum rule beneath
 * it, the content, and a title block along the foot. Keeping this in one place
 * is what makes twelve different graphics read as one kit — and the drawing
 * furniture is what makes them read as engineering rather than as marketing.
 */
function sheet({
  w,
  h,
  pad,
  label = '',
  main,
  block,
  logoHeight = 32,
  divisions = 16,
  tb = {},
  ...opts
}) {
  const scale = pad / 96; // type in the furniture tracks the sheet size
  return page({
    w,
    h,
    css: `
      .frame { height: 100%; display: flex; flex-direction: column; padding: ${pad}px; }
      .head { display: flex; align-items: center; justify-content: space-between; }
      .head .label { font-size: ${Math.round(13 * scale)}px; }
      .headrule { margin-top: ${Math.round(22 * scale)}px; }
      .main { flex: 1; display: flex; flex-direction: column; justify-content: center; padding: ${Math.round(52 * scale)}px 0; min-height: 0; }
      ${opts.css || ''}`,
    grid: opts.grid,
    glowAt: opts.glowAt,
    glowSize: opts.glowSize,
    gridMask: opts.gridMask,
    body: `
      <div class="frame">
        <div class="head">
          ${lockup(logoHeight)}
          ${label ? `<span class="eyebrow eyebrow-muted label">${label}</span>` : ''}
        </div>
        <div class="headrule">${datum({ divisions })}</div>
        <div class="main">${main}</div>
        ${titleBlock(block, {
          pad: Math.round(16 * scale),
          k: Math.max(9, Math.round(10 * scale)),
          v: Math.round(14 * scale),
          gap: Math.round(7 * scale),
        })}
      </div>`,
  });
}

/** The standard three-cell title block. */
const BLOCK = (scope, right = URL) => [
  { k: 'Category', v: 'Engineering Software Intelligence', width: '1.6fr' },
  { k: 'Scope', v: scope, width: '1.5fr' },
  { k: 'Web', v: right, width: '0.9fr' },
];

/** Two facing lists with a rule between: what goes in, what comes out. */
function inputsOutputs({ fontSize = 21, inputs, outputs }) {
  const col = (title, items, colour) => `
    <div style="flex:1;min-width:0">
      <div class="eyebrow" style="font-size:${fontSize * 0.55}px;color:${colour}">${title}</div>
      <ul style="list-style:none;margin-top:${fontSize * 1.05}px;display:flex;flex-direction:column;gap:${fontSize * 0.72}px">
        ${items
          .map(
            (i) =>
              `<li style="display:flex;align-items:center;gap:${fontSize * 0.6}px;font-size:${fontSize}px;font-weight:500;letter-spacing:-.016em">
                 <span class="dot" style="width:${fontSize * 0.28}px;height:${fontSize * 0.28}px;background:${colour}"></span>${i}
               </li>`,
          )
          .join('')}
      </ul>
    </div>`;
  return `
    <div style="display:flex;align-items:stretch;gap:${fontSize * 2.1}px">
      ${col('What goes in', inputs, 'var(--muted)')}
      <div style="width:1px;background:var(--border);flex:none"></div>
      ${col('What comes out', outputs, 'var(--accent)')}
    </div>`;
}

/** A grid of capability cards. */
function capabilityGrid({ cols, items, fontSize = 20, gap = 20 }) {
  const cards = items
    .map(
      (it) => `
      <div class="card" style="padding:${fontSize * 1.45}px;display:flex;flex-direction:column;gap:${fontSize * 0.45}px">
        <span class="dot" style="width:${fontSize * 0.42}px;height:${fontSize * 0.42}px;background:${it.color};margin-bottom:${fontSize * 0.4}px"></span>
        <div style="font-size:${fontSize * 1.1}px;font-weight:600;letter-spacing:-.022em">${it.title}</div>
        <div class="support" style="font-size:${fontSize * 0.82}px">${it.detail}</div>
      </div>`,
    )
    .join('');
  return `<div style="display:grid;grid-template-columns:repeat(${cols},minmax(0,1fr));gap:${gap}px">${cards}</div>`;
}

const CAPABILITIES = [
  { title: 'License optimization', detail: 'Peak concurrent demand against what you are entitled to.', color: SIGNAL.cost },
  { title: 'Renewals', detail: 'A defensible position on every upcoming commitment.', color: SIGNAL.renewal },
  { title: 'Forecasting', detail: 'Demand ahead of headcount and project change.', color: SIGNAL.forecast },
  { title: 'Decision support', detail: 'Every recommendation arrives with its evidence.', color: SIGNAL.usage },
];

const INPUTS = ['Usage and denials', 'Named users and activity', 'Contracts and entitlements', 'Cost and unit price', 'Headcount and projects'];
const OUTPUTS = ['Recommended quantity', 'P95 peak demand', 'Reclaim candidates', 'Renewal position', 'Forecast demand'];

/* ── Templates ────────────────────────────────────────────────────────── */

const statementSquare = () =>
  sheet({
    w: 1200,
    h: 1200,
    pad: 96,
    logoHeight: 34,
    // Sheet labels name the sheet, the way a drawing's title does. They are
    // not eyebrows and they never carry a claim.
    label: 'Statement',
    grid: 30,
    glowAt: '86% 86%',
    glowSize: '52% 48%',
    css: `
      h1 { font-size: 68px; }
      .support { font-size: 25px; margin-top: 34px; max-width: 880px; }
      .rowchips { margin-top: 54px; }`,
    main: `
      <h1>Know what engineering software you actually need before your next renewal.</h1>
      <div class="support">Usage, licenses, contracts and forecasts in one intelligence layer — with the evidence behind every number.</div>
      <div class="rowchips">${chips(['Usage', 'Licenses', 'Contracts', 'Cost', 'Forecast'], { fontSize: 18 })}</div>`,
    block: BLOCK('License · Renewal · Forecast · Demand'),
  });

const statementWide = () =>
  sheet({
    w: 1600,
    h: 900,
    pad: 88,
    logoHeight: 34,
    label: 'Statement',
    grid: 28,
    glowAt: '78% 42%',
    glowSize: '42% 88%',
    divisions: 20,
    css: `
      .split { display: grid; grid-template-columns: minmax(0, 1fr) 520px; gap: 72px; align-items: center; }
      h1 { font-size: 54px; }
      .support { font-size: 21px; margin-top: 28px; }`,
    main: `
      <div class="split">
        <div>
          <h1>Know what you use,<br>what you need,<br>and what to renew.</h1>
          <div class="support">EngiSignal turns engineering software usage, licenses and contracts into renewal, cost and capacity decisions you can defend.</div>
        </div>
        <div>${chartCard({ w: 520, h: 348 })}</div>
      </div>`,
    block: BLOCK('License · Renewal · Forecast · Demand'),
  });

const launchingSoonSquare = () =>
  sheet({
    w: 1200,
    h: 1200,
    pad: 96,
    logoHeight: 34,
    label: 'Launch',
    grid: 30,
    glowAt: '50% 78%',
    glowSize: '62% 50%',
    css: `
      h1 { font-size: 76px; }
      .support { font-size: 25px; margin-top: 36px; max-width: 860px; }
      .cta { display: inline-flex; align-items: center; gap: 14px; margin-top: 54px;
             padding: 19px 30px; border-radius: 999px; background: var(--accent);
             color: #04121f; font-size: 21px; font-weight: 600; letter-spacing: -.016em; }`,
    main: `
      <div class="eyebrow" style="font-size:16px;margin-bottom:28px">Launching soon</div>
      <h1>Engineering<br>Software<br>Intelligence.</h1>
      <div class="support">Know what engineering software you actually need before your next renewal.</div>
      <div><span class="cta">Request a 30-Day Pilot</span></div>`,
    block: BLOCK('Now taking pilot organizations'),
  });

const launchingSoonWide = () =>
  sheet({
    w: 1600,
    h: 900,
    pad: 88,
    logoHeight: 34,
    label: 'Launch',
    grid: 28,
    glowAt: '50% 22%',
    glowSize: '50% 64%',
    divisions: 20,
    css: `
      h1 { font-size: 58px; text-align: center; }
      .support { font-size: 22px; margin-top: 24px; text-align: center; }
      /* Grid, not inline-block: four equal tracks that cannot wrap to a second
         row however long a week's detail line gets. */
      .rail { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 40px; margin-top: 76px; }
      .week { padding-top: 22px; border-top: 1px solid var(--border); }
      .week:first-child { border-top-color: var(--accent); }
      .week h3 { margin-top: 12px; font-size: 25px; font-weight: 600; letter-spacing: -.024em; }
      .week .support { margin-top: 9px; font-size: 16px; text-align: left; }`,
    main: `
      <div class="eyebrow" style="font-size:15px;margin-bottom:24px;text-align:center">Launching soon</div>
      <h1>Engineering software. Clear signals. Better decisions.</h1>
      <div class="support">The 30-Day Engineering Software Intelligence Pilot</div>
      <div class="rail">${[
        { title: 'Connect', detail: 'Import usage, contracts and organizational data.' },
        { title: 'Analyze', detail: 'Normalize, compute demand and surface Signals.' },
        { title: 'Validate', detail: 'Review evidence with your license administrators.' },
        { title: 'Decide', detail: 'Produce renewal positions and an executive brief.' },
      ]
        .map(
          (s, i) => `
        <div class="week">
          <div class="eyebrow" style="font-size:12px;color:${i === 0 ? 'var(--accent)' : 'var(--subtle)'}">Week ${i + 1}</div>
          <h3>${s.title}</h3>
          <div class="support">${s.detail}</div>
        </div>`,
        )
        .join('')}</div>`,
    block: BLOCK('Connect · Analyze · Validate · Decide'),
  });

const categoryWide = () =>
  sheet({
    w: 1600,
    h: 900,
    pad: 88,
    logoHeight: 34,
    label: 'Overview',
    grid: 28,
    glowAt: '82% 26%',
    glowSize: '42% 66%',
    divisions: 20,
    css: `
      h1 { font-size: 54px; }
      .support { font-size: 21px; margin-top: 26px; max-width: 720px; }
      .split { display: grid; grid-template-columns: minmax(0, 580px) minmax(0, 1fr); gap: 84px; align-items: center; }`,
    main: `
      <div class="split">
        <div>
          <h1>Engineering<br>Software<br>Intelligence</h1>
          <div class="support">Your organization already emits the signals — usage, licenses, contracts, denials, headcount. EngiSignal makes them mean something.</div>
        </div>
        <div>${inputsOutputs({ inputs: INPUTS, outputs: OUTPUTS, fontSize: 20 })}</div>
      </div>`,
    block: BLOCK('Nothing is invented · every output carries its evidence'),
  });

const explainerWide = () =>
  sheet({
    w: 1600,
    h: 900,
    pad: 88,
    logoHeight: 34,
    label: 'Capabilities',
    grid: 28,
    glowAt: '50% 12%',
    glowSize: '55% 46%',
    divisions: 20,
    css: `
      h1 { font-size: 52px; }
      .support { font-size: 21px; margin-top: 24px; max-width: 820px; }
      .grid { margin-top: 60px; }`,
    main: `
      <h1>License optimization, renewals,<br>forecasting and decision support</h1>
      <div class="support">One intelligence layer over the data your engineering organization already produces.</div>
      <div class="grid">${capabilityGrid({ cols: 4, items: CAPABILITIES, fontSize: 19, gap: 22 })}</div>`,
    block: BLOCK('License · Renewal · Forecast · Decision support'),
  });

const founderAnnouncement = () =>
  sheet({
    w: 1200,
    h: 1200,
    pad: 96,
    logoHeight: 34,
    label: 'Announcement',
    grid: 30,
    glowAt: '22% 76%',
    glowSize: '55% 50%',
    css: `
      h1 { font-size: 62px; }
      .support { font-size: 24px; margin-top: 32px; max-width: 860px; }
      .who { display: flex; align-items: center; gap: 34px; margin-bottom: 54px; }
      .portrait { width: 172px; height: 172px; border-radius: 50%; flex: none;
                  border: 1px dashed var(--border-strong); display: grid; place-items: center;
                  color: var(--subtle); font-size: 15px; font-weight: 500; text-align: center; line-height: 1.35; }
      .role { font-size: 21px; font-weight: 500; color: var(--accent); letter-spacing: -.014em; }
      .roleSub { font-size: 17px; color: var(--subtle); margin-top: 7px; }`,
    main: `
      <div class="who">
        <div class="portrait">Portrait<br>172px</div>
        <div>
          <div class="role">[Role or title]</div>
          <div class="roleSub">Joining [month, year]</div>
        </div>
      </div>
      <h1>Welcoming [Name]<br>to EngiSignal</h1>
      <div class="support">[One sentence on what they will work on, in plain language and specific enough to be worth reading.]</div>`,
    block: [
      { k: 'Template', v: 'Founder / new joiner announcement', width: '1.6fr' },
      { k: 'Before publishing', v: 'Replace every bracketed field', width: '1.5fr' },
      { k: 'Web', v: URL, width: '0.9fr' },
    ],
  });

const partnerAnnouncement = () =>
  sheet({
    w: 1600,
    h: 900,
    pad: 88,
    logoHeight: 34,
    label: 'Partnership',
    grid: 28,
    glowAt: '50% 46%',
    glowSize: '52% 62%',
    divisions: 20,
    css: `
      .pair { display: flex; align-items: center; justify-content: center; gap: 54px; }
      .plus { font-size: 46px; font-weight: 300; color: var(--subtle); line-height: 1; }
      .partner { font-size: 42px; font-weight: 600; letter-spacing: -.028em; color: var(--fg);
                 padding: 18px 34px; border: 1px dashed var(--border-strong); border-radius: 12px; }
      h1 { font-size: 42px; text-align: center; margin-top: 72px; }
      .support { font-size: 20px; margin-top: 22px; text-align: center; max-width: 900px; margin-left: auto; margin-right: auto; }`,
    main: `
      <div class="pair">
        ${lockup(56)}
        <span class="plus">+</span>
        <!-- Set typographically on purpose: third-party logos are never
             reproduced, so there is no logo slot here to misuse. -->
        <span class="partner">[Partner name]</span>
      </div>
      <h1>[What the partnership does, in one line]</h1>
      <div class="support">[One sentence on what it changes for engineering organizations. No claim that is not agreed in writing with the partner.]</div>`,
    block: [
      { k: 'Template', v: 'Partnership announcement', width: '1.6fr' },
      { k: 'Rule', v: 'Partner names set in type — never a third-party logo', width: '1.5fr' },
      { k: 'Web', v: URL, width: '0.9fr' },
    ],
  });

const customerInsight = () =>
  sheet({
    w: 1200,
    h: 1200,
    pad: 96,
    logoHeight: 34,
    label: 'Customer insight',
    grid: 30,
    glowAt: '84% 80%',
    glowSize: '50% 46%',
    css: `
      .quotebars { display: flex; flex-direction: column; gap: 12px; margin-bottom: 52px; }
      .qb { height: 7px; border-radius: 4px; background: var(--accent); }
      blockquote { font-size: 54px; font-weight: 600; letter-spacing: -.028em; line-height: 1.16; }
      .attr { margin-top: 50px; padding-top: 28px; border-top: 1px solid var(--border); }
      .attr .name { font-size: 23px; font-weight: 600; letter-spacing: -.018em; }
      .attr .org { font-size: 19px; color: var(--muted); margin-top: 8px; }`,
    main: `
      <!-- The mark's three bars, borrowed as a quote device. -->
      <div class="quotebars">
        <div class="qb" style="width:96px;opacity:.55"></div>
        <div class="qb" style="width:148px"></div>
        <div class="qb" style="width:72px;opacity:.55"></div>
      </div>
      <blockquote>&ldquo;[One or two sentences, in the customer&rsquo;s own words, about a decision they were able to make.]&rdquo;</blockquote>
      <div class="attr">
        <div class="name">[Name], [Role]</div>
        <div class="org">[Organization] · used with written approval</div>
      </div>`,
    block: [
      { k: 'Template', v: 'Customer insight', width: '1.6fr' },
      { k: 'Rule', v: 'Never publish with invented attribution', width: '1.5fr' },
      { k: 'Web', v: URL, width: '0.9fr' },
    ],
  });

const featureAskWide = () =>
  sheet({
    w: 1600,
    h: 900,
    pad: 88,
    logoHeight: 34,
    label: 'Feature',
    grid: 28,
    glowAt: '76% 42%',
    glowSize: '42% 76%',
    divisions: 20,
    css: `
      .split { display: grid; grid-template-columns: minmax(0, 1fr) 580px; gap: 76px; align-items: center; }
      h1 { font-size: 56px; }
      .support { font-size: 21px; margin-top: 26px; }
      .ask { padding: 30px; }
      .q { font-size: 19px; font-weight: 500; letter-spacing: -.014em; color: var(--fg); }
      .qrow { display: flex; gap: 14px; align-items: flex-start; padding-bottom: 22px; border-bottom: 1px solid var(--border); }
      .a { margin-top: 22px; font-size: 17px; line-height: 1.55; color: var(--muted); }
      .a b { color: var(--fg); font-weight: 600; }`,
    main: `
      <div class="split">
        <div>
          <div class="eyebrow" style="font-size:15px;margin-bottom:22px">Ask EngiSignal</div>
          <h1>Ask a question.<br>Get the evidence<br>with the answer.</h1>
          <div class="support">Plain language in. A number, its derivation and the data behind it out.</div>
        </div>
        <div class="card ask">
          <div class="qrow">
            <span class="dot" style="width:9px;height:9px;background:var(--accent);margin-top:8px"></span>
            <span class="q">How many Ansys HPC licenses do we actually need at renewal?</span>
          </div>
          <div class="a">Peak concurrent demand reached <b>275</b> at P95 against <b>400</b> entitled. Recommended quantity is <b>318</b>, which holds a headroom buffer through the forecast period.</div>
          <div class="eyebrow eyebrow-muted" style="font-size:10px;margin-top:24px">Illustrative · every figure links to its evidence</div>
        </div>
      </div>`,
    block: BLOCK('Ask EngiSignal · Scenario Lab · Evidence Drawer'),
  });

const featureScenarioSquare = () =>
  sheet({
    w: 1200,
    h: 1200,
    pad: 96,
    logoHeight: 34,
    label: 'Feature',
    grid: 30,
    glowAt: '86% 74%',
    glowSize: '50% 46%',
    css: `
      h1 { font-size: 60px; }
      .support { font-size: 23px; margin-top: 28px; max-width: 860px; }
      .rows { margin-top: 54px; }`,
    main: `
      <div class="eyebrow" style="font-size:16px;margin-bottom:26px">Scenario Lab</div>
      <h1>Change an assumption.<br>Watch the number move.</h1>
      <div class="support">Model demand, headcount and entitlement changes before you commit to a renewal position.</div>
      <div class="rows">${signalRows(
        [
          { label: 'Renewal Signal', value: 'in 58 days', color: SIGNAL.renewal },
          { label: 'Cost Signal', value: 'reclaim 43 seats', color: SIGNAL.cost },
          { label: 'Capacity Signal', value: 'P95 275 / 400', color: SIGNAL.capacity },
          { label: 'Forecast Signal', value: '+12% demand', color: SIGNAL.forecast },
        ],
        { fontSize: 24, gap: 14 },
      )}</div>`,
    block: BLOCK('Illustrative signal set'),
  });

/** The site's Open Graph card — 1200x630 is what every link unfurl expects. */
const ogImage = () =>
  sheet({
    w: 1200,
    h: 630,
    pad: 68,
    logoHeight: 32,
    label: '',
    grid: 26,
    glowAt: '84% 32%',
    glowSize: '44% 88%',
    divisions: 16,
    css: `
      h1 { font-size: 50px; max-width: 900px; }
      .support { font-size: 20px; margin-top: 22px; max-width: 760px; }`,
    main: `
      <div class="eyebrow" style="font-size:13px;margin-bottom:22px">Engineering Software Intelligence</div>
      <h1>Engineering software.<br>Clear signals. Better decisions.</h1>
      <div class="support">Know what you use, what you need, and what to renew.</div>`,
    block: BLOCK('License · Renewal · Forecast'),
  });

/* ── Jobs ─────────────────────────────────────────────────────────────── */

const TEMPLATES = [
  ['engisignal-post-statement-1200x1200', 1200, 1200, statementSquare],
  ['engisignal-post-statement-1600x900', 1600, 900, statementWide],
  ['engisignal-launching-soon-1200x1200', 1200, 1200, launchingSoonSquare],
  ['engisignal-launching-soon-1600x900', 1600, 900, launchingSoonWide],
  ['engisignal-what-it-is-1600x900', 1600, 900, categoryWide],
  ['engisignal-what-it-does-1600x900', 1600, 900, explainerWide],
  ['engisignal-feature-ask-engisignal-1600x900', 1600, 900, featureAskWide],
  ['engisignal-feature-scenario-lab-1200x1200', 1200, 1200, featureScenarioSquare],
  ['engisignal-announcement-founder-1200x1200', 1200, 1200, founderAnnouncement],
  ['engisignal-announcement-partner-1600x900', 1600, 900, partnerAnnouncement],
  ['engisignal-customer-insight-1200x1200', 1200, 1200, customerInsight],
  ['engisignal-og-image-1200x630', 1200, 630, ogImage],
];

export function templateJobs({ templateDir, htmlDir, tmpDir }) {
  return TEMPLATES.map(([name, w, h, build]) => ({
    name,
    w,
    h,
    html: build(),
    outDir: templateDir,
    htmlDir,
    tmpDir,
  }));
}
