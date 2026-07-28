"""The durable grading queue.

Grading used to be an in-memory `asyncio.create_task` fired the moment a
student confirmed their transcription. These pin the two things that
replaced it, because both fail SILENTLY when they break — no exception,
no error log, just money spent or work quietly never done:

1. **Scheduling policy.** A NULL `scheduled_for` means "no due date —
   wait for a teacher". If a drain ever treats NULL as due, it
   auto-grades every no-due-date assignment on the platform, which is
   exactly what the design promises not to do. The backfill parks the
   entire pre-existing backlog at NULL, so this one guards a lot of rows.

2. **Cache sequencing.** A class shares one cached prompt prefix, and a
   prefix cannot be READ while it is still being WRITTEN. Fire thirty
   calls at once and all thirty miss and pay full price. The first job of
   an assignment must therefore finish before the rest start.

Plus durability: a claimed job whose worker died has to come back, and a
job that keeps failing has to park somewhere visible instead of cycling.
"""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from api.core.grading_queue import (
    _claim_due,
    _reclaim_stale,
    drain,
    enqueue_submission,
    request_now,
)
from api.database import get_session_factory
from api.models.assignment import Assignment, Submission, SubmissionGrade
from api.models.grading_job import (
    MAX_ATTEMPTS,
    STALE_RUNNING_MINUTES,
    STATUS_DONE,
    STATUS_FAILED,
    STATUS_QUEUED,
    STATUS_RUNNING,
    STATUS_SKIPPED,
    GradingJob,
)
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


async def _prepare(
    assignment_id: uuid.UUID,
    submission_ids: list[uuid.UUID],
    *,
    due_at: datetime | None,
) -> None:
    """Turn AI grading on, set (or clear) the due date, give every
    submission an extraction so the grader has something to work with."""
    async with get_session_factory()() as s:
        assignment = (await s.execute(
            select(Assignment).where(Assignment.id == assignment_id)
        )).scalar_one()
        assignment.ai_grading_enabled = True
        assignment.due_at = due_at
        for sid in submission_ids:
            sub = (await s.execute(
                select(Submission).where(Submission.id == sid)
            )).scalar_one()
            sub.extraction = _EXTRACTION
        await s.commit()


async def _enqueue(
    assignment_id: uuid.UUID, submission_id: uuid.UUID, **kwargs: Any,
) -> None:
    async with get_session_factory()() as s:
        assignment = (await s.execute(
            select(Assignment).where(Assignment.id == assignment_id)
        )).scalar_one()
        await enqueue_submission(s, submission_id, assignment, **kwargs)
        await s.commit()


async def _teacher_id(assignment_id: uuid.UUID) -> uuid.UUID:
    """_seed_hw doesn't hand back the teacher, and adding it there would
    edit a fixture five other test modules depend on. Read it off the
    assignment instead."""
    async with get_session_factory()() as s:
        return (await s.execute(
            select(Assignment.teacher_id).where(Assignment.id == assignment_id)
        )).scalar_one()


async def _fake_grade(
    submission_id: uuid.UUID, extraction: Any, db: Any, **kwargs: Any,
) -> None:
    """Stand-in for the real grader that actually writes a grade row.

    A bare AsyncMock isn't good enough any more: `_grade_one` now checks
    that a grade genuinely landed before retiring the job, because
    `run_ai_grading_for_submission` returns silently when the model hands
    back an empty `grades` array — a paid-for call that produced nothing.
    A mock that grades nothing is therefore indistinguishable from that
    bug, and would make these tests assert the wrong outcome.
    """
    db.add(SubmissionGrade(
        submission_id=submission_id, final_score=100.0, breakdown=[],
    ))
    await db.flush()


async def _job(submission_id: uuid.UUID) -> GradingJob | None:
    async with get_session_factory()() as s:
        return (await s.execute(
            select(GradingJob).where(GradingJob.submission_id == submission_id)
        )).scalar_one_or_none()


async def _all_jobs(assignment_id: uuid.UUID) -> list[GradingJob]:
    async with get_session_factory()() as s:
        return list((await s.execute(
            select(GradingJob).where(GradingJob.assignment_id == assignment_id)
        )).scalars().all())


# ── Scheduling policy ────────────────────────────────────────────────


