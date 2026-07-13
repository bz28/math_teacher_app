"""Seed a review world and screenshot the explicit grade-approval UI:
Approve button (disabled + enabled), the Approved ✓ state + Undo, the
roster approval markers, and the unapproved-publish warning.

Standalone (not a durable test) — drives the running worktree stack:
    web :3001, API :8001

    NEXT_PUBLIC_API_URL=http://localhost:8001/v1
    WEB_BASE=http://localhost:3001 .venv/bin/python -m scripts.seed_approval_screens

Writes shots to docs/design/shots-approval-*.png.
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

WEB_BASE = os.environ.get("WEB_BASE", "http://localhost:3001").rstrip("/")
OUT_DIR = Path(__file__).resolve().parent.parent / "docs" / "design"


def _entry(pid, status, percent, conf):
    return {
        "problem_id": str(pid),
        "score_status": status,
        "percent": float(percent),
        "confidence": conf,
        "feedback": "Looks right.",
        "deductions": None,
        "student_answer": "…",
    }


def _ai(pos, status, percent, conf):
    return {
        "problem_position": pos,
        "student_answer": "…",
        "score_status": status,
        "percent": float(percent),
        "confidence": conf,
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
            email=f"appr_teacher_{suffix}@t.com",
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
            content={"problem_ids": []},
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

        # roster entries: (name, n_graded_problems, reviewed, published)
        # n_graded < 4 → a partially-graded submission (Approve disabled).
        roster = [
            ("Maya Chen", 4, False, False),      # fully graded, NOT approved
            ("Pat Owens", 2, False, False),      # HALF graded → Approve disabled
            ("Riley Kim", 4, True, False),       # approved (not yet published)
            ("Noah Walsh", 4, False, False),     # graded, not approved
            ("Aisha Patel", 4, False, False),    # graded, not approved
            ("Sofia Reyes", 4, True, True),      # approved + published
        ]
        for name, n_graded, reviewed, published in roster:
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
            bd = [
                _entry(pids[i], "full" if percents[i] == 100 else "partial",
                       percents[i], 0.97 if percents[i] == 100 else 0.58)
                for i in range(n_graded)
            ]
            ai = [
                _ai(i + 1, "full" if percents[i] == 100 else "partial",
                    percents[i], 0.97 if percents[i] == 100 else 0.58)
                for i in range(4)
            ]
            score = sum(percents[:n_graded]) / n_graded
            sub = Submission(
                assignment_id=assignment.id, student_id=u.id, section_id=section.id,
                status="submitted", extraction={"steps": []},
                extraction_confirmed_at=now - timedelta(hours=1),
                submitted_at=now - timedelta(hours=2),
            )
            s.add(sub)
            await s.flush()
            grade = SubmissionGrade(
                submission_id=sub.id, ai_score=score, final_score=score,
                ai_breakdown={"grades": ai}, breakdown=bd,
                graded_at=now - timedelta(minutes=50),
            )
            if reviewed:
                grade.reviewed_by = teacher.id
                grade.reviewed_at = now - timedelta(minutes=31)
            if published:
                grade.grade_published_at = now - timedelta(minutes=30)
                grade.published_final_score = score
                grade.published_breakdown = bd
            s.add(grade)
            ids[name.split()[0].lower()] = str(u.id)

        refresh = await create_refresh_token(s, teacher.id)
        await s.commit()
        return {
            "course_id": str(course.id),
            "assignment_id": str(assignment.id),
            "section_id": str(section.id),
            "access": create_access_token(str(teacher.id), "teacher"),
            "refresh": refresh,
            **ids,
        }


async def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print("Seeding approval world …")
    w = await seed()

    def review_url(student_id: str) -> str:
        return (
            f"/school/teacher/courses/{w['course_id']}/homework/{w['assignment_id']}"
            f"/sections/{w['section_id']}/review?student={student_id}"
        )

    async with HarnessBrowser(WEB_BASE) as browser:
        async with browser.authed_page(w["access"], w["refresh"]) as page:
            errors: list[str] = []
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            await page.set_viewport_size({"width": 1440, "height": 1600})

            async def shot(label: str, height: int = 430) -> None:
                out = OUT_DIR / f"shots-approval-{label}.png"
                await page.screenshot(
                    path=str(out),
                    clip={"x": 0, "y": 0, "width": 1440, "height": height},
                )
                print(f"  -> {out}")

            # 1) Fully graded, NOT approved → Approve enabled + "Not reviewed".
            await page.goto(f"{WEB_BASE}{review_url(w['maya'])}",
                            wait_until="networkidle", timeout=45000)
            await page.wait_for_timeout(1500)
            await shot("enabled-and-roster", 470)

            # 2) Half graded → Approve disabled with the graded-count hint.
            await page.goto(f"{WEB_BASE}{review_url(w['pat'])}",
                            wait_until="networkidle", timeout=45000)
            await page.wait_for_timeout(1200)
            await shot("disabled", 480)

            # 3) Approved ✓ state + Undo control.
            await page.goto(f"{WEB_BASE}{review_url(w['riley'])}",
                            wait_until="networkidle", timeout=45000)
            await page.wait_for_timeout(1200)
            await shot("approved-undo", 480)

            # 4) Publish → unapproved-publish warning dialog.
            await page.get_by_role("button", name="Publish", exact=False).first.click()
            await page.wait_for_timeout(900)
            out = OUT_DIR / "shots-approval-publish-warning.png"
            await page.screenshot(path=str(out))
            print(f"  -> {out}")

            print(f"  console errors: {len(errors)}")
            for e in errors[:12]:
                print(f"    ! {e}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
