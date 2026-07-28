"""Before/after shots of the "Grade all" control on the teacher review page.

Standalone (not a durable test) — drives the running stack:
    web :3001, API :8000

    .venv/bin/python -m scripts.capture_grade_all_button

Reuses `seed_review_screens.seed()` for the world, then clears the AI
grade off two submissions so the header has something to grade. BEFORE
is that same header with everything graded (no button — the control is
absent, not disabled, so its presence always means "there's work").

Writes to docs/design/shots-grade-all-{before,after}.png.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

from sqlalchemy import select

from api.database import get_session_factory
from api.models.assignment import Submission, SubmissionGrade
from scripts.seed_review_screens import WEB_BASE, seed
from tests.harness.browser import HarnessBrowser

OUT_DIR = Path(__file__).resolve().parents[1] / "docs" / "design"


async def _ungrade(assignment_id: str, how_many: int) -> int:
    """Clear the AI grade off `how_many` submissions so they read as
    ungraded — the state a class is in before its due date passes."""
    async with get_session_factory()() as s:
        sub_ids = (await s.execute(
            select(Submission.id)
            .where(Submission.assignment_id == assignment_id)
            .limit(how_many)
        )).scalars().all()
        cleared = 0
        for sid in sub_ids:
            grade = (await s.execute(
                select(SubmissionGrade).where(
                    SubmissionGrade.submission_id == sid,
                )
            )).scalar_one_or_none()
            if grade is None:
                continue
            grade.final_score = None
            grade.ai_score = None
            grade.breakdown = None
            grade.grade_published_at = None
            grade.reviewed_at = None
            cleared += 1
        await s.commit()
        return cleared


async def _shoot(page, url: str, label: str) -> None:
    await page.goto(f"{WEB_BASE}{url}")
    await page.wait_for_load_state("networkidle")
    out = OUT_DIR / f"shots-grade-all-{label}.png"
    # Header band only — the control lives beside Publish, and a
    # full-page shot would bury a pill-sized change in 2000px of roster.
    await page.set_viewport_size({"width": 1440, "height": 420})
    await page.screenshot(path=str(out), full_page=False)
    print(f"  -> {out}")


async def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print("Seeding review world …")
    w = await seed()
    review = (
        f"/school/teacher/courses/{w['course_id']}/homework/{w['assignment_id']}"
        f"/sections/{w['section_id']}/review?student={w['maya_id']}"
    )

    errors: list[str] = []
    async with HarnessBrowser(WEB_BASE) as browser:
        async with browser.authed_page(w["access"], w["refresh"]) as page:
            page.on(
                "console",
                lambda m: errors.append(m.text) if m.type == "error" else None,
            )
            # BEFORE — everything graded, so no Grade-all control at all.
            await _shoot(page, review, "before")

            cleared = await _ungrade(w["assignment_id"], 2)
            print(f"  cleared the AI grade off {cleared} submissions")

            # AFTER — two ungraded, so the control appears with its count.
            await _shoot(page, review, "after")

    print(f"  console errors: {len(errors)}")
    for e in errors[:5]:
        print(f"    {e}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
