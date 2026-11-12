"""Screenshot reopening a homework for one student, end to end on the real
web app. Reuses the late-policy world (scripts/capture_late_policy): a
"Closed after due date" homework past due, where Riley turned nothing in
and Sam's late work is graded and published.

  teacher-missing-offer       review page, Riley (missing): "Reopen for Riley…"
  teacher-missing-picker      the date picker, with what it does
  teacher-missing-reopened    the personal date in force, Change / Undo
  student-missing-reopened    Riley's homework takes a turn-in again
  teacher-submitted-reopened  Sam reopened: the grade stands until he turns in
  student-resubmit-{desktop,phone}  Sam's "Turn it in again" panel
  student-dashboard-reopened  the dashboard row says why it's back
  student-list-reopened       the course homework list pill
  teacher-earlier-turnins     after Sam turns it in again: the earlier
                              turn-in, with the grade it had
  blast-penalty-review        an un-reopened late turn-in: penalty line intact

    DATABASE_URL=... WEB_BASE=http://localhost:3011 API_BASE=http://localhost:8010/v1 \\
        .venv/bin/python -m scripts.capture_reopen

Writes docs/design/reopen-*.png.
"""

from __future__ import annotations

import asyncio
import base64
import io
import os
import re
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from PIL import Image, ImageDraw

from scripts.capture_late_policy import DESKTOP, OUT_DIR, PHONE, WEB_BASE, seed
from tests.harness.browser import HarnessBrowser

API_BASE = os.environ.get("API_BASE", "http://localhost:8010/v1").rstrip("/")


def _page_jpeg() -> str:
    img = Image.new("RGB", (1200, 1600), "#fffdf7")
    d = ImageDraw.Draw(img)
    for i, line in enumerate(["1) 2x + 3 = 11, x = 4", "2) 3x - 7", "3) 5x = 25, x = 5"]):
        d.text((80, 140 + i * 400), line, fill="#243b6b")
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return base64.b64encode(buf.getvalue()).decode()


async def _shot(page: Any, name: str) -> None:
    out = OUT_DIR / f"reopen-{name}.png"
    await page.screenshot(path=str(out))
    print(f"  -> {out}")


def _review_url(w: dict[str, Any], hw: str, who: str) -> str:
    return (
        f"{WEB_BASE}/school/teacher/courses/{w['course_id']}/homework/{w[hw]}"
        f"/sections/{w['section_id']}/review?student={w['students'][who]['id']}"
    )


async def _teacher(browser: HarnessBrowser, w: dict[str, Any], hw: str, who: str, name: str,
                   wait_text: str) -> None:
    async with browser.authed_page(w["teacher_access"], w["teacher_refresh"]) as page:
        await page.set_viewport_size({"width": 1440, "height": 1000})
        await page.goto(_review_url(w, hw, who), wait_until="networkidle", timeout=60000)
        await page.get_by_text(wait_text).first.wait_for(timeout=30000)
        await page.wait_for_timeout(1200)
        await _shot(page, name)


async def _student(browser: HarnessBrowser, w: dict[str, Any], who: str, path: str, name: str,
                   size: dict[str, int], wait_text: str, *, bottom: bool = False) -> None:
    st = w["students"][who]
    async with browser.authed_page(st["access"], st["refresh"]) as page:
        await page.set_viewport_size(size)
        await page.goto(f"{WEB_BASE}{path}", wait_until="networkidle", timeout=60000)
        await page.get_by_text(wait_text).first.wait_for(timeout=30000)
        skip = page.get_by_role("button", name="Skip for now")
        if await skip.count():
            await skip.click()
        if bottom:
            target = page.get_by_text(wait_text).first
            await target.evaluate("el => el.scrollIntoView({block: 'start'})")
        await page.wait_for_timeout(900)
        await _shot(page, name)


async def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print("Seeding the late-policy world …")
    w = await seed()
    hw_path = f"/school/student/courses/{w['course_id']}/homework/{w['closed_hw']}"
    teacher_h = {"Authorization": f"Bearer {w['teacher_access']}"}
    async with HarnessBrowser(WEB_BASE) as browser:
        # Teacher reopens for Riley, who missed it — through the UI.
        async with browser.authed_page(w["teacher_access"], w["teacher_refresh"]) as page:
            await page.set_viewport_size({"width": 1440, "height": 1000})
            await page.goto(_review_url(w, "closed_hw", "riley"), wait_until="networkidle", timeout=60000)
            # The deep link only pins a student who turned something in.
            await page.get_by_role("button", name=re.compile("Riley Shah")).first.click(timeout=30000)
            offer = page.get_by_role("button", name="Reopen for Riley…")
            await offer.wait_for(timeout=30000)
            await page.wait_for_timeout(900)
            await _shot(page, "teacher-missing-offer")
            await offer.click()
            await page.get_by_label("Reopen for Riley until").wait_for(timeout=15000)
            await page.wait_for_timeout(400)
            await _shot(page, "teacher-missing-picker")
            await page.get_by_role("button", name="Reopen", exact=True).click()
            await page.get_by_text("Reopened · due").first.wait_for(timeout=15000)
            await page.wait_for_timeout(900)
            await _shot(page, "teacher-missing-reopened")
        await _student(browser, w, "riley", hw_path, "student-missing-reopened", DESKTOP,
                       "Submit your homework", bottom=True)

        # Sam had turned it in (late, graded, published): reopen him too.
        sam_id = w["students"]["sam"]["id"]
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                f"{API_BASE}/teacher/assignments/{w['closed_hw']}/students/{sam_id}/reopen",
                json={"due_at": (datetime.now(UTC) + timedelta(days=3)).isoformat()}, headers=teacher_h,
            )
            r.raise_for_status()
        await _teacher(browser, w, "closed_hw", "sam", "teacher-submitted-reopened", "can turn it in once more")
        await _student(browser, w, "sam", hw_path, "student-resubmit-desktop", DESKTOP,
                       "Reopened by your teacher", bottom=True)
        await _student(browser, w, "sam", hw_path, "student-resubmit-phone", PHONE,
                       "Reopened by your teacher", bottom=True)
        await _student(browser, w, "sam", "/school/student", "student-dashboard-reopened", DESKTOP,
                       "Reopened by your teacher")
        await _student(browser, w, "sam", f"/school/student/courses/{w['course_id']}",
                       "student-list-reopened", DESKTOP, "Reopened · turn it in again")

        # Sam turns it in again: the teacher sees the earlier turn-in.
        sam_h = {"Authorization": f"Bearer {w['students']['sam']['access']}"}
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(
                f"{API_BASE}/school/student/homework/{w['closed_hw']}/submit",
                json={"files": [_page_jpeg()]}, headers=sam_h,
            )
            r.raise_for_status()
        await _teacher(browser, w, "closed_hw", "sam", "teacher-earlier-turnins",
                       "Turned in again after you reopened it")

        # Blast radius: a late turn-in nobody reopened keeps its penalty line.
        await _teacher(browser, w, "penalty_hw", "alex", "blast-penalty-review", "Waive penalty")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