async def test_due_date_schedules_the_class_for_that_moment() -> None:
    world = await _seed_hw()
    due = datetime.now(UTC) + timedelta(days=2)
    await _prepare(world["assignment_id"], world["submission_ids"], due_at=due)

    for sid in world["submission_ids"]:
        await _enqueue(world["assignment_id"], sid)

    for sid in world["submission_ids"]:
        job = await _job(sid)
        assert job is not None
        assert job.status == STATUS_QUEUED
        # Every submission on the HW lands on the SAME timestamp — that
        # shared moment is what lets them share a cached prefix.
        assert job.scheduled_for == due


async def test_no_due_date_leaves_the_job_unscheduled() -> None:
    world = await _seed_hw()
    await _prepare(world["assignment_id"], world["submission_ids"], due_at=None)

    sid = world["submission_ids"][0]
    await _enqueue(world["assignment_id"], sid)

    job = await _job(sid)
    assert job is not None
    assert job.status == STATUS_QUEUED
    # NULL, not now(). There is no moment that means "the class is in",
    # so this waits for a teacher rather than grading one kid at a time
    # at full price.
    assert job.scheduled_for is None


async def test_drain_never_claims_an_unscheduled_job() -> None:
    """The policy guard. If this ever fails, every no-due-date
    assignment on the platform — including the entire backfilled
    backlog — grades itself on the next cron tick."""
    world = await _seed_hw()
    await _prepare(world["assignment_id"], world["submission_ids"], due_at=None)
    for sid in world["submission_ids"]:
        await _enqueue(world["assignment_id"], sid)

    async with get_session_factory()() as s:
        claimed = await _claim_due(s, 100)
    assert not (set(world["submission_ids"]) & {c.submission_id for c in claimed})

    for sid in world["submission_ids"]:
        job = await _job(sid)
        assert job is not None
        assert job.status == STATUS_QUEUED
        assert job.attempts == 0


async def test_future_schedule_is_not_claimed_until_it_passes() -> None:
    world = await _seed_hw()
    await _prepare(
        world["assignment_id"], world["submission_ids"],
        due_at=datetime.now(UTC) + timedelta(hours=1),
    )
    sid = world["submission_ids"][0]
    await _enqueue(world["assignment_id"], sid)

    async with get_session_factory()() as s:
        claimed = await _claim_due(s, 100)
    assert sid not in {c.submission_id for c in claimed}

    # Move the due date into the past — a late submission, or simply the
    # deadline arriving — and it becomes claimable.
    async with get_session_factory()() as s:
        job = (await s.execute(
            select(GradingJob).where(GradingJob.submission_id == sid)
        )).scalar_one()
        job.scheduled_for = datetime.now(UTC) - timedelta(minutes=1)
        await s.commit()

    async with get_session_factory()() as s:
        claimed = await _claim_due(s, 100)
    assert sid in {c.submission_id for c in claimed}


# ── Teacher overrides ────────────────────────────────────────────────


async def test_grade_all_pulls_the_whole_assignment_forward() -> None:
    world = await _seed_hw(n_submissions=3)
    await _prepare(
        world["assignment_id"], world["submission_ids"],
        due_at=datetime.now(UTC) + timedelta(days=3),
    )
    for sid in world["submission_ids"]:
        await _enqueue(world["assignment_id"], sid)

    async with get_session_factory()() as s:
        moved = await request_now(
            s,
            assignment_id=world["assignment_id"],
            requested_by_id=await _teacher_id(world["assignment_id"]),
        )
        await s.commit()
    assert moved == len(world["submission_ids"])

    async with get_session_factory()() as s:
        claimed = await _claim_due(s, 100)
    assert {c.submission_id for c in claimed} >= set(world["submission_ids"])


async def test_grade_now_pulls_only_that_student_forward() -> None:
    world = await _seed_hw()
    await _prepare(
        world["assignment_id"], world["submission_ids"],
        due_at=datetime.now(UTC) + timedelta(days=3),
    )
    for sid in world["submission_ids"]:
        await _enqueue(world["assignment_id"], sid)

    target = world["submission_ids"][0]
    async with get_session_factory()() as s:
        moved = await request_now(
            s,
            assignment_id=world["assignment_id"],
            requested_by_id=await _teacher_id(world["assignment_id"]),
            submission_id=target,
        )
        await s.commit()
    assert moved == 1

    async with get_session_factory()() as s:
        claimed = await _claim_due(s, 100)
    assert [c.submission_id for c in claimed] == [target]


