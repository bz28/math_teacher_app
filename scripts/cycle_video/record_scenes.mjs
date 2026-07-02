// Record the Veradic teacher<->student cycle as individual 1920x1080
// webm clips. A synthetic cursor + on-brand lower-third captions make
// every interaction read clearly. Each clip gets its own browser context
// (one webm), so the assembler can trim + cross-fade them independently.
//
// Production rules baked in (v2):
//  · Zero on-camera waits — AI latency is bridged by a branded veil, not
//    a spinner. No "Generating…" text ever hits the frame.
//  · Settled screens only — every clip waits for a real content anchor to
//    be visible + still before the caption/hold.
//  · One steady framing per clip — the app is enlarged via document.body
//    zoom set ONCE right after the navigation (before anything is on
//    camera) and held; it never animates on already-visible content.
//    Clicks under zoom use in-page getBoundingClientRect (zoom-aware), so
//    the synthetic cursor + the real click always agree.
//
//   TOKENS=$(python -m scripts.cycle_video.mint_tokens) \
//   node scripts/cycle_video/record_scenes.mjs [clipId ...]
import { chromium } from 'playwright';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const WEB = process.env.WEB_BASE || 'http://localhost:3000';
const API = process.env.API_BASE || 'http://localhost:8000';
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
  JORDAN: '0f63c477-12f8-4cbc-b4dc-ad62642f2cdc',
  SOCCER: '5e0c7a11-50cc-4bb0-9e11-50cc0a11500c',
};
const ALG_LINEAR_UNIT = '5547f6d5-0487-4174-bae0-a25908900c68';

const VIEW = { width: 1920, height: 1080 };
const sleep = (p, ms) => p.waitForTimeout(ms);

// Synthetic cursor + caption overlay + chrome-hider, injected before app
// JS so they survive client navigations. Mounted on <html>, outside the
// <body> that scene zoom scales — so caption + cursor stay native-sized.
const INIT = `
(() => {
  const ROOT = () => document.documentElement;
  function ensure() {
    if (!document.getElementById('__cur')) {
      const c = document.createElement('div'); c.id='__cur';
      c.style.cssText='position:fixed;z-index:2147483647;width:22px;height:22px;left:-50px;top:-50px;'
        +'border-radius:50%;background:rgba(31,92,67,.28);border:2px solid #1f5c43;'
        +'pointer-events:none;transition:transform .05s linear;box-shadow:0 1px 6px rgba(0,0,0,.18)';
      ROOT().appendChild(c);
    }
    if (!document.getElementById('__cap')) {
      // Premium broadcast lower-third: charcoal glass card, sienna accent
      // bar, paper-white type, eased rise-in. Sized generously so it stays
      // crisp after the assembler floats/shrinks the app clip.
      const w = document.createElement('div'); w.id='__cap';
      w.style.cssText='position:fixed;z-index:2147483646;left:50%;bottom:62px;transform:translateX(-50%) translateY(12px);'
        +'opacity:0;transition:opacity .55s cubic-bezier(.22,.61,.36,1), transform .55s cubic-bezier(.22,.61,.36,1);'
        +'pointer-events:none;display:flex;align-items:center;gap:20px;'
        +'background:rgba(18,17,14,.9);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);'
        +'color:#f7f5f0;padding:17px 34px 17px 28px;border-radius:16px;'
        +'border:1px solid rgba(247,245,240,.09);'
        +'font-family:Inter,system-ui,sans-serif;font-size:32px;font-weight:500;letter-spacing:.003em;'
        +'box-shadow:0 22px 60px rgba(18,17,14,.4);max-width:1560px';
      const bar=document.createElement('span');
      bar.style.cssText='width:4px;align-self:stretch;min-height:34px;border-radius:3px;background:#b8431a;flex:0 0 auto';
      const txt=document.createElement('span'); txt.id='__captxt';
      w.appendChild(bar); w.appendChild(txt); ROOT().appendChild(w);
    }
    // A full-frame brand veil used to bridge AI work AND every navigation.
    // Default OPAQUE so no loading skeleton / spinner / half-painted frame
    // is ever seen — each scene fades in from clean paper once its real
    // content has settled (gotoClean lifts it after the anchor + hold).
    if (!document.getElementById('__veil')) {
      const v=document.createElement('div'); v.id='__veil';
      v.style.cssText='position:fixed;inset:0;z-index:2147483645;background:#f7f5f0;'
        +'opacity:1;transition:opacity .45s ease;pointer-events:none';
      ROOT().appendChild(v);
    }
  }
  window.__moveCur=(x,y)=>{const c=document.getElementById('__cur');if(c)c.style.transform='translate('+x+'px,'+y+'px)';};
  document.addEventListener('mousemove',e=>window.__moveCur(e.clientX-11,e.clientY-11));
  window.__cap=(t)=>{ensure();const w=document.getElementById('__cap');const x=document.getElementById('__captxt');
    if(x)x.textContent=t; if(w){w.style.opacity='1';w.style.transform='translateX(-50%) translateY(0)';}};
  window.__capClear=()=>{const w=document.getElementById('__cap');if(w){w.style.opacity='0';w.style.transform='translateX(-50%) translateY(8px)';}};
  window.__veilOn=()=>{ensure();const v=document.getElementById('__veil');if(v)v.style.opacity='1';};
  window.__veilOff=()=>{const v=document.getElementById('__veil');if(v)v.style.opacity='0';};
  const HIDE_LABELS=['Take the tour','Try as Student','Try as student'];
  function hideChrome(){
    if(!document.getElementById('__hidecss')){
      const s=document.createElement('style'); s.id='__hidecss';
      s.textContent='nextjs-portal{display:none!important}[data-nextjs-toast]{display:none!important}'
        +'[data-next-badge]{display:none!important}[data-next-badge-root]{display:none!important}';
      (document.head||document.documentElement).appendChild(s);
    }
    document.querySelectorAll('nextjs-portal').forEach(e=>e.remove());
    document.querySelectorAll('a,button').forEach(el=>{
      const t=(el.textContent||'').trim();
      if(HIDE_LABELS.includes(t)) el.style.setProperty('display','none','important');
    });
  }
  window.__hideChrome=hideChrome;
  function boot(){ ensure(); hideChrome();
    try{ if(document.documentElement) new MutationObserver(()=>{ensure();hideChrome();}).observe(document.documentElement,{childList:true,subtree:true}); }catch(e){} }
  if (document.readyState!=='loading') boot(); else document.addEventListener('DOMContentLoaded', boot);
})();
`;

