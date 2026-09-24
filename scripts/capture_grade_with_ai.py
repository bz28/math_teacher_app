"""Screens for the per-student "Grade with AI" button and the honest
"Grade N ungraded" count on the teacher review page.

Standalone (not a durable test) — drives a running stack whose API and
this script share DATABASE_URL + JWT_SECRET:

    WEB_BASE=http://localhost:3411 .venv/bin/python -m scripts.capture_grade_with_ai

Seeds `seed_review_screens.seed()` (every submission AI-graded), then
adds four never-graded students:

- Jordan, Emma — readable work, never confirmed by the student (no
  grading job existed; the old "Grade all" moved nothing for them)
- Priya — unreadable photo (confidence under the bar)
- Ethan — the work was never read (no extraction)

The "grade lands" shot waits for the API's real queue → drain → write
path, so it needs a grader: locally that was the API with the LLM call
stubbed to a canned result.

Writes docs/design/shots-grade-with-ai-*.png. `--only-header before`
shoots just the header (for a before shot against the old frontend).
"""

from __future__ import annotations

import argparse
import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import select

from api.core.auth import hash_password
from api.database import get_session_factory
from api.models.assignment import Assignment, Submission
from api.models.section_enrollment import SectionEnrollment
from api.models.user import User
from scripts.seed_review_screens import WEB_BASE, _file_obj, seed
from tests.harness.browser import HarnessBrowser

OUT_DIR = Path(__file__).resolve().parents[1] / "docs" / "design"


def _extraction(confidence: float) -> dict[str, Any]:
    return {
        "steps": [
            {"problem_position": 1, "step_num": 1, "latex": "2x = 8", "plain_english": ""},
            {"problem_position": 1, "step_num": 2, "latex": "x = 4", "plain_english": ""},
            {"problem_position": 3, "step_num": 1, "latex": "2x - 6 = 4x + 8", "plain_english": ""},
            {"problem_position": 3, "step_num": 2, "latex": "x = -7", "plain_english": ""},
        ],
        "final_answers": [
            {"problem_position": 1, "answer_latex": "x = 4", "answer_plain": ""},
            {"problem_position": 3, "answer_latex": "x = -7", "answer_plain": ""},
        ],
        "confidence": confidence,
    }


async def _add_ungraded(world: dict[str, str]) -> dict[str, str]:
    """Four never-graded submissions; returns name → student id."""
    now = datetime.now(UTC)
    specs = [
        ("Jordan Lee", _extraction(0.92)),
        ("Emma Novak", _extraction(0.88)),
        ("Priya Shah", _extraction(0.12)),
        ("Ethan Cole", None),
    ]
    ids: dict[str, str] = {}
    async with get_session_factory()() as s:
        assignment = (await s.execute(
            select(Assignment).where(Assignment.id == uuid.UUID(world["assignment_id"]))
        )).scalar_one()
        for name, extraction in specs:
            u = User(
                email=f"{name.split()[0].lower()}_{uuid.uuid4().hex[:6]}@school.edu",
                password_hash=hash_password("x"), grade_level=9, role="student",
                name=name,
            )
            s.add(u)
            await s.flush()
            s.add(SectionEnrollment(
                section_id=uuid.UUID(world["section_id"]),
                course_id=assignment.course_id, student_id=u.id,
            ))
            s.add(Submission(
                assignment_id=assignment.id, student_id=u.id,
                section_id=uuid.UUID(world["section_id"]),
                status="submitted", files=[_file_obj()],
                extraction=extraction,
                submitted_at=now - timedelta(minutes=40),
            ))
            ids[name.split()[0].lower()] = str(u.id)
        await s.commit()
    return ids


async def _shot(page: Any, name: str, *, header_only: bool = False) -> None:
    out = OUT_DIR / f"shots-grade-with-ai-{name}.png"
    if header_only:
        await page.screenshot(path=str(out), clip={"x": 0, "y": 0, "width": 1440, "height": 260})
    else:
        await page.screenshot(path=str(out), full_page=False)
    print(f"  -> {out}")


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only-header", default=None)
    args = parser.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    w = await seed()
    students = await _add_ungraded(w)
    base = (
        f"{WEB_BASE}/school/teacher/courses/{w['course_id']}/homework/"
        f"{w['assignment_id']}/sections/{w['section_id']}/review"
    )

    errors: list[str] = []
    async with HarnessBrowser(WEB_BASE) as browser:
        async with browser.authed_page(w["access"], w["refresh"]) as page:
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            await page.set_viewport_size({"width": 1440, "height": 900})

            async def open_student(key: str) -> None:
                await page.goto(f"{base}?student={students.get(key, key)}")
                await page.wait_for_load_state("networkidle")
                await page.wait_for_timeout(800)

            if args.only_header:
                await open_student("jordan")
                await _shot(page, f"header-{args.only_header}", header_only=True)
                return 0

            await open_student("jordan")
            await _shot(page, "header-after", header_only=True)
            await _shot(page, "eligible")

            await page.get_by_role("button", name="Grade with AI").click()
            await page.wait_for_timeout(600)
            await _shot(page, "in-progress")

            await page.get_by_text("AI graded · not yet published").wait_for(timeout=90_000)
            await page.wait_for_timeout(600)
            await _shot(page, "landed")

            await open_student(w["maya_id"])
            await _shot(page, "graded-no-button")
            await open_student("priya")
            await _shot(page, "unreadable")
            await open_student("ethan")
            await _shot(page, "not-read")

            # "Grade all" now grades the one it counts (Emma, never
            # confirmed) and the page follows it until it lands.
            await open_student("emma")
            await page.get_by_role("button", name="Grade 1 ungraded").click()
            await page.get_by_text("AI graded · not yet published").wait_for(timeout=90_000)
            await page.wait_for_timeout(600)
            await _shot(page, "grade-all-landed")

    print(f"  console errors: {len(errors)}")
    for e in errors[:5]:
        print(f"    {e}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
