"""Integration tests for the delete-impact preflight and deactivation.

## Why these exist

`DELETE /admin/users/{id}` is a hard delete whose FK graph reaches far
past the row:

    users.id → assignments.teacher_id (CASCADE)
             → submissions            (CASCADE)
             → submission_grades      (CASCADE)

Deleting one TEACHER therefore destroys every homework they wrote and
every submission and grade on it — including work belonging to students
who are not being deleted. The console said only "will be removed
permanently".

`GET /users/{id}/delete-impact` is what lets the UI state the real
damage before an admin consents to it, so the number it returns has to
be exactly what the delete actually destroys. These tests assert that
by MEASURING: they read the impact, run the real delete, and compare
against the true before/after row counts. A preflight that merely looks
plausible is worse than none — it would launder a bad number as a
verified one.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select, text

from api.core.auth import create_access_token, hash_password
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


async def _seed() -> dict:
    """One teacher, two students, one graded submission each.

    Two students is the load-bearing part: it is what makes "deleting
    the teacher destroys OTHER people's work" observable at all.
    """
    now = datetime.now(UTC)
    async with get_session_factory()() as s:
        admin = User(
            email=f"admin_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"), grade_level=99,
            role="admin", name="Admin",
        )
        school = School(
            name="Lincoln", kind=SCHOOL_KIND_INSTITUTIONAL,
            contact_name="C", contact_email=f"c_{uuid.uuid4().hex[:6]}@s.com",
        )
        s.add_all([admin, school])
        await s.flush()

        teacher = User(
            email=f"t_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"), grade_level=12,
            role="teacher", name="Teacher", school_id=school.id,
        )
        stu_a = User(
            email=f"sa_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"), grade_level=9,
            role="student", name="Student A", school_id=school.id,
        )
        stu_b = User(
            email=f"sb_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"), grade_level=9,
            role="student", name="Student B", school_id=school.id,
        )
        s.add_all([teacher, stu_a, stu_b])
        await s.flush()

        course = Course(school_id=school.id, name="Algebra", subject="math")
        s.add(course)
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))
        unit = Unit(course_id=course.id, name="U", position=0)
        section = Section(course_id=course.id, name="P1")
        s.add_all([unit, section])
        await s.flush()
        s.add_all([
            SectionEnrollment(section_id=section.id, course_id=course.id, student_id=stu_a.id),
            SectionEnrollment(section_id=section.id, course_id=course.id, student_id=stu_b.id),
        ])

        hw = Assignment(
            course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
            title="HW", type="homework", status="published",
            due_at=now + timedelta(days=1),
        )
        s.add(hw)
        await s.flush()
        s.add(AssignmentSection(assignment_id=hw.id, section_id=section.id))

        # The teacher ALSO submits to their own assignment — the
        # "try it as a student" pattern. Without this row the seed
        # cannot tell a correct dedup from a plain sum, and a mutation
        # replacing the dedup with `own + others` survives the suite.
        for submitter in (stu_a, stu_b, teacher):
            sub = Submission(
                assignment_id=hw.id, student_id=submitter.id,
                section_id=section.id,
            )
            s.add(sub)
            await s.flush()
            s.add(SubmissionGrade(
                submission_id=sub.id, ai_score=3.0, final_score=3.0,
            ))

        await s.commit()
        return {
            "teacher_id": teacher.id,
            "stu_a": stu_a.id,
            "stu_b": stu_b.id,
            "admin_id": admin.id,
            "token": create_access_token(str(admin.id), "admin"),
        }


async def _row_counts() -> dict[str, int]:
    async with get_session_factory()() as s:
        out: dict[str, int] = {}
        for key, model in (
            ("assignments", Assignment),
            ("submissions", Submission),
            ("grades", SubmissionGrade),
        ):
            out[key] = (await s.execute(
                select(func.count()).select_from(model)
            )).scalar() or 0
        return out


@pytest.mark.asyncio
async def test_teacher_impact_matches_what_the_delete_destroys(
    client: AsyncClient,
) -> None:
    """The preflight number IS the real damage, verified by doing it."""
    await _wipe()
    seed = await _seed()
    headers = auth_headers(str(seed["token"]))

    impact = (await client.get(
        f"/v1/admin/users/{seed['teacher_id']}/delete-impact", headers=headers,
    )).json()

    assert impact["role"] == "teacher"
    assert impact["assignments_destroyed"] == 1
    # THREE submissions die (two students + the teacher's own), counted
    # once each. Summing "the user's own" and "everything on their
    # assignments" would say 4 — the teacher's row is in both sets.
    assert impact["submissions_destroyed"] == 3
    assert impact["grades_destroyed"] == 3
    # The number that makes deleting a teacher dangerous, and it counts
    # BYSTANDERS only: the teacher submitted too, but they are the one
    # being deleted, so they are not affected — they are the cause.
    assert impact["students_affected"] == 2

    before = await _row_counts()
    res = await client.delete(
        f"/v1/admin/users/{seed['teacher_id']}", headers=headers,
    )
    assert res.status_code == 200, res.text
    after = await _row_counts()

    assert before["assignments"] - after["assignments"] == impact["assignments_destroyed"]
    assert before["submissions"] - after["submissions"] == impact["submissions_destroyed"]
    assert before["grades"] - after["grades"] == impact["grades_destroyed"]

    # And the students themselves survive — it is only their work that
    # was destroyed, which is precisely why the dialog must say so.
    async with get_session_factory()() as s:
        for key in ("stu_a", "stu_b"):
            assert (await s.execute(
                select(User).where(User.id == seed[key])
            )).scalar_one_or_none() is not None


@pytest.mark.asyncio
async def test_student_impact_is_only_their_own_work(client: AsyncClient) -> None:
    """Deleting a student takes their submission, and nobody else's."""
    await _wipe()
    seed = await _seed()
    headers = auth_headers(str(seed["token"]))

    impact = (await client.get(
        f"/v1/admin/users/{seed['stu_a']}/delete-impact", headers=headers,
    )).json()

    assert impact["role"] == "student"
    assert impact["assignments_destroyed"] == 0
    assert impact["submissions_destroyed"] == 1
    assert impact["grades_destroyed"] == 1
    assert impact["students_affected"] == 0
    assert impact["enrollments_removed"] == 1

    before = await _row_counts()
    res = await client.delete(f"/v1/admin/users/{seed['stu_a']}", headers=headers)
    assert res.status_code == 200, res.text
    after = await _row_counts()

    assert before["submissions"] - after["submissions"] == 1
    assert before["grades"] - after["grades"] == 1
    # Everyone else's work is untouched (student B + the teacher's own).
    assert after["submissions"] == 2
    assert after["assignments"] == 1


