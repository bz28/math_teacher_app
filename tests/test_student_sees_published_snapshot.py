"""What a student sees is what the teacher released, not what she's editing.

`SubmissionGrade` keeps two scores: `final_score`, which follows the
teacher's edits live, and `published_final_score`, the snapshot taken
when she pressed Publish. The model comment is explicit that students
read the snapshot — "edits after publish stay as drafts until the
teacher republishes" — and the homework detail endpoint honoured that.
Its two siblings, the dashboard and the grades list, read the live
column, so reopening an already-published grade pushed the in-progress
number to a student before the teacher had decided to release it, and
left the three surfaces disagreeing with each other.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

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
from api.models.question_bank import QuestionBankItem
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.unit import Unit
from api.models.user import User
from tests.conftest import auth_headers

PUBLISHED = 78.0
MID_EDIT = 85.0


async def _world() -> dict[str, Any]:
    """A student with one published grade of 78, which the teacher has
    since edited toward 85 without republishing."""
    async with get_session_factory()() as s:
        await s.execute(text(
            "TRUNCATE TABLE submission_grades, submissions, assignment_sections, "
            "assignments, section_enrollments, sections, question_bank_items, "
            "units, course_teachers, courses, refresh_tokens, users "
            "RESTART IDENTITY CASCADE"
        ))
        await s.commit()

    async with get_session_factory()() as s:
        teacher = User(
            email=f"t_{uuid.uuid4().hex[:8]}@school.edu",
            password_hash=hash_password("x"), grade_level=12,
            role="teacher", name="Ms Teacher",
        )
        student = User(
            email=f"s_{uuid.uuid4().hex[:8]}@school.edu",
            password_hash=hash_password("x"), grade_level=12,
            role="student", name="Real Student",
        )
        s.add_all([teacher, student])
        await s.flush()

        course = Course(name="Trig/Pre-Calc", subject="math")
        s.add(course)
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))
        unit = Unit(course_id=course.id, name="Unit Circle", position=0)
        section = Section(course_id=course.id, name="Period 2")
        s.add_all([unit, section])
        await s.flush()
        s.add(SectionEnrollment(
            student_id=student.id, section_id=section.id, course_id=course.id,
        ))

        assignment = Assignment(
            course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
            title="HW 1", type="homework", status="published",
            content={"problems": []},
        )
        s.add(assignment)
        await s.flush()
        item = QuestionBankItem(
            course_id=course.id, unit_id=unit.id,
            originating_assignment_id=assignment.id,
            title="Q1", question="q", solution_steps=[{"title": "s", "description": "d"}],
            final_answer="1", distractors=["a", "b", "c"],
            status="approved", source="generated",
        )
        s.add(item)
        await s.flush()
        assignment.content = {"problems": [{
            "bank_item_id": str(item.id), "position": 1, "question": item.question,
            "solution_steps": item.solution_steps, "final_answer": item.final_answer,
            "difficulty": item.difficulty,
        }]}
        s.add(AssignmentSection(
            assignment_id=assignment.id, section_id=section.id,
            published_at=datetime.now(UTC),
        ))

        submission = Submission(
            assignment_id=assignment.id, student_id=student.id,
            section_id=section.id, status="submitted", files=[],
        )
        s.add(submission)
        await s.flush()

        # Released at 78, then reopened and edited toward 85. Exactly
        # the state the two score columns exist to represent.
        s.add(SubmissionGrade(
            submission_id=submission.id,
            final_score=MID_EDIT,
            published_final_score=PUBLISHED,
            grade_published_at=datetime.now(UTC),
        ))
        await s.commit()

        return {
            "student": auth_headers(create_access_token(str(student.id), "student")),
            "course_id": str(course.id),
            "assignment_id": str(assignment.id),
        }


async def test_the_dashboard_shows_the_released_score(client: AsyncClient) -> None:
    w = await _world()
    r = await client.get("/v1/school/student/dashboard", headers=w["student"])
    assert r.status_code == 200, r.text
    scores = [g["final_score"] for g in r.json()["recently_graded"]]
    assert scores == [PUBLISHED], scores


async def test_the_grades_list_shows_the_released_score(client: AsyncClient) -> None:
    w = await _world()
    r = await client.get("/v1/school/student/grades", headers=w["student"])
    assert r.status_code == 200, r.text
    scores = [g["final_score"] for g in r.json()["grades"]]
    assert scores == [PUBLISHED], scores


async def test_all_three_student_surfaces_agree(client: AsyncClient) -> None:
    """The bug was not just a wrong number — it was three surfaces
    disagreeing, with the homework page alone telling the truth."""
    w = await _world()
    detail = (await client.get(
        f"/v1/school/student/homework/{w['assignment_id']}", headers=w["student"],
    )).json()["final_score"]
    dash = (await client.get(
        "/v1/school/student/dashboard", headers=w["student"],
    )).json()["recently_graded"][0]["final_score"]
    listed = (await client.get(
        "/v1/school/student/grades", headers=w["student"],
    )).json()["grades"][0]["final_score"]
    assert detail == dash == listed == PUBLISHED, (detail, dash, listed)


async def test_an_unpublished_grade_is_still_invisible(client: AsyncClient) -> None:
    """Guards the half that was already right, so a future edit to these
    queries can't quietly start showing unreleased work.

    Only `grade_published_at` is cleared; the snapshot column is left
    populated on purpose. Nulling both would let the snapshot filter
    alone satisfy every assertion below, and the test would pass with
    the publication gate deleted — proving nothing about the thing it
    claims to protect.
    """
    w = await _world()
    async with get_session_factory()() as s:
        grade = (await s.execute(select(SubmissionGrade))).scalar_one()
        grade.grade_published_at = None
        await s.commit()

    assert (await client.get(
        "/v1/school/student/dashboard", headers=w["student"],
    )).json()["recently_graded"] == []
    assert (await client.get(
        "/v1/school/student/grades", headers=w["student"],
    )).json()["grades"] == []
    assert (await client.get(
        f"/v1/school/student/homework/{w['assignment_id']}", headers=w["student"],
    )).json()["final_score"] is None


async def test_a_grade_with_no_snapshot_never_falls_off_the_dashboard(
    client: AsyncClient,
) -> None:
    """`get_dashboard` answers "is this published?" twice — once to drop
    the homework from the active buckets, once to put it under Recently
    graded. When those two disagreed, a row with a score but no snapshot
    satisfied only the first, and the assignment appeared in NO bucket:
    gone from the student's dashboard entirely.

    That state is what every grade released before `as1000036` looked
    like. `cm1000082` backfills what it safely can, but the two queries must agree on
    their own terms — a dashboard that silently drops a homework is worse
    than one showing it in the wrong place.
    """
    w = await _world()
    async with get_session_factory()() as s:
        grade = (await s.execute(select(SubmissionGrade))).scalar_one()
        grade.published_final_score = None  # pre-as1000036 shape
        await s.commit()

    dash = (await client.get(
        "/v1/school/student/dashboard", headers=w["student"],
    )).json()
    buckets = ["due_this_week", "overdue", "in_review", "recently_graded"]
    appearances = {b: len(dash[b]) for b in buckets}
    assert sum(appearances.values()) == 1, appearances
    # No released snapshot, so it belongs with the work awaiting a
    # grade — which is what all four student surfaces now say.
    assert appearances["in_review"] == 1, appearances

    # The fourth surface. homework_detail gated on grade_published_at
    # alone, so it handed the page a publish timestamp with no score —
    # and AssignmentTimeline keys its stage off that field without
    # consulting the score, so the page announced "Graded" while the
    # dashboard said the work was still awaiting one.
    detail = (await client.get(
        f"/v1/school/student/homework/{w['assignment_id']}",
        headers=w["student"],
    )).json()
    assert detail["final_score"] is None, detail["final_score"]
    assert detail["grade_published_at"] is None, detail["grade_published_at"]


async def test_un_grading_after_release_leaves_the_released_score_standing(
    client: AsyncClient,
) -> None:
    """Clearing a breakdown nulls `final_score` but keeps the publication
    and its snapshot (`teacher_assignments.py`, "empty list = clear").
    That is a live row whose two score columns disagree in the opposite
    direction to a mid-edit draft, and it is reachable from a real
    endpoint.

    The released 78 stands until she republishes — and the homework must
    still appear exactly once, since the bucket query and the
    recently-graded query both answer "is this published?" from the
    snapshot.
    """
    w = await _world()
    async with get_session_factory()() as s:
        grade = (await s.execute(select(SubmissionGrade))).scalar_one()
        grade.final_score = None
        grade.breakdown = []
        await s.commit()

    dash = (await client.get(
        "/v1/school/student/dashboard", headers=w["student"],
    )).json()
    buckets = ["due_this_week", "overdue", "in_review", "recently_graded"]
    appearances = {b: len(dash[b]) for b in buckets}
    assert sum(appearances.values()) == 1, appearances
    assert dash["recently_graded"][0]["final_score"] == PUBLISHED

    listed = (await client.get(
        "/v1/school/student/grades", headers=w["student"],
    )).json()["grades"]
    assert [g["final_score"] for g in listed] == [PUBLISHED]
