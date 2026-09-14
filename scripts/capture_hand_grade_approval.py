"""Screenshot the review page's approval states after the hand-grade rule:

  1. Hand-graded, partial   — roster "Partly graded", detail "2/4 graded",
                              no Approve button (nothing to approve).
  2. Hand-graded, complete  — clicking Full on the last two problems drives
                              the REAL grade PATCH; the server stamps
                              reviewed_at and the pill reads "Approved"
                              with no Undo.
  3. AI-graded, unapproved  — "Not reviewed" + Approve ✓, unchanged.
  4. AI-graded, approved, then edited — the approval stays ("Approved" +
                              Undo) instead of reverting to "Not reviewed".

Standalone (not a durable test) — drives the running worktree stack:

    NEXT_PUBLIC_API_URL=http://localhost:8130/v1 \
    WEB_BASE=http://localhost:3130 .venv/bin/python -m scripts.capture_hand_grade_approval

Writes docs/design/hand-grade-approval-*.png.
"""

from __future__ import annotations

import asyncio
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
from api.models.question_bank import QuestionBankItem
from api.models.school import SCHOOL_KIND_INDIVIDUAL, School
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.unit import Unit
from api.models.user import User
from tests.harness.browser import HarnessBrowser

WEB_BASE = os.environ.get("WEB_BASE", "http://localhost:3130").rstrip("/")
OUT_DIR = Path(__file__).resolve().parent.parent / "docs" / "design"
RUBRIC = {"full_credit": "Award full credit for a correct final answer."}


def _entry(pid, percent, *, ai: bool):
    return {
        "problem_id": str(pid),
        "score_status": "full" if percent == 100 else "partial",
        "percent": float(percent),
        "confidence": 0.95 if ai else None,
        "feedback": "Looks right." if ai else None,
        "deductions": None,
    }


