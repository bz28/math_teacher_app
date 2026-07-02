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

// id, eyebrow (side label), title, subtitle, step (1..7 for the loop beats;
// 0 = bookend). Titles + subtitles are LOCKED content — verbatim.
const CARDS = [
  ['00-open', 'Veradic', 'The whole teaching loop.', 'Teacher to student, and back — in one place.', 0],
  ['01-section', 'Teacher', 'Start a class.', 'A new section, in seconds.', 1],
  ['02-materials', 'Teacher', 'Add your materials.', 'Drop in what you already teach from.', 2],
  ['03-generate', 'Teacher', 'Generate the homework.', 'Describe it once — the AI writes the problems.', 3],
  ['04-submit', 'Student', 'Submit, and prove you get it.', 'A photo of the work — then a check no grade can fake.', 4],
  ['05-grade', 'Teacher', 'Grade, and see the class.', 'Every problem graded — with a receipt.', 5],
  ['06-reteach', 'Teacher', 'Re-teach in one click.', 'Turn a weak spot into targeted practice.', 6],
  ['07-practice', 'Student', 'Practice and learn.', 'The loop closes — the student gets better.', 7],
  ['08-close', 'Veradic', 'The whole loop, in one place.', '', 0],
];

const TOTAL = 7;
const dots = (step) => {
  if (!step) return '';
  const cells = Array.from({ length: TOTAL }, (_, i) =>
    `<span class="pd${i + 1 === step ? ' on' : ''}${i + 1 < step ? ' past' : ''}"></span>`).join('');
  return `<div class="prog">${cells}</div>`;
};

const html = (eyebrow, title, subtitle, step) => `<!doctype html><html><head><meta charset="utf-8">
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
  /* layered warm paper light: a soft top glow + a faint sienna wash */
  body::before { content:''; position:absolute; inset:0;
    background:
      radial-gradient(80% 60% at 50% 8%, rgba(255,255,255,.60), transparent 62%),
      radial-gradient(60% 80% at 100% 100%, rgba(184,67,26,.045), transparent 55%); }
  /* editorial inset frame — a hairline rule with a warm tint */
  .edge { position:absolute; inset:52px; border:1px solid rgba(20,19,15,.10);
    border-radius:6px; z-index:1; }
  .mark { position:absolute; top:84px; left:50%; transform:translateX(-50%);
    display:flex; align-items:center; gap:13px; z-index:3; }
  .mark .dot { width:36px; height:36px; border-radius:10px;
    background:#1f5c43; color:#fff; font-family:'Instrument Serif',serif;
    font-size:25px; display:flex; align-items:center; justify-content:center;
    box-shadow:0 4px 14px rgba(31,92,67,.28); }
  .mark .name { font-size:18px; font-weight:600; letter-spacing:.12em;
    text-transform:uppercase; color:#3a382f; }
  /* vertical side-label eyebrow, reading bottom-to-top on the left edge */
  .side { position:absolute; left:96px; top:50%; transform:translateY(-50%);
    writing-mode:vertical-rl; text-orientation:mixed; transform-origin:center;
    color:#b8431a; font-size:21px; font-weight:600; letter-spacing:.42em;
    text-transform:uppercase; z-index:3; }
  .side .flip { transform:rotate(180deg); display:inline-block; }
  .wrap { text-align:center; max-width:1320px; padding:0 80px; z-index:2; }
  .kicker { color:#b8431a; font-size:20px; font-weight:600;
    letter-spacing:.40em; text-transform:uppercase; margin-bottom:30px; opacity:0; }
  .title { font-family:'Instrument Serif',Georgia,serif; font-weight:400;
    font-size:132px; line-height:1.0; letter-spacing:-.015em; color:#14130f; }
  .rule { width:56px; height:3px; background:#b8431a; margin:40px auto 34px;
    border-radius:2px; opacity:0; }
  .has-sub .rule { opacity:1; }
  .sub { font-size:31px; color:#6b6862; font-weight:400; letter-spacing:.008em;
    line-height:1.4; }
  /* loop-progress dots — where we are in the seven-beat cycle */
  .prog { position:absolute; bottom:96px; left:50%; transform:translateX(-50%);
    display:flex; align-items:center; gap:14px; z-index:3; }
  .prog span { width:9px; height:9px; border-radius:50%;
    background:rgba(20,19,15,.16); transition:none; }
  .prog span.past { background:rgba(184,67,26,.42); }
  .prog span.on { width:30px; border-radius:5px; background:#b8431a; }
</style></head>
<body>
<div class="edge"></div>
<div class="mark"><div class="dot">V</div><div class="name">Veradic</div></div>
<div class="side"><span class="flip">${eyebrow}</span></div>
<div class="wrap ${subtitle ? 'has-sub' : ''}">
  <div class="title">${title}</div>
  <div class="rule"></div>
  ${subtitle ? `<div class="sub">${subtitle}</div>` : ''}
</div>
${dots(step)}
</body></html>`;

const b = await chromium.launch({ executablePath: cached || undefined, headless: true });
const page = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
for (const [id, eyebrow, title, subtitle, step] of CARDS) {
  await page.setContent(html(eyebrow, title, subtitle, step), { waitUntil: 'networkidle' });
  await page.waitForTimeout(600); // let webfonts settle
  await page.screenshot({ path: `${OUT}/card-${id}.png` });
  console.log('card', id);
}
await b.close();