async function newCtx(who, view = VIEW) {
  const browser = global.__b;
  const dir = path.join(OUT, `_rec_${who}_${Date.now()}`);
  const ctx = await browser.newContext({
    viewport: view, deviceScaleFactor: 1,
    recordVideo: { dir, size: view },
  });
  const t = TOK[who];
  await ctx.addInitScript(([a, r]) => {
    try { localStorage.setItem('veradic_access_token', a); localStorage.setItem('veradic_refresh_token', r); } catch (e) {}
  }, [t.access, t.refresh]);
  await ctx.addInitScript(INIT);
  return ctx;
}

async function apiDelete(url) {
  try { await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer ' + TOK.teacher.access } }); } catch (e) {}
}
// Remove every section except Period 3 via the API (off-screen) so the
// insights/grading scenes stay on the curated roster.
async function deleteDemoSections() {
  try {
    const h = { Authorization: 'Bearer ' + TOK.teacher.access };
    const r = await (await fetch(`${API}/v1/teacher/courses/${ID.ALG}/sections`, { headers: h })).json();
    const list = r.sections || (Array.isArray(r) ? r : []);
    for (const sec of list) if (sec.name !== 'Period 3')
      await apiDelete(`${API}/v1/teacher/courses/${ID.ALG}/sections/${sec.id}`);
  } catch (e) {}
}

async function cap(page, text) { await page.evaluate((t) => window.__cap && window.__cap(t), text); }
async function capClear(page) { await page.evaluate(() => window.__capClear && window.__capClear()); }
async function veilOn(page) { await page.evaluate(() => window.__veilOn && window.__veilOn()); }
async function veilOff(page) { await page.evaluate(() => window.__veilOff && window.__veilOff()); }

// Enlarge the app to one steady size for the whole clip. Set ONLY right
// after a navigation (before content is on camera) so it never animates
// on visible content.
async function setZoom(page, z) { await page.evaluate((v) => { document.body.style.zoom = String(v); }, z); }

// In-page, zoom-aware rect of an element's click point.
async function rectOf(locator) {
  return await locator.evaluate((el) => {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + Math.min(r.height / 2, 24) };
  });
}