def _ai(pos, percent):
    return {
        "problem_position": pos,
        "student_answer": "…",
        "score_status": "full" if percent == 100 else "partial",
        "percent": float(percent),
        "confidence": 0.95,
        "reasoning": "Correct working shown.",
        "student_feedback": "Well done.",
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
            email=f"hand_teacher_{suffix}@t.com",
            password_hash=hash_password("x"), grade_level=12, role="teacher",
            name="Ms. Rivera", school_id=school.id,
        )
        s.add(teacher)
        await s.flush()
        course = Course(name="Algebra I", subject="math", school_id=school.id)
        s.add(course)
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))
        unit = Unit(course_id=course.id, name="Linear Equations", position=0)
        s.add(unit)
        await s.flush()
        section = Section(course_id=course.id, name="Period 3")
        s.add(section)
        await s.flush()
        assignment = Assignment(
            course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
            title="Linear Equations", type="homework", status="published",
            content={"problem_ids": []}, rubric=RUBRIC,
        )
        s.add(assignment)
        await s.flush()

        specs = [
            ("Solve for x:  $2x + 3 = 11$", "$x = 4$"),
            ("Simplify:  $3(x - 4) + 5$", "$3x - 7$"),
            ("Solve for x:  $2(x - 3) = 4x + 8$", "$x = -7$"),
            ("Solve for x:  $5x - 7 = 3x + 2$", r"$x = 4.5$"),
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
        ids: dict[str, str] = {}

        # (name, ai_graded, graded_positions, reviewed)
        roster = [
            ("Avery Hand", False, [0, 1], False),   # hand, partial 2/4
            ("Blake Ai", True, [0, 1, 2, 3], False),  # AI, unapproved
            ("Casey Ai", True, [0, 1, 2, 3], True),   # AI, approved
        ]
        for name, ai_graded, graded, reviewed in roster:
            u = User(
                email=f"{name.split()[0].lower()}_{suffix}@school.edu",
                password_hash=hash_password("x"), grade_level=9, role="student",
                name=name,
            )
            s.add(u)
            await s.flush()
            s.add(SectionEnrollment(
                section_id=section.id, course_id=course.id, student_id=u.id,
            ))
            percents = [100, 100, 73, 100]
            bd = [_entry(pids[i], percents[i], ai=ai_graded) for i in graded]
            score = sum(percents[i] for i in graded) / len(graded)
            sub = Submission(
                assignment_id=assignment.id, student_id=u.id, section_id=section.id,
                status="submitted", extraction={"steps": []},
                extraction_confirmed_at=now - timedelta(hours=1),
                submitted_at=now - timedelta(hours=2),
            )
            s.add(sub)
            await s.flush()
            grade = SubmissionGrade(
                submission_id=sub.id, final_score=score, breakdown=bd,
                graded_at=now - timedelta(minutes=50),
                rubric_snapshot=RUBRIC if ai_graded else None,
            )
            if ai_graded:
                grade.ai_score = score
                grade.ai_breakdown = {"grades": [_ai(i + 1, percents[i]) for i in graded]}
            if reviewed:
                grade.reviewed_by = teacher.id
                grade.reviewed_at = now - timedelta(minutes=31)
            s.add(grade)
            ids[name.split()[0].lower()] = str(u.id)

        refresh = await create_refresh_token(s, teacher.id)
        await s.commit()
        return {
            "course_id": str(course.id),
            "assignment_id": str(assignment.id),
            "section": str(section.id),
            "access": create_access_token(str(teacher.id), "teacher"),
            "refresh": refresh,
            **ids,
        }


async def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print("Seeding hand-grade approval world …")
    w = await seed()

    def review_url(student_id: str) -> str:
        return (
            f"/school/teacher/courses/{w['course_id']}/homework/{w['assignment_id']}"
            f"/sections/{w['section']}/review?student={student_id}"
        )

    async with HarnessBrowser(WEB_BASE) as browser:
        async with browser.authed_page(w["access"], w["refresh"]) as page:
            errors: list[str] = []
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            await page.set_viewport_size({"width": 1440, "height": 1700})

            async def shot(label: str, height: int = 700) -> None:
                out = OUT_DIR / f"hand-grade-approval-{label}.png"
                await page.screenshot(
                    path=str(out),
                    clip={"x": 0, "y": 0, "width": 1440, "height": height},
                )
                print(f"  -> {out}")

            async def open_student(student_id: str) -> None:
                await page.goto(
                    f"{WEB_BASE}{review_url(student_id)}",
                    wait_until="networkidle", timeout=45000,
                )
                await page.wait_for_timeout(1600)

            # 1) Hand-graded, partial: "2/4 graded", no Approve button.
            await open_student(w["avery"])
            await shot("hand-partial")
            assert await page.get_by_text("2/4 graded").count() == 1
            assert await page.get_by_role("button", name="Approve ✓").count() == 0

            # 2) Grade the remaining two problems for real → self-approves.
            #    Hand-graded rows have no AI confidence, so every problem
            #    is expanded; Full buttons 3 and 4 belong to the ungraded
            #    problems.
            full_btns = page.get_by_role("button", name="Full", exact=True)
            assert await full_btns.count() == 4
            for i in (2, 3):
                await full_btns.nth(i).click()
                await page.wait_for_timeout(700)
            await page.wait_for_timeout(1200)
            await shot("hand-complete-approved")
            assert await page.get_by_text("Approved", exact=True).count() >= 1
            assert await page.get_by_role("button", name="Undo", exact=True).count() == 0

            # 3) AI-graded, unapproved: "Not reviewed" + Approve ✓.
            await open_student(w["blake"])
            await shot("ai-not-reviewed")
            assert await page.get_by_role("button", name="Approve ✓").count() == 1

            # 4) AI-graded, approved, then edited: approval stays.
            await open_student(w["casey"])
            # Confident AI rows collapse; expand the first to reach its picker.
            await page.get_by_role("button", name="Expand problem 1", exact=False).first.click()
            await page.wait_for_timeout(400)
            await page.get_by_role("button", name="No credit", exact=True).first.click()
            await page.wait_for_timeout(1500)
            await shot("ai-edit-keeps-approval")
            assert await page.get_by_role("button", name="Undo", exact=True).count() == 1
            assert await page.get_by_role("button", name="Approve ✓").count() == 0

            print(f"  console errors: {len(errors)}")
            for e in errors[:12]:
                print(f"    ! {e}")
            return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
