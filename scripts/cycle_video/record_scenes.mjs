// Record the seven scenes of the Veradic teacher<->student cycle as
// individual 1920x1080 webm clips. A synthetic cursor + on-brand
// lower-third captions make every interaction read clearly. Each scene
// gets its own browser context (one webm), so the assembler can trim,
// speed-ramp, and cross-fade them independently.
//
//   TOKENS=$(python -m scripts.cycle_video.mint_tokens) \
//   node scripts/cycle_video/record_scenes.mjs [sceneId ...]
import { chromium } from 'playwright';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const WEB = process.env.WEB_BASE || 'http://localhost:3000';
const TOK = JSON.parse(process.env.TOKENS);
const OUT = process.env.SCENES_OUT || '/tmp/cycle-scenes';
const ASSETS = process.env.ASSETS_OUT || '/tmp/cycle-assets';
fs.mkdirSync(OUT, { recursive: true });
const CACHED = execSync(
  `ls -d ~/Library/Caches/ms-playwright/chromium-*/chrome-mac*/Chromium.app/Contents/MacOS/Chromium 2>/dev/null | tail -1`
).toString().trim();

// ── seed IDs ──
const ID = {
  ALG: 'c99b654b-7ef8-4b05-a1df-a57c47d98f6e',
  SEC: '845950c6-dc06-40a7-ba72-278ae63c221c',
  GEO: 'b24c145a-bf54-4fde-865d-792ff22f1c48',
  GEO_HW: '75375c6c-7e39-44a2-842e-f7b4f72ecd71',
  LIN: 'c072c9b6-fd0c-4565-9bab-afea06a3dcd4',
  SYSTEMS: '0bb2e228-d653-4d91-b03e-13e46006c498',
  PRACTICE: 'f1b8b77e-706b-4d07-97fe-c808a8548ccf',
  MAYA: '845d3c76-9fe8-4cec-b5ab-e43446400edd',
};

const VIEW = { width: 1920, height: 1080 };
const sleep = (p, ms) => p.waitForTimeout(ms);

// Synthetic cursor + caption overlay injected before app JS, so they
// survive client navigations within a context.
const INIT = `
(() => {
  function ensure() {
    if (!document.getElementById('__cur')) {
      const c = document.createElement('div'); c.id='__cur';
      c.style.cssText='position:fixed;z-index:2147483647;width:22px;height:22px;left:-50px;top:-50px;'
        +'border-radius:50%;background:rgba(31,92,67,.28);border:2px solid #1f5c43;'
        +'pointer-events:none;transition:transform .04s linear;box-shadow:0 1px 6px rgba(0,0,0,.18)';
      document.body.appendChild(c);
    }
    if (!document.getElementById('__cap')) {
      const w = document.createElement('div'); w.id='__cap';
      w.style.cssText='position:fixed;z-index:2147483646;left:50%;bottom:54px;transform:translateX(-50%) translateY(8px);'
        +'opacity:0;transition:opacity .5s ease, transform .5s ease;pointer-events:none;'
        +'display:flex;align-items:center;gap:14px;background:rgba(20,19,15,.93);color:#f7f5f0;'
        +'padding:15px 30px;border-radius:16px;font-family:Inter,system-ui,sans-serif;font-size:27px;'
        +'font-weight:500;letter-spacing:.005em;box-shadow:0 10px 40px rgba(0,0,0,.28);max-width:1500px';
      const dot=document.createElement('span');
      dot.style.cssText='width:11px;height:11px;border-radius:50%;background:#b8431a;flex:0 0 auto';
      const txt=document.createElement('span'); txt.id='__captxt';
      w.appendChild(dot); w.appendChild(txt); document.body.appendChild(w);
    }
  }
  window.__moveCur=(x,y)=>{const c=document.getElementById('__cur');if(c)c.style.transform='translate('+x+'px,'+y+'px)';};
  document.addEventListener('mousemove',e=>window.__moveCur(e.clientX-11,e.clientY-11));
  window.__cap=(t)=>{ensure();const w=document.getElementById('__cap');const x=document.getElementById('__captxt');
    if(x)x.textContent=t; if(w){w.style.opacity='1';w.style.transform='translateX(-50%) translateY(0)';}};
  window.__capClear=()=>{const w=document.getElementById('__cap');if(w){w.style.opacity='0';w.style.transform='translateX(-50%) translateY(8px)';}};
  function boot(){ ensure(); try{ if(document.body) new MutationObserver(ensure).observe(document.body,{childList:true}); }catch(e){} }
  if (document.readyState!=='loading') boot(); else document.addEventListener('DOMContentLoaded', boot);
})();
`;

