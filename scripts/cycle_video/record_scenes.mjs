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

// ── seed IDs (General Math · Period 3 — Unit 5 Review) ──
const ID = {
  ALG: 'c99b654b-7ef8-4b05-a1df-a57c47d98f6e',       // course "General Math"
  SEC: '845950c6-dc06-40a7-ba72-278ae63c221c',       // Period 3
  UNIT5: 'c072c9b6-fd0c-4565-9bab-afea06a3dcd4',      // the ONE assignment
  PRACTICE: 'f1b8b77e-706b-4d07-97fe-c808a8548ccf',   // re-teach practice set
  MAYA: '845d3c76-9fe8-4cec-b5ab-e43446400edd',       // exonerated + graded
  JORDAN: '0f63c477-12f8-4cbc-b4dc-ad62642f2cdc',     // the integrity catch
};
const ALG_LINEAR_UNIT = '5547f6d5-0487-4174-bae0-a25908900c68';
// The labeled source sheet the demo builds from — a real, dated review
// sheet, uploaded in scene 2 and selected in scene 3 (never "worksheet.png").
const REVIEW_SHEET = 'Unit 5 Review — Matrices, Trig & Equations (2024).png';

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
async function go(page, locator, { click = true, settle = 380, find = 4000 } = {}) {
  const el = locator.first();
  try { await el.waitFor({ state: 'visible', timeout: find }); }
  catch { return false; }
  await sleep(page, 150);
  let r; try { r = await rectOf(el); } catch { return false; }
  await sleep(page, 110);
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
  // Lift the veil PROMPTLY once content is ready (short cream, no dead air),
  // then hold the remaining settle on the now-visible content — so every
  // card→scene dissolve resolves onto real content, never a cream veil.
  const preReveal = Math.min(waitMs, 620);
  await sleep(page, preReveal);
  if (beforeReveal) { try { await beforeReveal(); } catch {} await sleep(page, 180); }
  await veilOff(page);
  await sleep(page, Math.max(360, waitMs - preReveal));
}

// ── Cinematic helpers (upgrades): a sienna emphasis box, eased window
//    scrolls, and the cold-open setup overlay. All mount on <html> (outside
//    the body-zoom) or drive the window scroll, so they read cleanly under
//    the full-bleed framing + Ken-Burns push.
// finderFn is a REAL page function returning {x,y,w,h}|null (passed to
// evaluate directly — the app's CSP blocks eval-of-strings, so we never
// eval; Playwright serializes the function itself).
async function highlightFinder(page, finderFn, { pad = 10 } = {}) {
  const rect = await page.evaluate(finderFn).catch(() => null);
  if (!rect || rect.w < 4 || rect.h < 4) return false;
  await page.evaluate(([r, pad]) => {
    const old = document.getElementById('__hl'); if (old) old.remove();
    const h = document.createElement('div'); h.id = '__hl';
    h.style.cssText = 'position:fixed;z-index:2147483644;pointer-events:none;'
      + `left:${r.x - pad}px;top:${r.y - pad}px;width:${r.w + 2 * pad}px;height:${r.h + 2 * pad}px;`
      + 'border:3px solid #b8431a;border-radius:14px;'
      + 'box-shadow:0 0 0 6px rgba(184,67,26,.15),0 14px 38px rgba(184,67,26,.28);'
      + 'opacity:0;transition:opacity .5s ease';
    document.documentElement.appendChild(h);
    requestAnimationFrame(() => { h.style.opacity = '1'; });
  }, [rect, pad]);
  return true;
}
async function clearHL(page) { await page.evaluate(() => { const h = document.getElementById('__hl'); if (h) h.remove(); }); }

