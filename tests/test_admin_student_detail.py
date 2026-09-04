"""Tests for the per-student admin drill-in:

- GET /v1/admin/students/{id}             — identity, sections, funnel
- GET /v1/admin/students/{id}/submissions — one row per piece of work

The seeded classroom deliberately contains one submission at each
interesting stage, because the value of the page is telling them apart:
a student who submitted and never confirmed the read looks identical to
a healthy submission in every list that existed before this.
"""

import json
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.assignment import Assignment, Submission, SubmissionGrade
from api.models.course import Course, CourseTeacher
from api.models.grading_job import GradingJob
from api.models.school import SCHOOL_KIND_INSTITUTIONAL, School
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.user import User

NOW = datetime.now(UTC)

# A read with content, so these submissions land in a real stage rather
# than the "reader found nothing" branch.
READ = {
    "steps": [{"problem_position": 1, "step_num": 1, "latex": "x = 2"}],
    "final_answers": [{"problem_position": 1, "answer_latex": "2"}],
    "confidence": 0.93,
}
EMPTY_READ = {"steps": [], "final_answers": [], "confidence": 0.0}


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
async def _truncate() -> None:
    async with get_session_factory()() as s:
        await s.execute(text(
            "TRUNCATE TABLE grading_jobs, submission_grades, submissions, "
            "assignments, section_enrollments, sections, courses, "
            "course_teachers, schools, users RESTART IDENTITY CASCADE"
        ))
        await s.commit()


async def _seed() -> dict[str, str]:
    """One student with six submissions, one per stage.

    Stages seeded: published, graded, flagged, confirmed,
    awaiting_confirm (the headline case), awaiting_extraction, plus one
    extraction_off — seven rows, so the funnel has a nonzero count in
    every bucket and an off-by-one in the rule shows up as a miscount.
    """
    tag = uuid.uuid4().hex[:6]
    async with get_session_factory()() as s:
        admin = User(
            email=f"admin_{tag}@t.com", password_hash=hash_password("x"),
            grade_level=12, role="admin", name="Admin",
        )
        school = School(
            name=f"School {tag}", kind=SCHOOL_KIND_INSTITUTIONAL,
            contact_name="Contact", contact_email=f"c_{tag}@s.com",
        )
        s.add_all([admin, school])
        await s.flush()

        teacher = User(
            email=f"teacher_{tag}@t.com", password_hash=hash_password("x"),
            grade_level=12, role="teacher", name="Ms Teacher",
            school_id=school.id,
        )
        student = User(
            email=f"stu_{tag}@t.com", password_hash=hash_password("x"),
            grade_level=8, role="student", name="Sam Student",
            school_id=school.id,
        )
        other = User(
            email=f"other_{tag}@t.com", password_hash=hash_password("x"),
            grade_level=8, role="student", name="Other Student",
            school_id=school.id,
        )
        s.add_all([teacher, student, other])
        await s.flush()

        course = Course(
            name=f"Algebra {tag}", subject="math", school_id=school.id,
        )
        s.add(course)
        await s.flush()
        s.add(CourseTeacher(
            course_id=course.id, teacher_id=teacher.id, role="owner",
        ))
        section = Section(course_id=course.id, name="Period 1")
        s.add(section)
        await s.flush()
        s.add(SectionEnrollment(
            section_id=section.id, course_id=course.id, student_id=student.id,
        ))

        # `ai_off` is the assignment with both AI toggles disabled — the
        # one whose empty trace is correct rather than a lost read.
        assignments: dict[str, Assignment] = {}
        for key, ai_on in (("ai_on", True), ("ai_off", False)):
            a = Assignment(
                course_id=course.id, unit_ids=[], teacher_id=teacher.id,
                title=f"HW {key} {tag}", type="homework", status="published",
                integrity_check_enabled=ai_on, ai_grading_enabled=ai_on,
            )
            assignments[key] = a
            s.add(a)
        await s.flush()

        def _sub(assignment: Assignment, student_id: uuid.UUID, **kw: object):
            sub = Submission(
                assignment_id=assignment.id, student_id=student_id,
                section_id=section.id, status="submitted",
                files=[{"data": "x", "media_type": "image/jpeg"}],
                submitted_at=NOW - timedelta(days=6),
                **kw,  # type: ignore[arg-type]
            )
            s.add(sub)
            return sub

        # A single assignment can hold only one submission per student
        # (unique constraint), so each stage gets its own assignment.
        stage_subs: dict[str, Submission] = {}
        for key in (
            "published", "graded", "flagged", "confirmed",
            "awaiting_confirm", "awaiting_extraction",
        ):
            a = Assignment(
                course_id=course.id, unit_ids=[], teacher_id=teacher.id,
                title=f"HW {key} {tag}", type="homework", status="published",
                integrity_check_enabled=True, ai_grading_enabled=True,
            )
            s.add(a)
            await s.flush()
            if key == "awaiting_extraction":
                stage_subs[key] = _sub(a, student.id)
            elif key == "awaiting_confirm":
                stage_subs[key] = _sub(a, student.id, extraction=READ)
            elif key == "flagged":
                stage_subs[key] = _sub(
                    a, student.id, extraction=READ,
                    extraction_flagged_at=NOW - timedelta(days=5),
                )
            else:
                stage_subs[key] = _sub(
                    a, student.id, extraction=READ,
                    extraction_confirmed_at=NOW - timedelta(days=5),
                )
        stage_subs["extraction_off"] = _sub(assignments["ai_off"], student.id)
        # A second student's work, to prove the scoping filter holds.
        _sub(assignments["ai_on"], other.id, extraction=READ)
        await s.flush()

        s.add_all([
            SubmissionGrade(
                submission_id=stage_subs["graded"].id, ai_score=80.0,
                final_score=95.0, graded_at=NOW - timedelta(days=4),
            ),
            SubmissionGrade(
                submission_id=stage_subs["published"].id, ai_score=70.0,
                final_score=70.0, graded_at=NOW - timedelta(days=4),
                grade_published_at=NOW - timedelta(days=3),
            ),
        ])
        s.add(GradingJob(
            submission_id=stage_subs["confirmed"].id,
            assignment_id=stage_subs["confirmed"].assignment_id,
            status="queued", attempts=0,
        ))
        await s.commit()

        return {
            "admin_token": create_access_token(str(admin.id), "admin"),
            "student_id": str(student.id),
            "other_student_id": str(other.id),
            "teacher_id": str(teacher.id),
            "school_id": str(school.id),
            "awaiting_confirm_id": str(stage_subs["awaiting_confirm"].id),
        }


