"""Golden-set capture: drive the real teacher UI through the
generate -> review -> AI-Workshop-edit -> approve flow, saving a labelled
screenshot at every step plus a screen recording (for a GIF).

Run from the worktree with the golden stack up (web :3142, api :8742):

    WEB_BASE=http://localhost:3142 \
    .venv/bin/python -m scripts.golden_capture
"""
from __future__ import annotations

import asyncio
import json
import os
import re
from pathlib import Path

from playwright.async_api import async_playwright

WEB = os.environ.get("WEB_BASE", "http://localhost:3142").rstrip("/")
SP = "/private/tmp/claude-501/-Users-benzhao-Documents-Veradic-math-teacher-app/a43cc21c-5d82-4132-836d-7211a773e26e/scratchpad"
OUT = Path("/Users/benzhao/Documents/Veradic/math_teacher_app/.claude/worktrees/golden-set-e2e/docs/golden-set/shots")
VID = OUT / "video"
OUT.mkdir(parents=True, exist_ok=True)
VID.mkdir(parents=True, exist_ok=True)

toks = json.load(open(f"{SP}/fresh_tokens.json"))
seed = json.load(open(f"{SP}/seed.json"))
courses = {c["key"]: c for c in seed["courses"]}
geo, calc = courses["geometry"], courses["calculus"]

_n = [0]
async def shot(page, name: str):
    _n[0] += 1
    p = OUT / f"{_n[0]:02d}_{name}.png"
    await page.screenshot(path=str(p), full_page=False)
    print(f"  shot -> {p.name}", flush=True)

async def wait_review_ready(page, timeout=30000):
    """Review pages fetch the assignment + pending items + render KaTeX after
    load — a fixed sleep races the spinner. Wait for the queue to actually
    show a problem (Approve button) or drain (All caught up)."""
    try:
        await page.wait_for_selector(
            'button:has-text("Approve"), :text("All caught up")', timeout=timeout)
    except Exception as e:
        print(f"  ! review never became ready: {e}", flush=True)
    await page.wait_for_timeout(1800)  # settle KaTeX + figure SVG

async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        ctx = await browser.new_context(
            viewport={"width": 1440, "height": 900}, device_scale_factor=2,
            record_video_dir=str(VID), record_video_size={"width": 1440, "height": 900},
        )
        inject = (
            "try{var ls=window.localStorage;"
            f"ls.setItem('veradic_access_token', {json.dumps(toks['access_token'])});"
            f"ls.setItem('veradic_refresh_token', {json.dumps(toks['refresh_token'])});"
            "}catch(e){}"
        )
        await ctx.add_init_script(inject)
        page = await ctx.new_page()
        page.set_default_timeout(20000)

        # 1) Teacher dashboard
        await page.goto(f"{WEB}/school/teacher", wait_until="networkidle")
        try:
            await page.wait_for_selector(':text("My Courses"), :text("Courses")', timeout=20000)
        except Exception:
            pass
        await page.wait_for_timeout(2000)
        await shot(page, "teacher_dashboard")

        # 2) Geometry homework with the 5 generated problems
        await page.goto(f"{WEB}/school/teacher/courses/{geo['course_id']}/homework/{geo['assignment_id']}",
                        wait_until="networkidle")
        try:
            await page.wait_for_selector(':text("PROBLEMS"), :text("Generate more")', timeout=25000)
        except Exception:
            pass
        await page.wait_for_timeout(2500)
        await shot(page, "geo_homework_generated")

        # 3) Geometry review queue (full-page Workshop)
        await page.goto(f"{WEB}/school/teacher/courses/{geo['course_id']}/homework/{geo['assignment_id']}/review",
                        wait_until="networkidle")
        await wait_review_ready(page)
        await shot(page, "geo_review_queue")

        fixed = False
        for i in range(7):
            body = (await page.locator("body").inner_text()).lower()
            if "all caught up" in body:
                await shot(page, "geo_all_approved")
                break

            is_tangent = "tangent" in body and "secant" in body
            if is_tangent and not fixed:
                print("  -> AI Workshop edit on the tangent-secant problem")
                await shot(page, "geo_q_tangent_before")
                chat = page.get_by_placeholder("Ask for changes", exact=False)
                await chat.click()
                await chat.fill(
                    "This is labelled a medium problem but the numbers give an ugly "
                    "answer (arc = 386/3 deg, x = 46/3). Please rewrite it as a clean "
                    "tangent-secant angle problem: choose whole-number arc measures and "
                    "an exterior angle so that x and the final arc both come out to whole "
                    "numbers. Keep the same theorem and difficulty."
                )
                await page.get_by_role("button", name="Send").click()
                # wait for the AI proposal (a "✓ Accept" button appears — there
                # are two, one in the chat panel and one in the footer; take first)
                try:
                    accept = page.get_by_role("button", name="✓ Accept").first
                    await accept.wait_for(timeout=75000)
                    await page.wait_for_timeout(1200)
                    await shot(page, "geo_workshop_proposal")
                    await accept.click()
                    await page.wait_for_timeout(2000)
                    await shot(page, "geo_workshop_accepted")
                    fixed = True
                except Exception as e:
                    print(f"  ! proposal wait failed: {e}", flush=True)
                    await shot(page, "geo_workshop_timeout")

            # Approve the current problem (advances the queue)
            try:
                btn = page.locator('button:has-text("Approve")').last
                await btn.click()
                await page.wait_for_timeout(1600)
            except Exception as e:
                print(f"  ! approve failed at item {i}: {e}")
                break

        # 4) Calculus review queue (showcase a strong multi-part problem)
        await page.goto(f"{WEB}/school/teacher/courses/{calc['course_id']}/homework/{calc['assignment_id']}/review",
                        wait_until="networkidle")
        await wait_review_ready(page)
        await shot(page, "calc_review_queue")
        for i in range(6):
            body = (await page.locator("body").inner_text()).lower()
            if "all caught up" in body:
                await shot(page, "calc_all_approved")
                break
            try:
                await page.locator('button:has-text("Approve")').last.click()
                await page.wait_for_timeout(1400)
            except Exception as e:
                print(f"  ! calc approve failed: {e}"); break

        await page.wait_for_timeout(1000)
        await ctx.close()  # finalizes the video
        await browser.close()

        # rename the (single) video file deterministically
        vids = sorted(VID.glob("*.webm"))
        if vids:
            final = VID / "golden-flow.webm"
            if final.exists():
                final.unlink()
            vids[0].rename(final)
            print(f"  video -> {final}")

if __name__ == "__main__":
    asyncio.run(main())
