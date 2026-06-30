// Render the full-screen branded title cards (1920x1080 PNGs) for the
// Veradic cycle video. Brand: paper #f7f5f0, ink #14130f, Instrument
// Serif display, sienna #b8431a eyebrow. One PNG per card.
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

// id, eyebrow (side label), title, subtitle
const CARDS = [
  ['00-open', 'Veradic', 'The whole teaching loop.', 'Teacher to student, and back — in one place.'],
  ['01-section', 'Teacher', 'Start a class.', 'A new section, in seconds.'],
  ['02-materials', 'Teacher', 'Add your materials.', 'Drop in what you already teach from.'],
  ['03-generate', 'Teacher', 'Generate the homework.', 'Describe it once — the AI writes the problems.'],
  ['04-submit', 'Student', 'Submit, and prove you get it.', 'A photo of the work, then a quick understanding check.'],
  ['05-grade', 'Teacher', 'Grade, and see the class.', 'Every problem graded — with a receipt.'],
  ['06-reteach', 'Teacher', 'Re-teach in one click.', 'Turn a weak spot into targeted practice.'],
  ['07-practice', 'Student', 'Practice and learn.', 'The loop closes — the student gets better.'],
  ['08-close', 'Veradic', 'The whole loop, in one place.', ''],
];

const html = (eyebrow, title, subtitle) => `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:1920px; height:1080px; }
  body {
    background:#f7f5f0; color:#14130f;
    font-family:'Inter',system-ui,sans-serif;
    display:flex; align-items:center; justify-content:center;
    position:relative; overflow:hidden;
  }
  /* subtle paper grain via faint radial */
  body::before { content:''; position:absolute; inset:0;
    background:radial-gradient(120% 120% at 50% 0%, rgba(255,255,255,.5), transparent 60%); }
  .mark { position:absolute; top:64px; left:50%; transform:translateX(-50%);
    display:flex; align-items:center; gap:12px; }
  .mark .dot { width:34px; height:34px; border-radius:9px;
    background:#1f5c43; color:#fff; font-family:'Instrument Serif',serif;
    font-size:24px; display:flex; align-items:center; justify-content:center; }
  .mark .name { font-size:18px; font-weight:600; letter-spacing:.02em; color:#1c1b16; }
  .wrap { text-align:center; max-width:1300px; padding:0 80px; z-index:2; }
  .eyebrow { color:#b8431a; font-size:22px; font-weight:600;
    letter-spacing:.34em; text-transform:uppercase; margin-bottom:34px; }
  .title { font-family:'Instrument Serif',Georgia,serif; font-weight:400;
    font-size:124px; line-height:1.02; letter-spacing:-.01em; color:#14130f; }
  .sub { margin-top:38px; font-size:30px; color:#6b6862; font-weight:400;
    letter-spacing:.01em; }
  .rule { width:64px; height:3px; background:#b8431a; margin:44px auto 0;
    border-radius:2px; opacity:.0; }
  .has-sub .rule { opacity:1; }
</style></head>
<body><div class="mark"><div class="dot">V</div><div class="name">Veradic</div></div>
<div class="wrap ${subtitle ? 'has-sub' : ''}">
  <div class="eyebrow">${eyebrow}</div>
  <div class="title">${title}</div>
  ${subtitle ? `<div class="sub">${subtitle}</div>` : ''}
  <div class="rule"></div>
</div></body></html>`;

const b = await chromium.launch({ executablePath: cached || undefined, headless: true });
const page = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
for (const [id, eyebrow, title, subtitle] of CARDS) {
  await page.setContent(html(eyebrow, title, subtitle), { waitUntil: 'networkidle' });
  await page.waitForTimeout(600); // let webfonts settle
  await page.screenshot({ path: `${OUT}/card-${id}.png` });
  console.log('card', id);
}
await b.close();
