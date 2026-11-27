"""The teacher half of the admin case file: who did what to one grade.

"Grade all" and "Grade with AI" now leave activity rows
(`grade.ai_batch`, naming each submission it queued, and
`grade.ai_single`), so the case file can say which button a teacher
pressed. A grade the schedule ran reads as automatic; one a teacher
asked for before those rows existed reads as teacher-requested.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select, update

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.activity_log import ActivityLog
from api.models.assignment import Assignment, Submission, SubmissionGrade
from api.models.grading_job import STATUS_DONE, GradingJob
from api.models.user import User
from tests.conftest import auth_headers
from tests.test_teacher_grade_now import _prepare
from tests.test_teacher_review_checkpoint import _seed_hw

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def admin_token() -> str:
    async with get_session_factory()() as s:
        admin = User(
            email=f"admin_{uuid.uuid4().hex[:6]}@t.com", password_hash=hash_password("x"),
            grade_level=99, role="admin", name="Admin",
        )
        s.add(admin)
        await s.commit()
        return create_access_token(str(admin.id), "admin")


async def _timeline(client: AsyncClient, token: str, sid: uuid.UUID) -> dict[str, Any]:
    r = await client.get(f"/v1/admin/submissions/{sid}/case", headers=auth_headers(token))
    assert r.status_code == 200, r.text
    body: dict[str, Any] = r.json()
    return body


async def _teacher_id(world: dict[str, Any]) -> uuid.UUID:
    async with get_session_factory()() as s:
        return (await s.execute(
            select(Assignment.teacher_id).where(Assignment.id == world["assignment_id"])
        )).scalar_one()


async def test_grade_all_and_grade_now_are_named_on_the_case(
    client: AsyncClient, admin_token: str,
) -> None:
    world = await _seed_hw(n_submissions=3)
    await _prepare(world, due_at=None)
    first, second, third = world["submission_ids"]

    with patch("api.core.grading_queue.drain", new=AsyncMock(return_value={})):
        r = await client.post(
            f"/v1/teacher/submissions/{first}/grade-now",
            headers=auth_headers(world["teacher_token"]),
        )
        assert r.json()["queued"] == 1
        r = await client.post(
            f"/v1/teacher/assignments/{world['assignment_id']}/grade-pending",
            headers=auth_headers(world["teacher_token"]),
        )
        # Grade all pulls every eligible job forward, the one Grade now
        # already queued included, and names each one it touched.
        assert r.json()["queued"] == 3

    async with get_session_factory()() as s:
        batch = (await s.execute(
            select(ActivityLog).where(ActivityLog.action == "grade.ai_batch")
            .where(ActivityLog.target_id == world["assignment_id"])
        )).scalar_one()
    assert batch.action_metadata is not None
    assert batch.action_metadata["queued"] == 3
    assert sorted(batch.action_metadata["submission_ids"]) == sorted(str(x) for x in (first, second, third))

    first_tl = (await _timeline(client, admin_token, first))["timeline"]
    assert [e["action"] for e in first_tl] == ["grade.ai_single", "grade.ai_batch"]
    assert first_tl[0]["actor_name"] == "T"
    second_case = await _timeline(client, admin_token, second)
    assert [e["action"] for e in second_case["timeline"]] == ["grade.ai_batch"]
    assert second_case["timeline"][0]["metadata"]["queued"] == 3
    assert second_case["grading_job"]["requested_by_name"] == "T"


async def test_a_press_that_queued_nothing_leaves_no_row(
    client: AsyncClient,
) -> None:
    world = await _seed_hw(n_submissions=1)
    await _prepare(world, due_at=None)
    async with get_session_factory()() as s:
        s.add(SubmissionGrade(
            submission_id=world["submission_ids"][0], ai_score=90.0, final_score=90.0,
            ai_breakdown={"grades": []},
        ))
        await s.commit()
    with patch("api.core.grading_queue.drain", new=AsyncMock(return_value={})):
        r = await client.post(
            f"/v1/teacher/assignments/{world['assignment_id']}/grade-pending",
            headers=auth_headers(world["teacher_token"]),
        )
    assert r.json()["queued"] == 0
    async with get_session_factory()() as s:
        assert (await s.execute(
            select(ActivityLog).where(ActivityLog.action == "grade.ai_batch")
            .where(ActivityLog.target_id == world["assignment_id"])
        )).scalar_one_or_none() is None


async def test_scheduled_and_legacy_runs_and_the_teacher_steps(
    client: AsyncClient, admin_token: str,
) -> None:
    world = await _seed_hw(n_submissions=2)
    await _prepare(world, due_at=None)
    auto, legacy = world["submission_ids"]
    teacher_id = await _teacher_id(world)
    now = datetime.now(UTC)
    published = now - timedelta(minutes=5)

    async with get_session_factory()() as s:
        # Turned in yesterday: every class-wide row below is after it.
        await s.execute(
            update(Submission).where(Submission.id.in_([auto, legacy]))
            .values(submitted_at=now - timedelta(days=1))
        )
        for sid, requester in ((auto, None), (legacy, teacher_id)):
            job = (await s.execute(
                select(GradingJob).where(GradingJob.submission_id == sid)
            )).scalar_one()
            job.status = STATUS_DONE
            job.requested_by_id = requester
            job.started_at = now - timedelta(hours=2)
            job.finished_at = now - timedelta(hours=2) + timedelta(seconds=20)
        s.add(SubmissionGrade(
            submission_id=auto, ai_score=80.0, final_score=70.0,
            ai_breakdown={"grades": []}, grade_published_at=published,
        ))

        def row(action: str, target_type: str, target: uuid.UUID, at: datetime,
                meta: dict[str, Any] | None = None) -> ActivityLog:
            return ActivityLog(
                actor_user_id=teacher_id, actor_role="teacher", action=action,
                target_type=target_type, target_id=target, action_metadata=meta,
                performed_at=at,
            )
        s.add_all([
            row("grade.save", "submission", auto, now - timedelta(hours=1), {"final_score": 70.0}),
            row("grade.mark_reviewed", "submission", auto, now - timedelta(minutes=30)),
            # This grade's publish, and an earlier one that wasn't it.
            row("grade.publish", "assignment", world["assignment_id"], published + timedelta(seconds=1),
                {"published_count": 1}),
            row("grade.publish", "assignment", world["assignment_id"], now - timedelta(minutes=50),
                {"published_count": 0}),
            # Another submission's Grade all press is not this one's.
            row("grade.ai_batch", "assignment", world["assignment_id"], now - timedelta(hours=3),
                {"queued": 1, "submission_ids": [str(legacy)]}),
        ])
        await s.commit()

    tl = (await _timeline(client, admin_token, auto))["timeline"]
    assert [e["action"] for e in tl] == [
        "grading.auto", "grade.save", "grade.mark_reviewed", "grade.publish",
    ]
    assert tl[0]["actor_name"] is None
    assert tl[1]["metadata"]["final_score"] == 70.0
    assert tl[3]["metadata"]["published_count"] == 1

    # The legacy grade's teacher pressed Grade all, and it's logged: the
    # press itself is shown, not a vague "teacher-requested".
    legacy_tl = (await _timeline(client, admin_token, legacy))["timeline"]
    assert [e["action"] for e in legacy_tl] == ["grade.ai_batch"]

    # Before presses were logged, only the job knows a teacher asked.
    async with get_session_factory()() as s:
        old = (await s.execute(
            select(ActivityLog).where(ActivityLog.action == "grade.ai_batch")
            .where(ActivityLog.target_id == world["assignment_id"])
        )).scalar_one()
        await s.delete(old)
        await s.commit()
    legacy_tl = (await _timeline(client, admin_token, legacy))["timeline"]
    assert [(e["action"], e["actor_name"]) for e in legacy_tl] == [("grading.requested", "T")]
