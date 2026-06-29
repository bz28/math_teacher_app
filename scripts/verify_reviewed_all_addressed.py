"""Drive the redesigned review page to verify the all-addressed reviewed
semantics end to end (NOT a durable test — a one-shot browser check):

    web :3001, API :8001

    .venv/bin/python scripts/verify_reviewed_all_addressed.py

Reuses scripts.seed_review_screens.seed() to seed Ms. Rivera's class with
Maya Chen's 4-problem submission (3 confident, 1 uncertain). Then:
  1. shoots the initial state (0 of 4 addressed, not reviewed),
  2. clicks "Confirm all 3 confident" → asserts NOT reviewed (3 of 4),
  3. grades the last uncertain problem → asserts "Reviewed by you".
Writes shots to docs/design/shots-reviewed-all-addressed-*.png.
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

from scripts.seed_review_screens import seed
from tests.harness.browser import HarnessBrowser

WEB_BASE = os.environ.get("WEB_BASE", "http://localhost:3001").rstrip("/")
OUT_DIR = Path(__file__).resolve().parent.parent / "docs" / "design"


async def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print("Seeding review world …")
    w = await seed()
    review = (
        f"/school/teacher/courses/{w['course_id']}/homework/{w['assignment_id']}"
        f"/sections/{w['section_id']}/review?student={w['maya_id']}"
    )
    print(f"  review url: {WEB_BASE}{review}")

    async with HarnessBrowser(WEB_BASE) as browser:
        async with browser.authed_page(w["access"], w["refresh"]) as page:
            errors: list[str] = []
            page.on(
                "console",
                lambda m: errors.append(m.text) if m.type == "error" else None,
            )
            page.on("pageerror", lambda e: errors.append(str(e)))
            await page.set_viewport_size({"width": 1440, "height": 1600})
            await page.goto(
                f"{WEB_BASE}{review}", wait_until="networkidle", timeout=45000
            )
            await page.wait_for_timeout(1500)

            async def has_reviewed_badge() -> bool:
                # "Reviewed by you" appears in BOTH the roster (left pane —
                # Sofia is seeded reviewed) and the detail header (right pane).
                # Scope to the detail pane by x-position so we read MAYA's
                # state, not a roster row's.
                loc = page.get_by_text("Reviewed by you", exact=False)
                for i in range(await loc.count()):
                    box = await loc.nth(i).bounding_box()
                    if box and box["x"] > 360:
                        return True
                return False

            async def addressed_chip() -> str:
                loc = page.get_by_text("addressed", exact=False)
                if await loc.count() == 0:
                    return "(none)"
                return (await loc.first.inner_text()).strip()

            # ── State 0: nothing addressed yet ───────────────────────────
            print(f"  initial addressed chip: {await addressed_chip()!r}")
            print(f"  initial reviewed badge: {await has_reviewed_badge()}")
            await page.screenshot(
                path=str(OUT_DIR / "shots-reviewed-all-addressed-0-initial.png"),
                full_page=False,
            )

            # ── Confirm the 3 confident → still NOT reviewed (3 of 4) ─────
            confirm_all = page.get_by_role(
                "button", name="Confirm all", exact=False
            )
            assert await confirm_all.count() > 0, "Confirm-all button missing"
            await confirm_all.first.click()
            await page.wait_for_timeout(900)
            chip_partial = await addressed_chip()
            reviewed_partial = await has_reviewed_badge()
            print(f"  after Confirm-all: chip={chip_partial!r} reviewed={reviewed_partial}")
            assert not reviewed_partial, (
                "REGRESSION: submission marked reviewed after confirming only "
                "the confident subset — uncertain problem still unaddressed"
            )
            await page.screenshot(
                path=str(
                    OUT_DIR / "shots-reviewed-all-addressed-1-partial-not-reviewed.png"
                ),
                full_page=False,
            )

            # ── Grade the last uncertain problem → fully addressed ───────
            # Only the expanded uncertain row renders the Full/Partial/No-credit
            # picker; the confident rows are collapsed to a confirm chip.
            partial_btn = page.get_by_role("button", name="Partial", exact=False)
            assert await partial_btn.count() > 0, "uncertain-row grade picker missing"
            await partial_btn.first.click()
            await page.wait_for_timeout(1600)
            chip_full = await addressed_chip()
            reviewed_full = await has_reviewed_badge()
            print(f"  after grading last: chip={chip_full!r} reviewed={reviewed_full}")
            assert reviewed_full, (
                "submission did NOT become reviewed once every problem was "
                "addressed (confident confirmed + uncertain graded)"
            )
            await page.screenshot(
                path=str(
                    OUT_DIR / "shots-reviewed-all-addressed-2-full-reviewed.png"
                ),
                full_page=False,
            )

            print(f"  console errors: {len(errors)}")
            for e in errors[:10]:
                print(f"    ! {e}")
    print("OK — all-addressed reviewed semantics verified.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