@pytest.mark.asyncio
async def test_impact_of_an_account_with_nothing_attached_is_all_zero(
    client: AsyncClient,
) -> None:
    """A clean account reports zero, so the UI can skip the hard gate.

    This is what keeps the friction proportional: routine deletions of
    empty/duplicate accounts must not train an operator to click through
    a scary dialog, or the dialog stops working the day it matters.
    """
    await _wipe()
    seed = await _seed()
    headers = auth_headers(str(seed["token"]))

    async with get_session_factory()() as s:
        spare = User(
            email=f"spare_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"), grade_level=9,
            role="student", name="Spare",
        )
        s.add(spare)
        await s.commit()
        spare_id = spare.id

    impact = (await client.get(
        f"/v1/admin/users/{spare_id}/delete-impact", headers=headers,
    )).json()
    assert impact["assignments_destroyed"] == 0
    assert impact["submissions_destroyed"] == 0
    assert impact["grades_destroyed"] == 0
    assert impact["students_affected"] == 0
    assert impact["enrollments_removed"] == 0


@pytest.mark.asyncio
async def test_impact_of_missing_user_is_404(client: AsyncClient) -> None:
    await _wipe()
    seed = await _seed()
    res = await client.get(
        f"/v1/admin/users/{uuid.uuid4()}/delete-impact",
        headers=auth_headers(str(seed["token"])),
    )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_deactivate_revokes_access_and_is_reversible(
    client: AsyncClient,
) -> None:
    """The safe alternative actually works, and keeps the work intact."""
    await _wipe()
    seed = await _seed()
    headers = auth_headers(str(seed["token"]))

    res = await client.patch(
        f"/v1/admin/users/{seed['teacher_id']}/active",
        json={"is_active": False}, headers=headers,
    )
    assert res.status_code == 200, res.text
    assert res.json()["is_active"] is False

    # The teacher's token is now refused — deactivation is real, not
    # cosmetic, which is what makes it a genuine alternative to delete.
    teacher_headers = auth_headers(create_access_token(str(seed["teacher_id"]), "teacher"))
    denied = await client.get("/v1/auth/me", headers=teacher_headers)
    assert denied.status_code in (401, 403), denied.text

    # And nothing was destroyed.
    counts = await _row_counts()
    assert counts["assignments"] == 1
    assert counts["submissions"] == 3
    assert counts["grades"] == 3

    # Reversible.
    back = await client.patch(
        f"/v1/admin/users/{seed['teacher_id']}/active",
        json={"is_active": True}, headers=headers,
    )
    assert back.status_code == 200
    assert back.json()["is_active"] is True


@pytest.mark.asyncio
async def test_admin_cannot_deactivate_themselves(client: AsyncClient) -> None:
    """Locking yourself out of the console is not a thing to allow."""
    await _wipe()
    seed = await _seed()
    res = await client.patch(
        f"/v1/admin/users/{seed['admin_id']}/active",
        json={"is_active": False},
        headers=auth_headers(str(seed["token"])),
    )
    assert res.status_code == 400
