// Ad-hoc legibility verification: boot authed, screenshot key surfaces.
// Usage: node scripts/cycle_video/_verify_shots.mjs
import { chromium } from 'playwright';
import { execSync } from 'child_process';
import fs from 'fs';
const WEB = process.env.WEB_BASE || 'http://localhost:3000';
const TOK = JSON.parse(fs.readFileSync('/tmp/cycle_tokens.json', 'utf8'));
const OUT = '/tmp/verify';
fs.mkdirSync(OUT, { recursive: true });
const CACHED = execSync(`ls -d ~/Library/Caches/ms-playwright/chromium-*/chrome-mac*/Chromium.app/Contents/MacOS/Chromium 2>/dev/null | tail -1`).toString().trim();
const COURSE = 'c99b654b-7ef8-4b05-a1df-a57c47d98f6e';
const UNIT5 = 'c072c9b6-fd0c-4565-9bab-afea06a3dcd4';
const SEC = '845950c6-dc06-40a7-ba72-278ae63c221c';
const MAYA = '845d3c76-9fe8-4cec-b5ab-e43446400edd';
const JORDAN = '0f63c477-12f8-4cbc-b4dc-ad62642f2cdc';

const b = await chromium.launch({ executablePath: CACHED || undefined, headless: true });
async function ctx(who) {
  const c = await b.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const t = TOK[who];
  await c.addInitScript(([a, r]) => { try { localStorage.setItem('veradic_access_token', a); localStorage.setItem('veradic_refresh_token', r); } catch (e) {} }, [t.access, t.refresh]);
  return c;
}
async function shot(who, url, name, { wait = 2500, click = null, then = 1500 } = {}) {
  const c = await ctx(who); const p = await c.newPage();
  await p.goto(WEB + url, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await p.waitForTimeout(wait);
  if (click) { try { await p.getByText(click, { exact: false }).first().click({ timeout: 5000 }); await p.waitForTimeout(then); } catch (e) { console.log('click miss', name, e.message); } }
  await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: false }).catch(() => {});
  console.log('shot', name);
  await c.close();
}
// 1 teacher Unit5 detail (problem list)
await shot('teacher', `/school/teacher/courses/${COURSE}/homework/${UNIT5}`, '01-unit5-list', { wait: 3000 });
// 2 matrix workshop (click problem 1 → solution w/ pmatrix)
await shot('teacher', `/school/teacher/courses/${COURSE}/homework/${UNIT5}`, '02-matrix-workshop', { wait: 3000, click: 'inverse matrix', then: 2500 });
// 3 right-triangle workshop (figure)
await shot('teacher', `/school/teacher/courses/${COURSE}/homework/${UNIT5}`, '03-ladder-workshop', { wait: 3000, click: 'ladder leans', then: 2500 });
// 4 teacher grade review — Maya
await shot('teacher', `/school/teacher/courses/${COURSE}/homework/${UNIT5}/sections/${SEC}/review?student=${MAYA}`, '04-grade-maya', { wait: 4000 });
// 5 teacher verdict review — Jordan
await shot('teacher', `/school/teacher/courses/${COURSE}/homework/${UNIT5}/sections/${SEC}/review?student=${JORDAN}`, '05-verdict-jordan', { wait: 4000 });
// 6 insights
await shot('teacher', `/school/teacher/courses/${COURSE}?tab=insights`, '06-insights', { wait: 4000 });
// 7 reteach practice detail
await shot('teacher', `/school/teacher/courses/${COURSE}/homework/f1b8b77e-706b-4d07-97fe-c808a8548ccf`, '07-reteach', { wait: 3000 });
// 8 student practice runner (Maya)
await shot('maya', `/school/student/courses/${COURSE}/practice/f1b8b77e-706b-4d07-97fe-c808a8548ccf`, '08-practice', { wait: 3000 });
await b.close();
console.log('done ->', OUT);