// Cursor glides along a gently bowed, eased path (easeInOutQuad on a
// quadratic bézier) so motion reads human/cinematic, never a robotic
// straight-line jump. Last position is tracked so each move eases from
// wherever the cursor actually is.
let CUR = { x: VIEW.width / 2, y: VIEW.height / 2 };
async function curveMove(page, x, y, steps = 32) {
  const sx = CUR.x, sy = CUR.y, dx = x - sx, dy = y - sy;
  const dist = Math.hypot(dx, dy) || 1;
  const bow = Math.min(130, dist * 0.16);           // perpendicular arc
  const mx = (sx + x) / 2 - (dy / dist) * bow;
  const my = (sy + y) / 2 + (dx / dist) * bow;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;  // easeInOutQuad
    const ix = (1 - e) * (1 - e) * sx + 2 * (1 - e) * e * mx + e * e * x;
    const iy = (1 - e) * (1 - e) * sy + 2 * (1 - e) * e * my + e * e * y;
    await page.mouse.move(ix, iy);
    await sleep(page, 9);
  }
  CUR = { x, y };
}

// Move the synthetic cursor smoothly to an element and (optionally)
// click — zoom-safe. Bounded: a missing locator is skipped, never stalls.
async function go(page, locator, { click = true, settle = 520, find = 4000 } = {}) {
  const el = locator.first();
  try { await el.waitFor({ state: 'visible', timeout: find }); }
  catch { return false; }
  await sleep(page, 220);
  let r; try { r = await rectOf(el); } catch { return false; }
  await sleep(page, 160);
  await curveMove(page, r.x, r.y);
  await sleep(page, settle);
  if (click) { await page.mouse.move(r.x, r.y); await page.mouse.down(); await sleep(page, 80); await page.mouse.up(); }
  return true;
}

