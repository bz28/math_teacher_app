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

* **A narrower `skipped`.** Grading skips for several reasons;
  extraction has exactly one — the assignment's AI toggles were switched
  off after the job was queued. "Not owed" is decided at enqueue time
  AND again at drain time, because a backfilled or re-enqueued row can
  be days old by the time it runs and a Vision call is the most
  expensive thing this system does per submission. It is reported apart
  from `failed`, since `failed` is the counter an operator is told to
  alert on and a closed door is not an incident.

  A deleted submission needs no outcome of its own: the job row is
  `ON DELETE CASCADE` and goes with it.
"""

import logging
import uuid
from collections import Counter
from datetime import UTC, datetime, timedelta
from typing import Any, cast

from sqlalchemy import CursorResult, case, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import SQLAlchemyError
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
# The assignment's AI toggles were switched off after the job was
# queued, so nothing is owed. Kept out of `failed` so a closed door
# does not page anyone.
_SKIPPED = "skipped"


def _now() -> datetime:
    return datetime.now(UTC)


def _safe_error(exc: BaseException) -> str:
    """Describe a failure without quoting the student's homework.

    `last_error` is a durable column and this text is also logged, so
    whatever lands here outlives the incident. The obvious
    `f"{type(exc).__name__}: {exc}"` is unsafe for exactly one family of
    exceptions, and it is the family this code path is most likely to
    raise.

    The extraction is persisted with `submissions.extraction = <the
    transcribed work>`. If anything goes wrong flushing that — a
    statement timeout, a deadlock, a connection reset mid-statement —
    SQLAlchemy raises a `StatementError`, and its `__str__` appends the
    statement AND its bound parameters. One of those parameters is the
    student's transcribed handwriting, so the naive format writes it
    into a database column and into the log stream:

        StatementError: statement timed out
        [SQL: UPDATE submissions SET extraction=%(extraction)s ...]
        [parameters: {'extraction': {'steps': [{'latex': '...'}]}}]

    We sell to districts and the rule in `activity_log` is ids, counts
    and codes — never student content. The same rule has to hold here.

    So for any SQLAlchemy error we keep the wrapper's class name and the
    DRIVER's message (`.orig`), which is the server's own text — "
    canceling statement due to statement timeout", "deadlock detected" —
    and never the statement or its parameters. That is the part an
    operator acts on anyway; the SQL is recoverable from Postgres's own
    logs if it is ever genuinely needed.

    Everything else is formatted in full. Those are our own raises and
    the Anthropic SDK's, and none carry transcribed work: the Vision
    parse errors report a position or a `stop_reason`, not content.
    """
    if isinstance(exc, SQLAlchemyError):
        orig = getattr(exc, "orig", None)
        detail = str(orig) if orig is not None else "no driver detail"
        return f"{type(exc).__name__}: {detail}"[:2000]
    return f"{type(exc).__name__}: {exc}"[:2000]


async def enqueue_submission(
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

    Opens and commits its OWN session, and takes no caller session. That
    is load-bearing, not tidiness. It used to run on the caller's session
    and swallow every exception, which meant a failed INSERT left that
    transaction ABORTED: the caller's next `COMMIT` silently degraded to
    a rollback, and the result was a durable submission with no job row
    and nothing but a log line — the exact stranding this table exists to
    end, reproduced inside the code written to end it.

    On its own session the failure is total instead of partial. Either
    the row is committed or it is not, and the caller's transaction is
    untouched either way.

    Requires the submission to be COMMITTED first: a separate session
    cannot see an uncommitted row, and the foreign key would reject it.
    Every caller already commits the submission before queueing.

    Still never raises — a queueing failure must not take down a submit
    that already succeeded.
    """
    try:
        async with get_session_factory()() as own:
            await own.execute(
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
            await own.commit()
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


async def _claim_queued(
    db: AsyncSession,
    limit: int,
    first: uuid.UUID | None = None,
) -> list[ExtractionJob]:
    """Atomically claim up to `limit` queued jobs.

    `FOR UPDATE SKIP LOCKED` is what makes two drains safe to run at
    once: each claims a disjoint set instead of both grabbing the same
    rows and billing the same Vision call twice.

    `first` jumps one submission to the head of the queue. Submit kicks a
    drain for the student who is at that moment watching a spinner, and
    jobs run one at a time — so under plain oldest-first that student
    lands LAST, behind every backlogged job, each a 5-15s Vision call.
    Twenty of those is past the client's 90-second timeout, and the
    student sees the "Couldn't prepare your check" screen this queue was
    built to eliminate. The migration backfill makes that concrete
    rather than theoretical: it stamps every pre-existing submission at
    the same `now()`, so the first student to submit after deploy is
    behind all of them.

    Oldest-first for everyone else, so a backlog still drains in the
    order students were kept waiting.
    """
    order = (
        [ExtractionJob.created_at.asc()]
        if first is None
        else [
            case((ExtractionJob.submission_id == first, 0), else_=1).asc(),
            ExtractionJob.created_at.asc(),
        ]
    )
    rows = (await db.execute(
        select(ExtractionJob)
        .where(ExtractionJob.status == STATUS_QUEUED)
        .order_by(*order)
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
    values: dict[str, Any] = {
        "status": status,
        "last_error": error,
        "updated_at": _now(),
    }
    if status == STATUS_QUEUED:
        # Going back to the queue is not finishing. Leaving `finished_at`
        # set — or `started_at` pointing at the claim that just failed —
        # would make a waiting job read as a completed one to anything
        # that renders these stamps. `_reclaim_stale` clears `started_at`
        # on its own requeue for the same reason.
        values["started_at"] = None
        values["finished_at"] = None
    else:
        values["finished_at"] = _now()

    async with get_session_factory()() as db:
        await db.execute(
            update(ExtractionJob)
            .where(ExtractionJob.id == job_id)
            .values(**values)
        )
        await db.commit()


async def _extract_one(job: ExtractionJob) -> str:
    """Run one job. Returns the tally key; never raises.

    This wrapper is what makes "never raises" true. Only the extraction
    call itself used to be guarded, so a blip in `_finish` or in the
    verification read propagated out of `drain()` — abandoning every job
    the same pass had already claimed, stranded in `running` until
    `_reclaim_stale` picked them up ten minutes later, and only if a
    drain ran at all. One bad job must not take the pass down with it.
    """
    try:
        return await _run_job(job)
    except Exception:
        logger.exception(
            "extraction job %s crashed outside the guarded call", job.id,
        )
        # Release the claim so the job is retryable now rather than in
        # ten minutes — but still on the budget. A job that reliably
        # crashes the bookkeeping would otherwise be requeued forever,
        # billing a Vision call every pass, which is precisely what
        # MAX_ATTEMPTS exists to prevent. If even this write fails,
        # `_reclaim_stale` is the backstop — which is why it exists.
        exhausted = job.attempts >= MAX_ATTEMPTS
        try:
            await _finish(
                job.id,
                status=STATUS_FAILED if exhausted else STATUS_QUEUED,
                error="drain crashed while handling this job",
            )
        except Exception:
            logger.exception("could not release extraction job %s", job.id)
        return _FAILED


async def _run_job(job: ExtractionJob) -> str:
    from api.routes.school_student_practice import run_extraction_for_submission

    # Re-check the toggles at drain time, not just at enqueue. The
    # enqueue-time gate is normally seconds old, but a backfilled row or
    # a job re-enqueued after parking can be days old, and a teacher may
    # have switched the feature off in between. A Vision call is the most
    # expensive thing this system does per submission; billing one
    # against a setting somebody deliberately turned off is not
    # defensible. Grading re-reads its own toggle for the same reason.
    async with get_session_factory()() as db:
        toggles = (await db.execute(
            select(
                Assignment.integrity_check_enabled,
                Assignment.ai_grading_enabled,
            ).where(Assignment.id == job.assignment_id)
        )).one_or_none()
    if toggles is not None and not (
        toggles.integrity_check_enabled or toggles.ai_grading_enabled
    ):
        await _finish(job.id, status=STATUS_DONE)
        return _SKIPPED

    try:
        await run_extraction_for_submission(job.submission_id)
    except Exception as exc:
        # Budget exhausted -> park for a human. Still in budget -> back to
        # the queue for the next drain, with the error kept on the row so
        # a human can see WHY it is retrying and not merely that it is.
        exhausted = job.attempts >= MAX_ATTEMPTS
        await _finish(
            job.id,
            status=STATUS_FAILED if exhausted else STATUS_QUEUED,
            error=_safe_error(exc),
        )
        # NOT `logger.exception` for a database error: the traceback it
        # prints ends in the same `StatementError` string, so it would
        # leak into the log stream exactly what `_safe_error` just kept
        # out of the column. Everything else keeps its traceback, which
        # is what makes an unfamiliar failure diagnosable.
        logger.error(
            "extraction job %s failed (attempt %d/%d) for submission %s: %s",
            job.id, job.attempts, MAX_ATTEMPTS, job.submission_id,
            _safe_error(exc),
            exc_info=not isinstance(exc, SQLAlchemyError),
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

    # No need to rule out a deleted submission here:
    # `extraction_jobs.submission_id` is ON DELETE CASCADE, so a deleted
    # submission takes its job row with it and there is nothing left to
    # drain. Reaching this line means the submission exists and the read
    # genuinely did not land.
    exhausted = job.attempts >= MAX_ATTEMPTS
    await _finish(
        job.id,
        status=STATUS_FAILED if exhausted else STATUS_QUEUED,
        error="extraction returned without writing a result",
    )
    return _FAILED


async def drain(
    limit: int = DEFAULT_DRAIN_LIMIT,
    first: uuid.UUID | None = None,
) -> dict[str, int]:
    """One drain pass. Safe to call concurrently with itself.

    `first` names a submission to run ahead of the queue — see
    `_claim_queued`. Submit passes the student it just accepted; the cron
    passes nothing and takes them oldest-first.
    """
    async with get_session_factory()() as db:
        reclaimed = await _reclaim_stale(db)
        await db.commit()
        claimed = await _claim_queued(db, limit, first)

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
        # Claimed, then found to owe nothing — the toggles went off.
        "skipped": tally[_SKIPPED],
        "failed": tally[_FAILED],
    }