@pytest.mark.asyncio
async def test_detail_returns_identity_sections_and_funnel(
    client: AsyncClient,
) -> None:
    seeded = await _seed()
    resp = await client.get(
        f"/v1/admin/students/{seeded['student_id']}",
        headers=auth_headers(seeded["admin_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["student"]["id"] == seeded["student_id"]
    assert body["student"]["name"] == "Sam Student"
    assert body["student"]["school"]["id"] == seeded["school_id"]
    assert body["student"]["last_submitted_at"] is not None

    # The section carries the teacher to email about this kid.
    assert len(body["sections"]) == 1
    assert body["sections"][0]["teachers"] == [
        {"id": seeded["teacher_id"], "name": "Ms Teacher"}
    ]

    # Seven submissions, one per stage — the other student's row is not
    # in this count.
    assert body["total_submissions"] == 7
    assert body["funnel"] == {
        "published": 1,
        "graded": 1,
        "flagged": 1,
        "confirmed": 1,
        "awaiting_confirm": 1,
        "awaiting_extraction": 1,
        "extraction_off": 1,
    }


@pytest.mark.asyncio
async def test_submissions_name_the_stage_and_how_long_it_has_sat(
    client: AsyncClient,
) -> None:
    seeded = await _seed()
    resp = await client.get(
        f"/v1/admin/students/{seeded['student_id']}/submissions",
        headers=auth_headers(seeded["admin_token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 7
    by_stage = {r["stage"]: r for r in body["submissions"]}
    assert set(by_stage) == {
        "published", "graded", "flagged", "confirmed",
        "awaiting_confirm", "awaiting_extraction", "extraction_off",
    }

    # The headline row: read landed, student never ruled, nothing
    # downstream ran. Dated from submission because no column records
    # when the read itself landed.
    stuck = by_stage["awaiting_confirm"]
    assert stuck["id"] == seeded["awaiting_confirm_id"]
    assert stuck["extraction_present"] is True
    assert stuck["extraction_empty"] is False
    assert stuck["confirmed_at"] is None and stuck["flagged_at"] is None
    assert stuck["stage_since"] == stuck["submitted_at"]
    assert stuck["files_count"] == 1

    # No read at all — "empty" must be null, not False: the reader
    # finding nothing and the reader never running are different
    # findings and the page words them differently.
    assert by_stage["awaiting_extraction"]["extraction_empty"] is None
    assert by_stage["extraction_off"]["extraction_present"] is False

    # Settled stages date from their own stamp, not from submission.
    assert by_stage["confirmed"]["stage_since"] == (
        by_stage["confirmed"]["confirmed_at"]
    )
    assert by_stage["published"]["stage_since"] == (
        by_stage["published"]["grade_published_at"]
    )

    # A teacher who moved the score off the AI's is the one quality
    # signal that needs no judge.
    assert by_stage["graded"]["overridden"] is True
    assert by_stage["published"]["overridden"] is False

    # The durable queue explains a confirmed submission with no calls:
    # it is owed, not lost.
    assert by_stage["confirmed"]["grading_job"]["status"] == "queued"
    assert by_stage["awaiting_confirm"]["grading_job"] is None


@pytest.mark.asyncio
async def test_empty_read_is_flagged_as_empty_not_as_a_clean_read(
    client: AsyncClient,
) -> None:
    """A student can tap "Looks right" on a screen that read nothing.
    The row has to say so — otherwise the worst possible read renders
    identically to the best one."""
    seeded = await _seed()
    async with get_session_factory()() as s:
        sub = (await s.execute(text(
            "SELECT id FROM submissions WHERE student_id = :sid "
            "AND extraction IS NOT NULL LIMIT 1"
        ), {"sid": seeded["student_id"]})).scalar_one()
        await s.execute(text(
            "UPDATE submissions SET extraction = :e WHERE id = :id"
        ), {"e": json.dumps(EMPTY_READ), "id": sub})
        await s.commit()

    resp = await client.get(
        f"/v1/admin/students/{seeded['student_id']}/submissions",
        headers=auth_headers(seeded["admin_token"]),
    )
    assert resp.status_code == 200, resp.text
    row = next(
        r for r in resp.json()["submissions"] if r["id"] == str(sub)
    )
    assert row["extraction_present"] is True
    assert row["extraction_empty"] is True


@pytest.mark.asyncio
async def test_submissions_are_scoped_to_the_one_student(
    client: AsyncClient,
) -> None:
    seeded = await _seed()
    resp = await client.get(
        f"/v1/admin/students/{seeded['other_student_id']}/submissions",
        headers=auth_headers(seeded["admin_token"]),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["total"] == 1


@pytest.mark.asyncio
async def test_404_on_a_non_student_id(client: AsyncClient) -> None:
    """A teacher id here would render their own submissions, which is a
    different page that already exists."""
    seeded = await _seed()
    for path in ("", "/submissions"):
        resp = await client.get(
            f"/v1/admin/students/{seeded['teacher_id']}{path}",
            headers=auth_headers(seeded["admin_token"]),
        )
        assert resp.status_code == 404, resp.text


@pytest.mark.asyncio
async def test_404_on_a_missing_id(client: AsyncClient) -> None:
    seeded = await _seed()
    resp = await client.get(
        f"/v1/admin/students/{uuid.uuid4()}",
        headers=auth_headers(seeded["admin_token"]),
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_non_admin_is_refused(client: AsyncClient) -> None:
    seeded = await _seed()
    student_token = create_access_token(seeded["student_id"], "student")
    resp = await client.get(
        f"/v1/admin/students/{seeded['student_id']}",
        headers=auth_headers(student_token),
    )
    assert resp.status_code == 403
