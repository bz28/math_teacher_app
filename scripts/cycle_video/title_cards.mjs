// Render the full-screen branded title cards (1920x1080 PNGs) for the
// Veradic cycle video. Premium editorial system:
//   paper #f7f5f0 · ink #14130f · sienna #b8431a · Instrument Serif display
//   · Inter labels. Bookend cards (open/close) are centered heroes; the
//   seven story cards use a left-aligned editorial layout with a vertical
//   side-label eyebrow, a section index, and hairline rules.
//
//   node scripts/cycle_video/title_cards.mjs
import { chromium } from 'playwright';
import { execSync } from 'child_process';
import fs from 'fs';

const OUT = process.env.CARDS_OUT || '/tmp/cycle-cards';
fs.mkdirSync(OUT, { recursive: true });
const cached = execSync(
  `ls -d ~/Library/Caches/ms-playwright/chromium-*/chrome-mac*/Chromium.app/Contents/MacOS/Chromium 2>/dev/null | tail -1`
).toString().trim();

// id, kind, sideLabel, index, title, subtitle
//   kind 'hero'  → centered bookend
//   kind 'story' → left editorial, numbered
const CARDS = [
  ['00-open',     'hero',  'Veradic', null, 'The whole teaching loop.', 'From a teacher’s first click to a student who actually understands — one place.'],
  ['01-section',  'story', 'Teacher', 1, 'Start a class.', 'Every class you teach, live in seconds.'],
  ['02-materials','story', 'Teacher', 2, 'Bring your materials.', 'Build from the worksheets you already use.'],
  ['03-generate', 'story', 'Teacher', 3, 'Generate the homework.', 'Aim it at a topic — the AI writes the problems, figures, and answer keys.'],
  ['04-submit',   'story', 'Student', 4, 'Prove you understand.', 'Snap the work — then pass a check no grade can fake.'],
  ['05-grade',    'story', 'Teacher', 5, 'Grade the whole class.', 'Every problem scored — with a receipt that adds up.'],
  ['06-reteach',  'story', 'Teacher', 6, 'Re-teach in one click.', 'Turn the class’s weakest spot into targeted practice.'],
  ['07-practice', 'story', 'Student', 7, 'Practice, and get better.', 'The loop closes — the student learns.'],
  ['08-close',    'cta',   'Veradic', null, 'Generate. Check understanding.\nGrade. Re-teach.', 'For every class you teach.'],
];
const TOTAL = 7;

const head = `<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">`;

const base = `
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:1920px; height:1080px; }
  body {
    background:#f7f5f0; color:#14130f;
    font-family:'Inter',system-ui,sans-serif;
    position:relative; overflow:hidden;
  }
  /* soft paper light from the top + faint warm vignette at the base */
  body::before { content:''; position:absolute; inset:0;
    background:radial-gradient(130% 110% at 50% -10%, rgba(255,255,255,.6), transparent 55%),
               radial-gradient(120% 80% at 50% 120%, rgba(184,67,26,.05), transparent 60%); }
  .mark { position:absolute; top:70px; left:120px; display:flex; align-items:center; gap:13px; z-index:3; }
  .mark .dot { width:34px; height:34px; border-radius:9px;
    background:#1f5c43; color:#fff; font-family:'Instrument Serif',serif;
    font-size:24px; line-height:34px; text-align:center; }
  .mark .name { font-size:18px; font-weight:600; letter-spacing:.02em; color:#1c1b16; }
  .footer { position:absolute; bottom:66px; left:120px; right:120px;
    display:flex; align-items:center; justify-content:space-between; z-index:3;
    font-size:15px; font-weight:500; letter-spacing:.22em; text-transform:uppercase; color:#a8a49b; }
  .footer .hair { position:absolute; left:0; right:0; top:-26px; height:1px; background:rgba(20,19,15,.10); }
`;

// ── centered hero bookend ──
const hero = (title) => `<!doctype html><html><head>${head}<style>${base}
  .stage { position:absolute; inset:0; display:flex; flex-direction:column;
    align-items:center; justify-content:center; z-index:2; padding:0 120px; }
  .eyebrow { color:#b8431a; font-size:20px; font-weight:600; letter-spacing:.42em;
    text-transform:uppercase; margin-bottom:40px; }
  .title { font-family:'Instrument Serif',Georgia,serif; font-weight:400;
    font-size:132px; line-height:1.0; letter-spacing:-.012em; text-align:center; max-width:1350px; }
  .rule { width:72px; height:2px; background:#b8431a; margin:46px 0 0; border-radius:2px; }
</style></head><body>
  <div class="mark"><div class="dot">V</div><div class="name">Veradic</div></div>
  <div class="stage">
    <div class="eyebrow">Veradic</div>
    <div class="title">${title}</div>
    <div class="rule"></div>
  </div>
  <div class="footer"><div class="hair"></div><span>Veradic</span><span>The teaching loop</span></div>
</body></html>`;