// Eased window scroll to an absolute scrollTop (targetFn → number|null).
async function animateScroll(page, y, ms = 1500) {
  await page.evaluate(async ([y, ms]) => {
    const se = document.scrollingElement || document.documentElement;
    const startY = se.scrollTop, dist = y - startY, t0 = performance.now();
    await new Promise((res) => { function step(now) { const p = Math.min(1, (now - t0) / ms);
      const e = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; se.scrollTop = startY + dist * e;
      if (p < 1) requestAnimationFrame(step); else res(); } requestAnimationFrame(step); });
  }, [y, ms]);
}
async function scrollToFinder(page, targetFn, ms = 1500) {
  const y = await page.evaluate(targetFn).catch(() => null);
  if (y == null) return;
  await animateScroll(page, y, ms);
}
// Finder factories (real functions; no eval). Return centered scrollTop / rect.
const yFlag = () => { const el = [...document.querySelectorAll('*')].find((n) => /couldn.t explain/i.test(n.textContent || '') && n.children.length < 8); if (!el) return null; const se = document.scrollingElement || document.documentElement; const r = el.getBoundingClientRect(); return Math.max(0, se.scrollTop + r.top + r.height / 2 - window.innerHeight / 2); };
// NOTE: each finder must be SELF-CONTAINED — Playwright serializes only the
// passed function, not module-scope helpers it references.
const yDigest = () => { const dl = [...document.querySelectorAll('dl')].find((d) => /Tabbed out/i.test(d.textContent || '') && /Paste events/i.test(d.textContent || '')); const el = dl ? (dl.parentElement || dl) : null; if (!el) return null; const se = document.scrollingElement || document.documentElement; const r = el.getBoundingClientRect(); return Math.max(0, se.scrollTop + r.top + r.height / 2 - window.innerHeight / 2); };
const rFlag = () => { const el = [...document.querySelectorAll('*')].find((n) => /couldn.t explain/i.test(n.textContent || '') && n.children.length < 8); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
const rRoster = () => { const el = [...document.querySelectorAll('*')].find((n) => /Jordan/i.test(n.textContent || '') && /100%/.test(n.textContent || '') && /Review/i.test(n.textContent || '') && n.children.length < 16 && n.getBoundingClientRect().width < 660 && n.getBoundingClientRect().height < 220); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
const rDigest = () => { const dl = [...document.querySelectorAll('dl')].find((d) => /Tabbed out/i.test(d.textContent || '') && /Paste events/i.test(d.textContent || '')); const el = dl ? (dl.parentElement || dl) : null; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
// Maya's EXONERATION banner — the pass verdict ("Student understood their
// own work" + the "in her own words" summary). Walk from the title <p> up
// to the role=status banner container so the highlight frames verdict +
// summary together. Self-contained (Playwright serializes only this fn).
const rExon = () => { const p = [...document.querySelectorAll('p')].find((n) => /understood their own work/i.test(n.textContent || '')); if (!p) return null; let el = p; for (let k = 0; k < 5 && el.parentElement; k++) { if (el.getAttribute && el.getAttribute('role') === 'status') break; el = el.parentElement; } const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
const yExon = () => { const p = [...document.querySelectorAll('p')].find((n) => /understood their own work/i.test(n.textContent || '')); if (!p) return null; let el = p; for (let k = 0; k < 5 && el.parentElement; k++) { if (el.getAttribute && el.getAttribute('role') === 'status') break; el = el.parentElement; } const se = document.scrollingElement || document.documentElement; const r = el.getBoundingClientRect(); return Math.max(0, se.scrollTop + r.top + r.height / 2 - window.innerHeight / 2); };
// The one student-work step a receipt deduction anchors to — the app tags it
// with id `work-<item>-step-<N>` and tints it. On Maya's grade that's the
// matrix AB₂₂ slip (5, should be 6). Self-contained (Playwright serializes it).
const yStepAnchor = () => { const el = document.querySelector('[id^="work-"][id*="-step-"]'); if (!el) return null; const se = document.scrollingElement || document.documentElement; const r = el.getBoundingClientRect(); return Math.max(0, se.scrollTop + r.top + r.height / 2 - window.innerHeight / 2); };
const rStepAnchor = () => { const el = document.querySelector('[id^="work-"][id*="-step-"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
// Eased window scroll to a fraction of the full document height.
async function smoothScrollToFrac(page, frac, ms = 2000) {
  await page.evaluate(async ([frac, ms]) => {
    const se = document.scrollingElement || document.documentElement;
    const max = Math.max(0, se.scrollHeight - window.innerHeight);
    const target = max * frac, startY = se.scrollTop, dist = target - startY, t0 = performance.now();
    await new Promise((res) => { function step(now) { const p = Math.min(1, (now - t0) / ms);
      const e = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; se.scrollTop = startY + dist * e;
      if (p < 1) requestAnimationFrame(step); else res(); } requestAnimationFrame(step); });
  }, [frac, ms]);
}
// Eased scroll of a scrollable CONTAINER (not the window) so its first
// element matching `needle` lands aligned in view. Used by the Workshop
// modal, whose artifact (question → solution steps → final answer) lives in
// an inner overflow-y-auto left panel — the window never moves. Finds the
// deepest element whose text matches, walks up to the nearest real scroll
// parent, and eases that element's scrollTop. `align` 0=top .5=center 1=bottom.
async function easeScrollContainerTo(page, needle, { ms = 1600, align = 0.5 } = {}) {
  await page.evaluate(async ([needle, ms, align]) => {
    const re = new RegExp(needle, 'i');
    const matches = [...document.querySelectorAll('div,span,p,li,h1,h2,h3,strong,button')]
      .filter((n) => re.test(n.textContent || '') && n.children.length < 14);
    const target = matches[matches.length - 1] || matches[0];
    if (!target) return;
    let sc = target.parentElement;
    while (sc && !(sc.scrollHeight > sc.clientHeight + 8 &&
      /auto|scroll/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
    if (!sc) sc = document.scrollingElement || document.documentElement;
    const scR = sc.getBoundingClientRect(), tR = target.getBoundingClientRect();
    const desired = sc.scrollTop + (tR.top - scR.top) - (sc.clientHeight - tR.height) * align;
    const maxTop = Math.max(0, sc.scrollHeight - sc.clientHeight);
    const to = Math.max(0, Math.min(maxTop, desired));
    const start = sc.scrollTop, dist = to - start, t0 = performance.now();
    await new Promise((res) => { function step(now) { const p = Math.min(1, (now - t0) / ms);
      const e = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; sc.scrollTop = start + dist * e;
      if (p < 1) requestAnimationFrame(step); else res(); } requestAnimationFrame(step); });
  }, [needle, ms, align]);
}
// Cold-open setup card, drawn on brand paper ABOVE the veil so it can hold
// while the flagged review is framed underneath, then dissolve away.
async function coldSetup(page) {
  await page.evaluate(() => {
    const old = document.getElementById('__setup'); if (old) old.remove();
    const o = document.createElement('div'); o.id = '__setup';
    o.style.cssText = 'position:fixed;inset:0;z-index:2147483645;background:#f7f5f0;'
      + 'display:flex;flex-direction:column;align-items:center;justify-content:center;'
      + 'text-align:center;padding:0 12%;'
      + "font-family:'Instrument Serif',Georgia,serif;color:#14130f;";
    o.innerHTML =
      '<div style="color:#b8431a;font-family:Inter,sans-serif;font-size:22px;font-weight:600;'
      + 'letter-spacing:.42em;text-transform:uppercase;margin-bottom:44px;opacity:0;transition:opacity .6s ease" id="__su0">Veradic</div>'
      + '<div id="__su1" style="font-size:78px;line-height:1.12;letter-spacing:-.012em;opacity:0;'
      + 'transition:opacity .75s ease,transform .75s ease;transform:translateY(16px)">A student just aced the hardest problem on the homework.</div>'
      + '<div id="__su2" style="margin-top:28px;font-size:70px;line-height:1.14;letter-spacing:-.012em;color:#b8431a;font-style:italic;'
      + 'opacity:0;transition:opacity .75s ease,transform .75s ease;transform:translateY(16px)">But did they understand it — or just copy the answer?</div>';
    document.documentElement.appendChild(o);
  });
}

// ─────────────────────────────── clips ───────────────────────────────
// One coherent loop on the SAME "Unit 5 Review" assignment (General Math ·
// Period 3 · Ms. Rivera). Three problems — a matrix system, a 15-ft ladder,
// a multi-step equation — thread every scene. Captions sell the value, not
// the clicks. Full-bleed: the assembler shows each clip edge-to-edge and
// pushes in (Ken-Burns) on the money shots; nothing floats.
const CLIPS = {
  // 0 · COLD OPEN — the CATCH, live, before the title. A setup card on brand
  //     paper, then Jordan's OWN understanding-check chat plays turn-by-turn
  //     from empty: the AI asks him to explain HOW he got a matrix entry, and
  //     the "why" keeps coming up empty on a correct answer. One framing
  //     caption names the mechanism. The teacher-side flag + behavioral
  //     evidence is the PAYOFF later (4-verdict) — shown once, never here, so
  //     no screen repeats. Recorded as Jordan (student), check in_progress.
  async '0-cold'(page) {
    // Navigate UNDER the veil to Jordan's live understanding-check; keep the
    // app hidden while the setup card holds.
    await veilOn(page).catch(() => {});
    await page.goto(WEB + `/school/student/courses/${ID.ALG}/homework/${ID.UNIT5}`,
      { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForLoadState('load', { timeout: 8000 }).catch(() => {});
    await veilOn(page).catch(() => {});
    await setZoom(page, 1.1);
    await page.locator('text=/understanding check/i').first().waitFor({ state: 'visible', timeout: 9000 }).catch(() => {});
    // Hide the chat bubbles so the conversation starts EMPTY and reveals
    // turn-by-turn (no pre-flash). Finds the transcript container (the row
    // with the most justify-start/end children), hides each row, and stashes
    // them + the scroller on window for the reveal loop.
    await page.evaluate(() => {
      const bubbles = Array.from(document.querySelectorAll('div')).filter((d) =>
        /\bjustify-(start|end)\b/.test(d.className) &&
        d.parentElement && Array.from(d.parentElement.children).filter((c) =>
          /\bjustify-(start|end)\b/.test(c.className)).length >= 3);
      let cont = null, best = 0;
      bubbles.forEach((b) => {
        const n = Array.from(b.parentElement.children).filter((c) => /\bjustify-(start|end)\b/.test(c.className)).length;
        if (n > best) { best = n; cont = b.parentElement; }
      });
      window.__rows = cont ? Array.from(cont.children).filter((c) => /\bjustify-(start|end)\b/.test(c.className)) : [];
      [...window.__rows].forEach((el) => { if (el) { el.style.transition = 'opacity .45s ease, transform .45s ease'; el.style.opacity = '0'; el.style.transform = 'translateY(12px)'; } });
      window.__scroller = cont;
      while (window.__scroller && window.__scroller.scrollHeight <= window.__scroller.clientHeight + 10)
        window.__scroller = window.__scroller.parentElement;
    });
    // Setup card (brand paper) above the veil — two beats (Option A copy).
    await coldSetup(page);
    await sleep(page, 250);
    await page.evaluate(() => { const e = document.getElementById('__su0'); if (e) e.style.opacity = '1'; });
    await sleep(page, 350);
    await page.evaluate(() => { const e = document.getElementById('__su1'); if (e) { e.style.opacity = '1'; e.style.transform = 'none'; } });
    await sleep(page, 1600);
    await page.evaluate(() => { const e = document.getElementById('__su2'); if (e) { e.style.opacity = '1'; e.style.transform = 'none'; } });
    await sleep(page, 2100);
    // Dissolve the card away onto the empty chat.
    await veilOff(page);
    await page.evaluate(() => { const o = document.getElementById('__setup'); if (o) { o.style.transition = 'opacity .6s ease'; o.style.opacity = '0'; } });
    await sleep(page, 760);
    await page.evaluate(() => { const o = document.getElementById('__setup'); if (o) o.remove(); });
    // The mechanism, named once — then the chat plays it out.
    await cap(page, 'Every answer gets an AI understanding check — right, but can’t explain it? Flagged.');
    await sleep(page, 900);
    // Reveal the conversation turn-by-turn from empty. Jordan got the matrix
    // product right; the AI asks him to walk through a single entry and the
    // "why" never lands.
    const n = await page.evaluate(() => (window.__rows || []).length);
    for (let i = 0; i < n; i++) {
      await page.evaluate((idx) => {
        const el = window.__rows[idx];
        if (el) { el.style.opacity = '1'; el.style.transform = 'none'; el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      }, i);
      if (i === 5) { await cap(page, 'The answer’s right — the “why” keeps coming up empty.'); }
      await sleep(page, i % 2 === 1 ? 1650 : 1250);
    }
    await sleep(page, 700);
    await cap(page, 'A perfect answer he can’t explain — quietly flagged.');
    await sleep(page, 2600);
    await capClear(page); await sleep(page, 1100);
  },

  // 1 · TEACHER — spin up a class section.
  async '1-section'(page) {
    await deleteDemoSections();
    await gotoClean(page, `/school/teacher/courses/${ID.ALG}`, { zoom: 1.12, waitMs: 1400, anchor: 'text=/Period 3/i' });
    await cap(page, 'Every class you teach, in one place.');
    await sleep(page, 1100);
    await go(page, page.getByRole('button', { name: /new section/i }));
    await sleep(page, 800);
    const input = page.locator('input[placeholder="Section name"]');
    await go(page, input, { click: true });
    await input.fill('Period 6', { timeout: 4000 }).catch(() => {});
    await sleep(page, 700);
    await go(page, page.getByRole('button', { name: /^Create$/ }));
    await sleep(page, 1700);
    await cap(page, 'A new section is live — just share the join code.');
    await sleep(page, 2000);
    await capClear(page); await sleep(page, 500);
    await deleteDemoSections();
  },

  // 2 · TEACHER — bring in the materials you already teach from.
  async '2-materials'(page) {
    try {
      const h = { Authorization: 'Bearer ' + TOK.teacher.access };
      const docs = await (await fetch(`${API}/v1/teacher/courses/${ID.ALG}/documents`, { headers: h })).json();
      const list = docs.documents || docs.items || (Array.isArray(docs) ? docs : []);
      for (const d of list) if ((d.filename || d.name || '') === REVIEW_SHEET)
        await apiDelete(`${API}/v1/teacher/courses/${ID.ALG}/documents/${d.id}`);
    } catch (e) {}
    // Zoom 1.0 so the app's image-preview lightbox (fixed inset-0) centers
    // cleanly and shows the whole sheet without clipping.
    await gotoClean(page, `/school/teacher/courses/${ID.ALG}?tab=materials`, { zoom: 1.0, waitMs: 1500 });
    await cap(page, 'Bring in the materials you already teach from.');
    await sleep(page, 1200);
    // Move the cursor onto "Upload Files" (a <label> — clicking it would open
    // the OS file dialog, which headless can't show), then feed the PNG to the
    // real hidden input so the app runs its true upload path (uploading → done).
    await go(page, page.getByText('Upload Files', { exact: true }).first(), { click: false }).catch(() => {});
    await cap(page, 'Upload your worksheet — the app takes it from here.');
    await sleep(page, 350);
    const input = page.locator('input[type=file]').first();
    await input.setInputFiles(`${ASSETS}/${REVIEW_SHEET}`).catch(() => {});
    // Wait for the uploaded sheet to land as a real card in the materials list.
    // Match on the FULL filename — a same-named unit folder exists in the
    // sidebar, so a loose substring would grab the folder, not the file card.
    const card = page.locator('button', { hasText: REVIEW_SHEET }).first();
    await card.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    await sleep(page, 900);
    await cap(page, 'Uploaded — your Unit 5 review sheet is in.');
    await sleep(page, 1700);
    // Preview it — the app's own image lightbox — so the viewer sees the ACTUAL
    // broad sheet (matrices, trig, linear + distractors) before the focus pulls
    // just three. Double-click the card opens the preview modal.
    await go(page, card, { click: false }).catch(() => {});
    await card.dblclick({ timeout: 4000 }).catch(() => {});
    const preview = page.locator('div[role="dialog"][aria-label^="Preview:"]').first();
    await preview.waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
    await preview.locator('img').first().waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
    await sleep(page, 900);
    await cap(page, 'Matrices, trig, linear — plus distractors. This is what it builds from.');
    await sleep(page, 3000);
    await capClear(page); await sleep(page, 300);
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(page, 500);
  },

  // 3 · TEACHER — the real new-homework wizard: name it, pick the unit,
  //     type a focus, and point it at the worksheet. Then veil-cut to the
  //     three problems the focus pulled — and land the focus-control beat.
  async '3-generate'(page) {
    await gotoClean(page, `/school/teacher/courses/${ID.ALG}?tab=homework`, { zoom: 1.13, waitMs: 900 });
    await cap(page, 'Now build the homework — from that same sheet.');
    await sleep(page, 500);
    await go(page, page.getByRole('button', { name: /new homework/i }).first());
    const dialog = page.getByRole('dialog', { name: /new homework/i });
    await dialog.waitFor({ state: 'visible', timeout: 9000 }).catch(() => {});
    await sleep(page, 450);

    // Step 1 · Details.
    await cap(page, 'Name it. Pick the unit.');
    const title = dialog.locator('input[placeholder*="Quadratics"], input[type="text"]').first();
    if (await title.count()) {
      await go(page, title, { click: true });
      await title.pressSequentially('Unit 5 Review', { delay: 20 }).catch(() => {});
    }
    await sleep(page, 250);
    await go(page, dialog.getByRole('button', { name: /^✓?\s*Unit 5$/ }).first(), { click: true }).catch(() => {});
    await sleep(page, 350);
    await go(page, dialog.getByRole('button', { name: /Continue/i }).first(), { click: true }).catch(() => {});
    await sleep(page, 350);

    // Step 2 · Problems — count 3, TYPE the focus, pick the worksheet source.
    // Set the count to 3 FIRST (deselects the default "10" chip, custom reads
    // 3) so the "just three" beat plays with the count already reading 3 — the
    // preset chip never lingers highlighted against the caption.
    const countInput = dialog.locator('input[aria-label="Custom problem count"]').first();
    if (await countInput.count()) {
      await go(page, countInput, { click: true });
      await countInput.fill('3').catch(() => {});
      await countInput.blur().catch(() => {});
      await sleep(page, 400);
    }
    await cap(page, 'How many? Just three today.');
    await sleep(page, 1400);
    await cap(page, 'Then aim it — matrices, trig, multi-step.');
    const focus = dialog.locator('input[placeholder*="word problems"], textarea[placeholder*="word problems"]').first();
    if (await focus.count()) {
      await go(page, focus, { click: true });
      await focus.pressSequentially('matrix multiplication, right-triangle trig, multi-step equations', { delay: 16 }).catch(() => {});
      await sleep(page, 500);
    } else { await sleep(page, 500); }
    await cap(page, 'And build from your own worksheet — one click.');
    const srcRow = dialog.getByText(REVIEW_SHEET, { exact: true }).first();
    await go(page, srcRow, { click: true }).catch(() => {});
    await sleep(page, 850);
    await go(page, dialog.getByRole('button', { name: /Continue/i }).first(), { click: true }).catch(() => {});
    await sleep(page, 350);

    // Step 3 · Grading (sensible defaults) → Step 4 · Review → create.
    await cap(page, 'Grading rubric — sensible defaults, already in.');
    await sleep(page, 850);
    await go(page, dialog.getByRole('button', { name: /Continue/i }).first(), { click: true }).catch(() => {});
    await sleep(page, 350);
    await cap(page, 'One last look, then build.');
    await sleep(page, 950);
    await go(page, dialog.getByRole('button', { name: /Create & generate/i }).first(), { click: false }).catch(() => {});
    await sleep(page, 450);
    await capClear(page); await sleep(page, 250);

    // Reveal the three problems the focus pulled (land on a real line).
    await gotoClean(page, `/school/teacher/courses/${ID.ALG}/homework/${ID.UNIT5}`,
      { zoom: 1.15, waitMs: 1500, anchor: 'text=/matrix product|Matrix multiplication/i' });
    await page.mouse.wheel(0, 260); await sleep(page, 500);
    await cap(page, 'Three problems — exactly the topics you named.');
    await sleep(page, 1900);
    await cap(page, 'The whole unit’s on the sheet — the focus pulled just these. No quadratics, no stats.');
    await sleep(page, 3000);
    await capClear(page); await sleep(page, 300);
  },

  // 3b · TEACHER — open the ladder problem: a self-checked figure AND a
  //      verified answer key. Proof it writes answers, not just questions.
  async '3-figure'(page) {
    await gotoClean(page, `/school/teacher/courses/${ID.ALG}/homework/${ID.UNIT5}`,
      { zoom: 1.05, waitMs: 1400, anchor: 'text=/zip-line/i' });
    await cap(page, 'Open any problem —');
    await sleep(page, 900);
    await go(page, page.getByText(/zip-line/i).first(), { click: true }).catch(() => {});
    await sleep(page, 1600);
    await cap(page, 'It drew the figure itself — and checked it.');
    await sleep(page, 2400);
    await go(page, page.getByText(/Show solution/i).first(), { click: true }).catch(() => {});
    await sleep(page, 1200);
    await cap(page, 'Every problem ships with a worked, verified answer key.');
    await page.mouse.wheel(0, 320); await sleep(page, 2600);
    await page.mouse.wheel(0, 300); await sleep(page, 2400);
    await capClear(page); await sleep(page, 500);
  },

  // 3c · TEACHER — the AI Workshop: edit the matrix in plain English into a
  //      no-solution system, and watch it re-solve and confirm. (Proposal
  //      is pre-warmed off-camera → lands instantly, no thinking spinner.)
  async '3-workshop'(page) {
    await gotoClean(page, `/school/teacher/courses/${ID.ALG}/homework/${ID.UNIT5}`,
      { zoom: 1.05, waitMs: 1200, anchor: 'text=/matrix product|Matrix multiplication/i' });
    await cap(page, 'Want to change a problem? Just say so.');
    await sleep(page, 700);
    await go(page, page.getByText(/matrix product|Compute the matrix/i).first(), { click: true }).catch(() => {});
    await page.getByRole('button', { name: /Accept/ }).first().waitFor({ state: 'visible', timeout: 9000 }).catch(() => {});
    await sleep(page, 1200);
    await cap(page, '“Make this one undefined.”');
    await sleep(page, 2300);
    // Reveal the UPDATED SOLUTION (the conformability explanation), not just
    // the rewritten question.
    await go(page, page.getByRole('button', { name: /Show solution/i }).first(), { click: true }).catch(() => {});
    await sleep(page, 1100);
    await cap(page, 'The whole solution — and the answer — rewrite themselves.');
    await sleep(page, 1500);
    // Scroll the modal's inner artifact panel (window never moves) down through
    // the COMPLETE updated solution: the dimension set-up → the conformability
    // rule (2 ≠ 3) → the conclusion. Eased, legible, one beat per landing.
    await easeScrollContainerTo(page, 'Check the Conformability', { ms: 1700, align: 0.42 });
    await sleep(page, 1900);
    await easeScrollContainerTo(page, 'State the Conclusion', { ms: 1600, align: 0.4 });
    await sleep(page, 1900);
    // Land on the ANSWER changing — the "Final answer" box shows the old
    // product matrix (the "Before" card) replaced by "undefined … 2 ≠ 3".
    await easeScrollContainerTo(page, 'Final answer', { ms: 1600, align: 0.18 });
    await sleep(page, 900);
    await cap(page, 'The answer flips — from a product matrix to: undefined, 2 ≠ 3.');
    await sleep(page, 3000);
    await capClear(page); await sleep(page, 500);
  },

  // 4 · STUDENT (Aisha) — her screen: snap the work, turn it in.
  async '4-submit'(page) {
    await gotoClean(page, `/school/student/courses/${ID.ALG}/homework/${ID.UNIT5}`,
      { zoom: 1.14, waitMs: 1300 });
    await cap(page, 'Now — the student’s screen.');
    await sleep(page, 1200);
    await page.getByText(/Submit your homework/i).first().scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {});
    await page.mouse.wheel(0, 120); await sleep(page, 800);
    await cap(page, 'Snap a photo of the work — attach it.');
    await go(page, page.getByRole('button', { name: /Add files/i }).first(), { click: false }).catch(() => {});
    await sleep(page, 300);
    const fin = page.locator('input[type=file]').first();
    await fin.setInputFiles(`${ASSETS}/handwriting.png`).catch(() => {});
    await sleep(page, 1600);
    await cap(page, 'Attached — Page 1 · handwriting.png.');
    await sleep(page, 2000);
    const turnInBtn = page.getByRole('button', { name: /review .* turn in/i }).first();
    await go(page, turnInBtn, { click: false }).catch(() => {});
    await turnInBtn.click({ timeout: 3000 }).catch(() => {});
    await sleep(page, 1000);
    await page.getByText(/Ready to turn it in/i).first().scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    await sleep(page, 700);
    await cap(page, 'Your teacher sees exactly what you turn in.');
    await sleep(page, 2400);
    await capClear(page); await sleep(page, 500);
  },

  // 4b · TEACHER — the PAYOFF of the cold-open catch, now on the teacher's
  //      side: Jordan's flag ("correct work but couldn't explain it") + the
  //      behavioral evidence (tabbed out 2×, paste 1) — the thing a grade can
  //      never do. THEN the other half the cold-open can't cover: the same
  //      check EXONERATES honest kids — Maya explained her method in her own
  //      words → passed, no flag. Jordan's student chat is the cold-open; his
  //      teacher review + Maya's exoneration live only here (no repeats).
  async '4-verdict'(page) {
    await gotoClean(page, `/school/teacher/courses/${ID.ALG}/homework/${ID.UNIT5}/sections/${ID.SEC}/review?student=${ID.JORDAN}`,
      { zoom: 1.12, waitMs: 1700, anchor: 'text=/couldn.t explain/i' });
    await cap(page, 'You see the catch a grade never could.');
    await sleep(page, 1600);
    await scrollToFinder(page, yFlag, 900);
    await highlightFinder(page, rFlag);
    await cap(page, 'A correct answer — that he can’t explain.');
    await sleep(page, 2600);
    await clearHL(page);
    // Highlight the behavioral evidence (tabbed out 2×, paste 1).
    await scrollToFinder(page, yDigest, 1000);
    await sleep(page, 250);
    await highlightFinder(page, rDigest);
    await cap(page, 'Behavior backs it up: tabbed out twice, pasted once.');
    await sleep(page, 2900);
    await clearHL(page);
    await cap(page, 'Warm to the student. Honest with you.');
    await sleep(page, 2100);
    await capClear(page); await sleep(page, 600);
    // ── The other half the cold-open can't show: the SAME check clears the
    //    honest kids. Maya explained her method in her own words → passed,
    //    no flag. (Her grade is scene 5 — here it's purely the exoneration.)
    await gotoClean(page, `/school/teacher/courses/${ID.ALG}/homework/${ID.UNIT5}/sections/${ID.SEC}/review?student=${ID.MAYA}`,
      { zoom: 1.12, waitMs: 1700, anchor: 'text=/own words|understood their own work/i' });
    await cap(page, 'And it clears the honest kids — automatically.');
    await sleep(page, 1700);
    await scrollToFinder(page, yExon, 700);
    await sleep(page, 250);
    await highlightFinder(page, rExon);
    await cap(page, 'Maya explained her method, in her own words — passed, no flag.');
    await sleep(page, 3000);
    await clearHL(page); await capClear(page); await sleep(page, 700);
  },

  // 5 · TEACHER — ONE smooth, continuous scroll down Maya's grading. Problem
  //     by problem on a single page: the matrix set-up perfect but one honest
  //     slip (3×2 = 6, not 5) → itemized Partial 95%; the trig + the equation
  //     full marks. Opens BELOW the integrity banner (her exoneration is the
  //     integrity beat's payoff — never re-shown here). No cutting between pages.
  async '5-grade'(page) {
    await gotoClean(page, `/school/teacher/courses/${ID.ALG}/homework/${ID.UNIT5}/sections/${ID.SEC}/review?student=${ID.MAYA}`,
      { zoom: 1.06, waitMs: 1800, anchor: 'text=/Maya/i' });
    // Expand every AI-confident problem so each shows its steps + receipt,
    // making the page one tall, scrollable grading document.
    for (let k = 0; k < 3; k++) {
      const b = page.getByRole('button', { name: /Expand problem \d+ to inspect/i }).first();
      if (await b.count() === 0) break;
      try { await b.click({ timeout: 2500 }); } catch {}
      await sleep(page, 450);
    }
    // Open on the GRADING, not Maya's integrity banner. Her exoneration is
    // the integrity beat's payoff (4-verdict); re-showing it at the top here
    // would repeat that screen. Jump just below the banner to the first
    // problem so the scroll is purely the grading document.
    await page.evaluate(() => {
      const se = document.scrollingElement || document.documentElement;
      const el = [...document.querySelectorAll('*')].find((n) => /Compute the matrix product/i.test(n.textContent || '') && n.children.length < 6);
      if (el) { const r = el.getBoundingClientRect(); se.scrollTop = Math.max(0, se.scrollTop + r.top - 56); }
      else { se.scrollTop = Math.min(se.scrollHeight, 320); }
    });
    await sleep(page, 400);
    await cap(page, 'Grade the class — one page, one clear receipt.');
    await sleep(page, 1500);
    // A single, eased, top-to-bottom scroll of the grading — one page moving.
    await smoothScrollToFrac(page, 0.24, 2300); await sleep(page, 500);
    await cap(page, 'Matrix multiply — the set-up is perfect.');
    await smoothScrollToFrac(page, 0.44, 2300); await sleep(page, 600);
    // Center + box the EXACT erroring step the receipt anchors to (AB₂₂ = 5,
    // should be 6) — the −5 ledger line links straight to this tinted step.
    await scrollToFinder(page, yStepAnchor, 1100); await sleep(page, 350);
    await highlightFinder(page, rStepAnchor, { pad: 8 });
    await cap(page, 'One honest slip: 3 × 2 = 6, not 5 → Partial 95%.');
    await sleep(page, 2400);
    await cap(page, 'It shows you the exact step — you decide.');
    await sleep(page, 2600);
    await clearHL(page);
    await smoothScrollToFrac(page, 0.64, 2000); await sleep(page, 700);
    await cap(page, 'The trig and the equation — full marks.');
    await smoothScrollToFrac(page, 0.83, 2300); await sleep(page, 700);
    await cap(page, 'The AI proposes — you set full, partial, or none.');
    await smoothScrollToFrac(page, 1.0, 2100); await sleep(page, 1600);
    await capClear(page); await sleep(page, 600);
  },

  // 5b · TEACHER — class insights: per-concept struggle + per-student roster.
  async '5-insights'(page) {
    await gotoClean(page, `/school/teacher/courses/${ID.ALG}?tab=insights`,
      { zoom: 1.12, waitMs: 1800, anchor: 'text=/Multiplying matrices|matrices/i' });
    await cap(page, 'See exactly where the class is struggling.');
    await sleep(page, 2400);
    await page.mouse.wheel(0, 520); await sleep(page, 1800);
    await cap(page, 'And how each student is really doing.');
    await sleep(page, 2200);
    await capClear(page); await sleep(page, 500);
  },

  // 6 · TEACHER — one-click reteach → a targeted practice set.
  async '6-reteach'(page) {
    await gotoClean(page, `/school/teacher/courses/${ID.ALG}?tab=insights`,
      { zoom: 1.12, waitMs: 1600, anchor: 'text=/Multiplying matrices|matrices/i' });
    await cap(page, 'One click turns a weak spot into practice.');
    await sleep(page, 1200);
    await go(page, page.getByRole('button', { name: /re-teach|reteach/i }).first(), { click: true }).catch(() => {});
    await sleep(page, 1200);
    await capClear(page); await sleep(page, 200);
    await gotoClean(page, `/school/teacher/courses/${ID.ALG}/homework/${ID.PRACTICE}`,
      { zoom: 1.13, waitMs: 1600, anchor: 'text=/product|dimension|undefined|entry/i' });
    await page.mouse.wheel(0, 160); await sleep(page, 1200);
    await cap(page, 'A targeted set — written for them, automatically.');
    await sleep(page, 2600);
    await capClear(page); await sleep(page, 500);
  },

  // 7 · STUDENT — practice with an instant check.
  async '7-practice'(page) {
    await gotoClean(page, `/school/student/courses/${ID.ALG}/practice/${ID.PRACTICE}`,
      { zoom: 1.13, waitMs: 1700 });
    await cap(page, 'The student practices — with an instant check.');
    await sleep(page, 1100);
    await go(page, page.getByRole('button', { name: /^Practice/ }).first(), { click: true }).catch(() => {});
    await sleep(page, 1600);
    // Correct answer: the product is undefined (2 ≠ 3). Pick that option.
    const pick = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const opt = btns.find((b) => /undefined/i.test(b.textContent || '') && (b.textContent || '').length < 90);
      if (!opt) return null;
      opt.scrollIntoView({ block: 'center' });
      const r = opt.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (pick) { await curveMove(page, pick.x, pick.y); await sleep(page, 420); await page.mouse.click(pick.x, pick.y); }
    await sleep(page, 2200);
    await cap(page, 'Instantly — they know, and they learn.');
    await sleep(page, 1800);
    await capClear(page); await sleep(page, 500);
  },

  // 7b · STUDENT — Learn: the worked solution, one step at a time.
  async '7-learn'(page) {
    await gotoClean(page, `/school/student/courses/${ID.ALG}/practice/${ID.PRACTICE}`,
      { zoom: 1.13, waitMs: 1500 });
    await go(page, page.getByRole('button', { name: /^Learn/ }).first(), { click: true }).catch(() => {});
    await sleep(page, 1800);
    await cap(page, 'Or walks the solution, one step at a time.');
    await sleep(page, 1800);
    await go(page, page.getByRole('button', { name: /I understand|Next|Continue/i }).first(), { click: true }).catch(() => {});
    await sleep(page, 2200);
    await capClear(page); await sleep(page, 500);
  },
};

// ─────────────────────────────── runner ───────────────────────────────
const WHO = {
  '0-cold': 'jordan', '1-section': 'teacher', '2-materials': 'teacher',
  '3-generate': 'teacher', '3-figure': 'teacher', '3-workshop': 'teacher',
  '4-submit': 'aisha', '4-verdict': 'teacher',
  '5-grade': 'teacher', '5-insights': 'teacher', '6-reteach': 'teacher',
  '7-practice': 'maya', '7-learn': 'maya',
};

const want = process.argv.slice(2);
const ids = (want.length ? want : Object.keys(CLIPS));

global.__b = await chromium.launch({ executablePath: CACHED || undefined, headless: true, args: ['--disable-gpu'] });
for (const id of ids) {
  const ctx = await newCtx(WHO[id]);
  const page = await ctx.newPage();
  CUR = { x: VIEW.width / 2, y: VIEW.height / 2 };
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