async def test_grade_now_works_on_an_unscheduled_job() -> None:
    """The no-due-date path is manual-only, so the teacher button is the
    ONLY way those ever grade. If this breaks, that work is unreachable."""
    world = await _seed_hw()
    await _prepare(world["assignment_id"], world["submission_ids"], due_at=None)
    sid = world["submission_ids"][0]
    await _enqueue(world["assignment_id"], sid)
    assert (await _job(sid)).scheduled_for is None  # type: ignore[union-attr]

    async with get_session_factory()() as s:
        await request_now(
            s,
            assignment_id=world["assignment_id"],
            requested_by_id=await _teacher_id(world["assignment_id"]),
            submission_id=sid,
        )
        await s.commit()

    async with get_session_factory()() as s:
        claimed = await _claim_due(s, 100)
    assert sid in {c.submission_id for c in claimed}


async def test_reenqueue_is_idempotent_and_keeps_the_earlier_schedule() -> None:
    world = await _seed_hw()
    await _prepare(
        world["assignment_id"], world["submission_ids"],
        due_at=datetime.now(UTC) + timedelta(days=3),
    )
    sid = world["submission_ids"][0]
    await _enqueue(world["assignment_id"], sid)

    # Teacher says "grade this now"...
    async with get_session_factory()() as s:
        await request_now(
            s,
            assignment_id=world["assignment_id"],
            requested_by_id=await _teacher_id(world["assignment_id"]),
            submission_id=sid,
        )
        await s.commit()

    # ...and then the submission is re-confirmed, which enqueues again
    # with the assignment's future due date. The teacher's request must
    # win: a re-confirm can't push work the teacher asked for back out
    # to Friday.
    await _enqueue(world["assignment_id"], sid)

    assert len(await _all_jobs(world["assignment_id"])) == 1
    job = await _job(sid)
    assert job is not None
    assert job.scheduled_for is not None
    assert job.scheduled_for <= datetime.now(UTC)


# ── Durability ───────────────────────────────────────────────────────


async def test_a_job_whose_worker_died_is_reclaimed() -> None:
    """The whole reason the queue exists. A deploy mid-grade used to
    lose the work with no record; now the row is still `running` and the
    next drain takes it back."""
    world = await _seed_hw()
    await _prepare(
        world["assignment_id"], world["submission_ids"],
        due_at=datetime.now(UTC) - timedelta(minutes=5),
    )
    sid = world["submission_ids"][0]
    await _enqueue(world["assignment_id"], sid)

    async with get_session_factory()() as s:
        claimed = await _claim_due(s, 100)
    assert sid in {c.submission_id for c in claimed}

    # Simulate the worker vanishing: the row sits `running` past the
    # stale cutoff with nobody working it.
    async with get_session_factory()() as s:
        job = (await s.execute(
            select(GradingJob).where(GradingJob.submission_id == sid)
        )).scalar_one()
        job.started_at = datetime.now(UTC) - timedelta(
            minutes=STALE_RUNNING_MINUTES + 1,
        )
        await s.commit()

    async with get_session_factory()() as s:
        reclaimed = await _reclaim_stale(s)
        await s.commit()
    # At least ours. Not an equality check: sibling tests in this session
    # leave their own claimed rows behind, and a platform-wide counter
    # would make this fail for reasons unrelated to what it tests.
    assert reclaimed >= 1

    job = await _job(sid)
    assert job is not None
    assert job.status == STATUS_QUEUED
    assert job.started_at is None
    # Attempts NOT incremented — the job never got its chance, and
    # charging it for a deploy would eventually park healthy work.
    assert job.attempts == 1


async def test_a_fresh_running_job_is_not_stolen() -> None:
    world = await _seed_hw()
    await _prepare(
        world["assignment_id"], world["submission_ids"],
        due_at=datetime.now(UTC) - timedelta(minutes=5),
    )
    sid = world["submission_ids"][0]
    await _enqueue(world["assignment_id"], sid)

    async with get_session_factory()() as s:
        await _claim_due(s, 100)

    async with get_session_factory()() as s:
        await _reclaim_stale(s)
        await s.commit()

    # The assertion that matters is about THIS job, not the count.
    job = await _job(sid)
    assert job is not None
    assert job.status == STATUS_RUNNING