// ── closing CTA card ──
const cta = (title, sub) => `<!doctype html><html><head>${head}<style>${base}
  .stage { position:absolute; inset:0; display:flex; flex-direction:column;
    align-items:center; justify-content:center; z-index:2; padding:0 120px; }
  .eyebrow { color:#b8431a; font-size:20px; font-weight:600; letter-spacing:.42em;
    text-transform:uppercase; margin-bottom:38px; }
  .title { font-family:'Instrument Serif',Georgia,serif; font-weight:400;
    font-size:104px; line-height:1.04; letter-spacing:-.012em; text-align:center;
    max-width:1400px; white-space:pre-line; }
  .sub { margin-top:30px; font-size:30px; color:#6b6862; font-weight:400; letter-spacing:.005em; }
  .rule { width:72px; height:2px; background:#b8431a; margin:46px 0 40px; border-radius:2px; }
  .pill { display:flex; align-items:center; gap:22px; font-size:23px; font-weight:600; color:#1c1b16; }
  .pill .site { color:#1f5c43; letter-spacing:.01em; }
  .pill .dot { width:5px; height:5px; border-radius:50%; background:#c9c3b6; }
  .pill .go { color:#b8431a; letter-spacing:.02em; }
</style></head><body>
  <div class="mark"><div class="dot">V</div><div class="name">Veradic</div></div>
  <div class="stage">
    <div class="eyebrow">Veradic</div>
    <div class="title">${title}</div>
    <div class="sub">${sub}</div>
    <div class="rule"></div>
    <div class="pill"><span class="site">veradicai.com</span><span class="dot"></span><span class="go">Start a pilot →</span></div>
  </div>
  <div class="footer"><div class="hair"></div><span>Veradic</span><span>The teaching loop</span></div>
</body></html>`;

// ── left editorial story card ──
const story = (sideLabel, index, title, subtitle) => `<!doctype html><html><head>${head}<style>${base}
  .side { position:absolute; left:132px; top:50%; transform:translateY(-50%) rotate(180deg);
    writing-mode:vertical-rl; color:#b8431a; font-size:19px; font-weight:600;
    letter-spacing:.46em; text-transform:uppercase; z-index:3; }
  .side::after { content:''; display:block; width:1px; height:64px;
    background:rgba(184,67,26,.4); margin:22px auto 0; }
  .stage { position:absolute; left:340px; right:200px; top:50%; transform:translateY(-50%); z-index:2; }
  .idx { display:flex; align-items:baseline; gap:16px; margin-bottom:30px; }
  .idx .n { font-family:'Instrument Serif',serif; font-size:40px; line-height:1; color:#14130f; }
  .idx .of { font-size:15px; font-weight:600; letter-spacing:.2em; color:#a8a49b; }
  .idx .bar { flex:1; height:1px; background:rgba(20,19,15,.12); margin-left:8px; }
  .title { font-family:'Instrument Serif',Georgia,serif; font-weight:400;
    font-size:120px; line-height:1.0; letter-spacing:-.012em; color:#14130f; max-width:1180px; }
  .rule { width:60px; height:2px; background:#b8431a; margin:40px 0 32px; border-radius:2px; }
  .sub { font-size:30px; line-height:1.35; color:#6b6862; font-weight:400; max-width:900px; letter-spacing:.005em; }
</style></head><body>
  <div class="mark"><div class="dot">V</div><div class="name">Veradic</div></div>
  <div class="side">${sideLabel}</div>
  <div class="stage">
    <div class="idx"><span class="n">${String(index).padStart(2, '0')}</span><span class="of">/ 0${TOTAL}</span><span class="bar"></span></div>
    <div class="title">${title}</div>
    <div class="rule"></div>
    <div class="sub">${subtitle}</div>
  </div>
  <div class="footer"><div class="hair"></div><span>Veradic</span><span>${sideLabel}</span></div>
</body></html>`;

const b = await chromium.launch({ executablePath: cached || undefined, headless: true });
const page = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
for (const [id, kind, sideLabel, index, title, subtitle] of CARDS) {
  const markup = kind === 'hero' ? hero(title)
    : kind === 'cta' ? cta(title, subtitle)
    : story(sideLabel, index, title, subtitle);
  await page.setContent(markup, { waitUntil: 'networkidle' });
  await page.waitForTimeout(650); // let webfonts settle
  await page.screenshot({ path: `${OUT}/card-${id}.png` });
  console.log('card', id);
}
await b.close();
