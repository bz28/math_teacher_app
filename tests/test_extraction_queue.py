"""The extraction queue survives what the fire-and-forget spawn did not.

Every test here is a re-run of a way the old design lost a student's
homework. Before this queue, extraction was `asyncio.create_task` with
one caller: a task that died took the work with it, left a durable
submission that could never be confirmed or graded, and wrote no record
that a read was ever owed. On 2026-09-03 that cost one student their
homework and several hours to recover by hand.

So the assertions are about failure, not the happy path: a crash leaves a
retryable row, a repeated crash parks with the reason attached, a worker
that vanishes mid-call gets reclaimed, and two drains never bill the same
Vision call twice.
"""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select, text

from api.core.extraction_queue import drain, enqueue_submission
from api.database import get_session_factory
from api.models.assignment import Assignment
from api.models.extraction_job import (
    MAX_ATTEMPTS,
    STATUS_FAILED,
    STATUS_QUEUED,
    STATUS_RUNNING,
    ExtractionJob,
)

_TARGET = "api.routes.school_student_practice.run_extraction_for_submission"


async def _assignment(world: dict[str, Any]) -> Assignment:
    async with get_session_factory()() as s:
        return (await s.execute(
            select(Assignment).where(Assignment.id == world["assignment_id"])
        )).scalar_one()


async def _seed_submission(world: dict[str, Any]) -> uuid.UUID:
    """A submission with no extraction — the state a queued job describes."""
    sid = uuid.uuid4()
    async with get_session_factory()() as s:
        await s.execute(
            text(
                "INSERT INTO submissions "
                "(id, assignment_id, student_id, section_id, status, files, is_late) "
                "VALUES (:i, :a, :st, :sec, 'submitted', '[]'::json, false)"
            ),
            {
                "i": sid,
                "a": world["assignment_id"],
                "st": world["student_id"],
                "sec": (await s.execute(
                    text("SELECT section_id FROM assignment_sections "
                         "WHERE assignment_id = :a LIMIT 1"),
                    {"a": world["assignment_id"]},
                )).scalar_one(),
            },
        )
        await s.commit()
    return sid


async def _enqueue(world: dict[str, Any], sid: uuid.UUID) -> None:
    assignment = await _assignment(world)
    async with get_session_factory()() as s:
        await enqueue_submission(s, sid, assignment)
        await s.commit()


async def _job(sid: uuid.UUID) -> ExtractionJob:
    async with get_session_factory()() as s:
        return (await s.execute(
            select(ExtractionJob).where(ExtractionJob.submission_id == sid)
        )).scalar_one()


async def _mark_extracted(sid: uuid.UUID) -> None:
    async with get_session_factory()() as s:
        await s.execute(
            text("UPDATE submissions SET extraction = :e WHERE id = :i"),
            {"e": '{"steps": [], "final_answers": []}', "i": sid},
        )
        await s.commit()


@pytest.mark.asyncio
async def test_a_crash_leaves_a_retryable_row_with_the_reason(
    world: dict[str, Any],
) -> None:
    """The 2026-09-03 shape. The old spawn swallowed this and left
    nothing; the queue must keep both the work and the reason."""
    sid = await _seed_submission(world)
    await _enqueue(world, sid)

    boom = TypeError(
        "AsyncMessages.create() got an unexpected keyword argument 'temperature'"
    )
    with patch(_TARGET, new_callable=AsyncMock, side_effect=boom):
        result = await drain()

    assert result["claimed"] == 1
    assert result["failed"] == 1

    job = await _job(sid)
    # Retryable, not parked: one failure is not a verdict.
    assert job.status == STATUS_QUEUED
    assert job.attempts == 1
    # The reason is ON THE ROW. This is the whole point — during the
    # outage the only copy lived in the platform log stream.
    assert "TypeError" in (job.last_error or "")
    assert "temperature" in (job.last_error or "")