async def test_repeated_failure_parks_the_job_instead_of_cycling() -> None:
    world = await _seed_hw()
    await _prepare(
        world["assignment_id"], world["submission_ids"][:1],
        due_at=datetime.now(UTC) - timedelta(minutes=1),
    )
    sid = world["submission_ids"][0]
    await _enqueue(world["assignment_id"], sid)

    boom = AsyncMock(side_effect=RuntimeError("anthropic exploded"))
    for _ in range(MAX_ATTEMPTS):
        with patch(
            "api.core.grading_ai.run_ai_grading_for_submission", new=boom,
        ):
            await drain()

    job = await _job(sid)
    assert job is not None
    assert job.status == STATUS_FAILED
    assert job.attempts == MAX_ATTEMPTS
    assert job.last_error is not None
    assert "anthropic exploded" in job.last_error
    # Parked, not queued — so a genuinely ungradeable submission becomes
    # visible instead of burning an LLM call every cron tick forever.
    async with get_session_factory()() as s:
        claimed = await _claim_due(s, 100)
    assert sid not in {c.submission_id for c in claimed}


# ── Cache sequencing ─────────────────────────────────────────────────


async def test_first_job_of_an_assignment_finishes_before_the_rest_start() -> None:
    """The saving depends on this ordering, and nothing else catches it.

    The shared prompt prefix is written by the first call and read by the
    others at a tenth of the price. A read cannot happen while the write
    is still in flight, so firing the class off simultaneously makes
    every call miss — same grades, full bill, no error anywhere.
    """
    # A real class, not one kid — the ordering only exists across a group.
    world = await _seed_hw(n_submissions=3)
    subs = world["submission_ids"]
    assert len(subs) == 3
    await _prepare(
        world["assignment_id"], subs,
        due_at=datetime.now(UTC) - timedelta(minutes=1),
    )
    for sid in subs:
        await _enqueue(world["assignment_id"], sid)

    # drain() is platform-wide by design, so sibling tests' jobs ride
    # along. Record which submission each event belongs to and look only
    # at ours — otherwise this asserts on whatever ran first globally.
    mine = set(subs)
    events: list[tuple[str, uuid.UUID]] = []

    async def _slow_grade(
        sub_id: uuid.UUID, extraction: Any, db: Any, **kwargs: Any,
    ) -> None:
        events.append(("start", sub_id))
        await asyncio.sleep(0.05)
        await _fake_grade(sub_id, extraction, db, **kwargs)
        events.append(("end", sub_id))

    with patch(
        "api.core.grading_ai.run_ai_grading_for_submission",
        new=AsyncMock(side_effect=_slow_grade),
    ):
        await drain()

    ours = [e for e in events if e[1] in mine]
    assert len(ours) == 2 * len(subs), f"expected every submission graded, got {ours}"
    # The first of OUR calls must have CLOSED before any other of ours
    # opened. Fanned out with gather(), the first two would be
    # start,start — and the cached prefix would be written by nobody and
    # read by nobody.
    assert ours[0][0] == "start"
    assert ours[1][0] == "end", (
        f"first grade must complete before the rest begin, got {ours[:4]}"
    )


async def test_drain_reports_what_it_did() -> None:
    world = await _seed_hw(n_submissions=3)
    await _prepare(
        world["assignment_id"], world["submission_ids"],
        due_at=datetime.now(UTC) - timedelta(minutes=1),
    )
    for sid in world["submission_ids"]:
        await _enqueue(world["assignment_id"], sid)

    with patch(
        "api.core.grading_ai.run_ai_grading_for_submission",
        new=AsyncMock(side_effect=_fake_grade),
    ):
        result = await drain()

    # Counters are platform-wide (one drain serves every school), so
    # assert they ACCOUNT for our work rather than equal it exactly.
    assert result["claimed"] >= len(world["submission_ids"])
    assert result["assignments"] >= 1
    assert result["succeeded"] >= len(world["submission_ids"])
    # A cron that 200s while grading nothing must be distinguishable
    # from a healthy one, so every one of ours must be reflected.
    for sid in world["submission_ids"]:
        job = await _job(sid)
        assert job is not None
        assert job.status == STATUS_DONE


