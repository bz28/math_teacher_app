"""Screenshot the proportional delete gate on the school page.

Standalone (not a durable test) — drives the running stack:
    dashboard :5173, API :8000

    .venv/bin/python -m scripts.capture_user_delete_gate

The whole claim of this feature is that the friction MATCHES the
damage, so one screenshot proves nothing. It captures three states:

  1. the school page showing the new per-teacher / per-student actions
  2. deleting a teacher who owns graded student work — counts plus the
     type-the-name gate, with the confirm button disabled
  3. deleting a student with nothing attached — an ordinary confirm,
     no ceremony, which is what stops operators learning to click
     through the scary one

Writes docs/design/admin-user-delete-*.png.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import text

from api.core.auth import hash_password
from api.database import get_session_factory
from api.models.assignment import (
    Assignment,
    AssignmentSection,
    Submission,
    SubmissionGrade,
)
from api.models.course import Course, CourseTeacher
from api.models.school import SCHOOL_KIND_INSTITUTIONAL, School
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.unit import Unit
from api.models.user import User
from tests.harness.browser import HarnessBrowser

WEB_BASE = "http://localhost:5173"
OUT_DIR = Path(__file__).resolve().parents[1] / "docs" / "design"


async def seed() -> str:
    async with get_session_factory()() as s:
        await s.execute(text(
            "TRUNCATE TABLE llm_calls, submission_grades, submissions, "
            "assignments, section_enrollments, sections, units, "
            "course_teachers, courses, teacher_invites, schools, users "
            "RESTART IDENTITY CASCADE"
        ))
        await s.commit()

    now = datetime.now(UTC)
    async with get_session_factory()() as s:
        admin = User(
            email="ops@veradicai.com", password_hash=hash_password("x"),
            grade_level=99, role="admin", name="Operator",
        )
        school = School(
            name="Lincoln High School", kind=SCHOOL_KIND_INSTITUTIONAL,
            contact_name="Dana Reyes", contact_email="dana@lincoln.k12.us",
        )
        s.add_all([admin, school])
        await s.flush()

        teacher = User(
            email="alvarez@lincoln.k12.us", password_hash=hash_password("x"),
            grade_level=12, role="teacher", name="Ms. Alvarez",
            school_id=school.id,
        )
        s.add(teacher)
        await s.flush()

        course = Course(school_id=school.id, name="Algebra I", subject="math")
        s.add(course)
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))
        unit = Unit(course_id=course.id, name="Unit 1", position=0)
        section = Section(course_id=course.id, name="Period 1")
        s.add_all([unit, section])
        await s.flush()

        students = []
        for i in range(1, 13):
            stu = User(
                email=f"student{i}@lincoln.k12.us",
                password_hash=hash_password("x"), grade_level=9,
                role="student", name=f"Student {i}", school_id=school.id,
            )
            s.add(stu)
            await s.flush()
            s.add(SectionEnrollment(
                section_id=section.id, course_id=course.id, student_id=stu.id,
            ))
            students.append(stu)

        # Three homeworks, graded for most of the roster — so the
        # teacher's delete impact is a number worth being stopped by.
        for h in range(3):
            hw = Assignment(
                course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
                title=f"Homework {h + 1}", type="homework", status="published",
                due_at=now - timedelta(days=3 - h),
            )
            s.add(hw)
            await s.flush()
            s.add(AssignmentSection(assignment_id=hw.id, section_id=section.id))
            # Every student except the last submits — the last one is the
            # clean account used for the low-friction screenshot.
            for stu in students[:-1]:
                sub = Submission(
                    assignment_id=hw.id, student_id=stu.id, section_id=section.id,
                )
                s.add(sub)
                await s.flush()
                s.add(SubmissionGrade(
                    submission_id=sub.id, ai_score=3.0, final_score=3.0,
                ))

        await s.commit()
        return str(school.id)


async def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print("Seeding Lincoln High …")
    school_id = await seed()

    errors: list[str] = []
    async with HarnessBrowser(WEB_BASE) as browser:
        async with browser.plain_page() as page:
            page.on(
                "console",
                lambda m: errors.append(m.text) if m.type == "error" else None,
            )
            await page.goto(f"{WEB_BASE}/login")
            await page.get_by_placeholder("Email").fill("ops@veradicai.com")
            await page.get_by_placeholder("Password").fill("x")
            await page.get_by_role("button", name="Sign in").click()
            await page.wait_for_load_state("networkidle")

            await page.set_viewport_size({"width": 1440, "height": 1000})
            await page.goto(f"{WEB_BASE}/schools/{school_id}")
            await page.wait_for_load_state("networkidle")
            await page.wait_for_timeout(500)

            out = OUT_DIR / "admin-user-delete-actions.png"
            await page.screenshot(path=str(out), full_page=False)
            print(f"  -> {out}")

            # ── Teacher with work: the hard gate ──
            await page.get_by_role("button", name="Delete").nth(1).click()
            await page.wait_for_timeout(700)
            out2 = OUT_DIR / "admin-user-delete-gated.png"
            await page.locator('[role="dialog"]').screenshot(path=str(out2))
            print(f"  -> {out2}")
            await page.keyboard.press("Escape")
            await page.wait_for_timeout(300)

            # ── Student with nothing attached: no ceremony ──
            await page.get_by_role("button", name="Period 1").first.click()
            await page.wait_for_timeout(500)
            # The last student in the roster never submitted.
            row = page.locator("tr", has_text="Student 12")
            await row.get_by_role("button", name="Delete").click()
            await page.wait_for_timeout(700)
            out3 = OUT_DIR / "admin-user-delete-clean.png"
            await page.locator('[role="dialog"]').screenshot(path=str(out3))
            print(f"  -> {out3}")

    print(f"  console errors: {len(errors)}")
    for e in errors[:5]:
        print(f"    {e}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
