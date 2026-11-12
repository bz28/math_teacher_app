"""The late policy does what the teacher picked (api/core/late_policy.py).

`none` accepts any time and takes nothing; `penalty_per_day` takes 10% of
the score per started 24 hours late (85% a day late is 76.5%), all of it at
10 days, as its own line the teacher sees and can waive; `no_credit` closes
the homework to *new* turn-ins at its due date and never touches work
already in. A homework with no due date is never late and never closes. A
teacher's preview is never closed.

The penalty must reach the score the same way whichever writer touches
`final_score` — AI grade, hand grade, graph verdict, points rescore, a
due-date or policy change, the waiver — and publish must carry it to the
student and the gradebook.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select

# Bound before conftest's autouse fixture swaps it for a no-op.
from api.core.grading_ai import run_ai_grading_for_submission as _real_run_ai_grading
from api.core.late_policy import (
    HOMEWORK_CLOSED_DETAIL,
    days_late,
    is_closed,
    penalty_percent,
    set_final_score,
)
from api.database import get_session_factory
from api.models.assignment import Assignment, AssignmentSection, Submission, SubmissionGrade
from api.models.course import CourseTeacher
from api.models.section_enrollment import SectionEnrollment
from tests.conftest import PAGE_PNG
from tests.conftest import auth_headers as _auth
from tests.test_teacher_review_checkpoint import _seed_hw

DUE = datetime(2026, 11, 10, 23, 59, tzinfo=UTC)
MIN = timedelta(minutes=1)
DAY = timedelta(hours=24)


# ── The rule ──────────────────────────────────────────────────────────


@pytest.mark.parametrize(("submitted", "days"), [
    (DUE - MIN, 0),
    (DUE, 0),                    # exactly at the due date is on time
    (DUE + MIN, 1),              # a minute after is a started day
    (DUE + DAY, 1),
    (DUE + DAY + MIN, 2),
    (DUE + 10 * DAY + MIN, 11),
])
def test_days_late_counts_started_days(submitted: datetime, days: int) -> None:
    assert days_late(submitted, DUE) == days


def test_no_due_date_is_never_late_and_never_closes() -> None:
    assert days_late(DUE + 100 * DAY, None) == 0
    assert not is_closed("no_credit", None, DUE + 100 * DAY)


@pytest.mark.parametrize(("policy", "days", "percent"), [
    ("none", 3, 0.0),
    ("penalty_per_day", 0, 0.0),
    ("penalty_per_day", 1, 10.0),
    ("penalty_per_day", 2, 20.0),
    ("penalty_per_day", 10, 100.0),
    ("penalty_per_day", 11, 100.0),  # capped at all of it
    ("no_credit", 1, 0.0),           # closed refuses new work; never scores old work
    ("no_credit", 30, 0.0),
])
def test_penalty_percent(policy: str, days: int, percent: float) -> None:
    assert penalty_percent(policy, days) == percent


def test_closes_only_after_the_due_date_under_no_credit() -> None:
    assert not is_closed("no_credit", DUE, DUE)
    assert is_closed("no_credit", DUE, DUE + MIN)
    assert not is_closed("penalty_per_day", DUE, DUE + 30 * DAY)
    assert not is_closed("none", DUE, DUE + 30 * DAY)


@pytest.mark.parametrize(("raw", "percent", "final", "taken"), [
    (85.0, 10.0, 76.5, 8.5),     # one day late
    (85.0, 20.0, 68.0, 17.0),    # two
    (85.0, 100.0, 0.0, 85.0),    # ten or more
    (15.0, 20.0, 12.0, 3.0),     # a percent of the score, so never below zero
    (0.0, 50.0, 0.0, 0.0),
    (85.0, 0.0, 85.0, 0.0),
])
def test_set_final_score_takes_a_percent_of_the_score(
    raw: float, percent: float, final: float, taken: float,
) -> None:
    g = SubmissionGrade(late_penalty_waived=False)
    set_final_score(g, raw, percent)
    assert g.final_score == pytest.approx(final)
    assert g.late_penalty == pytest.approx(taken)


def test_set_final_score_waived_and_ungraded() -> None:
    g = SubmissionGrade(late_penalty_waived=True)
    set_final_score(g, 85.0, 20.0)
    assert (g.final_score, g.late_penalty) == (85.0, 0.0)
    set_final_score(g, None, 20.0)
    assert (g.final_score, g.late_penalty) == (None, 0.0)


# ── Helpers ───────────────────────────────────────────────────────────


async def _set_hw(aid: uuid.UUID, **fields: Any) -> None:
    async with get_session_factory()() as s:
        a = (await s.execute(select(Assignment).where(Assignment.id == aid))).scalar_one()
        for k, v in fields.items():
            setattr(a, k, v)
        await s.commit()


async def _set_sub(sid: uuid.UUID, **fields: Any) -> None:
    async with get_session_factory()() as s:
        sub = (await s.execute(select(Submission).where(Submission.id == sid))).scalar_one()
        for k, v in fields.items():
            setattr(sub, k, v)
        await s.commit()


async def _grade(sid: uuid.UUID) -> SubmissionGrade:
    async with get_session_factory()() as s:
        return (await s.execute(
            select(SubmissionGrade).where(SubmissionGrade.submission_id == sid)
        )).scalar_one()


async def _late_hw(late_by: timedelta, *, policy: str = "penalty_per_day", n_problems: int = 2) -> dict[str, Any]:
    """A homework with one turn-in `late_by` after its due date."""
    world = await _seed_hw(n_problems=n_problems)
    await _set_hw(world["assignment_id"], due_at=DUE, late_policy=policy)
    await _set_sub(world["submission_ids"][0], submitted_at=DUE + late_by, is_late=late_by > timedelta(0))
    return world


def _breakdown(world: dict[str, Any], *percents: float) -> list[dict[str, Any]]:
    out = []
    for pid, p in zip(world["bank_item_ids"], percents, strict=True):
        status = "full" if p == 100 else "zero" if p == 0 else "partial"
        out.append({"problem_id": pid, "score_status": status, "percent": p})
    return out


async def _hand_grade(client: AsyncClient, world: dict[str, Any], *percents: float) -> dict[str, Any]:
    res = await client.patch(
        f"/v1/teacher/submissions/{world['submission_ids'][0]}/grade",
        json={"breakdown": _breakdown(world, *percents)},
        headers=_auth(world["teacher_token"]),
    )
    assert res.status_code == 200, res.text
    body: dict[str, Any] = res.json()
    return body


# ── penalty_per_day through every writer ─────────────────────────────


@pytest.mark.parametrize(("late_by", "expected"), [
    (timedelta(0), 80.0),           # exactly at due: on time
    (MIN, 72.0),                    # one started day: 80 × 0.9
    (DAY + MIN, 64.0),              # two: 80 × 0.8
    (10 * DAY + MIN, 0.0),          # capped
])
async def test_a_hand_grade_takes_the_penalty(
    client: AsyncClient, late_by: timedelta, expected: float,
) -> None:
    world = await _late_hw(late_by)
    body = await _hand_grade(client, world, 100, 60)
    assert body["final_score"] == pytest.approx(expected)
    g = await _grade(world["submission_ids"][0])
    assert g.final_score == pytest.approx(expected)
    assert g.final_score + g.late_penalty == 80.0


async def test_none_and_no_due_date_take_nothing(client: AsyncClient) -> None:
    world = await _late_hw(3 * DAY, policy="none")
    assert (await _hand_grade(client, world, 100, 60))["final_score"] == 80.0

    world = await _seed_hw(n_problems=2)
    await _set_hw(world["assignment_id"], due_at=None, late_policy="penalty_per_day")
    assert (await _hand_grade(client, world, 100, 60))["final_score"] == 80.0


async def test_the_ai_grade_takes_the_penalty() -> None:
    world = await _late_hw(DAY + MIN, n_problems=1)
    sid = world["submission_ids"][0]
    extraction = {
        "steps": [{"step_num": 1, "problem_position": 1, "latex": "x=2,3", "plain_english": ""}],
        "final_answers": [{"problem_position": 1, "answer_latex": "x=2,3", "answer_plain": ""}],
        "confidence": 0.9,
    }
    grader = AsyncMock(return_value={"grades": [{
        "problem_position": 1, "score_status": "full", "confidence": 0.9,
        "student_feedback": "Correct.", "reasoning": "matches", "deductions": [],
    }]})
    await _set_hw(world["assignment_id"], ai_grading_enabled=True)
    async with get_session_factory()() as s:
        with patch("api.core.grading_ai.grade_submission_with_ai", new=grader):
            await _real_run_ai_grading(sid, extraction, s)
        await s.commit()
    g = await _grade(sid)
    # The AI's own call stays unpenalized; the grade it pre-fills is not.
    assert (g.ai_score, g.final_score, g.late_penalty) == (100.0, 80.0, 20.0)


async def test_waive_and_restore(client: AsyncClient) -> None:
    world = await _late_hw(DAY + MIN)
    await _hand_grade(client, world, 100, 60)
    sid = world["submission_ids"][0]
    headers = _auth(world["teacher_token"])

    res = await client.post(f"/v1/teacher/submissions/{sid}/late-penalty", json={"waived": True}, headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert (body["final_score"], body["late_penalty"], body["late_penalty_waived"]) == (80.0, 0.0, True)
    assert (body["days_late"], body["late_penalty_percent"]) == (2, 20.0)

    # A later edit keeps the waiver.
    assert (await _hand_grade(client, world, 100, 100))["final_score"] == 100.0

    res = await client.post(f"/v1/teacher/submissions/{sid}/late-penalty", json={"waived": False}, headers=headers)
    assert res.json()["final_score"] == 80.0  # 100 × 0.8
    assert (await _grade(sid)).late_penalty == 20.0


async def test_only_the_homeworks_teacher_can_waive(client: AsyncClient) -> None:
    world = await _late_hw(DAY + MIN)
    other = await _seed_hw()
    res = await client.post(
        f"/v1/teacher/submissions/{world['submission_ids'][0]}/late-penalty",
        json={"waived": True}, headers=_auth(other["teacher_token"]),
    )
    assert res.status_code in (403, 404)


async def test_the_review_page_shows_the_penalty(client: AsyncClient) -> None:
    world = await _late_hw(DAY + MIN)
    await _hand_grade(client, world, 100, 60)
    headers = _auth(world["teacher_token"])
    sid = str(world["submission_ids"][0])

    detail = (await client.get(f"/v1/teacher/submissions/{sid}", headers=headers)).json()
    # 80% two days late: 20% of the score, which is 16 of it.
    assert (detail["days_late"], detail["late_penalty_percent"], detail["late_penalty"]) == (2, 20.0, 16.0)
    assert detail["final_score"] == 64.0

    rows = (await client.get(
        f"/v1/teacher/assignments/{world['assignment_id']}/submissions", headers=headers,
    )).json()["submissions"]
    row = next(r for r in rows if r["id"] == sid)
    assert (row["days_late"], row["late_penalty_percent"], row["late_penalty"], row["late_penalty_waived"]) == (
        2, 20.0, 16.0, False,
    )


async def test_the_penalty_survives_a_points_rescore(client: AsyncClient) -> None:
    world = await _late_hw(DAY + MIN)
    await _hand_grade(client, world, 100, 0)
    a, b = world["bank_item_ids"]
    res = await client.patch(
        f"/v1/teacher/assignments/{world['assignment_id']}",
        json={"problem_points": {a: 30, b: 10}}, headers=_auth(world["teacher_token"]),
    )
    assert res.status_code == 200
    g = await _grade(world["submission_ids"][0])
    assert (g.final_score, g.late_penalty) == (60.0, 15.0)  # 75 × 0.8


async def test_moving_the_due_date_or_policy_rederives_lateness(client: AsyncClient) -> None:
    world = await _late_hw(DAY + MIN)
    await _hand_grade(client, world, 100, 60)
    sid = world["submission_ids"][0]
    url = f"/v1/teacher/assignments/{world['assignment_id']}"
    headers = _auth(world["teacher_token"])
    # Config is locked while published.
    await _set_hw(world["assignment_id"], status="draft")

    res = await client.patch(url, json={"due_at": (DUE + 2 * DAY).isoformat()}, headers=headers)
    assert res.status_code == 200
    g = await _grade(sid)
    assert (g.final_score, g.late_penalty) == (80.0, 0.0)
    async with get_session_factory()() as s:
        sub = (await s.execute(select(Submission).where(Submission.id == sid))).scalar_one()
        assert sub.is_late is False

    await client.patch(url, json={"due_at": DUE.isoformat()}, headers=headers)
    assert (await _grade(sid)).final_score == 64.0
    await client.patch(url, json={"late_policy": "none"}, headers=headers)
    assert (await _grade(sid)).final_score == 80.0
    await client.patch(url, json={"clear_due_at": True, "late_policy": "penalty_per_day"}, headers=headers)
    assert (await _grade(sid)).final_score == 80.0


async def test_an_unknown_policy_is_refused(client: AsyncClient) -> None:
    world = await _seed_hw()
    await _set_hw(world["assignment_id"], status="draft")
    res = await client.patch(
        f"/v1/teacher/assignments/{world['assignment_id']}",
        json={"late_policy": "half_credit"}, headers=_auth(world["teacher_token"]),
    )
    assert res.status_code == 422


async def test_publish_carries_the_penalty_to_the_student_and_gradebook(client: AsyncClient) -> None:
    world = await _late_hw(DAY + MIN)
    await _hand_grade(client, world, 100, 60)
    sid = world["submission_ids"][0]
    headers = _auth(world["teacher_token"])
    res = await client.post(f"/v1/teacher/assignments/{world['assignment_id']}/publish-grades", headers=headers)
    assert res.status_code == 200
    g = await _grade(sid)
    assert (g.published_final_score, g.published_late_penalty) == (64.0, 16.0)

    # The gradebook cell carries the penalty, so "you gave" reads the
    # score she gave, not the policy's cut.
    async with get_session_factory()() as s:
        sub = await s.get(Submission, sid)
        hw = await s.get(Assignment, world["assignment_id"])
        assert sub is not None and hw is not None
        course_id, section_id = hw.course_id, sub.section_id
        # The review seed has no roster; give the gradebook one.
        s.add_all([
            CourseTeacher(course_id=course_id, teacher_id=hw.teacher_id, role="owner"),
            AssignmentSection(assignment_id=hw.id, section_id=section_id, published_at=datetime.now(UTC)),
            SectionEnrollment(section_id=section_id, course_id=course_id, student_id=sub.student_id),
        ])
        await s.commit()
    book = (await client.get(
        f"/v1/teacher/courses/{course_id}/sections/{section_id}/gradebook", headers=headers,
    )).json()
    cell = next(c for st in book["students"] for c in st["cells"].values() if c.get("submission_id") == str(sid))
    assert (cell["score"], cell["late_penalty"]) == (64.0, 16.0)

    # Waiving after publish is a draft edit until republished.
    await client.post(f"/v1/teacher/submissions/{sid}/late-penalty", json={"waived": True}, headers=headers)
    g = await _grade(sid)
    assert (g.final_score, g.published_final_score, g.published_late_penalty) == (80.0, 64.0, 16.0)
    await client.post(f"/v1/teacher/assignments/{world['assignment_id']}/publish-grades", headers=headers)
    g = await _grade(sid)
    assert (g.published_final_score, g.published_late_penalty) == (80.0, 0.0)


async def test_the_student_sees_the_published_penalty(client: AsyncClient, world: dict[str, Any]) -> None:
    aid = world["assignment_id"]
    await _set_hw(aid, due_at=DUE, late_policy="penalty_per_day")
    res = await client.post(
        f"/v1/school/student/homework/{aid}/submit",
        json={"files": [PAGE_PNG]}, headers=_auth(world["student_token"]),
    )
    assert res.status_code == 200, res.text
    assert res.json()["is_late"] is True
    sid = uuid.UUID(res.json()["submission_id"])
    async with get_session_factory()() as s:
        s.add(SubmissionGrade(
            submission_id=sid, final_score=68.0, late_penalty=17.0,
            published_final_score=68.0, published_late_penalty=17.0,
            breakdown=[], published_breakdown=[], grade_published_at=datetime.now(UTC),
        ))
        await s.commit()
    detail = (await client.get(f"/v1/school/student/homework/{aid}", headers=_auth(world["student_token"]))).json()
    assert (detail["final_score"], detail["late_penalty"], detail["late_policy"]) == (68.0, 17.0, "penalty_per_day")



# ── no_credit closes the homework to new turn-ins ────────────────────


async def _submit(client: AsyncClient, world: dict[str, Any]) -> Any:
    return await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        json={"files": [PAGE_PNG]}, headers=_auth(world["student_token"]),
    )


async def test_no_credit_refuses_a_turn_in_after_the_due_date(client: AsyncClient, world: dict[str, Any]) -> None:
    await _set_hw(world["assignment_id"], due_at=datetime.now(UTC) - MIN, late_policy="no_credit")
    res = await _submit(client, world)
    assert res.status_code == 403
    assert res.json()["detail"] == HOMEWORK_CLOSED_DETAIL


async def test_work_already_in_reads_as_submitted_not_closed(client: AsyncClient, world: dict[str, Any]) -> None:
    assert (await _submit(client, world)).status_code == 200
    await _set_hw(world["assignment_id"], due_at=datetime.now(UTC) - MIN, late_policy="no_credit")
    assert (await _submit(client, world)).status_code == 409


async def test_no_credit_accepts_before_the_due_date(client: AsyncClient, world: dict[str, Any]) -> None:
    await _set_hw(world["assignment_id"], due_at=datetime.now(UTC) + 5 * MIN, late_policy="no_credit")
    res = await _submit(client, world)
    assert res.status_code == 200
    assert res.json()["is_late"] is False


async def test_no_credit_without_a_due_date_never_closes(client: AsyncClient, world: dict[str, Any]) -> None:
    await _set_hw(world["assignment_id"], due_at=None, late_policy="no_credit")
    assert (await _submit(client, world)).status_code == 200


async def test_penalty_per_day_still_accepts_late_work(client: AsyncClient, world: dict[str, Any]) -> None:
    await _set_hw(world["assignment_id"], due_at=datetime.now(UTC) - 3 * DAY, late_policy="penalty_per_day")
    res = await _submit(client, world)
    assert res.status_code == 200
    assert res.json()["is_late"] is True


async def test_closed_shows_on_every_student_surface(client: AsyncClient, world: dict[str, Any]) -> None:
    aid = str(world["assignment_id"])
    await _set_hw(world["assignment_id"], due_at=datetime.now(UTC) - DAY, late_policy="no_credit")
    headers = _auth(world["student_token"])

    detail = (await client.get(f"/v1/school/student/homework/{aid}", headers=headers)).json()
    assert detail["closed"] is True

    course_id = detail["course_id"]
    listed = (await client.get(f"/v1/school/student/courses/{course_id}/homework", headers=headers)).json()
    assert next(h for h in listed if h["assignment_id"] == aid)["closed"] is True

    dash = (await client.get("/v1/school/student/dashboard", headers=headers)).json()
    assert [a["assignment_id"] for a in dash["closed"]] == [aid]
    assert dash["overdue"] == []

    # Under any other policy the same homework is overdue, not closed.
    await _set_hw(world["assignment_id"], late_policy="penalty_per_day")
    dash = (await client.get("/v1/school/student/dashboard", headers=headers)).json()
    assert dash["closed"] == []
    assert [a["assignment_id"] for a in dash["overdue"]] == [aid]
    detail = (await client.get(f"/v1/school/student/homework/{aid}", headers=headers)).json()
    assert detail["closed"] is False


async def test_switching_to_closed_keeps_late_work_already_graded(client: AsyncClient) -> None:
    """Closed only refuses new turn-ins. Work already in keeps its grade,
    marked late — when the teacher switches the policy to closed, and
    when she then moves the due date earlier still."""
    world = await _late_hw(DAY + MIN, policy="none")
    await _hand_grade(client, world, 100, 60)
    sid = world["submission_ids"][0]
    url = f"/v1/teacher/assignments/{world['assignment_id']}"
    headers = _auth(world["teacher_token"])
    await _set_hw(world["assignment_id"], status="draft")

    assert (await client.patch(url, json={"late_policy": "no_credit"}, headers=headers)).status_code == 200
    g = await _grade(sid)
    assert (g.final_score, g.late_penalty) == (80.0, 0.0)

    res = await client.patch(url, json={"due_at": (DUE - 5 * DAY).isoformat()}, headers=headers)
    assert res.status_code == 200
    g = await _grade(sid)
    assert (g.final_score, g.late_penalty) == (80.0, 0.0)
    async with get_session_factory()() as s:
        sub = (await s.execute(select(Submission).where(Submission.id == sid))).scalar_one()
        assert sub.is_late is True

    detail = (await client.get(f"/v1/teacher/submissions/{sid}", headers=headers)).json()
    assert (detail["is_late"], detail["late_penalty_percent"], detail["final_score"]) == (True, 0.0, 80.0)


async def test_late_work_graded_under_closed_keeps_its_score(client: AsyncClient) -> None:
    """A grade written after the switch (hand or AI path, same writer)
    isn't zeroed either."""
    world = await _late_hw(3 * DAY, policy="no_credit")
    assert (await _hand_grade(client, world, 100, 60))["final_score"] == 80.0


