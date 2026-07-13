"""Screenshot the "editing an approved grade revokes the approval" flow.

Reuses the approval seed world (scripts.seed_approval_screens.seed), opens
an APPROVED + fully-graded submission (Riley), captures the "Approved ✓"
state, then edits one problem's grade and captures the revert to
"Not reviewed" with the Approve button re-enabled.

Standalone (not a durable test) — drives the running worktree stack:

    WEB_BASE=http://localhost:3002 .venv/bin/python -m scripts.capture_revoke_screens

Writes docs/design/shots-approval-revoke-before.png / -after.png.
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

from scripts.seed_approval_screens import seed
from tests.harness.browser import HarnessBrowser

WEB_BASE = os.environ.get("WEB_BASE", "http://localhost:8081").rstrip("/")
OUT_DIR = Path(__file__).resolve().parent.parent / "docs" / "design"


async def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print("Seeding approval world …")
    w = await seed()

    review_url = (
        f"/school/teacher/courses/{w['course_id']}/homework/{w['assignment_id']}"
        f"/sections/{w['section_id']}/review?student={w['riley']}"
    )

    async with HarnessBrowser(WEB_BASE) as browser:
        async with browser.authed_page(w["access"], w["refresh"]) as page:
            errors: list[str] = []
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            await page.set_viewport_size({"width": 1440, "height": 1600})

            async def shot(label: str, height: int = 520) -> None:
                out = OUT_DIR / f"shots-approval-{label}.png"
                await page.screenshot(
                    path=str(out),
                    clip={"x": 0, "y": 0, "width": 1440, "height": height},
                )
                print(f"  -> {out}")

            # Riley: approved + fully graded → the panel shows "Approved ✓"
            # (pill + Undo) and the roster marker reads approved.
            await page.goto(f"{WEB_BASE}{review_url}",
                            wait_until="networkidle", timeout=45000)
            await page.wait_for_timeout(1500)
            approved = await page.get_by_text("Approved", exact=True).count()
            undo = await page.get_by_role("button", name="Undo", exact=True).count()
            print(f"  before edit: 'Approved' pills={approved}, Undo buttons={undo}")
            await shot("revoke-before", 520)

            # Edit one problem's grade (the expanded uncertain P3, currently
            # Partial) → click "No credit". A real grade save through the same
            # path a teacher uses, which must revoke the approval.
            await page.get_by_role("button", name="No credit", exact=True).first.click()
            # Let the optimistic revert + save settle.
            await page.wait_for_timeout(1800)

            approved_after = await page.get_by_text("Approved", exact=True).count()
            approve_btn = await page.get_by_role(
                "button", name="Approve ✓", exact=True
            ).count()
            print(f"  after edit: 'Approved' pills={approved_after}, "
                  f"'Approve ✓' buttons={approve_btn}")
            await shot("revoke-after", 520)

            print(f"  console errors: {len(errors)}")
            for e in errors[:12]:
                print(f"    ! {e}")

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
