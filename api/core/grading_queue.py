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
from api.models.assignment import Assignment, Submission
from api.models.grading_job import (
    MAX_ATTEMPTS,
    STALE_RUNNING_MINUTES,
    STATUS_DONE,
    STATUS_FAILED,
    STATUS_QUEUED,
    STATUS_RUNNING,
    GradingJob,
)

logger = logging.getLogger(__name__)

# How many jobs one drain pass claims. Bounded so a single pass can't run
# for an unbounded time and get killed halfway by a request timeout —
# whatever is left is still queued and the next pass picks it up.
DEFAULT_DRAIN_LIMIT = 200


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
) -> int:
    """Teacher-triggered grading: pull work forward to the next drain.

    With `submission_id`, that one submission ("Grade now" on a row).
    Without, every still-queued submission on the assignment ("Grade
    all"). Returns how many jobs were moved.

    Only touches `queued` rows. A `running` job is already being handled,
    and a `done` one needs a regrade rather than a re-queue — silently
    re-running either would double-charge.
    """
    stmt = (
        update(GradingJob)
        .where(
            GradingJob.assignment_id == assignment_id,
            GradingJob.status == STATUS_QUEUED,
        )
        .values(scheduled_for=_now(), requested_by_id=requested_by_id)
    )
    if submission_id is not None:
        stmt = stmt.where(GradingJob.submission_id == submission_id)
    result = cast("CursorResult[Any]", await db.execute(stmt))
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
    result = cast("CursorResult[Any]", await db.execute(
        update(GradingJob)
        .where(
            GradingJob.status == STATUS_RUNNING,
            GradingJob.started_at < cutoff,
        )
        .values(status=STATUS_QUEUED, started_at=None),
    ))
    return int(result.rowcount or 0)


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

    try:
        async with get_session_factory()() as db:
            sub = (await db.execute(
                select(Submission).where(Submission.id == submission_id)
            )).scalar_one_or_none()
            if sub is None or sub.extraction is None:
                await _finish(db, job_id, ok=True, error=None)
                await db.commit()
                return True

            extraction = apply_extraction_edits(
                sub.extraction, sub.extraction_edits,
            )
            if extraction is None:
                await _finish(db, job_id, ok=True, error=None)
                await db.commit()
                return True

            # Second line of defence. The submit pipeline already gates
            # on this and declines to queue an unreadable submission at
            # all, so reaching here means the extraction changed between
            # queueing and draining — a student edit, a re-extraction.
            # Grade what's true now rather than what was true on Monday.
            if extraction.get("confidence", 0.0) < UNREADABLE_THRESHOLD:
                await record_unreadable_grading_skip(submission_id, db)
            else:
                await run_ai_grading_for_submission(
                    submission_id, extraction, db,
                    user_id=str(sub.student_id),
                )
            await _finish(db, job_id, ok=True, error=None)
            await db.commit()
            return True
    except Exception as exc:  # noqa: BLE001 — a failed job must park, not crash the drain
        logger.exception("grading job %s failed", job_id)
        try:
            async with get_session_factory()() as db:
                await _finish(db, job_id, ok=False, error=str(exc)[:2000])
                await db.commit()
        except Exception:  # noqa: BLE001
            logger.exception("could not record failure for grading job %s", job_id)
        return False


async def _finish(
    db: AsyncSession, job_id: uuid.UUID, *, ok: bool, error: str | None,
) -> None:
    """Close out a job. A failure below MAX_ATTEMPTS goes back to queued
    so the next drain retries it; at the cap it parks in `failed` so a
    genuinely ungradeable submission becomes visible instead of cycling
    forever."""
    job = (await db.execute(
        select(GradingJob).where(GradingJob.id == job_id)
    )).scalar_one_or_none()
    if job is None:
        return
    if ok:
        job.status = STATUS_DONE
        job.finished_at = _now()
        job.last_error = None
        return
    job.last_error = error
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

    if rest:
        results = await asyncio.gather(
            *(_grade_one(j.id, j.submission_id) for j in rest),
            return_exceptions=False,
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
