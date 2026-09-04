"""Durable queue for the Vision read, mirroring `grading_queue`.

Extraction was the last hop still living in one web server's memory: a
bare `asyncio.create_task` with one caller, no row, no retry, no sweeper.
When the task died the submission stayed durable and permanently
unprocessable — see `api/models/extraction_job.py` for the full account.

The shape here is deliberately the same as grading's, because the failure
is the same and the pattern is already proven in production. Where it
differs, the reason is written down.

## What is different from grading, and why

* **No `scheduled_for`.** Grading's whole policy lives in that column: a
  due date makes the class grade together and share a cached prefix, and
  NULL means "wait for a teacher". Extraction has neither property —
  each submission is its own set of photos, so there is no batching
  benefit, and a submission without a read is a student who cannot
  proceed. Queued means runnable now.

* **No grouping in the drain.** Same reason: nothing to share between
  two students' photos, so jobs run independently.

* **No `skipped` outcome.** Grading skips for real reasons (a teacher
  turned AI grading off, the photo was unreadable). Extraction is either
  owed or not, and "not owed" is decided at enqueue time — a job that
  exists should run.
"""

import logging
import uuid
from collections import Counter
from datetime import UTC, datetime, timedelta
from typing import Any, cast

from sqlalchemy import CursorResult, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_session_factory
from api.models.assignment import Assignment, Submission
from api.models.extraction_job import (
    MAX_ATTEMPTS,
    STATUS_DONE,
    STATUS_FAILED,
    STATUS_QUEUED,
    STATUS_RUNNING,
    ExtractionJob,
)

logger = logging.getLogger(__name__)

DEFAULT_DRAIN_LIMIT = 20

# A job still `running` after this long belongs to a worker that was
# deployed over or crashed. Vision calls take 5-15s and the client
# timeout is 90s, so ten minutes is far past "slow" and safely into
# "gone".
STALE_RUNNING_MINUTES = 10

_DONE = "done"
_FAILED = "failed"


def _now() -> datetime:
    return datetime.now(UTC)


async def enqueue_submission(
    db: AsyncSession,
    submission_id: uuid.UUID,
    assignment: Assignment,
) -> None:
    """Record that a submission owes a Vision read.

    Idempotent on `submission_id`: a retried request, or a re-run asked
    for by an admin, collapses onto the existing row rather than queueing
    the same Vision call twice. A Vision call is the most expensive thing
    this system does per submission, so double-queueing is not a cosmetic
    problem.

    A re-enqueue RESETS the row — back to queued, attempts zeroed, error
    cleared. That is what makes this the retry path for a job that
    already exhausted its budget: the cause has presumably been fixed, so
    it deserves a fresh budget rather than inheriting a spent one.

    Caller commits. Never raises: a queueing failure must not take down
    the submit that just succeeded — the whole point of this table is
    that the student's work is already safe by the time we get here.
    """
    try:
        await db.execute(
            pg_insert(ExtractionJob)
            .values(
                id=uuid.uuid4(),
                submission_id=submission_id,
                assignment_id=assignment.id,
                status=STATUS_QUEUED,
                attempts=0,
            )
            .on_conflict_do_update(
                index_elements=["submission_id"],
                set_={
                    "status": STATUS_QUEUED,
                    "attempts": 0,
                    "last_error": None,
                    "started_at": None,
                    "finished_at": None,
                    "updated_at": _now(),
                },
            )
        )
    except Exception:
        logger.exception(
            "failed to enqueue extraction for submission %s", submission_id,
        )


async def _reclaim_stale(db: AsyncSession) -> int:
    """Return abandoned `running` jobs to the queue.

    A worker deployed over mid-call leaves its job claimed forever, and
    nothing claims or revives a `running` row — so without this it is
    invisible work that never completes, in the feature whose entire
    point is that work cannot go missing.

    Out of budget: PARK as `failed` rather than requeue, so a submission
    that reliably outlives its worker stops burning a Vision call every
    pass. `failed` is terminal but revivable — `enqueue_submission`
    resets it.
    """
    cutoff = _now() - timedelta(minutes=STALE_RUNNING_MINUTES)

    parked = cast("CursorResult[Any]", await db.execute(
        update(ExtractionJob)
        .where(
            ExtractionJob.status == STATUS_RUNNING,
            ExtractionJob.started_at < cutoff,
            ExtractionJob.attempts >= MAX_ATTEMPTS,
        )
        .values(
            status=STATUS_FAILED,
            finished_at=_now(),
            last_error=(
                f"abandoned mid-extraction after {MAX_ATTEMPTS} attempts "
                "— worker never reported back"
            ),
            updated_at=_now(),
        ),
    ))

    # Still in budget: back to the queue, attempts NOT incremented. The
    # job never got its chance, and charging it for a deploy would
    # eventually park healthy work as failed.
    requeued = cast("CursorResult[Any]", await db.execute(
        update(ExtractionJob)
        .where(
            ExtractionJob.status == STATUS_RUNNING,
            ExtractionJob.started_at < cutoff,
        )
        .values(status=STATUS_QUEUED, started_at=None, updated_at=_now()),
    ))
    return int(parked.rowcount or 0) + int(requeued.rowcount or 0)


