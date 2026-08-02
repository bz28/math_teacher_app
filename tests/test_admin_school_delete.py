"""Integration tests for DELETE /v1/admin/schools/{school_id}.

This endpoint had no coverage at all, which is a strange gap for the
single most destructive button in the admin console — it removes a
paying customer's school row and unlinks every teacher on it.

The behaviour that actually matters here is not the happy path (a bare
school with nothing attached deletes fine, and always did). It is
whether a school that looks like a REAL customer can be deleted:
teachers, students, courses, units, sections, enrollments, assignments,
submissions, grades, and the LLM cost rows that hang off them.

`delete_school` issues a single `db.delete(school)` and relies entirely
on what the schema does with the dependent rows. If any foreign key
pointing at `schools.id` is NOT NULL with no cascade, Postgres raises
and the operator gets a 500 on a button labelled "Delete".

So these tests seed the full hierarchy and then assert the endpoint's
contract: the school is gone, teachers survive (unlinked, not deleted —
the confirm dialog promises exactly that), and the counts reported back
match what really happened.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select, text

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.assignment import (
    Assignment,
    AssignmentSection,
    Submission,
    SubmissionGrade,
)
from api.models.course import Course, CourseTeacher
from api.models.llm_call import LLMCall
from api.models.school import SCHOOL_KIND_INSTITUTIONAL, School
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.teacher_invite import TeacherInvite
from api.models.unit import Unit
from api.models.user import User
from tests.conftest import auth_headers


async def _wipe() -> None:
    async with get_session_factory()() as s:
        await s.execute(text(
            "TRUNCATE TABLE llm_calls, submission_grades, submissions, "
            "assignments, section_enrollments, sections, units, "
            "course_teachers, courses, teacher_invites, schools, users "
            "RESTART IDENTITY CASCADE"
        ))
        await s.commit()


async def _seed_full_school() -> dict[str, uuid.UUID | str]:
    """A school with the whole dependent hierarchy hanging off it.

    Deliberately not a bare row: the point of these tests is what the
    delete does to everything that references the school, directly
    (users.school_id, courses.school_id, teacher_invites.school_id) and
    transitively (sections → assignments → submissions → grades, and
    the llm_calls that carry the cost attribution).
    """
    now = datetime.now(UTC)

    async with get_session_factory()() as s:
        admin = User(
            email=f"admin_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"), grade_level=99,
            role="admin", name="Admin",
        )
        school = School(
            name="Doomed High",
            kind=SCHOOL_KIND_INSTITUTIONAL,
            contact_name="Contact", contact_email=f"c_{uuid.uuid4().hex[:6]}@s.com",
        )
        s.add_all([admin, school])
        await s.flush()

        teacher = User(
            email=f"t_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"), grade_level=12,
            role="teacher", name="Teacher", school_id=school.id,
        )
        student = User(
            email=f"s_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"), grade_level=8,
            role="student", name="Student", school_id=school.id,
        )
        s.add_all([teacher, student])
        await s.flush()

        course = Course(school_id=school.id, name="Algebra", subject="math")
        s.add(course)
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))

        unit = Unit(course_id=course.id, name="U1", position=0)
        s.add(unit)
        section = Section(course_id=course.id, name="Period 1")
        s.add(section)
        await s.flush()
        s.add(SectionEnrollment(
            section_id=section.id, course_id=course.id, student_id=student.id,
        ))

        assignment = Assignment(
            course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
            title="HW 1", type="homework", status="published",
            due_at=now + timedelta(days=1),
        )
        s.add(assignment)
        await s.flush()
        s.add(AssignmentSection(assignment_id=assignment.id, section_id=section.id))

        submission = Submission(
            assignment_id=assignment.id, student_id=student.id,
            section_id=section.id,
        )
        s.add(submission)
        await s.flush()
        s.add(SubmissionGrade(
            submission_id=submission.id, ai_score=3.0, final_score=3.0,
        ))

        s.add(LLMCall(
            user_id=teacher.id, submission_id=submission.id, school_id=school.id,
            function="ai_grading", model="claude-sonnet-4-6",
            input_tokens=10, output_tokens=10, latency_ms=100.0,
            cost_usd=0.01, created_at=now,
        ))

        # A pending invite — counted in the delete response.
        s.add(TeacherInvite(
            school_id=school.id, email=f"inv_{uuid.uuid4().hex[:6]}@t.com",
            invited_by=admin.id, token=uuid.uuid4().hex, status="pending",
            expires_at=now + timedelta(days=7),
        ))

        await s.commit()

        return {
            "school_id": school.id,
            "teacher_id": teacher.id,
            "student_id": student.id,
            "token": create_access_token(str(admin.id), "admin"),
        }


@pytest.mark.asyncio
async def test_delete_school_with_full_hierarchy(client: AsyncClient) -> None:
    """A school that looks like a real customer deletes cleanly.

    This is the regression that matters: every dependent row above has
    to be handled by the schema, because the route does nothing but
    `db.delete(school)`. A 500 here is an FK with no cascade.
    """
    await _wipe()
    seed = await _seed_full_school()

    res = await client.delete(
        f"/v1/admin/schools/{seed['school_id']}",
        headers=auth_headers(str(seed["token"])),
    )

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "ok"
    assert body["teachers_unlinked"] == 1
    assert body["invites_deleted"] == 1

    async with get_session_factory()() as s:
        gone = (await s.execute(
            select(School).where(School.id == seed["school_id"])
        )).scalar_one_or_none()
        assert gone is None, "the school row should be deleted"

        # The confirm dialog promises teachers are UNLINKED, not deleted.
        teacher = (await s.execute(
            select(User).where(User.id == seed["teacher_id"])
        )).scalar_one_or_none()
        assert teacher is not None, "deleting a school must not delete its teachers"
        assert teacher.school_id is None, "the teacher should be unlinked"


@pytest.mark.asyncio
async def test_delete_school_detaches_rather_than_destroys(
    client: AsyncClient,
) -> None:
    """Pin the real blast radius, because the confirm dialog has to state it.

    Every FK pointing at `schools.id` is ON DELETE SET NULL except
    `teacher_invites`, which CASCADEs. So a delete does not destroy a
    term's work — it DETACHES it. Students keep their accounts, the
    course and its sections/assignments/submissions/grades all survive.

    Two consequences worth pinning because they are invisible in the
    UI and nobody would guess them from a button labelled "Delete":

      * the course is orphaned — it still exists but belongs to no
        school, so it drops out of every school-scoped view;
      * `llm_calls.school_id` is nulled, so the school's historical
        AI spend loses its attribution. In a console whose main job is
        cost tracking, deleting a school quietly rewrites the past.
    """
    await _wipe()
    seed = await _seed_full_school()

    res = await client.delete(
        f"/v1/admin/schools/{seed['school_id']}",
        headers=auth_headers(str(seed["token"])),
    )
    assert res.status_code == 200, res.text

    async with get_session_factory()() as s:
        # The student's account survives, unlinked from the school.
        student = (await s.execute(
            select(User).where(User.id == seed["student_id"])
        )).scalar_one_or_none()
        assert student is not None, "deleting a school must not delete its students"
        assert student.school_id is None

        # The course survives but is orphaned — no school owns it.
        course = (await s.execute(select(Course))).scalars().first()
        assert course is not None, "the course must survive the school"
        assert course.school_id is None, "the course is detached, not deleted"

        # Student work is fully intact.
        assert (await s.execute(select(Submission))).scalars().first() is not None
        assert (await s.execute(select(SubmissionGrade))).scalars().first() is not None

        # Cost history survives, but loses its school attribution.
        call = (await s.execute(select(LLMCall))).scalars().first()
        assert call is not None, "cost rows must not be destroyed"
        assert call.school_id is None, (
            "school attribution on historical spend is nulled by the delete"
        )

        # Pending invites are the one thing genuinely destroyed.
        assert (await s.execute(select(TeacherInvite))).scalars().first() is None


@pytest.mark.asyncio
async def test_delete_missing_school_is_404(client: AsyncClient) -> None:
    """A school id that does not exist is a 404, not a 500."""
    await _wipe()
    seed = await _seed_full_school()

    res = await client.delete(
        f"/v1/admin/schools/{uuid.uuid4()}",
        headers=auth_headers(str(seed["token"])),
    )
    assert res.status_code == 404
    assert res.json()["detail"] == "School not found"


@pytest.mark.asyncio
async def test_delete_school_is_not_idempotent_second_call_404s(
    client: AsyncClient,
) -> None:
    """The second delete of the same school 404s.

    Worth pinning because it is the one way an operator sees a 404 from
    a button that just worked: a double-click, or a retry after a
    response was lost. The row really is gone by then, so 404 is the
    honest answer — but the console must not present it as a failure to
    reach the service.
    """
    await _wipe()
    seed = await _seed_full_school()
    headers = auth_headers(str(seed["token"]))

    first = await client.delete(f"/v1/admin/schools/{seed['school_id']}", headers=headers)
    assert first.status_code == 200, first.text

    second = await client.delete(f"/v1/admin/schools/{seed['school_id']}", headers=headers)
    assert second.status_code == 404
