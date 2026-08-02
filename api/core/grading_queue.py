"""The durable grading queue: enqueue, claim, drain.

Why this exists at all is in `api.models.grading_job`. This module is the
mechanics.

## The cache-sequencing rule

Grading a class shares one cached prompt prefix (the rubric plus every
question and answer key — see `grading_ai._build_system_prompt`). The
discount only applies to a call that READS a prefix some earlier call
already WROTE, and a prefix cannot be read while it is still being
written. So firing thirty calls simultaneously makes all thirty miss and
pay full price — the exact opposite of the intent, with no error to
notice it by.

`_run_group` therefore runs the first job of an assignment alone, waits
for it, and only then fans out the rest. One submission pays to warm the
prefix; the remainder read it. This costs one call's latency per
assignment and is the difference between the batching work paying off and
doing nothing at all.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, cast

from sqlalchemy import CursorResult, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

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

logger = logging.getLogger(__name__)

# How many jobs one drain pass claims. Bounded so a single pass can't run
# for an unbounded time and get killed halfway by a request timeout —
# whatever is left is still queued and the next pass picks it up.
DEFAULT_DRAIN_LIMIT = 200

# Concurrent grades in flight. Each one holds a DB connection for the
# whole Anthropic round trip, and the pool (10 + 20 overflow) is SHARED
# with live teacher and student traffic — so this is a ceiling on how
# much of the app's connection budget a drain may occupy, not a
# throughput knob. Matches the limits the generation and diagnosis
# pipelines already use for the same reason.
_MAX_CONCURRENT_GRADES = 5
_SLOTS = asyncio.Semaphore(_MAX_CONCURRENT_GRADES)

# What actually happened to a job, which is not the same question as
# "did the drain error". See `_finish`.
_GRADED = "graded"    # a grade landed
_SKIPPED = "skipped"  # nothing to grade, and nothing coming
_FAILED = "failed"    # should have worked; retry or park


def _now() -> datetime:
    return datetime.now(UTC)


async def enqueue_submission(
    db: AsyncSession,
    submission_id: uuid.UUID,
    assignment: Assignment,
    *,
    requested_by_id: uuid.UUID | None = None,
    run_now: bool = False,
) -> None:
    """Record that a submission owes an AI grade.

    `scheduled_for` is the whole policy:

    - `run_now` (a teacher pressed something) → now, picked up next drain.
    - assignment has a `due_at` → that timestamp, so the class grades
      together and shares one cached prefix. A submission arriving after
      the due date gets a past timestamp, i.e. the next drain — late work
      grades automatically, just without the grouping discount.
    - no `due_at` → NULL. There is no moment that means "the class is
      in", so it waits for a teacher rather than being graded one-at-a-
      time at full price. It still shows in their to-review count.

    Idempotent on `submission_id`. A re-enqueue (regrade, double confirm)
    resets an existing row to queued and clears the previous error, but
    never lowers a row that a teacher has explicitly asked to run now
    back to a future schedule.
    """
    scheduled_for = _now() if run_now else assignment.due_at

    values: dict[str, Any] = {
        "submission_id": submission_id,
        "assignment_id": assignment.id,
        "status": STATUS_QUEUED,
        "scheduled_for": scheduled_for,
        "attempts": 0,
        "last_error": None,
        "requested_by_id": requested_by_id,
        "started_at": None,
        "finished_at": None,
    }
    stmt = pg_insert(GradingJob).values(**values)
    await db.execute(
        stmt.on_conflict_do_update(
            index_elements=["submission_id"],
            set_={
                "status": STATUS_QUEUED,
                "attempts": 0,
                "last_error": None,
                "started_at": None,
                "finished_at": None,
                "requested_by_id": stmt.excluded.requested_by_id,
                # Explicit: `pg_insert` does not fire the column's
                # `onupdate`, so without this a re-enqueued row keeps
                # the timestamp of its original insert and looks stale
                # to anything ordering by it.
                "updated_at": _now(),
                # least() keeps the EARLIER of the two schedules, and
                # treats NULL as "no opinion" rather than "never". A
                # teacher pressing "Grade now" on a not-yet-due
                # submission must win over the due date; re-confirming a
                # submission a teacher already queued must not push it
                # back out to Friday.
                "scheduled_for": _earliest(
                    GradingJob.scheduled_for, stmt.excluded.scheduled_for,
                ),
            },
        ),
    )


def _earliest(existing: Any, incoming: Any) -> Any:
    """Earlier of two nullable timestamps, where NULL means "unscheduled".

    Postgres `least()` already ignores NULLs, which is exactly the
    semantic wanted: an unscheduled row meeting a scheduled one becomes
    scheduled, and a scheduled row meeting an unscheduled one keeps its
    schedule.
    """
    from sqlalchemy import func

    return func.least(existing, incoming)


async def request_now(
    db: AsyncSession,
    *,
    assignment_id: uuid.UUID,
    requested_by_id: uuid.UUID,
    submission_id: uuid.UUID | None = None,
    section_id: uuid.UUID | None = None,
) -> int:
    """Teacher-triggered grading: pull work forward to the next drain.

    With `submission_id`, that one submission ("Grade now" on a row).
    Without, every still-queued submission on the assignment ("Grade
    all"). Returns how many jobs were moved.

    Also REVIVES `failed` jobs, with the retry budget reset. Without
    this, `failed` is a dead end — nothing in the system could move a
    job out of it, so a submission that exhausted its retries during an
    Anthropic incident would stay ungraded forever with no way back
    short of a database edit. The teacher pressing the button they
    already have is the natural retry, and resetting `attempts` is what
    makes it mean anything: the failure was three tries ago and
    conditions have presumably changed.

    Still won't touch `running` (already in flight), `done` (needs a
    regrade, not a re-queue) or `skipped` (nothing to grade) — silently
    re-running any of those would double-charge.
    """
    stmt = (
        update(GradingJob)
        .where(
            GradingJob.assignment_id == assignment_id,
            GradingJob.status.in_((STATUS_QUEUED, STATUS_FAILED)),
        )
        .values(
            status=STATUS_QUEUED,
            scheduled_for=_now(),
            requested_by_id=requested_by_id,
            attempts=0,
            started_at=None,
            finished_at=None,
            updated_at=_now(),
        )
    )
    if submission_id is not None:
        stmt = stmt.where(GradingJob.submission_id == submission_id)
    if section_id is not None:
        # An assignment spans sections, and the review page is
        # per-section: its button counts THIS section's ungraded work
        # and says so. Without this filter the endpoint moved every
        # queued job on the homework, so a teacher told "Grade 2
        # ungraded" could be billed for the whole grade level. The
        # label and the action have to describe the same thing.
        stmt = stmt.where(
            GradingJob.submission_id.in_(
                select(Submission.id).where(
                    Submission.assignment_id == assignment_id,
                    Submission.section_id == section_id,
                )
            )
        )
    result = cast("CursorResult[Any]", await db.execute(stmt))
    return int(result.rowcount or 0)


async def reschedule_assignment(
    db: AsyncSession, assignment: Assignment,
) -> int:
    """Re-point an assignment's queued jobs at its current due date.

    Enqueue-time scheduling is a snapshot, and `enqueue_submission`'s
    `least()` can only ever move a job EARLIER — so nothing else in the
    system can react to a due date changing. Two ordinary teacher edits
    go wrong without this:

    - **Extending a deadline** (the most common edit by far) leaves the
      class scheduled at the old time, so it grades before the extension
      has run out. Students who used the extra days get graded on work
      they hadn't finished, and the class splits across two drains,
      losing the shared cache prefix as well.
    - **Clearing a due date** leaves rows sitting at a past timestamp
      that will still auto-grade on the next drain — directly
      contradicting the promise that NULL means "wait for a teacher".

    Only `queued` jobs move. A `running` one is mid-flight; `done`,
    `skipped` and `failed` are terminal and re-pointing them would
    silently re-grade work that is finished.

    A teacher's explicit "Grade now" IS overwritten here, and that is
    correct: editing the deadline afterwards is a later, more specific
    instruction about when this class should grade.
    """
    result = cast("CursorResult[Any]", await db.execute(
        update(GradingJob)
        .where(
            GradingJob.assignment_id == assignment.id,
            GradingJob.status == STATUS_QUEUED,
        )
        .values(scheduled_for=assignment.due_at, updated_at=_now()),
    ))
    return int(result.rowcount or 0)


async def _reclaim_stale(db: AsyncSession) -> int:
    """Return abandoned `running` jobs to the queue.

    A worker that was deployed over or crashed leaves its jobs claimed
    forever; without this they are invisible work that never completes.
    Attempts is NOT incremented — the job never got its chance, and
    charging it an attempt would eventually park healthy work in
    `failed` purely because deploys happened.
    """
    cutoff = _now() - timedelta(minutes=STALE_RUNNING_MINUTES)

    # Out of budget: PARK, don't abandon. A submission that reliably
    # outlives its worker (a hang, an oversized payload, a drain killed
    # by a request timeout three times running) must not keep cycling
    # and burning a call every pass. But it must not be left `running`
    # either — nothing claims a `running` row and nothing revives one,
    # so it would sit invisible and ungradeable forever, in the feature
    # whose entire point is that work can't go missing. `failed` is
    # terminal AND revivable by the teacher's own button.
    parked = cast("CursorResult[Any]", await db.execute(
        update(GradingJob)
        .where(
            GradingJob.status == STATUS_RUNNING,
            GradingJob.started_at < cutoff,
            GradingJob.attempts >= MAX_ATTEMPTS,
        )
        .values(
            status=STATUS_FAILED,
            finished_at=_now(),
            last_error=(
                "abandoned mid-grade after "
                f"{MAX_ATTEMPTS} attempts — worker never reported back"
            ),
            updated_at=_now(),
        ),
    ))

    # Still in budget: back to the queue. Attempts is NOT incremented —
    # the job never got its chance, and charging it for a deploy would
    # park healthy work.
    requeued = cast("CursorResult[Any]", await db.execute(
        update(GradingJob)
        .where(
            GradingJob.status == STATUS_RUNNING,
            GradingJob.started_at < cutoff,
        )
        .values(status=STATUS_QUEUED, started_at=None, updated_at=_now()),
    ))
    return int(parked.rowcount or 0) + int(requeued.rowcount or 0)


async def _claim_due(db: AsyncSession, limit: int) -> list[GradingJob]:
    """Atomically claim up to `limit` jobs whose time has come.

    `WITH FOR UPDATE SKIP LOCKED` is what makes two drains running at
    once safe: each claims a disjoint set instead of both grabbing the
    same rows and grading (and billing) twice.

    `scheduled_for IS NOT NULL` is load-bearing — a NULL schedule means
    "no due date, waiting for a teacher", and treating it as due would
    auto-grade exactly the work we promised not to.
    """
    rows = (await db.execute(
        select(GradingJob)
        .where(
            GradingJob.status == STATUS_QUEUED,
            GradingJob.scheduled_for.is_not(None),
            GradingJob.scheduled_for <= _now(),
        )
        # Oldest schedule first so a backlog drains in the order it was
        # owed; assignment_id secondary so one class's jobs land in the
        # same claim and can share a cached prefix.
        .order_by(GradingJob.scheduled_for.asc(), GradingJob.assignment_id)
        .limit(limit)
        .with_for_update(skip_locked=True)
    )).scalars().all()

    for job in rows:
        job.status = STATUS_RUNNING
        job.started_at = _now()
        job.attempts += 1
    await db.commit()
    return list(rows)


async def _grade_one(job_id: uuid.UUID, submission_id: uuid.UUID) -> bool:
    """Grade one submission in its own session. Never raises.

    Own session per job so one failure can't poison a sibling's
    transaction — the previous in-process implementation shared a
    session and rolled the whole batch back on any single error.
    """
    from api.core.extraction_edits import apply_extraction_edits
    from api.core.grading_ai import (
        record_unreadable_grading_skip,
        run_ai_grading_for_submission,
    )
    from api.core.integrity_ai import UNREADABLE_THRESHOLD
    from api.models.assignment import Assignment

    try:
        # The connection is held across the Anthropic call below, so it
        # is only taken once we're ready to make it — see `_SLOTS`.
        async with get_session_factory()() as db:
            sub = (await db.execute(
                select(Submission).where(Submission.id == submission_id)
            )).scalar_one_or_none()
            if sub is None or sub.extraction is None:
                # Nothing gradeable and nothing coming: close the job as
                # `skipped` rather than `done`. `done` would claim a
                # grade exists.
                await _finish(db, job_id, outcome=_SKIPPED, error=None)
                await db.commit()
                return False

            # Re-read the switch. It was checked at confirm time, but a
            # teacher can turn AI grading off in the days between then
            # and the due date — and if they have, billing them for a
            # grade they opted out of is not a defensible thing to do.
            assignment = (await db.execute(
                select(Assignment).where(Assignment.id == sub.assignment_id)
            )).scalar_one_or_none()
            if assignment is None or not assignment.ai_grading_enabled:
                await _finish(db, job_id, outcome=_SKIPPED, error=None)
                await db.commit()
                return False

            extraction = apply_extraction_edits(
                sub.extraction, sub.extraction_edits,
            )
            if extraction is None:
                await _finish(db, job_id, outcome=_SKIPPED, error=None)
                await db.commit()
                return False

            # Second line of defence. The submit pipeline already gates
            # on this and declines to queue an unreadable submission at
            # all, so reaching here means the extraction changed between
            # queueing and draining — a student edit, a re-extraction.
            # Grade what's true now rather than what was true on Monday.
            if extraction.get("confidence", 0.0) < UNREADABLE_THRESHOLD:
                await record_unreadable_grading_skip(submission_id, db)
                await _finish(db, job_id, outcome=_SKIPPED, error=None)
                await db.commit()
                return False

            await run_ai_grading_for_submission(
                submission_id, extraction, db, user_id=str(sub.student_id),
            )
            # Did a grade actually land? `run_ai_grading_for_submission`
            # returns silently when the model hands back an empty
            # `grades` array — a call was paid for and nothing was
            # produced. Marking that `done` retires the job forever and
            # loses the work, which is the exact failure the queue
            # exists to prevent. Treat it as a failure so it retries.
            graded = (await db.execute(
                select(SubmissionGrade.final_score)
                .where(SubmissionGrade.submission_id == submission_id)
            )).scalar_one_or_none()
            if graded is None:
                await _finish(
                    db, job_id, outcome=_FAILED,
                    error="grader returned no grades",
                )
                await db.commit()
                return False

            await _finish(db, job_id, outcome=_GRADED, error=None)
            await db.commit()
            return True
    except Exception as exc:  # noqa: BLE001 — a failed job must park, not crash the drain
        logger.exception("grading job %s failed", job_id)
        try:
            async with get_session_factory()() as db:
                # An infrastructure stop — the daily cost cap tripping,
                # or the LLM circuit breaker opening — is not this
                # submission's fault, and it hits every job in the batch
                # at once. Charging each of them an attempt would park
                # whole classes in `failed` after one bad afternoon, and
                # nothing revives a failed job. Record the error, leave
                # the attempt uncharged, retry next drain.
                await _finish(
                    db, job_id,
                    outcome=_FAILED,
                    error=str(exc)[:2000],
                    charge_attempt=not _is_infrastructure_stop(exc),
                )
                await db.commit()
        except Exception:  # noqa: BLE001
            logger.exception("could not record failure for grading job %s", job_id)
        return False


def _is_infrastructure_stop(exc: BaseException) -> bool:
    """Was this the platform saying "stop", rather than this submission
    being ungradeable?

    The daily spend cap and the LLM circuit breaker both fire for every
    job in flight at once. They mean "come back later", not "this one is
    broken", so they must not burn the retry budget of work that is
    perfectly gradeable tomorrow — three drains at a 5-minute cadence
    would otherwise park whole classes in `failed`, which nothing
    revives automatically.

    Keyed on the exception TYPE. This was previously a substring match
    on the message, which never actually matched: the cap raises "Daily
    cost limit reached" and the guard looked for "cost cap" / "daily
    cap" / "budget".
    """
    from api.core.cost_tracker import PlatformStopError

    return isinstance(exc, PlatformStopError)


async def _finish(
    db: AsyncSession,
    job_id: uuid.UUID,
    *,
    outcome: str,
    error: str | None,
    charge_attempt: bool = True,
) -> None:
    """Close out a job.

    Three outcomes, deliberately distinct:

    - `_GRADED` — a grade landed. Terminal.
    - `_SKIPPED` — there was nothing to grade and nothing is coming (no
      extraction, AI grading switched off, unreadable). Terminal, but
      NOT `done`: `done` asserts a grade exists, and something reading
      this table to answer "is this class graded?" would be misled.
    - `_FAILED` — it should have worked and didn't. Back to `queued` for
      another go, or parked once the retry budget is spent.

    `charge_attempt=False` is for platform-level stops (the daily spend
    cap, the LLM circuit breaker) that hit every job in the batch at
    once. Charging those would park entire classes in `failed` after one
    bad afternoon, and nothing revives a failed job.
    """
    job = (await db.execute(
        select(GradingJob).where(GradingJob.id == job_id)
    )).scalar_one_or_none()
    if job is None:
        return

    if outcome == _GRADED:
        job.status = STATUS_DONE
        job.finished_at = _now()
        job.last_error = None
        return
    if outcome == _SKIPPED:
        job.status = STATUS_SKIPPED
        job.finished_at = _now()
        job.last_error = None
        return

    job.last_error = error
    if not charge_attempt:
        # Refund the attempt `_claim_due` took on the way in, so a
        # platform stop costs nothing but time.
        job.attempts = max(0, job.attempts - 1)
        job.status = STATUS_QUEUED
        job.started_at = None
        return
    if job.attempts >= MAX_ATTEMPTS:
        job.status = STATUS_FAILED
        job.finished_at = _now()
    else:
        job.status = STATUS_QUEUED
        job.started_at = None


async def _run_group(jobs: list[GradingJob]) -> tuple[int, int]:
    """Run one assignment's claimed jobs, warming the cache prefix first.

    See the module docstring: the first call is awaited alone so it
    writes the shared prefix, and the rest then read it. Fanning all of
    them out at once would make every call miss.
    """
    if not jobs:
        return 0, 0

    first, rest = jobs[0], jobs[1:]
    ok = await _grade_one(first.id, first.submission_id)
    succeeded = 1 if ok else 0
    failed = 0 if ok else 1

    async def _bounded(job: GradingJob) -> bool:
        # Every in-flight grade holds a DB connection for the whole
        # Anthropic round trip. The app's pool is 10 + 20 overflow and is
        # SHARED with live teacher and student traffic, so an unbounded
        # fan-out over a 30-student class starves the API and everyone
        # gets pool timeouts while a drain runs. Same guard the
        # generation and diagnosis pipelines already use.
        async with _SLOTS:
            return await _grade_one(job.id, job.submission_id)

    if rest:
        results = await asyncio.gather(
            *(_bounded(j) for j in rest), return_exceptions=False,
        )
        succeeded += sum(1 for r in results if r)
        failed += sum(1 for r in results if not r)
    return succeeded, failed


async def drain(limit: int = DEFAULT_DRAIN_LIMIT) -> dict[str, int]:
    """One drain pass. Safe to call concurrently with itself."""
    async with get_session_factory()() as db:
        reclaimed = await _reclaim_stale(db)
        await db.commit()
        claimed = await _claim_due(db, limit)

    by_assignment: dict[uuid.UUID, list[GradingJob]] = {}
    for job in claimed:
        by_assignment.setdefault(job.assignment_id, []).append(job)

    succeeded = failed = 0
    # Assignments run one after another rather than all at once: each
    # group's first call is warming its own prefix, and overlapping the
    # groups would put every warm-up call in flight simultaneously.
    for group in by_assignment.values():
        s, f = await _run_group(group)
        succeeded += s
        failed += f

    return {
        "reclaimed": reclaimed,
        "claimed": len(claimed),
        "assignments": len(by_assignment),
        "succeeded": succeeded,
        "failed": failed,
    }
