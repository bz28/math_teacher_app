"""Per-section due dates (POST /v1/teacher/assignments/{id}/due-dates).

A homework's date can differ by section. A student's lateness, late
penalty, closing and queued grading follow their section's date, and a
personal extension still only ever extends it. Editing a date — on a
published homework too — re-derives lateness for work already in; a
published grade is never changed under the student, it shows as changed
until the teacher republishes. The migration backfills every existing
section row with its homework's date.
"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select, text, update

from api.core.late_policy import effective_due_at, refresh_lateness, student_due_dates
from api.database import get_session_factory
from api.models.assignment import (
    Assignment,
    AssignmentSection,
    StudentDueDate,
    Submission,
    SubmissionGrade,
)
from api.models.course import CourseTeacher
from api.models.grading_job import GradingJob
from api.models.section import Section
from tests.conftest import auth_headers as _auth

DAY = timedelta(hours=24)
HW_DUE = datetime(2026, 12, 4, 4, 59, tzinfo=UTC)  # Thu 11:59 PM ET


async def _setup(world: dict[str, Any], *, policy: str = "penalty_per_day") -> dict[str, Any]:
    """The world's homework due HW_DUE, a second section with no students,
    the teacher on the course."""
    async with get_session_factory()() as s:
        a = await s.get(Assignment, world["assignment_id"])
        assert a is not None
        a.due_at = HW_DUE
        a.late_policy = policy
        row = (await s.execute(
            select(AssignmentSection).where(AssignmentSection.assignment_id == a.id)
        )).scalar_one()
        row.due_at = HW_DUE
        other = Section(course_id=a.course_id, name="Period 3")
        s.add(other)
        await s.flush()
        s.add(AssignmentSection(assignment_id=a.id, section_id=other.id, due_at=HW_DUE))
        s.add(CourseTeacher(course_id=a.course_id, teacher_id=world["teacher_id"], role="owner"))
        await s.commit()
        return {"aid": a.id, "student_section": row.section_id, "other_section": other.id}


async def _turn_in(world: dict[str, Any], at: datetime, *, score: float | None = None,
                   published: bool = False) -> uuid.UUID:
    async with get_session_factory()() as s:
        section_id = (await s.execute(
            select(AssignmentSection.section_id)
            .join(Section, Section.id == AssignmentSection.section_id)
            .where(AssignmentSection.assignment_id == world["assignment_id"], Section.name != "Period 3")
        )).scalar_one()
        sub = Submission(
            assignment_id=world["assignment_id"], student_id=world["student_id"], section_id=section_id,
            status="submitted", submitted_at=at, is_late=at > HW_DUE,
        )
        s.add(sub)
        await s.flush()
        if score is not None:
            now = datetime.now(UTC) - timedelta(minutes=5)
            s.add(SubmissionGrade(
                submission_id=sub.id, final_score=score, late_penalty=0.0, graded_at=now,
                grade_published_at=now if published else None,
                published_final_score=score if published else None,
                published_late_penalty=0.0 if published else None,
            ))
        await s.flush()
        if score is not None and not published:
            # Price the turn-in against today's date, as grading would have.
            a = await s.get(Assignment, world["assignment_id"])
            assert a is not None
            await refresh_lateness(s, a)
        await s.commit()
        return sub.id


async def _due_dates(client: AsyncClient, world: dict[str, Any], body: dict[str, Any]) -> Any:
    return await client.post(
        f"/v1/teacher/assignments/{world['assignment_id']}/due-dates",
        json=body, headers=_auth(world["teacher_token"]),
    )


async def test_a_students_date_is_their_sections(world: dict[str, Any]) -> None:
    w = await _setup(world)
    async with get_session_factory()() as s:
        await s.execute(update(AssignmentSection).where(
            AssignmentSection.section_id == w["student_section"]).values(due_at=HW_DUE + 2 * DAY))
        await s.commit()
        a = await s.get(Assignment, w["aid"])
        assert a is not None
        assert await effective_due_at(s, a, world["student_id"]) == HW_DUE + 2 * DAY
        assert (await student_due_dates(s, world["student_id"], [a]))[a.id] == HW_DUE + 2 * DAY
        # A student in none of its sections keeps the homework's date.
        assert await effective_due_at(s, a, uuid.uuid4()) == HW_DUE
        # A row written without a date (before per-section dates) reads as the homework's.
        await s.execute(update(AssignmentSection).where(
            AssignmentSection.section_id == w["student_section"]).values(due_at=None))
        await s.commit()
        assert await effective_due_at(s, a, world["student_id"]) == HW_DUE


async def test_an_extension_beats_the_section_date_and_never_shortens_it(
    world: dict[str, Any],
) -> None:
    w = await _setup(world)
    async with get_session_factory()() as s:
        await s.execute(update(AssignmentSection).where(
            AssignmentSection.section_id == w["student_section"]).values(due_at=HW_DUE + 2 * DAY))
        s.add(StudentDueDate(assignment_id=w["aid"], student_id=world["student_id"],
                             due_at=HW_DUE + 5 * DAY))
        await s.commit()
        a = await s.get(Assignment, w["aid"])
        assert a is not None
        assert await effective_due_at(s, a, world["student_id"]) == HW_DUE + 5 * DAY
        # An extension earlier than the section's date doesn't pull it in.
        await s.execute(update(StudentDueDate).values(due_at=HW_DUE + DAY))
        await s.commit()
        assert await effective_due_at(s, a, world["student_id"]) == HW_DUE + 2 * DAY


async def test_a_section_date_edit_recomputes_lateness_of_work_already_in(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    w = await _setup(world)
    sub_id = await _turn_in(world, HW_DUE + DAY / 2, score=90.0)  # 12 h late
    body = {"section_due_dates": {str(w["student_section"]): (HW_DUE + DAY).isoformat()}}

    preview = await _due_dates(client, world, {**body, "dry_run": True})
    assert preview.status_code == 200, preview.text
    p = preview.json()
    assert (p["lateness_changed"], p["grades_changed"], p["saved"]) == (1, 1, False)
    async with get_session_factory()() as s:
        sub = await s.get(Submission, sub_id)
        assert sub is not None and sub.is_late  # the preview saved nothing

    r = await _due_dates(client, world, body)
    assert r.status_code == 200, r.text
    dates = {d["section_id"]: d["due_at"] for d in r.json()["section_due_dates"]}
    assert datetime.fromisoformat(dates[str(w["student_section"])]) == HW_DUE + DAY
    assert datetime.fromisoformat(dates[str(w["other_section"])]) == HW_DUE
    async with get_session_factory()() as s:
        sub = await s.get(Submission, sub_id)
        grade = (await s.execute(
            select(SubmissionGrade).where(SubmissionGrade.submission_id == sub_id))).scalar_one()
        assert sub is not None and not sub.is_late
        assert grade.final_score == 90.0 and grade.late_penalty == 0.0


async def test_one_date_for_every_section_moves_them_all_and_reprices(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    w = await _setup(world)
    sub_id = await _turn_in(world, HW_DUE - DAY / 2, score=80.0)  # on time
    r = await _due_dates(client, world, {"due_at": (HW_DUE - DAY).isoformat()})
    assert r.status_code == 200, r.text
    assert r.json()["lateness_changed"] == 1
    assert {datetime.fromisoformat(d["due_at"]) for d in r.json()["section_due_dates"]} == {HW_DUE - DAY}
    async with get_session_factory()() as s:
        sub = await s.get(Submission, sub_id)
        grade = (await s.execute(
            select(SubmissionGrade).where(SubmissionGrade.submission_id == sub_id))).scalar_one()
        assert sub is not None and sub.is_late
        assert grade.final_score == 72.0 and grade.late_penalty == 8.0  # 1 started day: 10%
        a = await s.get(Assignment, w["aid"])
        assert a is not None and a.due_at == HW_DUE - DAY


async def test_a_published_grade_goes_dirty_and_the_student_keeps_the_published_one(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    await _setup(world)
    sub_id = await _turn_in(world, HW_DUE - DAY / 2, score=80.0, published=True)
    r = await _due_dates(client, world, {"due_at": (HW_DUE - DAY).isoformat()})
    assert r.status_code == 200, r.text
    assert r.json()["published_grades_changed"] == 1
    async with get_session_factory()() as s:
        grade = (await s.execute(
            select(SubmissionGrade).where(SubmissionGrade.submission_id == sub_id))).scalar_one()
        assert grade.final_score == 72.0
        # What the student sees is the published snapshot, untouched …
        assert grade.published_final_score == 80.0 and grade.published_late_penalty == 0.0
        # … and the live grade reads as changed since publishing.
        assert grade.graded_at is not None and grade.grade_published_at is not None
        assert grade.graded_at > grade.grade_published_at


async def test_queued_grading_waits_for_the_students_section_date(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    w = await _setup(world)
    sub_id = await _turn_in(world, HW_DUE - DAY)
    async with get_session_factory()() as s:
        s.add(GradingJob(submission_id=sub_id, assignment_id=w["aid"], status="queued",
                         scheduled_for=HW_DUE))
        await s.commit()
    later = HW_DUE + 3 * DAY
    r = await _due_dates(client, world, {"section_due_dates": {str(w["student_section"]): later.isoformat()}})
    assert r.status_code == 200, r.text
    async with get_session_factory()() as s:
        job = (await s.execute(select(GradingJob).where(GradingJob.submission_id == sub_id))).scalar_one()
        assert job.scheduled_for == later


async def test_refuses_a_foreign_section_a_naive_date_and_practice(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    await _setup(world)
    r = await _due_dates(client, world, {"section_due_dates": {str(uuid.uuid4()): HW_DUE.isoformat()}})
    assert r.status_code == 404
    r = await _due_dates(client, world, {"due_at": "2026-12-05T23:59:00"})
    assert r.status_code == 400
    r = await _due_dates(client, world, {
        "clear_due_at": True,
        "section_due_dates": {str((await _setup_section(world))): HW_DUE.isoformat()},
    })
    assert r.status_code == 400  # no homework date, so no date per section
    async with get_session_factory()() as s:
        a = await s.get(Assignment, world["assignment_id"])
        assert a is not None and a.due_at == HW_DUE  # nothing half-saved


async def _setup_section(world: dict[str, Any]) -> uuid.UUID:
    async with get_session_factory()() as s:
        return (await s.execute(select(AssignmentSection.section_id).where(
            AssignmentSection.assignment_id == world["assignment_id"]).limit(1))).scalar_one()


async def test_the_student_sees_their_sections_date(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    w = await _setup(world)
    later = HW_DUE + 2 * DAY
    r = await _due_dates(client, world, {"section_due_dates": {str(w["student_section"]): later.isoformat()}})
    assert r.status_code == 200, r.text
    r = await client.get(
        f"/v1/school/student/homework/{world['assignment_id']}", headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200, r.text
    assert datetime.fromisoformat(r.json()["due_at"]) == later


# ── The migration's backfill ──

MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "api" / "alembic" / "versions" / "dt1000107_section_due_dates.py"
)


def _backfill_sql() -> str:
    body = MIGRATION.read_text().split("def upgrade()", 1)[1]
    match = re.search(r'"""(.*?)"""', body, re.DOTALL)
    assert match, "could not find the UPDATE in the migration"
    assert "UPDATE assignment_sections" in match.group(1)
    return match.group(1)


async def test_the_backfill_gives_every_section_row_its_homeworks_date(
    world: dict[str, Any],
) -> None:
    w = await _setup(world)
    async with get_session_factory()() as s:
        practice = Assignment(course_id=(await s.get(Assignment, w["aid"])).course_id,  # type: ignore[union-attr]
                              teacher_id=world["teacher_id"], title="P", type="practice",
                              status="published", unit_ids=[world["unit_id"]])
        s.add(practice)
        await s.flush()
        s.add(AssignmentSection(assignment_id=practice.id, section_id=w["other_section"]))
        # Rows as they were before the column: no date.
        await s.execute(update(AssignmentSection).values(due_at=None))
        await s.commit()
        await s.execute(text(_backfill_sql()))
        await s.commit()
        rows = (await s.execute(
            select(AssignmentSection.assignment_id, AssignmentSection.due_at))).all()
    hw_rows = [at for aid, at in rows if aid == w["aid"]]
    assert hw_rows == [HW_DUE, HW_DUE]
    # A homework with no due date (practice) keeps none.
    assert [at for aid, at in rows if aid == practice.id] == [None]
