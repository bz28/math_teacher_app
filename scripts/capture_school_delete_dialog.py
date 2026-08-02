"""Seed a school that looks like a customer and screenshot its delete dialog.

Standalone (not a durable test) — drives the running stack:
    dashboard :5173, API :8000

    .venv/bin/python -m scripts.capture_school_delete_dialog

The dialog's whole job is to state the blast radius, so the seeded
school has to HAVE a blast radius: several teachers, classes with
distinct rosters, and a student enrolled in two of them (which is why
the count is distinct-students, not a sum over sections).

Writes docs/design/admin-school-delete-confirm.png.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

from sqlalchemy import text

from api.core.auth import hash_password
from api.database import get_session_factory
from api.models.course import Course, CourseTeacher
from api.models.school import SCHOOL_KIND_INSTITUTIONAL, School
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.unit import Unit
from api.models.user import User
from tests.harness.browser import HarnessBrowser

WEB_BASE = "http://localhost:5173"
OUT_DIR = Path(__file__).resolve().parents[1] / "docs" / "design"

ROSTERS = [
    ("Ms. Alvarez", "Algebra I", ["Period 1", "Period 3"]),
    ("Mr. Chen", "Geometry", ["Period 2"]),
    ("Ms. Okafor", "Algebra II", ["Period 4"]),
]


async def seed() -> str:
    async with get_session_factory()() as s:
        await s.execute(text(
            "TRUNCATE TABLE llm_calls, submission_grades, submissions, "
            "assignments, section_enrollments, sections, units, "
            "course_teachers, courses, teacher_invites, schools, users "
            "RESTART IDENTITY CASCADE"
        ))
        await s.commit()

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

        # One student deliberately sits in two CLASSES, so the dialog's
        # "students" number exercises the distinct-count path rather
        # than summing rosters. (Two sections of the same course would
        # not work — enrollment is unique per student per course.)
        shared = User(
            email="jordan@lincoln.k12.us", password_hash=hash_password("x"),
            grade_level=9, role="student", name="Jordan Vega",
            school_id=school.id,
        )
        s.add(shared)
        await s.flush()

        roster_n = 0
        for course_i, (teacher_name, course_name, section_names) in enumerate(ROSTERS):
            teacher = User(
                email=f"{teacher_name.split()[-1].lower()}@lincoln.k12.us",
                password_hash=hash_password("x"), grade_level=12,
                role="teacher", name=teacher_name, school_id=school.id,
            )
            s.add(teacher)
            await s.flush()

            course = Course(school_id=school.id, name=course_name, subject="math")
            s.add(course)
            await s.flush()
            s.add(CourseTeacher(
                course_id=course.id, teacher_id=teacher.id, role="owner",
            ))
            s.add(Unit(course_id=course.id, name="Unit 1", position=0))

            for section_i, section_name in enumerate(section_names):
                section = Section(course_id=course.id, name=section_name)
                s.add(section)
                await s.flush()

                for _ in range(6):
                    roster_n += 1
                    student = User(
                        email=f"student{roster_n}@lincoln.k12.us",
                        password_hash=hash_password("x"), grade_level=9,
                        role="student", name=f"Student {roster_n}",
                        school_id=school.id,
                    )
                    s.add(student)
                    await s.flush()
                    s.add(SectionEnrollment(
                        section_id=section.id, course_id=course.id,
                        student_id=student.id,
                    ))

                # Enrollment is unique per (student, course), so the
                # shared student joins the FIRST section of the first
                # two courses — two different classes, one account.
                if section_i == 0 and course_i < 2:
                    s.add(SectionEnrollment(
                        section_id=section.id, course_id=course.id,
                        student_id=shared.id,
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

            await page.get_by_role("button", name="Delete").first.click()
            await page.wait_for_timeout(500)
            out = OUT_DIR / "admin-school-delete-confirm.png"
            await page.screenshot(path=str(out), full_page=False)
            print(f"  -> {out}")

    print(f"  console errors: {len(errors)}")
    for e in errors[:5]:
        print(f"    {e}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