@pytest.mark.asyncio
async def test_repeated_failure_parks_instead_of_burning_vision_calls(
    world: dict[str, Any],
) -> None:
    """A photo that will never read must stop costing a call per drain,
    and must stop somewhere a human can see."""
    sid = await _seed_submission(world)
    await _enqueue(world, sid)

    with patch(_TARGET, new_callable=AsyncMock, side_effect=RuntimeError("nope")):
        for _ in range(MAX_ATTEMPTS):
            await drain()
        job = await _job(sid)
        assert job.status == STATUS_FAILED
        assert job.attempts == MAX_ATTEMPTS
        assert "nope" in (job.last_error or "")

        # Parked means parked: a further drain must not pick it back up.
        again = await drain()
        assert again["claimed"] == 0


@pytest.mark.asyncio
async def test_a_re_enqueue_revives_a_parked_job_with_a_fresh_budget(
    world: dict[str, Any],
) -> None:
    """The recovery path. Once the cause is fixed — an SDK pinned, a
    limit raised — the operator re-enqueues rather than hand-running a
    script against production."""
    sid = await _seed_submission(world)
    await _enqueue(world, sid)
    with patch(_TARGET, new_callable=AsyncMock, side_effect=RuntimeError("x")):
        for _ in range(MAX_ATTEMPTS):
            await drain()
    assert (await _job(sid)).status == STATUS_FAILED

    await _enqueue(world, sid)
    revived = await _job(sid)
    assert revived.status == STATUS_QUEUED
    assert revived.attempts == 0
    assert revived.last_error is None

    async def _succeed(_sid: uuid.UUID) -> None:
        await _mark_extracted(_sid)

    with patch(_TARGET, new_callable=AsyncMock, side_effect=_succeed):
        result = await drain()
    assert result["succeeded"] == 1
    assert (await _job(sid)).status == "done"


@pytest.mark.asyncio
async def test_silent_failure_is_not_recorded_as_success(
    world: dict[str, Any],
) -> None:
    """`run_extraction_for_submission` can return without writing — the
    queue must verify by re-reading rather than trusting that it didn't
    raise. Otherwise a silent failure marks the job done and the student
    stays stuck while the queue insists the work finished, which is the
    exact invisibility this table exists to end."""
    sid = await _seed_submission(world)
    await _enqueue(world, sid)

    # Returns cleanly, writes nothing.
    with patch(_TARGET, new_callable=AsyncMock, return_value=None):
        result = await drain()

    assert result["succeeded"] == 0
    assert result["failed"] == 1
    job = await _job(sid)
    assert job.status == STATUS_QUEUED
    assert "without writing a result" in (job.last_error or "")


@pytest.mark.asyncio
async def test_enqueue_is_idempotent_so_a_vision_call_is_never_doubled(
    world: dict[str, Any],
) -> None:
    """A Vision call is the most expensive thing this system does per
    submission; a double-enqueue must collapse, not duplicate."""
    sid = await _seed_submission(world)
    for _ in range(3):
        await _enqueue(world, sid)

    async with get_session_factory()() as s:
        n = (await s.execute(
            select(ExtractionJob).where(ExtractionJob.submission_id == sid)
        )).scalars().all()
    assert len(n) == 1


@pytest.mark.asyncio
async def test_an_abandoned_worker_is_reclaimed_without_losing_budget(
    world: dict[str, Any],
) -> None:
    """A deploy landing mid-call leaves a `running` row that nothing
    claims and nothing revives. It must return to the queue — and must
    NOT be charged an attempt, or repeated deploys would park healthy
    work as failed."""
    sid = await _seed_submission(world)
    await _enqueue(world, sid)

    async with get_session_factory()() as s:
        await s.execute(
            text(
                "UPDATE extraction_jobs SET status = :r, attempts = 1, "
                "started_at = now() - interval '1 hour' WHERE submission_id = :i"
            ),
            {"r": STATUS_RUNNING, "i": sid},
        )
        await s.commit()

    async def _succeed(_sid: uuid.UUID) -> None:
        await _mark_extracted(_sid)

    with patch(_TARGET, new_callable=AsyncMock, side_effect=_succeed):
        result = await drain()

    assert result["reclaimed"] == 1
    assert result["succeeded"] == 1
    # 1 from the stall + 1 from the real run. Reclaim itself charged none.
    assert (await _job(sid)).attempts == 2