async function newCtx(who) {
  const browser = global.__b;
  const dir = path.join(OUT, `_rec_${who}_${Date.now()}`);
  const ctx = await browser.newContext({
    viewport: VIEW, deviceScaleFactor: 1,
    recordVideo: { dir, size: VIEW },
  });
  const t = TOK[who];
  await ctx.addInitScript(([a, r]) => {
    try { localStorage.setItem('veradic_access_token', a); localStorage.setItem('veradic_refresh_token', r); } catch (e) {}
  }, [t.access, t.refresh]);
  await ctx.addInitScript(INIT);
  return ctx;
}

// Remove every section except Period 3 (the demo "Period 6" the create
// scene spawns) via the API, so the insights/grading scenes stay on the
// curated roster. Off-screen — never reloads the recorded page.
async function deleteDemoSections() {
  try {
    const h = { Authorization: 'Bearer ' + TOK.teacher.access };
    const r = await (await fetch(`http://localhost:8001/v1/teacher/courses/${ID.ALG}/sections`, { headers: h })).json();
    const list = r.sections || (Array.isArray(r) ? r : []);
    for (const sec of list) {
      if (sec.name !== 'Period 3') {
        await fetch(`http://localhost:8001/v1/teacher/courses/${ID.ALG}/sections/${sec.id}`, { method: 'DELETE', headers: h }).catch(() => {});
      }
    }
  } catch (e) {}
}

async function cap(page, text) { await page.evaluate((t) => window.__cap && window.__cap(t), text); }
async function capClear(page) { await page.evaluate(() => window.__capClear && window.__capClear()); }

// Move the synthetic cursor smoothly to an element and (optionally)
// click. Bounded: if the element isn't visible within `find` ms we skip
// it (a missing locator must never stall the clip for the boundingBox
// default 30s timeout).
async function go(page, locator, { click = true, settle = 550, find = 3500 } = {}) {
  const el = locator.first();
  try { await el.waitFor({ state: 'visible', timeout: find }); }
  catch { return false; }
  await el.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
  await sleep(page, 260);
  const box = await el.boundingBox().catch(() => null);
  if (!box) { if (click) await el.click({ timeout: 2500 }).catch(() => {}); return true; }
  const x = box.x + box.width / 2, y = box.y + Math.min(box.height / 2, 26);
  await page.mouse.move(x, y, { steps: 26 });
  await sleep(page, settle);
  if (click) { await page.mouse.down(); await sleep(page, 90); await page.mouse.up(); }
  return true;
}

