"""Seed a minimal teacher→course→unit→published-assignment world directly
against the (harness) database — mirrors tests/conftest.py's `world` fixture
but trimmed to what a generation run needs (no pre-seeded bank items; the
probe generates those for real). The running API process shares this DB and
JWT secret, so the tokens minted here authenticate against it.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from api.core.auth import create_access_token, create_refresh_token, hash_password
from api.database import get_session_factory
from api.models.assignment import Assignment, AssignmentSection
from api.models.course import Course, CourseTeacher
from api.models.school import SCHOOL_KIND_INDIVIDUAL, School
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.unit import Unit
from api.models.user import User


@dataclass
class Seed:
    teacher_id: str
    student_id: str
    course_id: str
    unit_id: str
    assignment_id: str
    teacher_token: str
    student_token: str
    teacher_refresh: str
    student_refresh: str


async def seed_world() -> Seed:
    async with get_session_factory()() as s:
        # Teachers require a school (ck_users_school_required_for_teacher);
        # mint an individual-kind school like the indie-teacher signup flow.
        school = School(
            name="Harness School", kind=SCHOOL_KIND_INDIVIDUAL,
            contact_name="Harness", contact_email="harness@t.com",
        )
        s.add(school)
        await s.flush()

        teacher = User(
            email=f"harness_teacher_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"), grade_level=12, role="teacher",
            name="Harness Teacher", school_id=school.id,
        )
        student = User(
            email=f"harness_student_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"), grade_level=8, role="student",
            name="Harness Student",
        )
        s.add_all([teacher, student])
        await s.flush()

        course = Course(name="Geometry Harness", subject="math", school_id=school.id)
        s.add(course)
        await s.flush()
        # Course ownership is via the CourseTeacher join (get_teacher_course).
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))

        unit = Unit(course_id=course.id, name="Figures", position=0)
        s.add(unit)
        await s.flush()

        section = Section(course_id=course.id, name="Period 1")
        s.add(section)
        await s.flush()
        s.add(SectionEnrollment(
            section_id=section.id, course_id=course.id, student_id=student.id,
        ))

        assignment = Assignment(
            course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
            title="Geometry HW", type="homework", status="published",
            content={"problems": []},
        )
        s.add(assignment)
        await s.flush()
        s.add(AssignmentSection(
            assignment_id=assignment.id, section_id=section.id,
            published_at=datetime.now(UTC),
        ))
        # Refresh tokens are DB-backed; the web auth guard needs both an
        # access and a refresh token present to consider us logged in.
        teacher_refresh = await create_refresh_token(s, teacher.id)
        student_refresh = await create_refresh_token(s, student.id)
        await s.commit()

        return Seed(
            teacher_id=str(teacher.id), student_id=str(student.id),
            course_id=str(course.id), unit_id=str(unit.id),
            assignment_id=str(assignment.id),
            teacher_token=create_access_token(str(teacher.id), "teacher"),
            student_token=create_access_token(str(student.id), "student"),
            teacher_refresh=teacher_refresh, student_refresh=student_refresh,
        )