async def _make_preview(world: dict[str, Any]) -> None:
    from api.models.user import User
    async with get_session_factory()() as s:
        u = (await s.execute(select(User).where(User.id == world["student_id"]))).scalar_one()
        u.is_preview = True
        await s.commit()


async def test_a_teachers_preview_is_never_closed(client: AsyncClient, world: dict[str, Any]) -> None:
    """Preview as student always works: she sees the upload panel and can
    rehearse a turn-in on a closed homework."""
    aid = str(world["assignment_id"])
    await _set_hw(world["assignment_id"], due_at=datetime.now(UTC) - DAY, late_policy="no_credit")
    await _make_preview(world)
    headers = _auth(world["student_token"])

    detail = (await client.get(f"/v1/school/student/homework/{aid}", headers=headers)).json()
    assert detail["closed"] is False
    listed = (await client.get(
        f"/v1/school/student/courses/{detail['course_id']}/homework", headers=headers,
    )).json()
    assert next(h for h in listed if h["assignment_id"] == aid)["closed"] is False
    dash = (await client.get("/v1/school/student/dashboard", headers=headers)).json()
    assert dash["closed"] == []

    res = await _submit(client, world)
    assert res.status_code == 200, res.text


async def test_closed_homework_lists_after_open_work(client: AsyncClient, world: dict[str, Any]) -> None:
    """Missed, not to do: a closed, never-turned-in homework sorts after
    the open ones in the class list, even with an earlier due date."""
    aid = world["assignment_id"]
    await _set_hw(aid, due_at=datetime.now(UTC) - DAY, late_policy="no_credit")
    async with get_session_factory()() as s:
        hw = await s.get(Assignment, aid)
        assert hw is not None
        later = Assignment(
            course_id=hw.course_id, unit_ids=hw.unit_ids, teacher_id=hw.teacher_id,
            title="HW 2", type="homework", status="published", content=hw.content,
            due_at=datetime.now(UTC) + 3 * DAY, late_policy="none",
        )
        s.add(later)
        await s.flush()
        sections = (await s.execute(
            select(AssignmentSection).where(AssignmentSection.assignment_id == aid)
        )).scalars().all()
        for sec in sections:
            s.add(AssignmentSection(assignment_id=later.id, section_id=sec.section_id, published_at=sec.published_at))
        await s.commit()
        later_id = str(later.id)
    headers = _auth(world["student_token"])
    detail = (await client.get(f"/v1/school/student/homework/{aid}", headers=headers)).json()
    listed = (await client.get(
        f"/v1/school/student/courses/{detail['course_id']}/homework", headers=headers,
    )).json()
    ids = [h["assignment_id"] for h in listed]
    assert ids.index(later_id) < ids.index(str(aid))
    assert [h["closed"] for h in listed if h["assignment_id"] in (later_id, str(aid))] == [False, True]
