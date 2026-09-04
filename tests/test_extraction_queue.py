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

from api.core import extraction_queue
from api.core.extraction_queue import drain, enqueue_submission
from api.database import get_session_factory
from api.models.assignment import Assignment
from api.models.extraction_job import (
    MAX_ATTEMPTS,
    STATUS_DONE,
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


async def _seed_submission(
    world: dict[str, Any], student: str = "student_id",
) -> uuid.UUID:
    """A submission with no extraction — the state a queued job describes.

    `student` picks which of the world's students it belongs to.
    Submissions are unique on (assignment, student), so a test needing two
    at once needs two students.
    """
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
                "st": world[student],
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
    """`enqueue_submission` opens and commits its own session."""
    await enqueue_submission(sid, await _assignment(world))


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


@pytest.mark.asyncio
async def test_the_student_who_just_submitted_jumps_the_backlog(
    world: dict[str, Any],
) -> None:
    """Submit kicks a drain for the student now watching a spinner.

    Jobs run one at a time and each is a 5-15s Vision call, so under
    plain oldest-first that student lands behind the entire queue. The
    migration's backfill stamps every pre-existing submission at the same
    `now()`, so on the deploy this ships in, the first student to submit
    is behind all of them — twenty jobs deep is past the client's 90s
    timeout and they get the "Couldn't prepare your check" screen the
    queue exists to eliminate.
    """
    older = await _seed_submission(world)
    await _enqueue(world, older)
    newer = await _seed_submission(world, student="outsider_id")
    await _enqueue(world, newer)

    ran: list[uuid.UUID] = []

    async def _record(sid: uuid.UUID) -> None:
        ran.append(sid)
        await _mark_extracted(sid)

    # limit=1 so the claim ORDER is what decides, not the pass size.
    with patch(_TARGET, new_callable=AsyncMock, side_effect=_record):
        await drain(limit=1, first=newer)

    assert ran == [newer], "the waiting student was queued behind the backlog"

    # Everyone else still drains oldest-first.
    ran.clear()
    with patch(_TARGET, new_callable=AsyncMock, side_effect=_record):
        await drain(limit=1)
    assert ran == [older]


@pytest.mark.asyncio
async def test_one_bad_job_does_not_abandon_the_rest_of_the_pass(
    world: dict[str, Any],
) -> None:
    """A crash outside the guarded extraction call used to escape
    `_extract_one` and take `drain()` down with it — leaving every job
    the pass had already claimed stranded in `running`, invisible until
    `_reclaim_stale` ran ten minutes later.

    Fails the bookkeeping rather than the extraction, because the
    extraction call was the only part that was ever guarded.
    """
    first_sid = await _seed_submission(world)
    await _enqueue(world, first_sid)
    second_sid = await _seed_submission(world, student="outsider_id")
    await _enqueue(world, second_sid)

    ran: list[uuid.UUID] = []
    real_finish = extraction_queue._finish
    tripped = False

    async def _finish_once_broken(job_id: uuid.UUID, **kw: Any) -> None:
        nonlocal tripped
        if not tripped:
            tripped = True
            raise RuntimeError("connection reset while stamping the job")
        await real_finish(job_id, **kw)

    async def _record(sid: uuid.UUID) -> None:
        ran.append(sid)
        await _mark_extracted(sid)

    with (
        patch(_TARGET, new_callable=AsyncMock, side_effect=_record),
        patch.object(extraction_queue, "_finish", _finish_once_broken),
    ):
        result = await drain(first=first_sid)

    # Both jobs ran: the pass survived the failure.
    assert set(ran) == {first_sid, second_sid}
    assert result["claimed"] == 2

    # And the job whose bookkeeping blew up is retryable, not stranded
    # in `running` waiting on the ten-minute sweeper.
    assert (await _job(first_sid)).status == STATUS_QUEUED


@pytest.mark.asyncio
async def test_a_job_whose_toggles_were_switched_off_is_not_billed(
    world: dict[str, Any],
) -> None:
    """Enqueue gates on the toggles, but a backfilled or re-enqueued row
    can be days old by the time it drains. A Vision call is the most
    expensive thing this system does per submission; spending one on a
    feature a teacher deliberately turned off is not defensible."""
    sid = await _seed_submission(world)
    await _enqueue(world, sid)

    async with get_session_factory()() as s:
        await s.execute(
            text(
                "UPDATE assignments SET integrity_check_enabled = false, "
                "ai_grading_enabled = false WHERE id = :a"
            ),
            {"a": world["assignment_id"]},
        )
        await s.commit()

    with patch(_TARGET, new_callable=AsyncMock) as vision:
        result = await drain()

    vision.assert_not_awaited()
    # Reported apart from `failed`, the counter operators alert on.
    assert result["skipped"] == 1
    assert result["failed"] == 0
    assert (await _job(sid)).status == STATUS_DONE


@pytest.mark.asyncio
async def test_a_requeued_job_does_not_read_as_finished(
    world: dict[str, Any],
) -> None:
    """A job going back to the queue is not a finished job. `_finish`
    used to stamp `finished_at` unconditionally and leave `started_at`
    pointing at the claim that had just failed, so a waiting job looked
    completed to anything rendering those stamps."""
    sid = await _seed_submission(world)
    await _enqueue(world, sid)

    with patch(_TARGET, new_callable=AsyncMock, side_effect=RuntimeError("no")):
        await drain()

    job = await _job(sid)
    assert job.status == STATUS_QUEUED
    assert job.finished_at is None
    assert job.started_at is None


@pytest.mark.asyncio
async def test_a_failed_enqueue_does_not_silently_lose_the_job(
    world: dict[str, Any],
) -> None:
    """`enqueue_submission` runs on its own session for a reason.

    It used to take the caller's and swallow every exception, so a failed
    INSERT left that transaction ABORTED — the caller's next COMMIT
    silently degraded to a rollback, and a durable submission ended up
    with no job row and nothing but a log line. That is the exact
    stranding this table exists to end.

    Asserts the caller's session survives an enqueue that blows up, and
    that its own writes still commit.
    """
    sid = await _seed_submission(world)

    # A real server-side error, not a patched constructor. That matters:
    # the bug was Postgres ABORTING the transaction, which only happens
    # once a bad statement actually reaches it. An exception raised
    # before `execute` leaves the transaction clean and would prove
    # nothing. This assignment id does not exist, so the INSERT trips the
    # foreign key.
    doomed = Assignment(
        id=uuid.uuid4(),
        course_id=uuid.uuid4(),
        teacher_id=world["teacher_id"],
        title="gone",
        type="homework",
        status="published",
        content={"problems": []},
    )

    async with get_session_factory()() as caller:
        await caller.execute(
            text("UPDATE submissions SET is_late = true WHERE id = :i"),
            {"i": sid},
        )

        # Never raises — a queueing failure must not take down a submit
        # that already succeeded.
        await enqueue_submission(sid, doomed)

        # The caller's transaction was never touched, so this is a real
        # COMMIT and not a rollback wearing its name. On the old shape
        # the failed INSERT ran HERE, aborting this transaction, and this
        # line silently discarded the UPDATE above.
        await caller.commit()

    async with get_session_factory()() as s:
        assert (await s.execute(
            text("SELECT is_late FROM submissions WHERE id = :i"), {"i": sid},
        )).scalar_one() is True, "the caller's write was silently rolled back"

        # The failure was total, not partial: no half-written job row.
        assert (await s.execute(
            select(ExtractionJob).where(ExtractionJob.submission_id == sid)
        )).scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_the_extraction_call_raises_so_the_queue_can_see_it(
    world: dict[str, Any],
) -> None:
    """Everything above patches `run_extraction_for_submission`, so
    nothing here would notice if it went back to swallowing.

    It used to, because it was spawned fire-and-forget and had nobody to
    tell — which is why the 2026-09-03 TypeError left no trace anywhere
    but the platform log stream. The queue's entire retry-and-park path
    hangs off this function raising: swallow again and every failure is
    recorded as a successful pass over a submission that never got read.
    """
    from api.routes.school_student_practice import run_extraction_for_submission

    sid = await _seed_submission(world)
    boom = TypeError(
        "AsyncMessages.create() got an unexpected keyword argument 'temperature'"
    )

    with (
        patch(
            "api.core.integrity_ai.extract_student_work",
            new_callable=AsyncMock, side_effect=boom,
        ),
        pytest.raises(TypeError, match="temperature"),
    ):
        await run_extraction_for_submission(sid)
