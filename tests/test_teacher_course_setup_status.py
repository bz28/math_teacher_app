"""GET /v1/teacher/courses/{id}/setup-status drives the first-run
"Set up your class" checklist on the course workspace. Each boolean is
an EXISTS probe over an onboarding milestone — section, enrolled
student, course materials (units), homework, and a published grade.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from httpx import AsyncClient

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.assignment import Assignment, Submission, SubmissionGrade
from api.models.course import Course, CourseTeacher
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.unit import Unit
from api.models.user import User
from tests.conftest import auth_headers as _auth


async def _bare_teacher_course() -> dict[str, uuid.UUID | str]:
    """A teacher + empty course (no sections, units, HW, grades) — the
    blank-slate state a teacher lands on right after creating a course."""
    async with get_session_factory()() as s:
        teacher = User(
            email=f"teacher_{uuid.uuid4().hex[:8]}@t.com",
            password_hash=hash_password("x"),
            grade_level=12,
            role="teacher",
            name="T",
        )
        student = User(
            email=f"student_{uuid.uuid4().hex[:8]}@t.com",
            password_hash=hash_password("x"),
            grade_level=8,
            role="student",
            name="S",
        )
        s.add_all([teacher, student])
        await s.flush()

        course = Course(name="Algebra 1", subject="math")
        s.add(course)
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))
        await s.commit()

        return {
            "teacher_id": teacher.id,
            "student_id": student.id,
            "course_id": course.id,
            "teacher_token": create_access_token(str(teacher.id), "teacher"),
        }


async def _get(client: AsyncClient, w: dict, token_key: str = "teacher_token") -> dict:
    r = await client.get(
        f"/v1/teacher/courses/{w['course_id']}/setup-status",
        headers=_auth(w[token_key]),
    )
    assert r.status_code == 200, r.text
    return r.json()


async def test_blank_course_all_false(client: AsyncClient) -> None:
    w = await _bare_teacher_course()
    body = await _get(client, w)
    assert body == {
        "has_section": False,
        "has_student": False,
        "has_materials": False,
        "has_homework": False,
        "has_published_grade": False,
    }


async def test_section_only_flips_has_section(client: AsyncClient) -> None:
    w = await _bare_teacher_course()
    async with get_session_factory()() as s:
        s.add(Section(course_id=w["course_id"], name="P1"))
        await s.commit()
    body = await _get(client, w)
    assert body["has_section"] is True
    assert body["has_student"] is False


async def test_enrollment_flips_has_student(client: AsyncClient) -> None:
    w = await _bare_teacher_course()
    async with get_session_factory()() as s:
        section = Section(course_id=w["course_id"], name="P1")
        s.add(section)
        await s.flush()
        s.add(SectionEnrollment(
            section_id=section.id, course_id=w["course_id"], student_id=w["student_id"],
        ))
        await s.commit()
    body = await _get(client, w)
    assert body["has_section"] is True
    assert body["has_student"] is True


async def test_unit_flips_has_materials(client: AsyncClient) -> None:
    w = await _bare_teacher_course()
    async with get_session_factory()() as s:
        s.add(Unit(course_id=w["course_id"], name="Quadratics", position=0))
        await s.commit()
    body = await _get(client, w)
    assert body["has_materials"] is True


async def test_homework_flips_has_homework_but_practice_does_not(client: AsyncClient) -> None:
    """Only type=homework counts. A practice assignment is not a step in
    the onboarding sequence and must not satisfy has_homework."""
    w = await _bare_teacher_course()
    async with get_session_factory()() as s:
        s.add(Assignment(
            course_id=w["course_id"], teacher_id=w["teacher_id"],
            title="Practice set", type="practice", status="published",
            content={"problems": []},
        ))
        await s.commit()
    assert (await _get(client, w))["has_homework"] is False

    async with get_session_factory()() as s:
        s.add(Assignment(
            course_id=w["course_id"], teacher_id=w["teacher_id"],
            title="HW 1", type="homework", status="draft",
            content={"problems": []},
        ))
        await s.commit()
    assert (await _get(client, w))["has_homework"] is True


async def test_unpublished_grade_does_not_satisfy_published_grade(client: AsyncClient) -> None:
    """A graded-but-unpublished submission must not flip has_published_grade —
    the step is "Grade & publish", not just grade."""
    w = await _bare_teacher_course()
    async with get_session_factory()() as s:
        section = Section(course_id=w["course_id"], name="P1")
        s.add(section)
        await s.flush()
        hw = Assignment(
            course_id=w["course_id"], teacher_id=w["teacher_id"],
            title="HW 1", type="homework", status="published",
            content={"problems": []},
        )
        s.add(hw)
        await s.flush()
        sub = Submission(
            assignment_id=hw.id, student_id=w["student_id"],
            section_id=section.id, status="submitted",
        )
        s.add(sub)
        await s.flush()
        # Graded but NOT published (grade_published_at is None).
        s.add(SubmissionGrade(
            submission_id=sub.id, final_score=85.0, grade_published_at=None,
        ))
        await s.commit()
    assert (await _get(client, w))["has_published_grade"] is False


async def test_published_grade_flips_has_published_grade(client: AsyncClient) -> None:
    w = await _bare_teacher_course()
    async with get_session_factory()() as s:
        section = Section(course_id=w["course_id"], name="P1")
        s.add(section)
        await s.flush()
        hw = Assignment(
            course_id=w["course_id"], teacher_id=w["teacher_id"],
            title="HW 1", type="homework", status="published",
            content={"problems": []},
        )
        s.add(hw)
        await s.flush()
        sub = Submission(
            assignment_id=hw.id, student_id=w["student_id"],
            section_id=section.id, status="submitted",
        )
        s.add(sub)
        await s.flush()
        s.add(SubmissionGrade(
            submission_id=sub.id, final_score=85.0,
            published_final_score=85.0, grade_published_at=datetime.now(UTC),
        ))
        await s.commit()
    assert (await _get(client, w))["has_published_grade"] is True


async def test_other_teacher_gets_404(client: AsyncClient) -> None:
    """Ownership is enforced before any probe runs — another teacher
    can't read a course's onboarding milestones."""
    w = await _bare_teacher_course()
    async with get_session_factory()() as s:
        other = User(
            email=f"other_{uuid.uuid4().hex[:8]}@t.com",
            password_hash=hash_password("x"),
            grade_level=12, role="teacher", name="Other",
        )
        s.add(other)
        await s.commit()
        other_token = create_access_token(str(other.id), "teacher")

    r = await client.get(
        f"/v1/teacher/courses/{w['course_id']}/setup-status",
        headers=_auth(other_token),
    )
    assert r.status_code == 404
