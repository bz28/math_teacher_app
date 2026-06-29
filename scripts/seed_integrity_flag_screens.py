"""Seed a flagged integrity submission and screenshot the new teacher
"Mark reviewed" / resolution flow on the review page.

Standalone (not a durable test) — drives the running stack:
    web :3001, API on $NEXT_PUBLIC_API_URL (default :8000)

    .venv/bin/python -m scripts.seed_integrity_flag_screens

Captures, into docs/design/:
  shots-integrity-flag-resolution-1-banner.png   — flagged banner + "Mark reviewed"
  shots-integrity-flag-resolution-2-picker.png   — outcome picker
  shots-integrity-flag-resolution-3-resolved.png — de-emphasized resolved banner
  shots-integrity-flag-resolution-4-roster.png   — flagged roster filter (post-resolve)
"""

from __future__ import annotations

import asyncio
import base64
import os
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from api.core.auth import create_access_token, create_refresh_token, hash_password
from api.database import get_session_factory
from api.models.assignment import (
    Assignment,
    AssignmentSection,
    Submission,
    SubmissionGrade,
)
from api.models.course import Course, CourseTeacher
from api.models.integrity_check import (
    IntegrityCheckProblem,
    IntegrityCheckSubmission,
    IntegrityConversationTurn,
)
from api.models.question_bank import QuestionBankItem
from api.models.school import SCHOOL_KIND_INDIVIDUAL, School
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.unit import Unit
from api.models.user import User
from tests.harness.browser import HarnessBrowser

WEB_BASE = os.environ.get("WEB_BASE", "http://localhost:3001").rstrip("/")
OUT_DIR = Path(__file__).resolve().parent.parent / "docs" / "design"


def _work_svg() -> str:
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" '
        'viewBox="0 0 640 420"><rect width="640" height="420" fill="#fdfcf7"/>'
        '<text x="60" y="90" font-family="Caveat, cursive" font-size="28" '
        'fill="#243b6b">x² − 5x + 6 = 0</text>'
        '<text x="60" y="150" font-family="Caveat, cursive" font-size="28" '
        'fill="#243b6b">(x − 2)(x − 3) = 0</text>'
        '<text x="60" y="210" font-family="Caveat, cursive" font-size="28" '
        'fill="#16794f">x = 2,  x = 3</text></svg>'
    )
    return svg


def _file_obj() -> dict[str, str]:
    return {
        "data": base64.b64encode(_work_svg().encode()).decode(),
        "media_type": "image/svg+xml",
    }


def _grade_entry(pid, status, percent, conf, feedback, answer=None):
    return {
        "problem_id": str(pid),
        "score_status": status,
        "percent": float(percent),
        "confidence": conf,
        "feedback": feedback,
        "deductions": None,
        "student_answer": answer,
    }


