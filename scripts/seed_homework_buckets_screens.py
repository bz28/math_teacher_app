"""Seed a teacher homework tab that exercises the fixed bucketing logic and
screenshot it: a past-due, fully-submitted, ALL-GRADED-BUT-UNPUBLISHED HW
now lands in NEEDS GRADING (with the "all N graded — review & publish"
card) instead of silently in COMPLETED, and a fully-PUBLISHED HW lands in
COMPLETED.

Standalone (not a durable test) — drives the running stack:
    web :3001, API :8000  (NEXT_PUBLIC_API_URL defaults API to :8000)

    .venv/bin/python -m scripts.seed_homework_buckets_screens

Writes shots to docs/design/homework-buckets-*.png.
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

STUDENT_NAMES = [
    "Maya Chen", "Liam Walsh", "Noah Kim", "Sofia Reyes", "Aisha Patel",
]


async def seed() -> dict[str, str]:
    async with get_session_factory()() as s:
        suffix = uuid.uuid4().hex[:6]
        now = datetime.now(UTC)

        school = School(
            name="Lincoln High", kind=SCHOOL_KIND_INDIVIDUAL,
            contact_name="Demo", contact_email=f"demo_{suffix}@t.com",
        )
        s.add(school)
        await s.flush()

        teacher = User(
            email=f"buckets_teacher_{suffix}@t.com",
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

        # 5 enrolled students in Period 3.
        students: list[User] = []
        for i, name in enumerate(STUDENT_NAMES):
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
            students.append(u)

        async def make_hw(
            title: str,
            due_at: datetime,
            n_submitted: int,
            *,
            publish: bool,
        ) -> Assignment:
            """Create a published HW with `n_submitted` graded submissions.
            When `publish` is True every grade is released to students."""
            a = Assignment(
                course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
                title=title, type="homework", status="published",
                due_at=due_at, content={"problem_ids": []},
            )
            s.add(a)
            await s.flush()

            pids = []
            for i in range(4):
                it = QuestionBankItem(
                    course_id=course.id, unit_id=unit.id,
                    originating_assignment_id=a.id,
                    title=f"P{i + 1}", question=f"Problem {i + 1}",
                    final_answer="$x = 4$", difficulty="medium",
                    format="frq", status="approved",
                )
                s.add(it)
                pids.append(it)
            await s.flush()
            a.content = {"problem_ids": [str(p.id) for p in pids]}
            s.add(AssignmentSection(
                assignment_id=a.id, section_id=section.id,
                published_at=now - timedelta(days=10),
            ))

            for i in range(n_submitted):
                stu = students[i]
                sub = Submission(
                    assignment_id=a.id, student_id=stu.id, section_id=section.id,
                    status="submitted", files=[],
                    extraction={"steps": []},
                    extraction_confirmed_at=now - timedelta(hours=3),
                    submitted_at=now - timedelta(hours=2),
                )
                s.add(sub)
                await s.flush()
                score = 88.0 + i * 2  # AI-graded on submit (final_score set)
                grade = SubmissionGrade(
                    submission_id=sub.id, ai_score=score, final_score=score,
                    ai_breakdown={"grades": []}, breakdown=[],
                    graded_at=now - timedelta(hours=1, minutes=50),
                )
                if publish:
                    grade.grade_published_at = now - timedelta(minutes=30)
                    grade.published_final_score = score
                    grade.published_breakdown = []
                    grade.reviewed_by = teacher.id
                    grade.reviewed_at = now - timedelta(minutes=31)
                s.add(grade)
            return a

        # NEEDS GRADING target: past due, whole class submitted, every grade
        # AI-scored (graded) but NONE published → the fix routes it here.
        await make_hw(
            "Two-Step Equations", now - timedelta(days=2), 5, publish=False,
        )
        # COMPLETED target: past due, whole class submitted, all published.
        await make_hw(
            "Fraction Operations", now - timedelta(days=4), 5, publish=True,
        )
        # DUE THIS WEEK: active (future) HW, partial unpublished submissions —
        # must NOT be nagged for grading (proves the pre-due guard).
        await make_hw(
            "Graphing Linear Functions", now + timedelta(days=3), 2, publish=False,
        )

        refresh = await create_refresh_token(s, teacher.id)
        await s.commit()

        return {
            "course_id": str(course.id),
            "access": create_access_token(str(teacher.id), "teacher"),
            "refresh": refresh,
        }


async def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print("Seeding homework buckets world …")
    w = await seed()
    url = f"/school/teacher/courses/{w['course_id']}?tab=homework"
    print(f"  homework tab: {WEB_BASE}{url}")

    async with HarnessBrowser(WEB_BASE) as browser:
        async with browser.authed_page(w["access"], w["refresh"]) as page:
            errors: list[str] = []
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            await page.set_viewport_size({"width": 1280, "height": 1600})
            await page.goto(f"{WEB_BASE}{url}", wait_until="networkidle", timeout=45000)
            await page.wait_for_timeout(2000)

            # Expand the COMPLETED bucket (collapsed by default when other
            # buckets have items) so the screenshot shows the published HW.
            try:
                show = page.get_by_text("Show all", exact=False).first
                if await show.count():
                    await show.click()
                    await page.wait_for_timeout(500)
            except Exception as e:  # noqa: BLE001
                print(f"  (no COMPLETED expander: {e})")

            out = OUT_DIR / "homework-buckets-after.png"
            await page.screenshot(path=str(out), full_page=True)
            print(f"  -> {out}")

            print(f"  console errors: {len(errors)}")
            for e in errors[:10]:
                print(f"    ! {e}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
