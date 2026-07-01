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
      const w = document.createElement('div'); w.id='__cap';
      w.style.cssText='position:fixed;z-index:2147483646;left:50%;bottom:54px;transform:translateX(-50%) translateY(8px);'
        +'opacity:0;transition:opacity .5s ease, transform .5s ease;pointer-events:none;'
        +'display:flex;align-items:center;gap:14px;background:rgba(20,19,15,.93);color:#f7f5f0;'
        +'padding:15px 30px;border-radius:16px;font-family:Inter,system-ui,sans-serif;font-size:27px;'
        +'font-weight:500;letter-spacing:.005em;box-shadow:0 10px 40px rgba(0,0,0,.28);max-width:1500px';
      const dot=document.createElement('span');
      dot.style.cssText='width:11px;height:11px;border-radius:50%;background:#b8431a;flex:0 0 auto';
      const txt=document.createElement('span'); txt.id='__captxt';
      w.appendChild(dot); w.appendChild(txt); ROOT().appendChild(w);
    }
    // A full-frame brand veil used to bridge AI work — fades over the
    // screen so no spinner/loading frame is ever seen.
    if (!document.getElementById('__veil')) {
      const v=document.createElement('div'); v.id='__veil';
      v.style.cssText='position:fixed;inset:0;z-index:2147483645;background:#f7f5f0;'
        +'opacity:0;transition:opacity .4s ease;pointer-events:none';
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

// Move the synthetic cursor smoothly to an element and (optionally)
// click — zoom-safe. Bounded: a missing locator is skipped, never stalls.
async function go(page, locator, { click = true, settle = 520, find = 4000 } = {}) {
  const el = locator.first();
  try { await el.waitFor({ state: 'visible', timeout: find }); }
  catch { return false; }
  await sleep(page, 220);
  let r; try { r = await rectOf(el); } catch { return false; }
  await sleep(page, 160);
  await page.mouse.move(r.x, r.y, { steps: 26 });
  await sleep(page, settle);
  if (click) { await page.mouse.move(r.x, r.y); await page.mouse.down(); await sleep(page, 80); await page.mouse.up(); }
  return true;
}

async function gotoClean(page, url, { zoom = 1, waitMs = 1500, anchor = null } = {}) {
  await veilOn(page).catch(() => {});
  await page.goto(WEB + url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForLoadState('load', { timeout: 8000 }).catch(() => {});
  await setZoom(page, zoom);
  if (anchor) { try { await page.locator(anchor).first().waitFor({ state: 'visible', timeout: 9000 }); } catch {} }
  await sleep(page, waitMs);
  await veilOff(page);
  await sleep(page, 260);
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

  // 2 · TEACHER — add course materials (upload a worksheet).
  async '2-materials'(page) {
    try {
      const h = { Authorization: 'Bearer ' + TOK.teacher.access };
      const docs = await (await fetch(`${API}/v1/teacher/courses/${ID.ALG}/documents`, { headers: h })).json();
      const list = docs.documents || docs.items || (Array.isArray(docs) ? docs : []);
      for (const d of list) if ((d.filename || d.name || '').includes('worksheet-demo'))
        await apiDelete(`${API}/v1/teacher/courses/${ID.ALG}/documents/${d.id}`);
    } catch (e) {}
    await gotoClean(page, `/school/teacher/courses/${ID.ALG}?tab=materials`, { zoom: 1.1, waitMs: 1400 });
    await cap(page, 'Drop in the materials you already teach from.');
    await sleep(page, 1300);
    const input = page.locator('input[type=file]').first();
    await input.setInputFiles(`${ASSETS}/worksheet.png`).catch(() => {});
    await sleep(page, 2400);
    await cap(page, 'Uploaded — ready to build from.');
    await sleep(page, 2000);
    await capClear(page); await sleep(page, 500);
  },

  // 3a · TEACHER — describe a homework + set a "soccer" focus, then cut to
  //      the generated, unmistakably soccer-themed problems.
  async '3-generate'(page) {
    await gotoClean(page, `/school/teacher/courses/${ID.ALG}?tab=homework`, { zoom: 1.0, waitMs: 1300 });
    await cap(page, 'Describe the homework once.');
    await sleep(page, 800);
    await go(page, page.getByRole('button', { name: /new homework/i }));
    await sleep(page, 1000);
    const title = page.locator('input[placeholder*="Quadratics"], input[placeholder*="HW"], input[placeholder*="Unit"]').first();
    if (await title.count()) { await go(page, title, { click: true }); await title.fill('Soccer word problems').catch(() => {}); }
    await sleep(page, 600);
    await go(page, page.getByText(/Linear Equations/).first(), { click: true }).catch(() => {});
    await sleep(page, 500);
    await go(page, page.getByRole('button', { name: /Continue|Next/i }).first(), { click: true }).catch(() => {});
    await sleep(page, 900);
    const focus = page.locator('input[placeholder*="word problems"], textarea[placeholder*="word problems"]').first();
    if (await focus.count()) {
      await go(page, focus, { click: true });
      await focus.fill('soccer — players, goals, matches, standings').catch(() => {});
      await sleep(page, 700);
      await cap(page, 'Set a focus — like soccer.');
      await sleep(page, 1600);
    } else {
      await cap(page, 'Set a focus — like soccer.');
      await sleep(page, 1400);
    }
    await capClear(page); await sleep(page, 300);
    // The AI writes the set — bridge the wait with the brand veil (no
    // spinner) and land on the real, pre-generated soccer problems.
    await gotoClean(page, `/school/teacher/courses/${ID.ALG}/homework/${ID.SOCCER}`,
      { zoom: 1.18, waitMs: 1500, anchor: 'text=/soccer|goals|match/i' });
    await page.mouse.wheel(0, 150); await sleep(page, 700);
    await cap(page, 'Every problem — themed to soccer.');
    await sleep(page, 2600);
    await page.mouse.wheel(0, 170); await sleep(page, 2000);
    await capClear(page); await sleep(page, 500);
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
    await sleep(page, 3400);
    await capClear(page); await sleep(page, 500);
  },

  // 4a · STUDENT — snap a photo of the work and turn it in.
  async '4-submit'(page) {
    await gotoClean(page, `/school/student/courses/${ID.ALG}/homework/${ID.SYSTEMS}`,
      { zoom: 1.05, waitMs: 1400 });
    await cap(page, 'The student just snaps a photo of their work.');
    await sleep(page, 1100);
    const fin = page.locator('input[type=file]').first();
    await fin.setInputFiles(`${ASSETS}/handwriting.png`).catch(() => {});
    await sleep(page, 2400);
    await cap(page, 'One tap to turn it in.');
    await sleep(page, 1800);
    // Show the turn-in CTA but don't trigger a live extraction/wait.
    await go(page, page.getByRole('button', { name: /review .* turn in|turn in/i }).first(), { click: false }).catch(() => {});
    await sleep(page, 1600);
    await capClear(page); await sleep(page, 500);
  },

  // 4b · STUDENT — the understanding check plays as a flowing conversation,
  //      then lands on its closing verdict.
  async '4-chat'(page) {
    await gotoClean(page, `/school/student/courses/${ID.ALG}/homework/${ID.LIN}`,
      { zoom: 1.0, waitMs: 1800, anchor: 'text=/understanding check/i' });
    // Hide every message + the closing verdict, then reveal them in
    // sequence so the chat reads as a live conversation.
    await page.evaluate(() => {
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
    });
    await sleep(page, 500);
    await cap(page, 'A short chat checks they really understand.');
    await sleep(page, 700);
    const n = await page.evaluate(() => (window.__rows || []).length);
    for (let i = 0; i < n; i++) {
      await page.evaluate((idx) => {
        const el = window.__rows[idx];
        if (el) { el.style.opacity = '1'; el.style.transform = 'none'; el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      }, i);
      await sleep(page, i % 2 === 1 ? 1650 : 1250);
    }
    await sleep(page, 500);
    await cap(page, 'A right answer no longer means they got it.');
    await sleep(page, 1600);
    // Reveal the closing verdict, then clear the caption so the outcome
    // panel ("check passed / your teacher has everything they need")
    // holds clean on camera.
    await cap(page, 'She explained it in her own words — check passed.');
    await sleep(page, 600);
    await page.evaluate(() => { const t = window.__term; if (t) { t.style.opacity = '1'; t.style.transform = 'none'; t.scrollIntoView({ block: 'center', behavior: 'smooth' }); } });
    await sleep(page, 2400);
    await capClear(page); await sleep(page, 2200);
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
  '3-solution': 'teacher', '3-figure': 'teacher', '4-submit': 'maya',
  '4-chat': 'maya', '5-grade': 'teacher', '5-insights': 'teacher',
  '6-reteach': 'teacher', '7-practice': 'maya', '7-learn': 'maya',
};

const want = process.argv.slice(2);
const ids = (want.length ? want : Object.keys(CLIPS));

global.__b = await chromium.launch({ executablePath: CACHED || undefined, headless: true, args: ['--disable-gpu'] });
for (const id of ids) {
  const ctx = await newCtx(WHO[id]);
  const page = await ctx.newPage();
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