# ── Guards added after cold review ───────────────────────────────────


async def test_turning_ai_grading_off_after_submit_stops_the_bill() -> None:
    """`ai_grading_enabled` is read at confirm time, but a teacher can
    switch it off in the days before the due date. Billing them for a
    grade they opted out of isn't defensible, so the drain re-checks."""
    world = await _seed_hw()
    await _prepare(
        world["assignment_id"], world["submission_ids"],
        due_at=datetime.now(UTC) - timedelta(minutes=1),
    )
    sid = world["submission_ids"][0]
    await _enqueue(world["assignment_id"], sid)

    async with get_session_factory()() as s:
        assignment = (await s.execute(
            select(Assignment).where(Assignment.id == world["assignment_id"])
        )).scalar_one()
        assignment.ai_grading_enabled = False
        await s.commit()

    grader = AsyncMock(side_effect=_fake_grade)
    with patch("api.core.grading_ai.run_ai_grading_for_submission", new=grader):
        await drain()

    grader.assert_not_awaited()
    job = await _job(sid)
    assert job is not None
    assert job.status == STATUS_SKIPPED


async def test_a_grader_that_returns_nothing_is_retried_not_retired() -> None:
    """`run_ai_grading_for_submission` returns silently when the model
    hands back an empty `grades` array — a paid-for call that produced
    no grade. Marking that `done` retires the job forever and loses the
    work, which is the precise failure the queue exists to prevent."""
    world = await _seed_hw()
    await _prepare(
        world["assignment_id"], world["submission_ids"],
        due_at=datetime.now(UTC) - timedelta(minutes=1),
    )
    sid = world["submission_ids"][0]
    await _enqueue(world["assignment_id"], sid)

    # Grades nothing, raises nothing — exactly the silent-empty case.
    with patch(
        "api.core.grading_ai.run_ai_grading_for_submission", new=AsyncMock(),
    ):
        await drain()

    job = await _job(sid)
    assert job is not None
    assert job.status == STATUS_QUEUED, "must retry, not retire"
    assert job.attempts == 1
    assert job.last_error is not None


async def test_the_daily_cost_cap_does_not_burn_a_class_s_retries() -> None:
    """The spend cap and the circuit breaker fire for EVERY job in
    flight. Charging each an attempt would park whole classes in
    `failed` after one bad afternoon — and nothing revives a failed
    job."""
    world = await _seed_hw()
    await _prepare(
        world["assignment_id"], world["submission_ids"],
        due_at=datetime.now(UTC) - timedelta(minutes=1),
    )
    sid = world["submission_ids"][0]
    await _enqueue(world["assignment_id"], sid)

    capped = AsyncMock(side_effect=RuntimeError("daily cost cap exceeded"))
    for _ in range(MAX_ATTEMPTS + 2):
        with patch(
            "api.core.grading_ai.run_ai_grading_for_submission", new=capped,
        ):
            await drain()

    job = await _job(sid)
    assert job is not None
    # Still retryable after more rounds than MAX_ATTEMPTS — the platform
    # said "come back later", not "this one is broken".
    assert job.status == STATUS_QUEUED
    assert job.attempts == 0


async def test_a_submission_with_no_extraction_is_skipped_not_marked_graded() -> None:
    world = await _seed_hw()
    await _prepare(
        world["assignment_id"], world["submission_ids"],
        due_at=datetime.now(UTC) - timedelta(minutes=1),
    )
    sid = world["submission_ids"][0]
    async with get_session_factory()() as s:
        sub = (await s.execute(
            select(Submission).where(Submission.id == sid)
        )).scalar_one()
        sub.extraction = None
        await s.commit()
    await _enqueue(world["assignment_id"], sid)

    with patch(
        "api.core.grading_ai.run_ai_grading_for_submission", new=AsyncMock(),
    ):
        await drain()

    job = await _job(sid)
    assert job is not None
    # `done` would assert a grade exists. It doesn't.
    assert job.status == STATUS_SKIPPED