// Navigate under the opaque veil, settle the real content, optionally run
// a `beforeReveal` mutation (e.g. hide chat bubbles so the scene starts
// empty) while still hidden, THEN fade the paper away onto clean content.
async function gotoClean(page, url, { zoom = 1, waitMs = 1500, anchor = null, beforeReveal = null } = {}) {
  await veilOn(page).catch(() => {});
  await page.goto(WEB + url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForLoadState('load', { timeout: 8000 }).catch(() => {});
  await veilOn(page).catch(() => {});   // re-assert on the fresh document
  await setZoom(page, zoom);
  if (anchor) { try { await page.locator(anchor).first().waitFor({ state: 'visible', timeout: 9000 }); } catch {} }
  await sleep(page, waitMs);
  if (beforeReveal) { try { await beforeReveal(); } catch {} await sleep(page, 200); }
  await veilOff(page);
  await sleep(page, 300);
}

// ─────────────────────────────── clips ───────────────────────────────
const CLIPS = {
  // 1 · TEACHER — create a class section.
  async '1-section'(page) {
    await deleteDemoSections();
    await gotoClean(page, `/school/teacher/courses/${ID.ALG}`, { zoom: 1.1, waitMs: 1400, anchor: 'text=/Period 3/i' });
    await cap(page, 'A class section — in seconds.');
    await sleep(page, 1100);
    await go(page, page.getByRole('button', { name: /new section/i }));
    await sleep(page, 800);
    const input = page.locator('input[placeholder="Section name"]');
    await go(page, input, { click: true });
    await input.fill('Period 6', { timeout: 4000 }).catch(() => {});
    await sleep(page, 700);
    await go(page, page.getByRole('button', { name: /^Create$/ }));
    await sleep(page, 1700);
    await cap(page, 'Done — share the join code with the class.');
    await sleep(page, 2100);
    await capClear(page); await sleep(page, 500);
    await deleteDemoSections();
  },

  // 2 · TEACHER — add course materials by UPLOADING a worksheet on
  //      camera: glide to Upload, attach, watch it land in the list
  //      (no magic appearance). One warm-up material is pre-seeded so
  //      the grid visibly goes 1 → 2 files.
  async '2-materials'(page) {
    try {
      // Idempotent: remove prior on-camera uploads (the seeded warm-up
      // "Warm-up — solving equations.png" is preserved).
      const h = { Authorization: 'Bearer ' + TOK.teacher.access };
      const docs = await (await fetch(`${API}/v1/teacher/courses/${ID.ALG}/documents`, { headers: h })).json();
      const list = docs.documents || docs.items || (Array.isArray(docs) ? docs : []);
      for (const d of list) if ((d.filename || d.name || '') === 'worksheet.png')
        await apiDelete(`${API}/v1/teacher/courses/${ID.ALG}/documents/${d.id}`);
    } catch (e) {}
    await gotoClean(page, `/school/teacher/courses/${ID.ALG}?tab=materials`, { zoom: 1.1, waitMs: 1500 });
    await cap(page, 'Drop in the materials you already teach from.');
    await sleep(page, 1300);
    // Glide the cursor to the Upload control so the upload reads as a
    // real click, not a file teleporting in. (We don't fire the click —
    // it would open the OS picker, which can't be filmed headless — we
    // stage the file straight into the same input the picker feeds.)
    await go(page, page.getByRole('button', { name: /^Upload Files$/i }).first(), { click: false }).catch(() => {});
    await sleep(page, 300);
    const input = page.locator('input[type=file]').first();
    await input.setInputFiles(`${ASSETS}/worksheet.png`).catch(() => {});
    // The grid goes 1 → 2 files + an "Uploaded 1 file" toast — the
    // upload transition, on camera.
    await sleep(page, 1900);
    await cap(page, 'Uploaded — ready to build from.');
    await sleep(page, 2000);
    await capClear(page); await sleep(page, 500);
  },

  // 3a · TEACHER — the REAL new-homework wizard, all four steps, in
  //      order: Details → Problems (type a "soccer" focus) → Grading →
  //      Review. Breezed through so completeness reads as "look how
  //      fast," then a veil-cut to the pre-generated soccer problems.
  async '3-generate'(page) {
    // One steady framing for the whole scene — zoom set on the homework
    // tab before the modal is on camera, then held (no mid-scene zoom).
    await gotoClean(page, `/school/teacher/courses/${ID.ALG}?tab=homework`, { zoom: 1.15, waitMs: 1200 });
    await cap(page, 'New homework — start to finish.');
    await sleep(page, 700);
    await go(page, page.getByRole('button', { name: /new homework/i }).first());
    // Wait for the wizard's Step 1 (Details) to settle.
    const dialog = page.getByRole('dialog', { name: /new homework/i });
    await dialog.waitFor({ state: 'visible', timeout: 9000 }).catch(() => {});
    await sleep(page, 700);

    // ── Step 1 · Details — title + pick the unit. Breeze through. ──
    await cap(page, 'Name it, pick the unit.');
    const title = dialog.locator('input[placeholder*="Quadratics"], input[type="text"]').first();
    if (await title.count()) {
      await go(page, title, { click: true });
      await title.pressSequentially('Soccer word problems', { delay: 30 }).catch(() => {});
    }
    await sleep(page, 400);
    // The "Linear Equations" unit chip (a real click, shown).
    await go(page, dialog.getByRole('button', { name: /^✓?\s*Linear Equations$/ }).first(), { click: true }).catch(() => {});
    await sleep(page, 600);
    await go(page, dialog.getByRole('button', { name: /Continue/i }).first(), { click: true }).catch(() => {});
    await sleep(page, 500);

    // ── Step 2 · Problems — pick a count (3), TYPE the "soccer" focus,
    //      and select the uploaded worksheet as a source. ──
    // Count → a custom 3, so the wizard, the Review summary, and the
    // generated set all agree on 3.
    await cap(page, 'How many? Just three today.');
    const countInput = dialog.locator('input[aria-label="Custom problem count"]').first();
    if (await countInput.count()) {
      await go(page, countInput, { click: true });
      await countInput.fill('3').catch(() => {});
      await sleep(page, 900);
    }
    await cap(page, 'Set a focus — just type it.');
    const focus = dialog.locator('input[placeholder*="word problems"], textarea[placeholder*="word problems"]').first();
    if (await focus.count()) {
      await go(page, focus, { click: true });
      await focus.pressSequentially('soccer', { delay: 95 }).catch(() => {});
      await sleep(page, 900);
    } else { await sleep(page, 800); }
    // Source material — click the worksheet uploaded in scene 2 so it's
    // visibly chosen as the generation source ("1 of 2 selected").
    await cap(page, 'Build from your own worksheet — one click.');
    const srcRow = dialog.getByText('worksheet.png', { exact: true }).first();
    await go(page, srcRow, { click: true }).catch(() => {});
    await sleep(page, 1600);
    await go(page, dialog.getByRole('button', { name: /Continue/i }).first(), { click: true }).catch(() => {});
    await sleep(page, 500);

    // ── Step 3 · Grading — the rubric, sensible defaults already in. ──
    await cap(page, 'Grading rubric — defaults ready.');
    await sleep(page, 1300);
    await go(page, dialog.getByRole('button', { name: /Continue/i }).first(), { click: true }).catch(() => {});
    await sleep(page, 500);

    // ── Step 4 · Review — one last look, then create. ──
    await cap(page, 'One last look — then create.');
    await sleep(page, 1600);
    // Glide the cursor to "Create & generate" but DON'T fire a live job
    // — bridge the AI write with the brand veil and land on the real,
    // pre-generated soccer set. No spinner ever hits the frame.
    await go(page, dialog.getByRole('button', { name: /Create & generate/i }).first(), { click: false }).catch(() => {});
    await sleep(page, 700);
    await capClear(page); await sleep(page, 300);

    // Anchor on a REAL problem line (not the word "soccer", which paints
    // in the title before the set loads) so the veil never lifts onto a
    // "Loading…" frame.
    await gotoClean(page, `/school/teacher/courses/${ID.ALG}/homework/${ID.SOCCER}`,
      { zoom: 1.18, waitMs: 2400, anchor: 'text=/Amara|striker|goals|match/i' });
    await page.mouse.wheel(0, 150); await sleep(page, 600);
    await cap(page, 'Every problem — themed to soccer.');
    await sleep(page, 2200);
    await page.mouse.wheel(0, 170); await sleep(page, 1600);
    await capClear(page); await sleep(page, 400);
  },

  // 3b · TEACHER — open a generated problem to reveal its worked solution
  //      + verified final answer (proof it makes answer keys, not just Qs).
  async '3-solution'(page) {
    await gotoClean(page, `/school/teacher/courses/${ID.ALG}/homework/${ID.SOCCER}`,
      { zoom: 1.0, waitMs: 1400, anchor: 'text=/Amara/i' });
    await cap(page, 'Open any problem —');
    await sleep(page, 900);
    await go(page, page.getByText(/striker Amara scored/i).first(), { click: true }).catch(() => {});
    await sleep(page, 1500);
    await go(page, page.getByText(/show solution/i).first(), { click: true }).catch(() => {});
    await sleep(page, 1400);
    await cap(page, '— a full worked solution and a verified answer key.');
    await sleep(page, 3000);
    await capClear(page); await sleep(page, 500);
  },

  // 3c+3d · TEACHER — a self-checked geometry figure, then reshape it in
  //      plain English (AI Workshop) and watch it redraw + re-verify. The
  //      reshape proposal is pre-warmed off-camera (workshop_prewarm.py)
  //      so it lands instantly — no thinking spinner on camera.
  async '3-figure'(page) {
    await gotoClean(page, `/school/teacher/courses/${ID.GEO}/homework/${ID.GEO_HW}`,
      { zoom: 1.0, waitMs: 1400, anchor: 'text=/right triangle/i' });
    await cap(page, 'Geometry? A clean, self-checked figure.');
    await sleep(page, 900);
    await go(page, page.getByText(/right triangle/i).first(), { click: true }).catch(() => {});
    // Modal opens straight into the pre-warmed proposal: before + redraw.
    await page.getByRole('button', { name: /^Accept$/ }).first().waitFor({ state: 'visible', timeout: 9000 }).catch(() => {});
    await sleep(page, 1400);
    await cap(page, 'Reshape it in plain English — "change the legs to 9 and 12."');
    await sleep(page, 2600);
    // Scroll from the "Before" figure down to the freshly redrawn one.
    await page.mouse.wheel(0, 300); await sleep(page, 1900);
    await cap(page, 'The figure redraws — and re-verifies the answer to AB = 15.');
    await sleep(page, 2800);
    // The WHOLE problem regenerates — not just the picture. Expand the
    // worked solution and reveal the rewritten steps (before → after)
    // so it's clear the answer key is re-derived too.
    await go(page, page.getByText(/Show solution/i).first(), { click: true }).catch(() => {});
    await sleep(page, 1000);
    await cap(page, 'And the worked solution rewrites itself — every step re-derived.');
    await page.mouse.wheel(0, 360); await sleep(page, 2600);
    await page.mouse.wheel(0, 340); await sleep(page, 2600);
    await capClear(page); await sleep(page, 500);
  },

  // 4a · STUDENT (Jordan) — his own screen: attach a photo of the work
  //      and turn it in. Framed unmistakably as the student's view; the
  //      attached work is staged (no live extraction wait on camera).
  async '4-submit'(page) {
    await gotoClean(page, `/school/student/courses/${ID.ALG}/homework/${ID.SYSTEMS}`,
      { zoom: 1.16, waitMs: 1300 });
    await cap(page, "This is the student's screen.");
    await sleep(page, 1200);
    // Bring the "Submit your homework" attach panel into view first, so
    // the file is shown being ATTACHED — not sitting there pre-attached.
    await page.getByText(/Submit your homework/i).first().scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {});
    await page.mouse.wheel(0, 120); await sleep(page, 800);
    await cap(page, 'Snap a photo of your work — attach it.');
    // Glide to the attach dropzone (don't fire the click — it opens the
    // un-filmable OS picker — stage into the same input it feeds), then
    // the staged page row appears live: attaching → attached.
    await go(page, page.getByRole('button', { name: /Add files/i }).first(), { click: false }).catch(() => {});
    await sleep(page, 300);
    const fin = page.locator('input[type=file]').first();
    await fin.setInputFiles(`${ASSETS}/handwriting.png`).catch(() => {});
    await sleep(page, 1600);
    await cap(page, 'Attached — Page 1 · handwriting.png.');
    await sleep(page, 2200);
    // Open the confirm ("your teacher will see exactly this") — glide
    // the cursor, then commit with a reliable element-level click
    // (never submits / triggers a live extraction wait). Element click
    // is used because a synthetic mouse click under zoom can miss the
    // small CTA.
    const turnInBtn = page.getByRole('button', { name: /review .* turn in/i }).first();
    await go(page, turnInBtn, { click: false }).catch(() => {});
    await turnInBtn.click({ timeout: 3000 }).catch(() => {});
    await sleep(page, 1000);
    await page.getByText(/Ready to turn it in/i).first().scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    await sleep(page, 700);
    await cap(page, 'Your teacher sees exactly what you turn in.');
    await sleep(page, 3000);
    await capClear(page); await sleep(page, 500);
  },

  // 4b · STUDENT (Jordan) — the understanding check. He got the answer
  //      RIGHT, but as the chat reveals turn-by-turn he can't explain a
  //      single step. The AI stays warm to him the whole way (the catch
  //      is surfaced privately to the teacher in 4-verdict).
  async '4-chat'(page) {
    // Hide every chat bubble + the closing verdict WHILE the veil is still
    // up (beforeReveal), so the scene fades in on an EMPTY thread — no
    // pre-flash of the full conversation — then reveals one turn at a time.
    await gotoClean(page, `/school/student/courses/${ID.ALG}/homework/${ID.LIN}`,
      { zoom: 1.0, waitMs: 1800, anchor: 'text=/understanding check/i',
        beforeReveal: () => page.evaluate(() => {
          const bubbles = Array.from(document.querySelectorAll('div')).filter((d) =>
            /\bjustify-(start|end)\b/.test(d.className) &&
            d.parentElement && Array.from(d.parentElement.children).filter((c) =>
              /\bjustify-(start|end)\b/.test(c.className)).length >= 3);
          // De-dupe to the true bubble row set (largest sibling group).
          let cont = null, best = 0;
          bubbles.forEach((b) => {
            const n = Array.from(b.parentElement.children).filter((c) => /\bjustify-(start|end)\b/.test(c.className)).length;
            if (n > best) { best = n; cont = b.parentElement; }
          });
          window.__rows = cont ? Array.from(cont.children).filter((c) => /\bjustify-(start|end)\b/.test(c.className)) : [];
          window.__term = Array.from(document.querySelectorAll('div,section')).find((d) =>
            /Thanks for walking me through/i.test(d.textContent || '') &&
            (d.textContent || '').length < 400) || null;
          [...window.__rows, window.__term].forEach((el) => { if (el) { el.style.transition = 'opacity .45s ease, transform .45s ease'; el.style.opacity = '0'; el.style.transform = 'translateY(12px)'; } });
          window.__scroller = cont;
          while (window.__scroller && window.__scroller.scrollHeight <= window.__scroller.clientHeight + 10)
            window.__scroller = window.__scroller.parentElement;
        }) });
    await cap(page, 'Then a quick check — is the work really yours?');
    await sleep(page, 900);
    const n = await page.evaluate(() => (window.__rows || []).length);
    for (let i = 0; i < n; i++) {
      await page.evaluate((idx) => {
        const el = window.__rows[idx];
        if (el) { el.style.opacity = '1'; el.style.transform = 'none'; el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      }, i);
      // Swap the caption partway so the viewer reads the turn — the
      // answer was right, but the "why" keeps coming up empty.
      if (i === 1) { await cap(page, 'Just explain your thinking, in your own words.'); }
      if (i === 3) { await cap(page, 'The answer’s right — but the “why” keeps coming up empty.'); }
      await sleep(page, i % 2 === 1 ? 1750 : 1300);
    }
    await sleep(page, 800);
    // The chat is recorded live (in_progress) so it ends on the
    // student's last hollow answer — no closing panel. The AI stayed
    // warm the whole way; the catch is surfaced to the teacher next.
    await cap(page, "Right answer — and not one step he can explain.");
    await sleep(page, 3000);
    await capClear(page); await sleep(page, 1400);
  },

  // 4c · TEACHER — the CATCH. Same submission, the teacher's review: a
  //      correct answer on a perfect grade, quietly flagged — the thing
  //      a grade can never do. Lands on the resolved red verdict banner.
  async '4-verdict'(page) {
    await gotoClean(page, `/school/teacher/courses/${ID.ALG}/homework/${ID.LIN}/sections/${ID.SEC}/review?student=${ID.JORDAN}`,
      { zoom: 1.12, waitMs: 2000, anchor: 'text=/Jordan/i' });
    await cap(page, 'You see the catch a grade never could.');
    await sleep(page, 1600);
    // Bring the integrity flag banner into view and hold on it.
    await page.evaluate(() => { const e = Array.from(document.querySelectorAll('*')).find((n) => /couldn.t explain the steps/i.test(n.textContent || '') && n.children.length < 8); if (e) e.scrollIntoView({ block: 'center' }); });
    await sleep(page, 1200);
    await cap(page, 'Correct answer — but he couldn’t explain it.');
    await sleep(page, 3000);
    // Behavior context CORROBORATES the flag (never replaces it): the
    // "Activity during the integrity check" digest sits right below the
    // banner — pasted answer + tabbed out. Bring it into view and frame
    // it honestly as supporting evidence, not the verdict itself.
    await page.evaluate(() => {
      const e = Array.from(document.querySelectorAll('*')).find((n) =>
        /Activity during the integrity check/i.test(n.textContent || '') &&
        n.children.length < 8);
      if (e) e.scrollIntoView({ block: 'center' });
    });
    await sleep(page, 900);
    await cap(page, 'Behavior backs it up — pasted the answer, switched tabs — the read is still the call.');
    await sleep(page, 3400);
    await cap(page, 'Warm to the student, honest with you.');
    await sleep(page, 2400);
    await capClear(page); await sleep(page, 600);
  },

  // 5a · TEACHER — the itemized grading receipt (math that adds up) + the
  //      teacher setting the call per item + the resolved integrity verdict.
  async '5-grade'(page) {
    await gotoClean(page, `/school/teacher/courses/${ID.ALG}/homework/${ID.LIN}/sections/${ID.SEC}/review?student=${ID.MAYA}`,
      { zoom: 1.12, waitMs: 2000, anchor: 'text=/Maya/i' });
    await cap(page, 'Every problem graded — with a receipt that adds up.');
    await sleep(page, 1600);
    // Expand problem 3's confident row to reveal its itemized receipt.
    // Glide the cursor there, then commit with a single element-level
    // click (reliable on the small target under zoom; a second mouse
    // click would just toggle it back shut).
    const expandBtn = page.getByRole('button', { name: /Expand problem 3 to inspect/i }).first();
    await go(page, expandBtn, { click: false }).catch(() => {});
    await expandBtn.click({ timeout: 3000 }).catch(() => {});
    await sleep(page, 1300);
    // Scroll the itemized ledger (Why 73% — itemized) into view.
    await page.getByText(/itemized/i).first().scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    await page.mouse.wheel(0, 150);
    await sleep(page, 1400);
    await cap(page, '100 − 20 for a sign error − 7 for arithmetic = 73%.');
    await sleep(page, 3400);
    await cap(page, 'The AI proposes — but you set full, partial, or none.');
    await sleep(page, 2800);
    // The resolved integrity verdict at the top (no spinner — a verdict).
    await page.evaluate(() => { const e = Array.from(document.querySelectorAll('*')).find((n) => /method in her own words/i.test(n.textContent || '') && n.children.length < 8); if (e) e.scrollIntoView({ block: 'center' }); });
    await sleep(page, 1200);
    await cap(page, 'And the understanding check comes back resolved.');
    await sleep(page, 2400);
    await capClear(page); await sleep(page, 600);
  },

  // 5b · TEACHER — class insights: per-concept struggle + per-student roster.
  async '5-insights'(page) {
    await gotoClean(page, `/school/teacher/courses/${ID.ALG}?tab=insights`, { zoom: 1.12, waitMs: 1800 });
    await cap(page, 'See exactly where the class is struggling.');
    await sleep(page, 2400);
    await page.mouse.wheel(0, 520); await sleep(page, 1800);
    await cap(page, 'And how each student is really doing.');
    await sleep(page, 2200);
    await capClear(page); await sleep(page, 500);
  },

  // 6 · TEACHER — one-click reteach → targeted practice set.
  async '6-reteach'(page) {
    await gotoClean(page, `/school/teacher/courses/${ID.ALG}?tab=insights`, { zoom: 1.12, waitMs: 1600 });
    await cap(page, 'One click turns a weak spot into practice.');
    await sleep(page, 1200);
    await go(page, page.getByRole('button', { name: /re-teach|reteach/i }).first(), { click: true }).catch(() => {});
    await sleep(page, 1200);
    await capClear(page); await sleep(page, 200);
    await gotoClean(page, `/school/teacher/courses/${ID.ALG}/homework/${ID.PRACTICE}`,
      { zoom: 1.15, waitMs: 1600, anchor: 'text=/distribut/i' });
    await page.mouse.wheel(0, 160); await sleep(page, 1200);
    await cap(page, 'A targeted set — written for them, automatically.');
    await sleep(page, 2600);
    await capClear(page); await sleep(page, 500);
  },

  // 7a · STUDENT — practice with an instant check.
  async '7-practice'(page) {
    await gotoClean(page, `/school/student/courses/${ID.ALG}/practice/${ID.PRACTICE}`,
      { zoom: 1.15, waitMs: 1700 });
    await cap(page, 'The student practices — with an instant check.');
    await sleep(page, 1100);
    await go(page, page.getByRole('button', { name: /^Practice/ }).first(), { click: true }).catch(() => {});
    await sleep(page, 1600);
    // The correct answer to −(3x−5) is −3x+5 — the ONLY option whose
    // math contains a "+". Find that option button (KaTeX renders the
    // text into spans, so match on textContent) and click it, so the
    // instant check lands on "Correct".
    const pick = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const opt = btns.find((b) => /[+＋]/.test(b.textContent || '') && /3x/.test(b.textContent || '') && (b.textContent || '').length < 40);
      if (!opt) return null;
      opt.scrollIntoView({ block: 'center' });
      const r = opt.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (pick) { await page.mouse.move(pick.x, pick.y, { steps: 22 }); await sleep(page, 420); await page.mouse.click(pick.x, pick.y); }
    await sleep(page, 2200);
    await cap(page, 'Right away — they know, and they learn.');
    await sleep(page, 1800);
    await capClear(page); await sleep(page, 500);
  },

  // 7b · STUDENT — Learn: the worked solution, one step at a time.
  async '7-learn'(page) {
    await gotoClean(page, `/school/student/courses/${ID.ALG}/practice/${ID.PRACTICE}`,
      { zoom: 1.15, waitMs: 1500 });
    await go(page, page.getByRole('button', { name: /^Learn/ }).first(), { click: true }).catch(() => {});
    await sleep(page, 1800);
    await cap(page, 'Or walks the worked solution, one step at a time.');
    await sleep(page, 1800);
    await go(page, page.getByRole('button', { name: /I understand|Next|Continue/i }).first(), { click: true }).catch(() => {});
    await sleep(page, 2200);
    await capClear(page); await sleep(page, 500);
  },
};

// ─────────────────────────────── runner ───────────────────────────────
const WHO = {
  '1-section': 'teacher', '2-materials': 'teacher', '3-generate': 'teacher',
  '3-solution': 'teacher', '3-figure': 'teacher', '4-submit': 'jordan',
  '4-chat': 'jordan', '4-verdict': 'teacher', '5-grade': 'teacher',
  '5-insights': 'teacher', '6-reteach': 'teacher', '7-practice': 'maya',
  '7-learn': 'maya',
};

const want = process.argv.slice(2);
const ids = (want.length ? want : Object.keys(CLIPS));

global.__b = await chromium.launch({ executablePath: CACHED || undefined, headless: true, args: ['--disable-gpu'] });
for (const id of ids) {
  const ctx = await newCtx(WHO[id]);
  const page = await ctx.newPage();
  CUR = { x: VIEW.width / 2, y: VIEW.height / 2 };   // reset cursor per clip
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERR ' + e.message));
  try { await CLIPS[id](page); }
  catch (e) { console.log(`clip ${id} threw:`, e.message); }
  const vp = await page.video().path();
  await ctx.close();
  const dest = path.join(OUT, `scene-${id}.webm`);
  fs.renameSync(vp, dest);
  console.log(`clip ${id}: ${dest}  (console errors: ${errors.length})`);
  if (errors.length) errors.slice(0, 3).forEach(e => console.log('   !', e));
}
await global.__b.close();