async function gotoClean(page, url, waitMs = 1600) {
  // domcontentloaded (not networkidle): several surfaces long-poll and
  // never reach idle, which would stall the clip for the full timeout.
  await page.goto(WEB + url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForLoadState('load', { timeout: 8000 }).catch(() => {});
  await sleep(page, waitMs);
}

// A short synthetic "AI working" beat — mimics the real generating hero,
// speed-ramped so no spinner lingers on camera.
async function generatingBeat(page, label) {
  await page.evaluate((t) => {
    const o = document.createElement('div'); o.id = '__gen';
    o.style.cssText = 'position:fixed;inset:0;z-index:2147483645;background:#f7f5f0;display:flex;'
      + 'flex-direction:column;align-items:center;justify-content:center;font-family:Inter,sans-serif;color:#14130f';
    o.innerHTML = '<div style="width:46px;height:46px;border:4px solid #d9d4c7;border-top-color:#1f5c43;'
      + 'border-radius:50%;animation:__spin .8s linear infinite"></div>'
      + '<div style="margin-top:26px;font-size:28px;font-weight:500">' + t + '</div>'
      + '<style>@keyframes __spin{to{transform:rotate(360deg)}}</style>';
    document.body.appendChild(o);
  }, label);
  await sleep(page, 1100);
  await page.evaluate(() => { const o = document.getElementById('__gen'); if (o) o.remove(); });
}

// ─────────────────────────────── scenes ───────────────────────────────
const SCENES = {
  // 1 · TEACHER — create a class section.
  // The demo section ("Period 6") is created on camera, then removed
  // off-screen (API, no reload) at the end so it never pollutes the
  // later Period-3 insights / grading scenes.
  async '1-section'(page) {
    await deleteDemoSections();
    await gotoClean(page, `/school/teacher/courses/${ID.ALG}`, 1800);
    await cap(page, 'A class section — in seconds.');
    await sleep(page, 1100);
    await go(page, page.getByRole('button', { name: /new section/i }));
    await sleep(page, 900);
    const input = page.locator('input[placeholder="Section name"]');
    await go(page, input, { click: true });
    await input.fill('Period 6', { timeout: 4000 }).catch(() => {});
    await sleep(page, 700);
    await go(page, page.getByRole('button', { name: /^Create$/ }));
    await sleep(page, 1900);
    await cap(page, 'Done. Share the join code with the class.');
    await sleep(page, 2200);
    await capClear(page); await sleep(page, 500);
    await deleteDemoSections();  // off-screen: keep insights/grading on Period 3
  },

  // 2 · TEACHER — add course materials
  async '2-materials'(page) {
    // idempotent: clear any earlier demo upload so the grid stays tidy
    try {
      const h = { Authorization: 'Bearer ' + TOK.teacher.access };
      const docs = await (await fetch(`http://localhost:8001/v1/teacher/courses/${ID.ALG}/documents`, { headers: h })).json();
      const list = docs.documents || docs.items || (Array.isArray(docs) ? docs : []);
      for (const d of list) {
        if ((d.filename || d.name || '').includes('worksheet')) {
          await fetch(`http://localhost:8001/v1/teacher/courses/${ID.ALG}/documents/${d.id}`, { method: 'DELETE', headers: h }).catch(() => {});
        }
      }
    } catch (e) {}
    await gotoClean(page, `/school/teacher/courses/${ID.ALG}?tab=materials`, 1800);
    await cap(page, 'Drop in the materials you already teach from.');
    await sleep(page, 1400);
    const input = page.locator('input[type=file]').first();
    await input.setInputFiles(`${ASSETS}/worksheet.png`).catch(async () => {
      await input.setInputFiles(`${ASSETS}/worksheet.png`).catch(() => {});
    });
    await sleep(page, 2600);
    await cap(page, 'Uploaded — ready to build from.');
    await sleep(page, 2200);
    await capClear(page); await sleep(page, 500);
  },

  // 3 · TEACHER — generate homework, land on 3 problems incl a figure
  async '3-generate'(page) {
    await gotoClean(page, `/school/teacher/courses/${ID.GEO}?tab=homework`, 1700);
    await cap(page, 'Describe the homework once.');
    await sleep(page, 900);
    await go(page, page.getByRole('button', { name: /new homework/i }));
    await sleep(page, 1100);
    const title = page.locator('input[placeholder*="Quadratics"], input[placeholder*="HW"]').first();
    await go(page, title, { click: true });
    await title.fill('Triangles & Angles').catch(() => {});
    await sleep(page, 700);
    // pick the Triangles unit (multi-select chip/button)
    await go(page, page.getByText(/Triangles/).first(), { click: true }).catch(() => {});
    await sleep(page, 600);
    await go(page, page.getByRole('button', { name: /Continue/i }).first(), { click: true }).catch(() => {});
    await sleep(page, 1100);
    // problems step — set count to 3
    const custom = page.locator('input[aria-label="Custom problem count"]');
    if (await custom.count()) {
      await go(page, custom, { click: true });
      await custom.fill('3').catch(() => {});
      await sleep(page, 500);
    }
    const focus = page.locator('input[placeholder*="word problems"], input[placeholder*="Focus"], textarea[placeholder*="Focus"]').first();
    if (await focus.count()) { await go(page, focus, { click: true }); await focus.fill('triangles & angles — include a diagram').catch(() => {}); }
    await sleep(page, 700);
    await cap(page, 'Three problems — and it draws the diagram.');
    await sleep(page, 1200);
    // the AI does the work — cut to the (pre-generated) result
    await generatingBeat(page, 'Generating problems…');
    await gotoClean(page, `/school/teacher/courses/${ID.GEO}/homework/${ID.GEO_HW}`, 1800);
    await page.mouse.wheel(0, 240); await sleep(page, 1400);
    // open the figure problem
    await go(page, page.getByRole('button', { name: /right triangle/i }).first(), { click: true }).catch(async () => {
      await go(page, page.getByText(/right triangle/i).first(), { click: true }).catch(() => {});
    });
    await sleep(page, 2200);
    await cap(page, 'A clean, self-checked figure — every time.');
    await sleep(page, 2400);
    await capClear(page); await sleep(page, 500);
  },

  // 4 · STUDENT — snap a photo, then the understanding chat
  async '4-submit'(page) {
    await gotoClean(page, `/school/student/courses/${ID.ALG}/homework/${ID.SYSTEMS}`, 1700);
    await cap(page, 'The student just snaps a photo of their work.');
    await sleep(page, 1100);
    const fin = page.locator('input[type=file]').first();
    await fin.setInputFiles(`${ASSETS}/handwriting.png`).catch(() => {});
    await sleep(page, 2400);
    await go(page, page.getByRole('button', { name: /review .* turn in/i }).first(), { click: true }).catch(() => {});
    await sleep(page, 1800);
    await capClear(page); await sleep(page, 400);
    // the understanding check (seeded transcript renders in-place)
    await gotoClean(page, `/school/student/courses/${ID.ALG}/homework/${ID.LIN}`, 2200);
    await cap(page, 'Then a short chat checks they really understand.');
    await sleep(page, 1800);
    await page.mouse.wheel(0, 220); await sleep(page, 1700);
    await page.mouse.wheel(0, 220); await sleep(page, 1900);
    await cap(page, 'A right answer no longer means they get it.');
    await sleep(page, 2200);
    await capClear(page); await sleep(page, 500);
  },

  // 5 · TEACHER — grading receipt + class insights
  async '5-grade'(page) {
    await gotoClean(page, `/school/teacher/courses/${ID.ALG}/homework/${ID.LIN}/sections/${ID.SEC}/review?student=${ID.MAYA}`, 2400);
    await cap(page, 'Every problem graded — with a receipt that adds up.');
    await sleep(page, 1500);
    // scroll to the itemized receipt
    await go(page, page.getByText(/itemized/i).first(), { click: false }).catch(() => {});
    await sleep(page, 600);
    await page.mouse.wheel(0, 320); await sleep(page, 2200);
    await capClear(page); await sleep(page, 400);
    // insights
    await gotoClean(page, `/school/teacher/courses/${ID.ALG}?tab=insights`, 2000);
    await cap(page, 'See exactly where the class is struggling.');
    await sleep(page, 2400);
    await page.mouse.wheel(0, 560); await sleep(page, 2000);
    await cap(page, 'And how each student is really doing.');
    await sleep(page, 2200);
    await capClear(page); await sleep(page, 500);
  },

  // 6 · TEACHER — one-click reteach
  async '6-reteach'(page) {
    await gotoClean(page, `/school/teacher/courses/${ID.ALG}?tab=insights`, 2000);
    await cap(page, 'One click turns a weak spot into practice.');
    await sleep(page, 1200);
    await go(page, page.getByRole('button', { name: /re-teach/i }).first(), { click: true }).catch(() => {});
    await sleep(page, 1900);
    await capClear(page); await sleep(page, 300);
    await generatingBeat(page, 'Writing targeted practice…');
    await gotoClean(page, `/school/teacher/courses/${ID.ALG}/homework/${ID.PRACTICE}`, 1900);
    await page.mouse.wheel(0, 220); await sleep(page, 1400);
    await cap(page, 'A targeted set — written for them, automatically.');
    await sleep(page, 2400);
    await capClear(page); await sleep(page, 500);
  },

  // 7 · STUDENT — practice (instant check) + learn (step by step)
  async '7-practice'(page) {
    await gotoClean(page, `/school/student/courses/${ID.ALG}/practice/${ID.PRACTICE}`, 1900);
    await cap(page, 'The student practices — with an instant check.');
    await sleep(page, 1100);
    await go(page, page.getByRole('button', { name: /^Practice/ }).first(), { click: true }).catch(() => {});
    await sleep(page, 1700);
    // correct answer for problem 1 (-(3x-5) = -3x+5) — pick the matching option
    const correct = page.locator('button', { hasText: /3x/ }).filter({ hasText: /\+\s*5|＋5/ });
    await go(page, page.getByRole('button', { name: /D/ }).first(), { click: true }).catch(async () => {
      await go(page, correct.first(), { click: true }).catch(() => {});
    });
    await sleep(page, 2200);
    await cap(page, 'Right away — they know, and they learn.');
    await sleep(page, 1600);
    await capClear(page); await sleep(page, 400);
    // learn — step by step
    await gotoClean(page, `/school/student/courses/${ID.ALG}/practice/${ID.PRACTICE}`, 1500);
    await go(page, page.getByRole('button', { name: /^Learn/ }).first(), { click: true }).catch(() => {});
    await sleep(page, 1900);
    await cap(page, 'Or walks the worked solution, one step at a time.');
    await sleep(page, 1600);
    await go(page, page.getByRole('button', { name: /I understand/i }).first(), { click: true }).catch(() => {});
    await sleep(page, 2200);
    await capClear(page); await sleep(page, 500);
  },
};

// ─────────────────────────────── runner ───────────────────────────────
const WHO = {
  '1-section': 'teacher', '2-materials': 'teacher', '3-generate': 'teacher',
  '4-submit': 'maya', '5-grade': 'teacher', '6-reteach': 'teacher', '7-practice': 'maya',
};

const want = process.argv.slice(2);
const ids = (want.length ? want : Object.keys(SCENES));

global.__b = await chromium.launch({ executablePath: CACHED || undefined, headless: true, args: ['--disable-gpu'] });
for (const id of ids) {
  const ctx = await newCtx(WHO[id]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERR ' + e.message));
  try {
    await SCENES[id](page);
  } catch (e) {
    console.log(`scene ${id} threw:`, e.message);
  }
  const vp = await page.video().path();
  await ctx.close(); // finalizes the webm
  const dest = path.join(OUT, `scene-${id}.webm`);
  fs.renameSync(vp, dest);
  console.log(`scene ${id}: ${dest}  (console errors: ${errors.length})`);
  if (errors.length) errors.slice(0, 4).forEach(e => console.log('   !', e));
}
await global.__b.close();