async def test_extending_a_due_date_moves_the_queued_class() -> None:
    """The most common due-date edit. Without a reschedule the class
    still grades at the OLD time — before the extension has run out."""
    from api.core.grading_queue import reschedule_assignment

    world = await _seed_hw(n_submissions=2)
    original = datetime.now(UTC) + timedelta(hours=1)
    await _prepare(world["assignment_id"], world["submission_ids"], due_at=original)
    for sid in world["submission_ids"]:
        await _enqueue(world["assignment_id"], sid)

    extended = original + timedelta(days=3)
    async with get_session_factory()() as s:
        assignment = (await s.execute(
            select(Assignment).where(Assignment.id == world["assignment_id"])
        )).scalar_one()
        assignment.due_at = extended
        moved = await reschedule_assignment(s, assignment)
        await s.commit()
    assert moved == 2

    for sid in world["submission_ids"]:
        job = await _job(sid)
        assert job is not None
        assert job.scheduled_for == extended


async def test_clearing_a_due_date_unschedules_the_class() -> None:
    """Otherwise rows sit at a past timestamp and auto-grade anyway,
    contradicting the rule that no due date means "wait for a teacher"."""
    from api.core.grading_queue import reschedule_assignment

    world = await _seed_hw(n_submissions=2)
    await _prepare(
        world["assignment_id"], world["submission_ids"],
        due_at=datetime.now(UTC) - timedelta(minutes=5),
    )
    for sid in world["submission_ids"]:
        await _enqueue(world["assignment_id"], sid)

    async with get_session_factory()() as s:
        assignment = (await s.execute(
            select(Assignment).where(Assignment.id == world["assignment_id"])
        )).scalar_one()
        assignment.due_at = None
        await reschedule_assignment(s, assignment)
        await s.commit()

    for sid in world["submission_ids"]:
        assert (await _job(sid)).scheduled_for is None  # type: ignore[union-attr]

    # And a drain must now leave them alone.
    async with get_session_factory()() as s:
        claimed = await _claim_due(s, 100)
    assert not (set(world["submission_ids"]) & {c.submission_id for c in claimed})


async def test_rescheduling_does_not_disturb_finished_work() -> None:
    from api.core.grading_queue import reschedule_assignment

    world = await _seed_hw(n_submissions=2)
    await _prepare(
        world["assignment_id"], world["submission_ids"],
        due_at=datetime.now(UTC) + timedelta(hours=1),
    )
    for sid in world["submission_ids"]:
        await _enqueue(world["assignment_id"], sid)

    done_sub = world["submission_ids"][0]
    async with get_session_factory()() as s:
        job = (await s.execute(
            select(GradingJob).where(GradingJob.submission_id == done_sub)
        )).scalar_one()
        job.status = STATUS_DONE
        job.scheduled_for = datetime.now(UTC) - timedelta(days=1)
        await s.commit()

    async with get_session_factory()() as s:
        assignment = (await s.execute(
            select(Assignment).where(Assignment.id == world["assignment_id"])
        )).scalar_one()
        assignment.due_at = datetime.now(UTC) + timedelta(days=5)
        moved = await reschedule_assignment(s, assignment)
        await s.commit()

    # Only the still-queued one. Re-pointing a finished job would
    # silently re-grade work that is already done.
    assert moved == 1
    assert (await _job(done_sub)).status == STATUS_DONE  # type: ignore[union-attr]


async def test_a_teacher_can_revive_a_failed_job() -> None:
    """`failed` was a dead end: nothing could move a job out of it, so a
    submission that exhausted its retries during an Anthropic incident
    stayed ungraded forever short of a database edit. The button the
    teacher already has is the natural retry."""
    world = await _seed_hw()
    await _prepare(
        world["assignment_id"], world["submission_ids"],
        due_at=datetime.now(UTC) - timedelta(minutes=1),
    )
    sid = world["submission_ids"][0]
    await _enqueue(world["assignment_id"], sid)

    boom = AsyncMock(side_effect=RuntimeError("anthropic exploded"))
    for _ in range(MAX_ATTEMPTS):
        with patch(
            "api.core.grading_ai.run_ai_grading_for_submission", new=boom,
        ):
            await drain()
    assert (await _job(sid)).status == STATUS_FAILED  # type: ignore[union-attr]

    async with get_session_factory()() as s:
        moved = await request_now(
            s,
            assignment_id=world["assignment_id"],
            requested_by_id=await _teacher_id(world["assignment_id"]),
            submission_id=sid,
        )
        await s.commit()
    assert moved == 1

    job = await _job(sid)
    assert job is not None
    assert job.status == STATUS_QUEUED
    # Budget reset — the failure was three tries ago and conditions have
    # presumably changed. Without this the revived job would park again
    # on its very next attempt.
    assert job.attempts == 0

    with patch(
        "api.core.grading_ai.run_ai_grading_for_submission",
        new=AsyncMock(side_effect=_fake_grade),
    ):
        await drain()
    assert (await _job(sid)).status == STATUS_DONE  # type: ignore[union-attr]


