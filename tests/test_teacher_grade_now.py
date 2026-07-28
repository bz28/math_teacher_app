"""Teacher-triggered grading: "Grade all" and "Grade now".

These two buttons are the ONLY way a no-due-date assignment ever gets
graded — that path is manual by design, because there is no moment that
means "the class is in". If they break, that work is unreachable and the
failure is silent: the submissions just sit there looking submitted.

They also have to be safe against the money-losing mistakes: re-running a
submission that is already graded, or one a drain is already working.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from api.core.grading_queue import enqueue_submission
from api.database import get_session_factory
from api.models.assignment import Assignment, Submission
from api.models.grading_job import (
    STATUS_DONE,
    STATUS_QUEUED,
    STATUS_RUNNING,
    GradingJob,
)
from tests.conftest import auth_headers as _auth
from tests.test_teacher_review_checkpoint import _seed_hw

pytestmark = pytest.mark.asyncio

_EXTRACTION: dict[str, Any] = {
    "steps": [
        {"step_num": 1, "problem_position": 1,
         "latex": "x^2 - 5x + 6 = 0", "plain_english": ""},
    ],
    "final_answers": [
        {"problem_position": 1, "answer_latex": "x=2,3", "answer_plain": ""},
    ],
    "confidence": 0.9,
}


async def _prepare(world: dict[str, Any], *, due_at: datetime | None) -> None:
    async with get_session_factory()() as s:
        assignment = (await s.execute(
            select(Assignment).where(Assignment.id == world["assignment_id"])
        )).scalar_one()
        assignment.ai_grading_enabled = True
        assignment.due_at = due_at
        for sid in world["submission_ids"]:
            sub = (await s.execute(
                select(Submission).where(Submission.id == sid)
            )).scalar_one()
            sub.extraction = _EXTRACTION
        await s.commit()
        for sid in world["submission_ids"]:
            assignment = (await s.execute(
                select(Assignment).where(Assignment.id == world["assignment_id"])
            )).scalar_one()
            await enqueue_submission(s, sid, assignment)
        await s.commit()


async def _job(submission_id: uuid.UUID) -> GradingJob | None:
    async with get_session_factory()() as s:
        return (await s.execute(
            select(GradingJob).where(GradingJob.submission_id == submission_id)
        )).scalar_one_or_none()


async def test_grade_all_schedules_every_pending_submission(
    client: AsyncClient,
) -> None:
    world = await _seed_hw(n_submissions=3)
    await _prepare(world, due_at=None)  # no due date → all unscheduled
    for sid in world["submission_ids"]:
        assert (await _job(sid)).scheduled_for is None  # type: ignore[union-attr]

    with patch("api.core.grading_queue.drain", new=AsyncMock(return_value={})):
        r = await client.post(
            f"/v1/teacher/assignments/{world['assignment_id']}/grade-pending",
            headers=_auth(world["teacher_token"]),
        )

    assert r.status_code == 200, r.text
    assert r.json()["queued"] == 3
    for sid in world["submission_ids"]:
        job = await _job(sid)
        assert job is not None
        # Now scheduled — the manual path is what makes no-due-date work
        # reachable at all.
        assert job.scheduled_for is not None
        assert job.scheduled_for <= datetime.now(UTC)


async def test_grade_now_schedules_only_that_student(
    client: AsyncClient,
) -> None:
    world = await _seed_hw(n_submissions=3)
    await _prepare(world, due_at=None)
    target = world["submission_ids"][0]

    with patch("api.core.grading_queue.drain", new=AsyncMock(return_value={})):
        r = await client.post(
            f"/v1/teacher/submissions/{target}/grade-now",
            headers=_auth(world["teacher_token"]),
        )

    assert r.status_code == 200, r.text
    assert r.json()["queued"] == 1
    assert (await _job(target)).scheduled_for is not None  # type: ignore[union-attr]
    for sid in world["submission_ids"][1:]:
        assert (await _job(sid)).scheduled_for is None  # type: ignore[union-attr]


async def test_grade_now_leaves_an_already_running_job_alone(
    client: AsyncClient,
) -> None:
    """A drain already has this one. Re-queueing it would grade — and
    bill for — the same submission twice."""
    world = await _seed_hw()
    await _prepare(world, due_at=None)
    sid = world["submission_ids"][0]

    async with get_session_factory()() as s:
        job = (await s.execute(
            select(GradingJob).where(GradingJob.submission_id == sid)
        )).scalar_one()
        job.status = STATUS_RUNNING
        job.started_at = datetime.now(UTC)
        await s.commit()

    with patch("api.core.grading_queue.drain", new=AsyncMock(return_value={})):
        r = await client.post(
            f"/v1/teacher/submissions/{sid}/grade-now",
            headers=_auth(world["teacher_token"]),
        )

    assert r.status_code == 200, r.text
    # Nothing moved, and that is success — not an error the teacher
    # should be shown.
    assert r.json()["queued"] == 0
    assert (await _job(sid)).status == STATUS_RUNNING  # type: ignore[union-attr]


async def test_grade_all_does_not_requeue_finished_work(
    client: AsyncClient,
) -> None:
    world = await _seed_hw(n_submissions=2)
    await _prepare(world, due_at=None)
    done_sub = world["submission_ids"][0]

    async with get_session_factory()() as s:
        job = (await s.execute(
            select(GradingJob).where(GradingJob.submission_id == done_sub)
        )).scalar_one()
        job.status = STATUS_DONE
        job.finished_at = datetime.now(UTC)
        await s.commit()

    with patch("api.core.grading_queue.drain", new=AsyncMock(return_value={})):
        r = await client.post(
            f"/v1/teacher/assignments/{world['assignment_id']}/grade-pending",
            headers=_auth(world["teacher_token"]),
        )

    assert r.status_code == 200, r.text
    # Only the still-queued one moved. A finished grade needs a regrade,
    # not a re-queue.
    assert r.json()["queued"] == 1
    assert (await _job(done_sub)).status == STATUS_DONE  # type: ignore[union-attr]


async def test_grade_all_rejects_a_hw_with_ai_grading_off(
    client: AsyncClient,
) -> None:
    world = await _seed_hw()
    await _prepare(world, due_at=None)
    async with get_session_factory()() as s:
        assignment = (await s.execute(
            select(Assignment).where(Assignment.id == world["assignment_id"])
        )).scalar_one()
        assignment.ai_grading_enabled = False
        await s.commit()

    r = await client.post(
        f"/v1/teacher/assignments/{world['assignment_id']}/grade-pending",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 400


async def test_another_teacher_cannot_grade_your_class(
    client: AsyncClient,
) -> None:
    """The endpoints spend money on someone else's students, so
    ownership has to be enforced, not assumed."""
    mine = await _seed_hw()
    theirs = await _seed_hw()
    await _prepare(mine, due_at=None)
    await _prepare(theirs, due_at=None)

    r = await client.post(
        f"/v1/teacher/assignments/{theirs['assignment_id']}/grade-pending",
        headers=_auth(mine["teacher_token"]),
    )
    assert r.status_code == 403

    r = await client.post(
        f"/v1/teacher/submissions/{theirs['submission_ids'][0]}/grade-now",
        headers=_auth(mine["teacher_token"]),
    )
    assert r.status_code == 403
    # And nothing of theirs moved.
    assert (await _job(theirs["submission_ids"][0])).scheduled_for is None  # type: ignore[union-attr]


async def test_future_due_date_can_be_pulled_forward(
    client: AsyncClient,
) -> None:
    """The head-start case: it IS due Friday, but the teacher wants to
    start reviewing on Thursday."""
    world = await _seed_hw(n_submissions=2)
    await _prepare(world, due_at=datetime.now(UTC) + timedelta(days=2))
    for sid in world["submission_ids"]:
        assert (await _job(sid)).scheduled_for > datetime.now(UTC)  # type: ignore[union-attr,operator]

    with patch("api.core.grading_queue.drain", new=AsyncMock(return_value={})):
        r = await client.post(
            f"/v1/teacher/assignments/{world['assignment_id']}/grade-pending",
            headers=_auth(world["teacher_token"]),
        )

    assert r.status_code == 200, r.text
    for sid in world["submission_ids"]:
        job = await _job(sid)
        assert job is not None
        assert job.status == STATUS_QUEUED
        assert job.scheduled_for <= datetime.now(UTC)  # type: ignore[operator]
