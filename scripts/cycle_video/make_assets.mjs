// Generate the two upload props for the recording:
//   worksheet.png    — a tidy "course material" page (scene 2)
//   handwriting.png   — a lined-paper photo of handwritten work (scene 4)
import { chromium } from 'playwright';
import { execSync } from 'child_process';
import fs from 'fs';

const OUT = process.env.ASSETS_OUT || '/tmp/cycle-assets';
fs.mkdirSync(OUT, { recursive: true });
const cached = execSync(
  `ls -d ~/Library/Caches/ms-playwright/chromium-*/chrome-mac*/Chromium.app/Contents/MacOS/Chromium 2>/dev/null | tail -1`
).toString().trim();

const worksheet = `<!doctype html><meta charset=utf-8>
<style>
 *{margin:0;box-sizing:border-box}
 body{width:1100px;height:1420px;background:#fffdf8;font-family:Georgia,serif;color:#1c1b18;padding:84px 90px}
 .ey{font-family:'Helvetica',sans-serif;font-size:15px;letter-spacing:.28em;text-transform:uppercase;color:#b8431a;font-weight:700}
 h1{font-size:46px;margin:14px 0 6px}
 .sub{font-family:Helvetica,sans-serif;color:#6b6862;font-size:18px;margin-bottom:40px}
 hr{border:none;border-top:2px solid #e7e2d6;margin:26px 0}
 h2{font-size:27px;margin:30px 0 14px}
 p,li{font-size:21px;line-height:1.7}
 .box{background:#f3efe5;border-left:4px solid #1f5c43;padding:18px 24px;border-radius:8px;margin:18px 0;font-size:21px}
 ol{padding-left:28px}
 .ex{font-family:'Courier New',monospace;font-size:22px;color:#243b6b}
</style>
<div class=ey>Algebra I · Unit 3</div>
<h1>Linear Equations — Class Notes</h1>
<div class=sub>Solving multi-step equations &amp; distributing across parentheses</div>
<hr>
<h2>1 · The big idea</h2>
<p>To solve for a variable, undo the operations in reverse order until the
variable stands alone. Whatever you do to one side, do to the other.</p>
<div class=box><b>Golden rule:</b> a negative in front of parentheses flips the
sign of <i>every</i> term inside.</div>
<h2>2 · Worked example</h2>
<p class=ex>2(x − 3) = 4x + 8</p>
<ol>
 <li class=ex>2x − 6 = 4x + 8 &nbsp; <span style="font-family:Georgia">(distribute)</span></li>
 <li class=ex>−2x = 14 &nbsp; <span style="font-family:Georgia">(collect terms)</span></li>
 <li class=ex>x = −7 &nbsp; <span style="font-family:Georgia">(divide by −2)</span></li>
</ol>
<h2>3 · Watch out for</h2>
<p>The most common slip is a <b>sign error</b> when moving a term across the
equals sign. Slow down on that one step.</p>`;

// hand-written look (cursive-ish system fallback) on lined paper.
const lines = [
  '3.  2(x − 3) = 4x + 8',
  '2x − 6 = 4x + 8',
  '2x − 4x = 8 + 6',
  '−2x = 14',
  'x = −6',
];
const rows = lines.map((ln, i) => {
  const y = 150 + i * 96;
  const color = i === 4 ? '#15643f' : '#1c2a52';
  return `<text x="120" y="${y}" font-family="'Bradley Hand','Comic Sans MS',cursive" font-size="46" fill="${color}">${ln}</text>`;
}).join('');
const grid = Array.from({ length: 13 }, (_, i) =>
  `<line x1="0" y1="${110 + i * 96}" x2="1100" y2="${110 + i * 96}" stroke="#cfe0ee" stroke-width="2"/>`).join('');
const handwriting = `<!doctype html><meta charset=utf-8>
<div style="width:1100px;height:1400px;background:#fdfcf6">
<svg width="1100" height="1400" viewBox="0 0 1100 1400" xmlns="http://www.w3.org/2000/svg">
 <rect width="1100" height="1400" fill="#fdfcf6"/>
 ${grid}
 <line x1="92" y1="0" x2="92" y2="1400" stroke="#e6a89c" stroke-width="3"/>
 <text x="900" y="60" font-family="Helvetica" font-size="22" fill="#9aa0a6" letter-spacing="2">PERIOD 3</text>
 ${rows}
</svg></div>`;

const b = await chromium.launch({ executablePath: cached || undefined, headless: true });
async function render(html, w, h, path) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await p.setContent(html, { waitUntil: 'networkidle' });
  await p.waitForTimeout(200);
  await p.screenshot({ path, clip: { x: 0, y: 0, width: w, height: h } });
  await p.close();
}
await render(worksheet, 1100, 1420, `${OUT}/worksheet.png`);
await render(handwriting, 1100, 1400, `${OUT}/handwriting.png`);
await b.close();
console.log('assets ->', OUT);
