"""End-to-end save-path check for the redesigned review screen.

Seeds a world, opens the review screen in a real browser, exercises:
  1. a collapsed-row CONFIRM (click the Confirm chip) -> submission
     reviewed_at gets stamped (no grade mutation), and
  2. a grade OVERRIDE on the uncertain Q3 (click 'No credit') -> the
     percent drops to 0, final_score recomputes, and the AI deduction
     ledger is dropped (override no longer reconciles).
Asserts the persisted state via the teacher API. Drives the running
stack (web :3001, API :8000).
"""

from __future__ import annotations

import asyncio
import json
import os
import urllib.request

from scripts.seed_review_screens import seed
from tests.harness.browser import HarnessBrowser

WEB_BASE = os.environ.get("WEB_BASE", "http://localhost:3001").rstrip("/")
API_BASE = os.environ.get("API_BASE", "http://localhost:8000/v1").rstrip("/")


def _api_get(path: str, token: str) -> dict:
    req = urllib.request.Request(
        f"{API_BASE}{path}", headers={"Authorization": f"Bearer {token}"}
    )
    with urllib.request.urlopen(req, timeout=20) as r:  # noqa: S310
        return json.loads(r.read())


async def main() -> int:
    w = await seed()
    review = (
        f"/school/teacher/courses/{w['course_id']}/homework/{w['assignment_id']}"
        f"/sections/{w['section_id']}/review?student={w['maya_id']}"
    )

    # Find Maya's submission id via the teacher submissions feed.
    subs = _api_get(f"/teacher/assignments/{w['assignment_id']}/submissions", w["access"])
    maya_sub = next(
        r for r in subs["submissions"] if r["student_id"] == w["maya_id"]
    )
    sub_id = maya_sub["id"]
    before = _api_get(f"/teacher/submissions/{sub_id}", w["access"])
    q3_before = next(b for b in before["breakdown"] if b["percent"] == 73.0)
    assert q3_before["deductions"], "seed should carry a Q3 deduction ledger"
    assert before["reviewed_at"] is None, "starts unreviewed"
    print(f"  before: final_score={before['final_score']:.1f} reviewed_at=None "
          f"q3.deductions={len(q3_before['deductions'])} lines")

    async with HarnessBrowser(WEB_BASE) as browser:
        async with browser.authed_page(w["access"], w["refresh"]) as page:
            errors: list[str] = []
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            await page.set_viewport_size({"width": 1440, "height": 1800})
            await page.goto(f"{WEB_BASE}{review}", wait_until="networkidle", timeout=45000)
            await page.wait_for_timeout(1200)

            # 1. Confirm a collapsed confident row (Q1).
            await page.get_by_role("button", name="Confirm 1").first.click()
            await page.wait_for_timeout(800)

            # 2. Override Q3 to No credit (drops the AI ledger).
            await page.get_by_role("button", name="No credit", exact=False).first.click()
            await page.wait_for_timeout(1200)

    after = _api_get(f"/teacher/submissions/{sub_id}", w["access"])
    q3_after = next(b for b in after["breakdown"] if b["problem_id"] == q3_before["problem_id"])
    print(f"  after:  final_score={after['final_score']:.1f} "
          f"reviewed_at={'set' if after['reviewed_at'] else 'None'} "
          f"q3.status={q3_after['score_status']} q3.percent={q3_after['percent']} "
          f"q3.deductions={q3_after.get('deductions')}")

    ok = True
    if after["reviewed_at"] is None:
        print("  FAIL: confirm did not stamp reviewed_at")
        ok = False
    if q3_after["score_status"] != "zero" or q3_after["percent"] != 0.0:
        print("  FAIL: Q3 override did not persist as zero")
        ok = False
    if q3_after.get("deductions") is not None:
        print("  FAIL: AI ledger survived an override (should drop)")
        ok = False
    if errors:
        print(f"  console errors: {len(errors)} -> {errors[:5]}")
    print("  RESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
