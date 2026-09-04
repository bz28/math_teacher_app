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

import asyncio
import uuid
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import StatementError

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
    STATUS_SKIPPED,
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
    # And apart from `done` on the row, which would claim a read exists.
    assert (await _job(sid)).status == STATUS_SKIPPED


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
async def test_a_failed_enqueue_does_not_poison_the_callers_transaction(
    world: dict[str, Any],
) -> None:
    """`enqueue_submission` runs on its own session for a reason.

    Note what this does and does not promise. The job row IS lost when
    the INSERT fails — loudly, via `logger.exception`, which is the
    deliberate trade: a queueing failure must never take down a submit
    that already succeeded. What it guarantees is that the loss is
    CONTAINED, and that is the whole point.

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


@pytest.mark.asyncio
async def test_a_database_failure_does_not_write_student_work_into_last_error(
    world: dict[str, Any],
) -> None:
    """`last_error` is durable and logged, and must never quote homework.

    The extraction is persisted as `submissions.extraction = <the
    student's transcribed work>`. If that flush fails — statement
    timeout, deadlock, connection reset — SQLAlchemy raises a
    `StatementError` whose `__str__` appends the statement AND its bound
    parameters, one of which IS the transcription. Formatting that
    exception naively puts a student's handwriting into a database
    column and the log stream, on a product sold to districts under the
    same ids-counts-and-codes rule `activity_log` follows.

    A cold review of this PR explicitly cleared this path as safe. It
    was right that the Vision-side errors carry no content and wrong
    about the database-side one, which is the likelier failure.
    """
    sid = await _seed_submission(world)
    await _enqueue(world, sid)

    secret = "STUDENT-HANDWRITING-x-equals-42"
    boom = StatementError(
        message="canceling statement due to statement timeout",
        statement="UPDATE submissions SET extraction=%(extraction)s WHERE id=%(id)s",
        params={"extraction": {"steps": [{"latex": secret}]}, "id": str(sid)},
        orig=Exception("canceling statement due to statement timeout"),
    )
    assert secret in str(boom), "the exception must really carry the work"

    with patch(_TARGET, new_callable=AsyncMock, side_effect=boom):
        await drain()

    stored = (await _job(sid)).last_error or ""
    assert secret not in stored, f"student work reached last_error: {stored}"
    assert "parameters" not in stored, f"bound parameters leaked: {stored}"
    assert "UPDATE submissions" not in stored, f"the statement leaked: {stored}"

    # Still useful to an operator: the wrapper class and the server's own
    # reason survive, which is what they act on.
    assert "StatementError" in stored
    assert "statement timeout" in stored


@pytest.mark.asyncio
async def test_a_non_database_failure_keeps_its_full_message(
    world: dict[str, Any],
) -> None:
    """The sanitiser must not blunt the error it was written to preserve.

    The 2026-09-03 outage was a `TypeError` from the SDK, and the whole
    point of the row is that its text survives. Only SQLAlchemy errors
    carry bound parameters, so only they are trimmed.
    """
    sid = await _seed_submission(world)
    await _enqueue(world, sid)

    boom = TypeError(
        "AsyncMessages.create() got an unexpected keyword argument 'temperature'"
    )
    with patch(_TARGET, new_callable=AsyncMock, side_effect=boom):
        await drain()

    stored = (await _job(sid)).last_error or ""
    assert "TypeError" in stored
    assert "temperature" in stored


@pytest.mark.asyncio
async def test_a_platform_cost_stop_does_not_burn_the_retry_budget(
    world: dict[str, Any],
) -> None:
    """The daily spend cap means "come back later", not "this one is
    broken".

    `check_limit` raises BEFORE the request goes out, so a capped
    platform fails jobs instantly and for free — and submit kicks a
    drain, so a burst of submissions after the cap is hit would burn all
    three attempts on every queued job within minutes rather than over
    the 15 minutes three cron passes would take.

    That matters because `failed` is terminal in practice: it is revived
    only by `enqueue_submission`, whose callers are the one-shot submit
    endpoint (409 on repeat) and a hand-run script. Parking the queue
    there is the 2026-09-03 stranding again, at class scale, inside the
    fix written to end it. Grading has carried this guard for the same
    reason; extraction shipped without it.
    """
    from api.core.cost_tracker import PlatformStopError

    sid = await _seed_submission(world)
    await _enqueue(world, sid)

    stop = PlatformStopError("Daily cost limit reached ($50.00 >= $50.00)")

    # Well past MAX_ATTEMPTS worth of passes.
    for _ in range(MAX_ATTEMPTS + 2):
        with patch(_TARGET, new_callable=AsyncMock, side_effect=stop):
            await drain()

    job = await _job(sid)
    # Still runnable, and no attempt was spent — the cap resets and the
    # student's read happens with a full budget.
    assert job.status == STATUS_QUEUED, "a spend cap parked the job"
    assert job.attempts == 0, f"the stop was charged: attempts={job.attempts}"
    assert "Daily cost limit" in (job.last_error or "")

    # And it really is still claimable once the platform recovers.
    async def _succeed(_sid: uuid.UUID) -> None:
        await _mark_extracted(_sid)

    with patch(_TARGET, new_callable=AsyncMock, side_effect=_succeed):
        result = await drain()
    assert result["succeeded"] == 1
    assert (await _job(sid)).status == STATUS_DONE


@pytest.mark.asyncio
async def test_a_landed_extraction_is_never_read_twice(
    world: dict[str, Any],
) -> None:
    """A requeue after the read landed must not re-run Vision.

    A job can return to `queued` with the extraction already committed:
    the `_finish` stamp can fail on a connection blip, and a worker can
    die between the extraction's commit and its own bookkeeping, leaving
    `_reclaim_stale` to requeue it. The retry would then bill a SECOND
    Vision call and overwrite the first read.

    The cost is the smaller half. By then the student may have confirmed
    — their corrections are keyed "{problem}:{step}" against the read
    they were SHOWN, so a fresh read with different step numbering makes
    those edits land on the wrong steps or vanish, and integrity and
    grading go on to run over work the student never approved.
    """
    sid = await _seed_submission(world)
    await _enqueue(world, sid)

    # The read landed, and the student signed off on it.
    await _mark_extracted(sid)
    async with get_session_factory()() as s:
        await s.execute(
            text(
                "UPDATE submissions SET extraction_confirmed_at = now(), "
                "extraction_edits = :e WHERE id = :i"
            ),
            {"e": '{"1:1": "x = 42"}', "i": sid},
        )
        await s.commit()

    # Put the job back in the queue, exactly as a failed _finish would.
    async with get_session_factory()() as s:
        await s.execute(
            text("UPDATE extraction_jobs SET status = :q WHERE submission_id = :i"),
            {"q": STATUS_QUEUED, "i": sid},
        )
        await s.commit()

    with patch(_TARGET, new_callable=AsyncMock) as vision:
        result = await drain()

    vision.assert_not_awaited()
    assert result["succeeded"] == 1
    assert (await _job(sid)).status == STATUS_DONE

    # The confirmed read and the student's corrections are untouched.
    async with get_session_factory()() as s:
        row = (await s.execute(
            text(
                "SELECT extraction_confirmed_at, extraction_edits "
                "FROM submissions WHERE id = :i"
            ),
            {"i": sid},
        )).one()
    assert row[0] is not None, "the student's confirmation was discarded"
    assert row[1] == {"1:1": "x = 42"}, "the student's corrections were orphaned"


@pytest.mark.asyncio
async def test_a_re_enqueue_will_not_reset_a_job_that_is_mid_flight(
    world: dict[str, Any],
) -> None:
    """A re-enqueue must leave a `running` job alone.

    Resetting one to `queued` frees a concurrent drain to claim it while
    the first Vision call is still in flight: the same photos read and
    billed twice, with whichever call commits last silently winning.

    The live trigger is the rescue script. Its guards all interrogate the
    SUBMISSION — already extracted? confirmed? flagged? — and never the
    job's status, and a `running` row a few minutes old is exactly what
    "stuck" looks like to an operator at 2am.
    """
    sid = await _seed_submission(world)
    await _enqueue(world, sid)

    async with get_session_factory()() as s:
        await s.execute(
            text(
                "UPDATE extraction_jobs SET status = :r, attempts = 1, "
                "started_at = now() WHERE submission_id = :i"
            ),
            {"r": STATUS_RUNNING, "i": sid},
        )
        await s.commit()

    await _enqueue(world, sid)

    job = await _job(sid)
    assert job.status == STATUS_RUNNING, "an in-flight job was reset"
    assert job.attempts == 1, "the in-flight job's budget was reset"

    # A job that is NOT in flight still resets — that is the recovery
    # path, and the guard must not have broken it.
    async with get_session_factory()() as s:
        await s.execute(
            text(
                "UPDATE extraction_jobs SET status = :f, attempts = :m "
                "WHERE submission_id = :i"
            ),
            {"f": STATUS_FAILED, "m": MAX_ATTEMPTS, "i": sid},
        )
        await s.commit()

    await _enqueue(world, sid)
    revived = await _job(sid)
    assert revived.status == STATUS_QUEUED
    assert revived.attempts == 0


@pytest.mark.asyncio
async def test_two_concurrent_drains_never_bill_the_same_call_twice(
    world: dict[str, Any],
) -> None:
    """The claim this module's docstring makes, and the drain endpoint
    repeats to operators, that nothing tested.

    Every other test here runs one drain. But a drain is spawned on
    EVERY submit, so overlapping drains are the normal case, not an
    edge — and a Vision call is the most expensive thing this system
    does per submission.
    """
    ids = [
        await _seed_submission(world),
        await _seed_submission(world, student="outsider_id"),
    ]
    for sid in ids:
        await _enqueue(world, sid)

    ran: list[uuid.UUID] = []

    async def _slow(sid: uuid.UUID) -> None:
        # Wide enough for the other drain to be inside its claim while
        # this one holds a row.
        ran.append(sid)
        await asyncio.sleep(0.05)
        await _mark_extracted(sid)

    with patch(_TARGET, new_callable=AsyncMock, side_effect=_slow):
        results = await asyncio.gather(drain(), drain(), drain())

    # Each submission was read exactly once, across all three drains.
    assert sorted(ran) == sorted(ids), f"a submission was read twice: {ran}"
    assert sum(r["claimed"] for r in results) == 2
    assert sum(r["succeeded"] for r in results) == 2
    for sid in ids:
        assert (await _job(sid)).status == STATUS_DONE


@pytest.mark.asyncio
async def test_a_failing_job_gets_one_attempt_per_pass_not_three(
    world: dict[str, Any],
) -> None:
    """The retry budget is spread across drains on purpose.

    A job that fails goes straight back to `queued`, and the drain claims
    one job at a time — so without an explicit guard the same pass picks
    it straight back up and spends the whole budget in seconds, against
    one set of conditions. The budget exists to give a transient cause
    time to clear; three tries in the same second is not three tries.
    """
    sid = await _seed_submission(world)
    await _enqueue(world, sid)

    with patch(_TARGET, new_callable=AsyncMock, side_effect=RuntimeError("no")):
        result = await drain()

    assert result["claimed"] == 1, f"the pass re-claimed it: {result}"
    job = await _job(sid)
    assert job.attempts == 1, f"the budget was spent in one pass: {job.attempts}"
    assert job.status == STATUS_QUEUED
