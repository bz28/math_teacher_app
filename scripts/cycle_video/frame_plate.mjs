// Render the two static plates the assembler composites every app clip
// onto, so each scene "floats" as a rounded, shadowed card on warm paper:
//
//   plate-bg.png     1920x1080  warm paper gradient + the card's soft
//                               drop shadow (the clip sits on top of this)
//   plate-mask.png   CARD_W x CARD_H  white rounded rect on black — the
//                               alpha mask that rounds the clip's corners
//
// Geometry is shared with assemble.sh via env (CARD_W/H/X/Y/RADIUS).
//   node scripts/cycle_video/frame_plate.mjs
import { chromium } from 'playwright';
import { execSync } from 'child_process';
import fs from 'fs';

const OUT = process.env.PLATES_OUT || '/tmp/cycle-plates';
fs.mkdirSync(OUT, { recursive: true });
const W = 1920, H = 1080;
const CW = +(process.env.CARD_W || 1766);
const CH = +(process.env.CARD_H || 994);
const CX = Math.round((W - CW) / 2);
const CY = Math.round((H - CH) / 2);
const R = +(process.env.CARD_RADIUS || 22);

const cached = execSync(
  `ls -d ~/Library/Caches/ms-playwright/chromium-*/chrome-mac*/Chromium.app/Contents/MacOS/Chromium 2>/dev/null | tail -1`
).toString().trim();

const bgHtml = `<!doctype html><meta charset=utf-8><style>
 *{margin:0;padding:0;box-sizing:border-box}
 html,body{width:${W}px;height:${H}px;overflow:hidden}
 body{position:relative;
   background:
     radial-gradient(70% 55% at 50% 2%, rgba(255,255,255,.55), transparent 60%),
     radial-gradient(55% 70% at 96% 98%, rgba(184,67,26,.05), transparent 55%),
     linear-gradient(152deg, #f6f2ea 0%, #efe9dd 58%, #e9e2d4 100%);}
 .card{position:absolute;left:${CX}px;top:${CY}px;width:${CW}px;height:${CH}px;
   border-radius:${R}px;background:transparent;
   box-shadow:0 50px 110px -26px rgba(20,19,15,.34),
              0 18px 44px -18px rgba(20,19,15,.24);}
</style><div class="card"></div>`;

// Pure alpha mask: white rounded rect on black, CARD-sized.
const maskHtml = `<!doctype html><meta charset=utf-8><style>
 *{margin:0;padding:0;box-sizing:border-box}
 html,body{width:${CW}px;height:${CH}px;overflow:hidden;background:#000}
 .m{width:${CW}px;height:${CH}px;border-radius:${R}px;background:#fff}
</style><div class="m"></div>`;

const b = await chromium.launch({ executablePath: cached || undefined, headless: true });
const p1 = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await p1.setContent(bgHtml, { waitUntil: 'networkidle' });
await p1.screenshot({ path: `${OUT}/plate-bg.png` });
const p2 = await b.newPage({ viewport: { width: CW, height: CH }, deviceScaleFactor: 1 });
await p2.setContent(maskHtml, { waitUntil: 'networkidle' });
await p2.screenshot({ path: `${OUT}/plate-mask.png` });
await b.close();
console.log('plates ->', OUT, `(card ${CW}x${CH} @ ${CX},${CY} r${R})`);
