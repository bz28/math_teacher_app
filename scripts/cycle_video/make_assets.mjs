// Generate the two upload props for the recording:
//   worksheet.png    — the real Unit 5 review sheet (scene 2 upload + the
//                      generation source). Copied straight from the repo
//                      asset so what's shown on camera IS the seeded source.
//   handwriting.png   — a lined-paper photo of a student's Unit 5 work
//                      (matrix system, ladder trig, multi-step) for scene 4.
import { chromium } from 'playwright';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const OUT = process.env.ASSETS_OUT || '/tmp/cycle-assets';
fs.mkdirSync(OUT, { recursive: true });
const cached = execSync(
  `ls -d ~/Library/Caches/ms-playwright/chromium-*/chrome-mac*/Chromium.app/Contents/MacOS/Chromium 2>/dev/null | tail -1`
).toString().trim();

// worksheet prop = the real repo asset (the sheet the demo generates from).
// Copied under BOTH the generic name (the seeded warm-up doc's image) AND
// the LABELED name that scene 2 uploads on camera + scene 3 selects, so the
// generation source reads as a real, dated review sheet — never "worksheet.png".
const REVIEW_SHEET = 'Unit 5 Review — Matrices, Trig & Equations (2024).png';
const REPO = path.resolve(new URL('../../', import.meta.url).pathname);
const SRC = path.join(REPO, 'docs/design/unit5_review_worksheet.png');
if (fs.existsSync(SRC)) {
  fs.copyFileSync(SRC, `${OUT}/worksheet.png`);
  fs.copyFileSync(SRC, `${OUT}/${REVIEW_SHEET}`);
  console.log('worksheet + labeled review sheet <- repo unit5 sheet');
}

// hand-written look (cursive-ish system fallback) on lined paper — the
// student's Unit 5 work across the three problems (matrix mult, zip-line
// trig, multi-step linear).
const lines = [
  '1)  A = [ 5  2 ; 0  3 ] ,  B = [ 1  4 ; 3  2 ]',
  '     AB = row·col each entry',
  '     AB = [ 11  24 ; 9  6 ]',
  '2)  sin 48° = h / 35',
  '     h = 35 sin 48° ≈ 26.0 ft',
  '3)  3(x−2)/4 − (x+1)/3 = 2',
  '     9(x−2) − 4(x+1) = 24  →  x = 46/5',
];
const rows = lines.map((ln, i) => {
  const y = 150 + i * 96;
  const color = (i === 2 || i === 4 || i === 6) ? '#15643f' : '#1c2a52';
  return `<text x="120" y="${y}" font-family="'Bradley Hand','Comic Sans MS',cursive" font-size="42" fill="${color}">${ln}</text>`;
}).join('');
const grid = Array.from({ length: 13 }, (_, i) =>
  `<line x1="0" y1="${110 + i * 96}" x2="1100" y2="${110 + i * 96}" stroke="#cfe0ee" stroke-width="2"/>`).join('');
const handwriting = `<!doctype html><meta charset=utf-8>
<div style="width:1100px;height:1400px;background:#fdfcf6">
<svg width="1100" height="1400" viewBox="0 0 1100 1400" xmlns="http://www.w3.org/2000/svg">
 <rect width="1100" height="1400" fill="#fdfcf6"/>
 ${grid}
 <line x1="92" y1="0" x2="92" y2="1400" stroke="#e6a89c" stroke-width="3"/>
 <text x="820" y="60" font-family="Helvetica" font-size="22" fill="#9aa0a6" letter-spacing="2">UNIT 5 · PERIOD 3</text>
 ${rows}
</svg></div>`;

const b = await chromium.launch({ executablePath: cached || undefined, headless: true });
async function render(html, w, h, p) {
  const pg = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await pg.setContent(html, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(200);
  await pg.screenshot({ path: p, clip: { x: 0, y: 0, width: w, height: h } });
  await pg.close();
}
await render(handwriting, 1100, 1400, `${OUT}/handwriting.png`);
await b.close();
console.log('assets ->', OUT);