async def test_reviving_does_not_touch_finished_or_skipped_work() -> None:
    world = await _seed_hw(n_submissions=2)
    await _prepare(world["assignment_id"], world["submission_ids"], due_at=None)
    done_sub, skipped_sub = world["submission_ids"]
    for sid in world["submission_ids"]:
        await _enqueue(world["assignment_id"], sid)

    async with get_session_factory()() as s:
        for sid, st in ((done_sub, STATUS_DONE), (skipped_sub, STATUS_SKIPPED)):
            job = (await s.execute(
                select(GradingJob).where(GradingJob.submission_id == sid)
            )).scalar_one()
            job.status = st
        await s.commit()

    async with get_session_factory()() as s:
        moved = await request_now(
            s,
            assignment_id=world["assignment_id"],
            requested_by_id=await _teacher_id(world["assignment_id"]),
        )
        await s.commit()

    # Neither is re-runnable: `done` needs a regrade, `skipped` has
    # nothing to grade. Re-running either would double-charge.
    assert moved == 0
    assert (await _job(done_sub)).status == STATUS_DONE  # type: ignore[union-attr]
    assert (await _job(skipped_sub)).status == STATUS_SKIPPED  # type: ignore[union-attr]


# ── The drain endpoint (the scheduled clock knocks here) ─────────────


async def test_drain_endpoint_is_shut_when_no_token_is_configured(
    client: AsyncClient,
) -> None:
    """Safe default. An unguarded drain lets anyone on the internet force
    every pending class on the platform to grade on demand — real money.
    Unset means 503, not open."""
    from api.config import settings

    original = settings.grading_drain_token
    settings.grading_drain_token = ""
    try:
        r = await client.post("/v1/internal/grading/drain")
        assert r.status_code == 503
    finally:
        settings.grading_drain_token = original


async def test_drain_endpoint_rejects_a_wrong_token(
    client: AsyncClient,
) -> None:
    from api.config import settings

    original = settings.grading_drain_token
    settings.grading_drain_token = "the-real-one"
    try:
        assert (await client.post("/v1/internal/grading/drain")).status_code == 401
        r = await client.post(
            "/v1/internal/grading/drain",
            headers={"X-Grading-Token": "not-it"},
        )
        assert r.status_code == 401
    finally:
        settings.grading_drain_token = original


async def test_drain_endpoint_grades_a_due_class_and_reports_it(
    client: AsyncClient,
) -> None:
    """End-to-end through the door the cron knocks on."""
    from api.config import settings

    world = await _seed_hw(n_submissions=2)
    await _prepare(
        world["assignment_id"], world["submission_ids"],
        due_at=datetime.now(UTC) - timedelta(minutes=1),
    )
    for sid in world["submission_ids"]:
        await _enqueue(world["assignment_id"], sid)

    original = settings.grading_drain_token
    settings.grading_drain_token = "test-token"
    try:
        with patch(
            "api.core.grading_ai.run_ai_grading_for_submission",
            new=AsyncMock(side_effect=_fake_grade),
        ):
            r = await client.post(
                "/v1/internal/grading/drain",
                headers={"X-Grading-Token": "test-token"},
            )
    finally:
        settings.grading_drain_token = original

    assert r.status_code == 200, r.text
    payload = r.json()
    # The cron reads this to tell a healthy run from one that silently
    # graded nothing.
    assert payload["succeeded"] >= 2
    for sid in world["submission_ids"]:
        assert (await _job(sid)).status == STATUS_DONE  # type: ignore[union-attr]