async def _claim_queued(db: AsyncSession, limit: int) -> list[ExtractionJob]:
    """Atomically claim up to `limit` queued jobs.

    `FOR UPDATE SKIP LOCKED` is what makes two drains safe to run at
    once: each claims a disjoint set instead of both grabbing the same
    rows and billing the same Vision call twice.
    """
    rows = (await db.execute(
        select(ExtractionJob)
        .where(ExtractionJob.status == STATUS_QUEUED)
        # Oldest first, so a backlog drains in the order students were
        # kept waiting.
        .order_by(ExtractionJob.created_at.asc())
        .limit(limit)
        .with_for_update(skip_locked=True)
    )).scalars().all()

    for job in rows:
        job.status = STATUS_RUNNING
        job.started_at = _now()
        job.attempts += 1
    await db.commit()
    return list(rows)


async def _finish(
    job_id: uuid.UUID,
    *,
    status: str,
    error: str | None = None,
) -> None:
    """Stamp a job's terminal state on its own session.

    Its own session because the extraction that just ran opened and
    closed one of its own; reusing that would mean holding a connection
    across a 15-second Vision call.
    """
    async with get_session_factory()() as db:
        await db.execute(
            update(ExtractionJob)
            .where(ExtractionJob.id == job_id)
            .values(
                status=status,
                last_error=error,
                finished_at=_now(),
                updated_at=_now(),
            )
        )
        await db.commit()


async def _extract_one(job: ExtractionJob) -> str:
    """Run one job. Returns the tally key; never raises."""
    from api.routes.school_student_practice import run_extraction_for_submission

    try:
        await run_extraction_for_submission(job.submission_id)
    except Exception as exc:
        # Budget exhausted -> park for a human. Still in budget -> back to
        # the queue for the next drain, with the error kept so the admin
        # console can say WHY it is retrying rather than just that it is.
        exhausted = job.attempts >= MAX_ATTEMPTS
        await _finish(
            job.id,
            status=STATUS_FAILED if exhausted else STATUS_QUEUED,
            error=f"{type(exc).__name__}: {exc}"[:2000],
        )
        logger.exception(
            "extraction job %s failed (attempt %d/%d) for submission %s",
            job.id, job.attempts, MAX_ATTEMPTS, job.submission_id,
        )
        return _FAILED

    # `run_extraction_for_submission` swallows its own exceptions and
    # returns normally either way, so success is confirmed by re-reading
    # rather than by it not raising. Without this a silent failure would
    # be recorded as `done` and the student would stay stuck with the
    # queue insisting the work was finished.
    async with get_session_factory()() as db:
        landed = (await db.execute(
            select(Submission.extraction).where(
                Submission.id == job.submission_id,
            )
        )).scalar_one_or_none()

    if landed:
        await _finish(job.id, status=STATUS_DONE)
        return _DONE

    exhausted = job.attempts >= MAX_ATTEMPTS
    await _finish(
        job.id,
        status=STATUS_FAILED if exhausted else STATUS_QUEUED,
        error="extraction returned without writing a result",
    )
    return _FAILED


async def drain(limit: int = DEFAULT_DRAIN_LIMIT) -> dict[str, int]:
    """One drain pass. Safe to call concurrently with itself."""
    async with get_session_factory()() as db:
        reclaimed = await _reclaim_stale(db)
        await db.commit()
        claimed = await _claim_queued(db, limit)

    tally: Counter[str] = Counter()
    # Sequential, not gathered: each job is a full Vision call on
    # multi-megabyte photos, and running twenty at once would spike both
    # memory and the provider's rate limit for no latency benefit that
    # matters — nobody is watching this run.
    for job in claimed:
        tally.update([await _extract_one(job)])

    return {
        "reclaimed": reclaimed,
        "claimed": len(claimed),
        "succeeded": tally[_DONE],
        "failed": tally[_FAILED],
    }
