"""Seed a golden-set test world: one teacher, two accelerated courses, each
with a top-level unit and a homework assignment to attach generation to.

Isolated DB only — run with DATABASE_URL pointed at mathapp_golden:

    DATABASE_URL=postgresql+asyncpg://mathapp:***@localhost:5432/mathapp_golden \
        PYTHONPATH=. .venv/bin/python -m scripts.seed_golden_set

Prints a JSON blob (teacher tokens + course/unit/assignment ids) to stdout.
"""

from __future__ import annotations

import asyncio
import json
import uuid

from api.core.auth import create_access_token, create_refresh_token, hash_password
from api.database import get_session_factory
from api.models.assignment import Assignment
from api.models.course import Course, CourseTeacher
from api.models.school import SCHOOL_KIND_INDIVIDUAL, School
from api.models.unit import Unit
from api.models.user import User

COURSES = [
    {
        "key": "geometry",
        "course": "Accelerated Geometry",
        "unit": "Circle Theorems",
        "homework": "Circle Theorems — Problem Set 1",
    },
    {
        "key": "calculus",
        "course": "Calculus (Accelerated)",
        "unit": "Applications of the Derivative",
        "homework": "Related Rates & Optimization — Problem Set 1",
    },
]


async def seed() -> dict:
    async with get_session_factory()() as s:
        suffix = uuid.uuid4().hex[:6]
        school = School(
            name="Golden Set Academy",
            kind=SCHOOL_KIND_INDIVIDUAL,
            contact_name="Golden Set",
            contact_email=f"golden_{suffix}@t.com",
        )
        s.add(school)
        await s.flush()

        teacher = User(
            email=f"golden_teacher_{suffix}@t.com",
            password_hash=hash_password("goldenset"),
            grade_level=12,
            role="teacher",
            name="Dr. Avery Stone",
            school_id=school.id,
        )
        s.add(teacher)
        await s.flush()

        out_courses = []
        for spec in COURSES:
            course = Course(name=spec["course"], subject="math", school_id=school.id)
            s.add(course)
            await s.flush()
            s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))
            unit = Unit(course_id=course.id, name=spec["unit"], position=0)
            s.add(unit)
            await s.flush()
            assignment = Assignment(
                course_id=course.id,
                unit_ids=[unit.id],
                teacher_id=teacher.id,
                title=spec["homework"],
                type="homework",
                status="draft",
                content={"problem_ids": []},
            )
            s.add(assignment)
            await s.flush()
            out_courses.append({
                "key": spec["key"],
                "course_id": str(course.id),
                "course_name": spec["course"],
                "unit_id": str(unit.id),
                "unit_name": spec["unit"],
                "assignment_id": str(assignment.id),
                "homework_title": spec["homework"],
            })

        refresh = await create_refresh_token(s, teacher.id)
        await s.commit()

        return {
            "teacher_id": str(teacher.id),
            "teacher_email": teacher.email,
            "access_token": create_access_token(str(teacher.id), "teacher"),
            "refresh_token": refresh,
            "courses": out_courses,
        }


if __name__ == "__main__":
    print(json.dumps(asyncio.run(seed()), indent=2))
