// Render the two static PNG plates the assembler uses to "float" each app
// clip cinematically — kept as one-time renders so the per-scene ffmpeg
// composite stays cheap (just a scale + alphamerge + overlay):
//
//   plate.png  1920x1080  warm-gradient mat + a soft rounded drop shadow
//              at the float rect (the app clip is overlaid on top of it)
//   mask.png   FWxFH      white rounded rect on black → the app's alpha,
//              so the floated clip gets clean rounded corners
//
//   FLOAT_W=.. FLOAT_H=.. FLOAT_X=.. FLOAT_Y=.. RADIUS=.. \
//   OUT=/tmp/cycle-build node scripts/cycle_video/float_plates.mjs
import { chromium } from 'playwright';
import { execSync } from 'child_process';
import fs from 'fs';

const OUT = process.env.OUT || '/tmp/cycle-build';
const FW = +(process.env.FLOAT_W || 1804);
const FH = +(process.env.FLOAT_H || 1014);
const FX = +(process.env.FLOAT_X || 58);
const FY = +(process.env.FLOAT_Y || 33);
const R = +(process.env.RADIUS || 20);
fs.mkdirSync(OUT, { recursive: true });
const cached = execSync(
  `ls -d ~/Library/Caches/ms-playwright/chromium-*/chrome-mac*/Chromium.app/Contents/MacOS/Chromium 2>/dev/null | tail -1`
).toString().trim();

const plate = `<!doctype html><meta charset=utf-8><style>
 *{margin:0;box-sizing:border-box}
 html,body{width:1920px;height:1080px}
 body{position:relative;overflow:hidden;
   background:
     radial-gradient(150% 120% at 50% -20%, #faf8f3 0%, #f1ede4 45%, #e9e3d7 100%);}
 .card{position:absolute;left:${FX}px;top:${FY}px;width:${FW}px;height:${FH}px;
   border-radius:${R}px;background:#ffffff;
   box-shadow:0 2px 5px rgba(20,19,15,.05),
              0 12px 28px rgba(20,19,15,.10),
              0 34px 80px rgba(20,19,15,.20);}
</style><div class="card"></div>`;

const mask = `<!doctype html><meta charset=utf-8><style>
 *{margin:0;box-sizing:border-box}
 html,body{width:${FW}px;height:${FH}px;background:#000}
 .m{width:${FW}px;height:${FH}px;border-radius:${R}px;background:#fff}
</style><div class="m"></div>`;

const b = await chromium.launch({ executablePath: cached || undefined, headless: true });
const p1 = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await p1.setContent(plate, { waitUntil: 'networkidle' }); await p1.waitForTimeout(120);
await p1.screenshot({ path: `${OUT}/plate.png` });
const p2 = await b.newPage({ viewport: { width: FW, height: FH }, deviceScaleFactor: 1 });
await p2.setContent(mask, { waitUntil: 'networkidle' }); await p2.waitForTimeout(120);
await p2.screenshot({ path: `${OUT}/mask.png` });
await b.close();
console.log(`plates -> ${OUT}/plate.png ${OUT}/mask.png  (float ${FW}x${FH} @ ${FX},${FY} r${R})`);
