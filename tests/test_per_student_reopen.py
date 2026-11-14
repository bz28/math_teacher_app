"""Reopening a homework for one student (POST /teacher/assignments/{id}/
students/{student_id}/reopen).

The teacher picks a personal due date. It replaces the class date for that
student everywhere the date counts — closing, `is_late`, the late penalty
— and for no one else. A student who never turned it in can now; one who
did may turn it in once more, and until they do their turn-in and its
grade stand. When they do, the old turn-in is kept whole (photos,
reading, grade, understanding check) as an attempt, and the new one walks
the normal path from nothing, for the teacher to grade and approve.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select, text
from sqlalchemy.orm import undefer

from api.core.late_policy import HOMEWORK_CLOSED_DETAIL, effective_due_dates
from api.database import get_session_factory
from api.models.assignment import (
    Assignment,
    AssignmentSection,
    StudentDueDate,
    Submission,
    SubmissionAttempt,
    SubmissionGrade,
)
from api.models.course import CourseTeacher
from api.models.grading_job import GradingJob
from api.models.integrity_check import IntegrityCheckSubmission, IntegrityConversationTurn
from api.routes.school_student_practice import drain_integrity_background_tasks
from tests.conftest import PAGE_PNG
from tests.conftest import auth_headers as _auth
from tests.test_submission_retake import NEW_PAGE

DAY = timedelta(hours=24)


async def _set_hw(aid: uuid.UUID, **fields: Any) -> None:
    async with get_session_factory()() as s:
        a = (await s.execute(select(Assignment).where(Assignment.id == aid))).scalar_one()
        for k, v in fields.items():
            setattr(a, k, v)
        await s.commit()


def _reopen_url(world: dict[str, Any], student_id: Any = None) -> str:
    sid = student_id or world["student_id"]
    return f"/v1/teacher/assignments/{world['assignment_id']}/students/{sid}/reopen"


async def _reopen(client: AsyncClient, world: dict[str, Any], due_at: datetime, **kw: Any) -> Any:
    return await client.post(
        _reopen_url(world, kw.get("student_id")),
        json={"due_at": due_at.isoformat()},
        headers=_auth(kw.get("token", world["teacher_token"])),
    )


async def _submit(client: AsyncClient, world: dict[str, Any], files: list[str] | None = None) -> Any:
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        json={"files": files or [PAGE_PNG]}, headers=_auth(world["student_token"]),
    )
    await drain_integrity_background_tasks()
    return r


async def _detail(client: AsyncClient, world: dict[str, Any]) -> dict[str, Any]:
    r = await client.get(
        f"/v1/school/student/homework/{world['assignment_id']}", headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200, r.text
    body: dict[str, Any] = r.json()
    return body


async def _dashboard(client: AsyncClient, world: dict[str, Any]) -> dict[str, Any]:
    body: dict[str, Any] = (await client.get(
        "/v1/school/student/dashboard", headers=_auth(world["student_token"]),
    )).json()
    return body


async def _publish_grade(sid: uuid.UUID, score: float) -> None:
    async with get_session_factory()() as s:
        now = datetime.now(UTC)
        s.add(SubmissionGrade(
            submission_id=sid, final_score=score, published_final_score=score,
            breakdown=[], published_breakdown=[], teacher_notes="Nice work",
            published_teacher_notes="Nice work", grade_published_at=now, reviewed_at=now,
        ))
        await s.commit()


async def _attempts(sid: uuid.UUID) -> list[SubmissionAttempt]:
    async with get_session_factory()() as s:
        return list((await s.execute(
            select(SubmissionAttempt)
            .options(undefer(SubmissionAttempt.files), undefer(SubmissionAttempt.integrity))
            .where(SubmissionAttempt.submission_id == sid)
            .order_by(SubmissionAttempt.number)
        )).scalars().all())


async def _sub(sid: uuid.UUID) -> Submission:
    async with get_session_factory()() as s:
        return (await s.execute(
            select(Submission).where(Submission.id == sid).options(undefer(Submission.files))
        )).scalar_one()


# ── A student who never turned it in ─────────────────────────────────


async def test_reopening_a_closed_homework_lets_a_missed_student_turn_it_in(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    now = datetime.now(UTC)
    await _set_hw(world["assignment_id"], due_at=now - DAY, late_policy="no_credit")
    assert (await _detail(client, world))["closed"] is True
    assert (await _submit(client, world)).json()["detail"] == HOMEWORK_CLOSED_DETAIL

    personal = now + 2 * DAY
    r = await _reopen(client, world, personal)
    assert r.status_code == 200, r.text
    assert r.json()["reopened_at"] is None  # nothing was turned in to replace

    detail = await _detail(client, world)
    assert detail["closed"] is False
    assert datetime.fromisoformat(detail["due_at"]) == personal
    dash = await _dashboard(client, world)
    assert [a["assignment_id"] for a in dash["due_this_week"]] == [str(world["assignment_id"])]
    assert dash["closed"] == []

    r = await _submit(client, world)
    assert r.status_code == 200, r.text
    assert r.json()["is_late"] is False  # before their date: on time

    # The roster sees the personal date on the student.
    r = await client.get(
        f"/v1/teacher/assignments/{world['assignment_id']}/submissions", headers=_auth(world["teacher_token"]),
    )
    body = r.json()
    assert datetime.fromisoformat(body["personal_due_dates"][str(world["student_id"])]) == personal
    [row] = body["submissions"]
    assert datetime.fromisoformat(row["due_at"]) == personal
    assert row["days_late"] == 0


async def test_a_personal_date_is_only_that_students(world: dict[str, Any]) -> None:
    class_due = datetime.now(UTC) - DAY
    personal = datetime.now(UTC) + DAY
    async with get_session_factory()() as s:
        s.add(StudentDueDate(
            assignment_id=world["assignment_id"], student_id=world["student_id"], due_at=personal,
        ))
        await s.commit()
        a = (await s.execute(select(Assignment).where(Assignment.id == world["assignment_id"]))).scalar_one()
        a.due_at = class_due
        due = await effective_due_dates(s, a, [world["student_id"], world["outsider_id"]])
    assert due == {world["student_id"]: personal, world["outsider_id"]: class_due}


# ── A student who did ────────────────────────────────────────────────


async def test_reopening_graded_work_keeps_the_grade_until_they_turn_it_in_again(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    await _set_hw(world["assignment_id"], due_at=datetime.now(UTC) - DAY, late_policy="no_credit")
    # Turned in on time, then graded and published.
    await _set_hw(world["assignment_id"], due_at=datetime.now(UTC) + DAY)
    first = await _submit(client, world)
    sid = uuid.UUID(first.json()["submission_id"])
    await _set_hw(world["assignment_id"], due_at=datetime.now(UTC) - DAY)
    await _publish_grade(sid, 70.0)
    assert (await _submit(client, world)).status_code == 409
    before = await _sub(sid)

    r = await _reopen(client, world, datetime.now(UTC) + 3 * DAY)
    assert r.status_code == 200, r.text
    assert r.json()["reopened_at"] is not None

    # It's to do again — but the grade stands, and the student still sees it.
    detail = await _detail(client, world)
    assert detail["can_resubmit"] is True
    assert detail["submitted"] is True
    assert detail["final_score"] == 70.0
    listed = (await client.get(
        f"/v1/school/student/courses/{detail['course_id']}/homework", headers=_auth(world["student_token"]),
    )).json()
    assert listed[0]["can_resubmit"] is True
    dash = await _dashboard(client, world)
    [due] = dash["due_this_week"]
    assert due["can_resubmit"] is True
    assert dash["in_review"] == []
    assert [g["final_score"] for g in dash["recently_graded"]] == [70.0]

    # The understanding check it ran, to prove that's kept too.
    async with get_session_factory()() as s:
        check = IntegrityCheckSubmission(submission_id=sid, status="complete", disposition="pass")
        s.add(check)
        await s.flush()
        s.add(IntegrityConversationTurn(
            integrity_check_submission_id=check.id, ordinal=0, role="student", content="I factored it",
        ))
        await s.commit()

    r = await _submit(client, world, [NEW_PAGE, NEW_PAGE])
    assert r.status_code == 200, r.text
    assert r.json()["submission_id"] == str(sid)  # the same row, its latest turn-in
    assert r.json()["is_late"] is False

    after = await _sub(sid)
    assert len(after.files or []) == 2
    assert after.reopened_at is None
    assert after.extraction is not None  # read again (mocked reader)
    assert after.extraction_confirmed_at is None
    assert after.submitted_at > before.submitted_at

    # The old turn-in, whole: photos, reading, grade, check.
    [old] = await _attempts(sid)
    assert (old.number, old.reason) == (1, "reopen")
    assert old.files == before.files
    assert old.submitted_at == before.submitted_at
    assert old.grade is not None
    assert (old.grade["final_score"], old.grade["published_final_score"]) == (70.0, 70.0)
    assert old.grade["teacher_notes"] == "Nice work"
    assert old.integrity is not None
    assert old.integrity["check"]["disposition"] == "pass"
    assert [t["content"] for t in old.integrity["turns"]] == ["I factored it"]

    # Cleared off the live submission: the new turn-in starts from nothing,
    # and the student sees no grade until the teacher approves a new one.
    async with get_session_factory()() as s:
        assert (await s.execute(
            select(SubmissionGrade).where(SubmissionGrade.submission_id == sid)
        )).scalar_one_or_none() is None
        assert (await s.execute(
            select(IntegrityCheckSubmission).where(IntegrityCheckSubmission.submission_id == sid)
        )).scalar_one_or_none() is None
    detail = await _detail(client, world)
    assert (detail["can_resubmit"], detail["final_score"]) == (False, None)
    dash = await _dashboard(client, world)
    assert [a["assignment_id"] for a in dash["in_review"]] == [str(world["assignment_id"])]
    assert dash["recently_graded"] == []

    # One turn-in per reopen.
    assert (await _submit(client, world)).status_code == 409

    # The teacher sees the attempt, with the grade it had, and its photos.
    r = await client.get(f"/v1/teacher/submissions/{sid}", headers=_auth(world["teacher_token"]))
    body = r.json()
    assert body["reopened_at"] is None
    [a] = body["attempts"]
    assert (a["number"], a["reason"], a["file_count"]) == (1, "reopen", 1)
    assert (a["final_score"], a["grade_published"]) == (70.0, True)
    r = await client.get(f"/v1/teacher/submissions/{sid}/attempts/1/files", headers=_auth(world["teacher_token"]))
    assert [f["data"] for f in r.json()["files"]] == [PAGE_PNG]

    async with get_session_factory()() as s:
        actions = (await s.execute(text(
            "SELECT action FROM activity_log WHERE action IN "
            "('assignment.reopen_student', 'submission.resubmit') ORDER BY performed_at"
        ))).scalars().all()
    assert actions == ["assignment.reopen_student", "submission.resubmit"]


async def test_reopening_reprices_work_already_in_against_the_new_date(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """A personal date is an extension: a turn-in already in before it is
    on time, so its late penalty comes off (and returns on cancel)."""
    await _set_hw(world["assignment_id"], due_at=datetime.now(UTC) - 2 * DAY + timedelta(minutes=1),
                  late_policy="penalty_per_day")
    sid = uuid.UUID((await _submit(client, world)).json()["submission_id"])
    r = await client.patch(
        f"/v1/teacher/submissions/{sid}/grade",
        json={"breakdown": [{"problem_id": str(world["primary_id"]), "score_status": "partial", "percent": 80}]},
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 200, r.text
    assert r.json()["final_score"] == 64.0  # two started days late: 80 × 0.8

    assert (await _reopen(client, world, datetime.now(UTC) + DAY)).status_code == 200
    async with get_session_factory()() as s:
        g = (await s.execute(select(SubmissionGrade).where(SubmissionGrade.submission_id == sid))).scalar_one()
        assert (g.final_score, g.late_penalty) == (80.0, 0.0)
    assert (await _sub(sid)).is_late is False

    r = await client.delete(_reopen_url(world), headers=_auth(world["teacher_token"]))
    assert r.status_code == 200, r.text
    async with get_session_factory()() as s:
        g = (await s.execute(select(SubmissionGrade).where(SubmissionGrade.submission_id == sid))).scalar_one()
        assert g.final_score == 64.0
    row = await _sub(sid)
    assert (row.is_late, row.reopened_at) == (True, None)
    assert (await _detail(client, world))["can_resubmit"] is False
    assert (await _submit(client, world)).status_code == 409


async def test_cancelling_closes_a_missed_homework_again(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    await _set_hw(world["assignment_id"], due_at=datetime.now(UTC) - DAY, late_policy="no_credit")
    await _reopen(client, world, datetime.now(UTC) + DAY)
    assert (await _detail(client, world))["closed"] is False
    assert (await client.delete(_reopen_url(world), headers=_auth(world["teacher_token"]))).status_code == 200
    assert (await _detail(client, world))["closed"] is True
    # Idempotent.
    assert (await client.delete(_reopen_url(world), headers=_auth(world["teacher_token"]))).status_code == 200


async def test_a_reopen_past_its_date_closes_again(client: AsyncClient, world: dict[str, Any]) -> None:
    """Under "Closed after due date" the personal date closes too."""
    await _set_hw(world["assignment_id"], due_at=datetime.now(UTC) + DAY, late_policy="no_credit")
    sid = uuid.UUID((await _submit(client, world)).json()["submission_id"])
    await _reopen(client, world, datetime.now(UTC) + 2 * DAY)
    async with get_session_factory()() as s:
        await s.execute(text(
            "UPDATE student_due_dates SET due_at = now() - interval '1 minute'"
        ))
        await s.commit()
    await _set_hw(world["assignment_id"], due_at=datetime.now(UTC) - 2 * DAY)
    assert (await _detail(client, world))["can_resubmit"] is False
    r = await _submit(client, world)
    assert r.status_code == 403
    assert (await _sub(sid)).reopened_at is not None  # still owed, if she moves the date


async def test_not_while_the_old_turn_in_is_being_graded(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    sid = uuid.UUID((await _submit(client, world)).json()["submission_id"])
    await _reopen(client, world, datetime.now(UTC) + DAY)
    async with get_session_factory()() as s:
        s.add(GradingJob(submission_id=sid, assignment_id=world["assignment_id"], status="running"))
        await s.commit()
    r = await _submit(client, world, [NEW_PAGE])
    assert r.status_code == 409
    assert "being graded" in r.json()["detail"]
    row = await _sub(sid)
    assert row.reopened_at is not None
    assert len(row.files or []) == 1
    assert await _attempts(sid) == []


async def test_a_second_reopen_grants_another_turn_in(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    sid = uuid.UUID((await _submit(client, world)).json()["submission_id"])
    for n in (1, 2):
        await _reopen(client, world, datetime.now(UTC) + n * DAY)
        assert (await _submit(client, world, [NEW_PAGE])).status_code == 200
    assert [a.number for a in await _attempts(sid)] == [1, 2]


# ── Who can, and what dates ──────────────────────────────────────────


async def test_the_date_must_be_future_and_not_before_the_class_date(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    class_due = datetime.now(UTC) + 2 * DAY
    await _set_hw(world["assignment_id"], due_at=class_due)
    assert (await _reopen(client, world, datetime.now(UTC) - DAY)).status_code == 400
    assert (await _reopen(client, world, class_due - DAY)).status_code == 400
    r = await client.post(
        _reopen_url(world), json={"due_at": "2030-01-01T09:00:00"}, headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 400  # no time zone
    assert (await _reopen(client, world, class_due)).status_code == 200


async def test_only_the_homeworks_teacher_for_a_student_on_it(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    from api.core.auth import create_access_token, hash_password
    from api.models.user import User

    later = datetime.now(UTC) + DAY
    async with get_session_factory()() as s:
        other = User(
            email=f"other_{uuid.uuid4().hex[:6]}@t.com", name="Other",
            password_hash=hash_password("x"), grade_level=12, role="teacher",
        )
        s.add(other)
        await s.commit()
        other_token = create_access_token(str(other.id), "teacher")
    assert (await _reopen(client, world, later, token=other_token)).status_code in (403, 404)
    assert (await _reopen(client, world, later, token=world["student_token"])).status_code in (401, 403)
    # A student not in a section it's assigned to.
    assert (await _reopen(client, world, later, student_id=world["outsider_id"])).status_code == 404
    async with get_session_factory()() as s:
        assert (await s.execute(text("SELECT count(*) FROM student_due_dates"))).scalar_one() == 0

    await _set_hw(world["assignment_id"], status="draft")
    assert (await _reopen(client, world, later)).status_code == 400


async def test_two_resubmits_at_once_only_one_lands(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """A double tap: the row lock makes the second wait, then find the
    reopen used up — one turn-in kept, one attempt archived."""
    import asyncio

    sid = uuid.UUID((await _submit(client, world)).json()["submission_id"])
    await _reopen(client, world, datetime.now(UTC) + DAY)
    r1, r2 = await asyncio.gather(_submit(client, world, [NEW_PAGE]), _submit(client, world, [NEW_PAGE]))
    assert sorted([r1.status_code, r2.status_code]) == [200, 409]
    assert [a.number for a in await _attempts(sid)] == [1]


# ── A personal date only ever extends ────────────────────────────────


async def test_a_class_date_moved_past_the_personal_one_wins(world: dict[str, Any]) -> None:
    now = datetime.now(UTC)
    personal = now + DAY
    async with get_session_factory()() as s:
        s.add(StudentDueDate(
            assignment_id=world["assignment_id"], student_id=world["student_id"], due_at=personal,
        ))
        await s.commit()
        a = (await s.execute(select(Assignment).where(Assignment.id == world["assignment_id"]))).scalar_one()
        a.due_at = now + 3 * DAY  # the teacher gave the whole class longer
        assert (await effective_due_dates(s, a, [world["student_id"]]))[world["student_id"]] == a.due_at
        a.due_at = None  # no class date: nothing is due, for anyone
        assert (await effective_due_dates(s, a, [world["student_id"]]))[world["student_id"]] is None


async def test_not_missing_in_the_grades_before_the_personal_date(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    aid = world["assignment_id"]
    await _set_hw(aid, due_at=datetime.now(UTC) - DAY)
    async with get_session_factory()() as s:
        hw = (await s.execute(select(Assignment).where(Assignment.id == aid))).scalar_one()
        section_id = (await s.execute(
            select(AssignmentSection.section_id).where(AssignmentSection.assignment_id == aid)
        )).scalar_one()
        course_id = hw.course_id
        s.add(CourseTeacher(course_id=course_id, teacher_id=hw.teacher_id, role="owner"))
        await s.commit()
    headers = _auth(world["teacher_token"])
    base = f"/v1/teacher/courses/{course_id}"
    student = str(world["student_id"])

    async def missing() -> tuple[int, str, int]:
        roster = (await client.get(f"{base}/grades", headers=headers)).json()
        book = (await client.get(f"{base}/sections/{section_id}/gradebook", headers=headers)).json()
        detail = (await client.get(
            f"{base}/sections/{section_id}/students/{student}/grades", headers=headers,
        )).json()
        [row] = [r for r in roster["students"] if r["student_id"] == student]
        [cell] = [st["cells"][str(aid)] for st in book["students"] if st["student_id"] == student]
        return row["missing_count"], cell["state"], detail["missing_count"]

    assert await missing() == (1, "missing", 1)
    await _reopen(client, world, datetime.now(UTC) + DAY)
    assert await missing() == (0, "not_turned_in", 0)
    await client.delete(_reopen_url(world), headers=headers)
    assert await missing() == (1, "missing", 1)