async def seed() -> dict[str, str]:
    async with get_session_factory()() as s:
        suffix = uuid.uuid4().hex[:6]
        school = School(
            name="Lincoln High", kind=SCHOOL_KIND_INDIVIDUAL,
            contact_name="Demo", contact_email=f"demo_{suffix}@t.com",
        )
        s.add(school)
        await s.flush()

        teacher = User(
            email=f"flag_teacher_{suffix}@t.com",
            password_hash=hash_password("x"), grade_level=12, role="teacher",
            name="Ms. Rivera", school_id=school.id,
        )
        s.add(teacher)
        await s.flush()

        course = Course(name="Algebra I", subject="math", school_id=school.id)
        s.add(course)
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))
        unit = Unit(course_id=course.id, name="Quadratics", position=0)
        s.add(unit)
        await s.flush()
        section = Section(course_id=course.id, name="Period 3")
        s.add(section)
        await s.flush()

        assignment = Assignment(
            course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
            title="Quadratics", type="homework", status="published",
            content={"problem_ids": []},
        )
        s.add(assignment)
        await s.flush()

        specs = [
            ("Solve:  $x^2 - 5x + 6 = 0$", "$x = 2, 3$"),
            ("Solve:  $x^2 - 9 = 0$", "$x = \\pm 3$"),
        ]
        items = []
        for i, (q, ans) in enumerate(specs):
            it = QuestionBankItem(
                course_id=course.id, unit_id=unit.id,
                originating_assignment_id=assignment.id,
                title=f"P{i + 1}", question=q, final_answer=ans,
                difficulty="medium", format="frq", status="approved",
            )
            items.append(it)
            s.add(it)
        await s.flush()
        pids = [it.id for it in items]
        assignment.content = {"problem_ids": [str(p) for p in pids]}

        s.add(AssignmentSection(
            assignment_id=assignment.id, section_id=section.id,
            published_at=datetime.now(UTC),
        ))

        now = datetime.now(UTC)

        # ── Maya: the flagged student ──
        maya = User(
            email=f"maya.chen_{suffix}@school.edu", password_hash=hash_password("x"),
            grade_level=9, role="student", name="Maya Chen",
        )
        s.add(maya)
        await s.flush()
        s.add(SectionEnrollment(
            section_id=section.id, course_id=course.id, student_id=maya.id,
        ))
        maya_bd = [
            _grade_entry(pids[0], "full", 100, 0.97, "Correct factoring.", "x = 2, 3"),
            _grade_entry(pids[1], "full", 100, 0.96, "Correct.", "x = ±3"),
        ]
        maya_sub = Submission(
            assignment_id=assignment.id, student_id=maya.id, section_id=section.id,
            status="submitted", files=[_file_obj()],
            extraction={"steps": []},
            extraction_confirmed_at=now - timedelta(hours=1),
            submitted_at=now - timedelta(hours=2),
        )
        s.add(maya_sub)
        await s.flush()
        # Clean, published grade so the ONLY "needs attention" signal is
        # the integrity flag — proves the resolution clears it.
        s.add(SubmissionGrade(
            submission_id=maya_sub.id, ai_score=100.0, final_score=100.0,
            ai_breakdown={"grades": []}, breakdown=maya_bd,
            graded_at=now - timedelta(minutes=50),
            grade_published_at=now - timedelta(minutes=30),
            published_final_score=100.0, published_breakdown=maya_bd,
            reviewed_by=teacher.id, reviewed_at=now - timedelta(minutes=31),
        ))

        # Integrity check — flagged disposition, unresolved.
        check = IntegrityCheckSubmission(
            submission_id=maya_sub.id, status="complete",
            disposition="flag_for_review",
            headline="Review — correct work but couldn't explain it",
            overall_summary=(
                "Maya's written solution was correct, but across three turns "
                "she couldn't describe why factoring works or predict a "
                "variant — the verbal account didn't match the page."
            ),
            resolution="unresolved",
        )
        s.add(check)
        await s.flush()
        s.add(IntegrityCheckProblem(
            integrity_check_submission_id=check.id, bank_item_id=pids[0],
            sample_position=0, status="verdict_submitted",
            rubric={"paraphrase_originality": "low", "causal_fluency": "low"},
            ai_reasoning=(
                "Asked to explain the factoring step, Maya restated the answer "
                "without describing the reasoning; couldn't predict the roots "
                "of a sign-flipped variant."
            ),
        ))
        opener = (
            "Hi Maya! Nice work on the quadratics. Can you walk me through how "
            "you knew to factor $x^2 - 5x + 6$ into $(x-2)(x-3)$?"
        )
        s.add(IntegrityConversationTurn(
            integrity_check_submission_id=check.id, ordinal=0, role="agent",
            content=opener,
        ))
        s.add(IntegrityConversationTurn(
            integrity_check_submission_id=check.id, ordinal=1, role="student",
            content="I just knew it was 2 and 3.", seconds_on_turn=42,
        ))
        s.add(IntegrityConversationTurn(
            integrity_check_submission_id=check.id, ordinal=2, role="agent",
            content="What about the numbers 2 and 3 makes them the answers?",
        ))
        s.add(IntegrityConversationTurn(
            integrity_check_submission_id=check.id, ordinal=3, role="student",
            content="not sure", seconds_on_turn=8,
        ))

        # ── A second, clean student so the roster has a sibling row ──
        liam = User(
            email=f"liam_{suffix}@school.edu", password_hash=hash_password("x"),
            grade_level=9, role="student", name="Liam Walsh",
        )
        s.add(liam)
        await s.flush()
        s.add(SectionEnrollment(
            section_id=section.id, course_id=course.id, student_id=liam.id,
        ))
        liam_bd = [
            _grade_entry(pids[0], "full", 100, 0.98, "Correct.", "x = 2, 3"),
            _grade_entry(pids[1], "full", 100, 0.97, "Correct.", "x = ±3"),
        ]
        liam_sub = Submission(
            assignment_id=assignment.id, student_id=liam.id, section_id=section.id,
            status="submitted", files=[_file_obj()], extraction={"steps": []},
            extraction_confirmed_at=now - timedelta(hours=1),
            submitted_at=now - timedelta(hours=2),
        )
        s.add(liam_sub)
        await s.flush()
        s.add(SubmissionGrade(
            submission_id=liam_sub.id, ai_score=100.0, final_score=100.0,
            ai_breakdown={"grades": []}, breakdown=liam_bd,
            graded_at=now - timedelta(minutes=50),
        ))
        lcheck = IntegrityCheckSubmission(
            submission_id=liam_sub.id, status="complete", disposition="pass",
            headline="Student understood their own work",
            overall_summary="Liam explained each factoring step clearly.",
            resolution="unresolved",
        )
        s.add(lcheck)
        await s.flush()
        s.add(IntegrityCheckProblem(
            integrity_check_submission_id=lcheck.id, bank_item_id=pids[0],
            sample_position=0, status="verdict_submitted",
            rubric={"paraphrase_originality": "high", "causal_fluency": "high"},
            ai_reasoning="Clear, original explanation of the factoring logic.",
        ))

        refresh = await create_refresh_token(s, teacher.id)
        await s.commit()

        return {
            "course_id": str(course.id),
            "assignment_id": str(assignment.id),
            "section_id": str(section.id),
            "maya_id": str(maya.id),
            "access": create_access_token(str(teacher.id), "teacher"),
            "refresh": refresh,
        }


async def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print("Seeding flagged integrity world …")
    w = await seed()
    review = (
        f"/school/teacher/courses/{w['course_id']}/homework/{w['assignment_id']}"
        f"/sections/{w['section_id']}/review?student={w['maya_id']}"
    )
    print(f"  review url: {WEB_BASE}{review}")

    async with HarnessBrowser(WEB_BASE) as browser:
        async with browser.authed_page(w["access"], w["refresh"]) as page:
            errors: list[str] = []
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            await page.set_viewport_size({"width": 1440, "height": 1600})
            await page.goto(f"{WEB_BASE}{review}", wait_until="networkidle", timeout=45000)
            await page.wait_for_timeout(2000)

            async def clip_banner(label: str, height: int = 340) -> None:
                """Clip the integrity banner region (anchored on its title)."""
                anchor = page.get_by_text(
                    "correct work but couldn't explain", exact=False,
                ).first
                box = await anchor.bounding_box()
                out = OUT_DIR / f"shots-integrity-flag-resolution-{label}.png"
                if not box:
                    await page.screenshot(path=str(out))
                    return
                x = max(0, box["x"] - 60)
                y = max(0, box["y"] - 70)
                await page.screenshot(
                    path=str(out),
                    clip={"x": x, "y": y, "width": min(960, 1440 - x), "height": height},
                )
                print(f"  -> {out}")

            async def clip_roster(label: str) -> None:
                """Clip the triage-roster column (between nav + detail)."""
                out = OUT_DIR / f"shots-integrity-flag-resolution-{label}.png"
                await page.screenshot(
                    path=str(out),
                    clip={"x": 248, "y": 150, "width": 320, "height": 620},
                )
                print(f"  -> {out}")

            # 0. Roster BEFORE — flagged filter shows Maya as flagged.
            try:
                await page.get_by_role(
                    "button", name="Flagged", exact=False,
                ).first.click()
                await page.wait_for_timeout(700)
                await clip_roster("0-roster-flagged-before")
                # Reset to All so the resolved row stays visible after.
                await page.get_by_role("button", name="All", exact=True).first.click()
                await page.wait_for_timeout(500)
            except Exception as e:  # noqa: BLE001
                print(f"  (before-roster step skipped: {e})")

            # 1. Flagged banner with the "Mark reviewed" action.
            await clip_banner("1-banner")

            # 2. Open the outcome picker (taller clip — all three outcomes).
            await page.get_by_role("button", name="Mark reviewed").first.click()
            await page.wait_for_timeout(500)
            await clip_banner("2-picker", height=480)

            # 3. Choose "Cleared" → resolved, de-emphasized banner.
            await page.get_by_role(
                "button", name="Cleared", exact=False,
            ).first.click()
            await page.wait_for_timeout(1800)
            await clip_banner("3-resolved")

            # 4. Roster AFTER — Maya is "Reviewed by you", the Flagged
            #    filter is now empty (count 0), so it disables itself.
            await clip_roster("4-roster-after")

            # 5. Full review page post-resolve — roster + de-emphasized
            #    banner together, for unambiguous before/after context.
            full = OUT_DIR / "shots-integrity-flag-resolution-5-full.png"
            await page.screenshot(path=str(full), full_page=False)
            print(f"  -> {full}")

            print(f"  console errors: {len(errors)}")
            for e in errors[:10]:
                print(f"    ! {e}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
