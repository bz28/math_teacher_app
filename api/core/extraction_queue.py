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

import asyncio
import logging
import uuid
from collections import Counter
from datetime import UTC, datetime, timedelta
from typing import Any, cast

from sqlalchemy import CursorResult, func, literal, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.safe_errors import safe_error, traceback_is_safe
from api.database import get_session_factory
from api.models.assignment import Assignment, Submission
from api.models.extraction_job import (
    MAX_ATTEMPTS,
    STATUS_DONE,
    STATUS_FAILED,
    STATUS_QUEUED,
    STATUS_RUNNING,
    STATUS_SKIPPED,
    ExtractionJob,
)

logger = logging.getLogger(__name__)

DEFAULT_DRAIN_LIMIT = 20

# A ceiling on how much of the app's connection budget extraction may
# occupy, not a throughput knob — the same guard, and the same number,
# grading uses.
#
# It has to be module-level rather than per-drain. A single drain
# already runs its jobs one at a time, but submit spawns a drain PER
# SUBMISSION, so the number of concurrent drains is the number of
# students pressing Submit at once. `run_extraction_for_submission`
# holds a DB session open across the whole Vision call, and the pool is
# 10 + 20 overflow SHARED with live teacher and student traffic — so a
# class of thirty submitting together would otherwise pin every
# connection in the pool for minutes and hand teachers pool timeouts
# while they wait.
#
# Grading never needed this from its drain (cron-only, one at a time)
# and has it anyway; extraction is the one that is actually spawned per
# request, and shipped without it.
_MAX_CONCURRENT_EXTRACTIONS = 5
_SLOTS = asyncio.Semaphore(_MAX_CONCURRENT_EXTRACTIONS)

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


def _is_infrastructure_stop(exc: BaseException) -> bool:
    """Was this the platform saying "stop", rather than this submission
    being unreadable?

    Ported from `grading_queue`, where the same guard already exists and
    the same reasoning already applies. The daily spend cap and the LLM
    circuit breaker fire for every job in flight at once, and they mean
    "come back later", not "this one is broken".

    Charging them is not a small mistake here. `check_limit` raises
    before the request is made, so a capped platform fails jobs
    instantly and for free — and submit kicks a drain, so a burst of
    submissions after the cap is hit burns all three attempts on every
    queued job within minutes. `failed` is revived only by
    `enqueue_submission`, whose callers are the one-shot submit endpoint
    and a hand-run script. One afternoon at the cap would park the whole
    queue in a state nothing in the product recovers — the 2026-09-03
    stranding again, at class scale, inside the fix for it.

    Keyed on the exception TYPE, following grading's note that a
    substring match on the message never actually matched.
    """
    from api.core.cost_tracker import PlatformStopError

    return isinstance(exc, PlatformStopError)


async def enqueue_submission(
    submission_id: uuid.UUID,
    assignment: Assignment,
) -> str | None:
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

    Returns the row's resulting status, or None if nothing was written.
    That matters because the `running` guard below makes this a silent
    no-op for an in-flight job: an operator re-enqueueing what looks
    stuck would otherwise be told nothing and go on to drain, and a
    caller cannot distinguish "queued for you" from "left alone" without
    being told which happened.
    """
    try:
        async with get_session_factory()() as own:
            result = await own.execute(
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
                    # Never touch a job that is mid-flight. Resetting a
                    # `running` row frees a concurrent drain to claim it
                    # while the first Vision call is still going, so the
                    # same photos get read — and billed — twice, with
                    # whichever call commits last silently winning. The
                    # live trigger is the rescue script: its guards check
                    # the SUBMISSION (already extracted? confirmed?
                    # flagged?) and never the job's status, and a
                    # `running` row a few minutes old is exactly what
                    # "stuck" looks like to an operator at 2am.
                    where=ExtractionJob.status != STATUS_RUNNING,
                    set_={
                        "status": STATUS_QUEUED,
                        "attempts": 0,
                        "last_error": None,
                        "started_at": None,
                        "finished_at": None,
                        "updated_at": _now(),
                    },
                )
                .returning(ExtractionJob.status)
            )
            await own.commit()
            written = result.scalar_one_or_none()
        if written is not None:
            return str(written)
        # The upsert's WHERE excluded the row: it is `running`, and a
        # drain owns it.
        async with get_session_factory()() as own:
            return (await own.execute(
                select(ExtractionJob.status).where(
                    ExtractionJob.submission_id == submission_id,
                )
            )).scalar_one_or_none()
    except Exception:
        logger.exception(
            "failed to enqueue extraction for submission %s", submission_id,
        )
        return None


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


async def _claim_one(
    db: AsyncSession,
    *,
    prefer: uuid.UUID | None = None,
    only: uuid.UUID | None = None,
    exclude: set[uuid.UUID] | None = None,
) -> ExtractionJob | None:
    """Claim exactly ONE queued job, or return None if there is none.

    One at a time, deliberately. The previous version claimed the whole
    pass up front — up to twenty rows stamped `running` with
    `started_at = now()` — and then worked them sequentially. The
    twentieth job did not begin until nineteen Vision calls had
    finished, but it had been wearing a ten-minute-old `started_at` the
    entire time.

    `STALE_RUNNING_MINUTES` is dimensioned for ONE call ("Vision calls
    take 5-15s ... ten minutes is far past slow"), so the tail of a batch
    crossed it routinely, `_reclaim_stale` handed the job to another
    drain, and the same submission was read and BILLED twice
    concurrently. The already-extracted guard cannot catch that: neither
    run has written yet.

    Grading gets away with the batch shape because its cron is the only
    thing that drains and GitHub's concurrency group serialises it — no
    second drain exists to do the reclaiming. Extraction spawns a drain
    on every submit, so an overlapping drain is not a risk, it is the
    normal case. Claiming one at a time makes `started_at` mean what
    `_reclaim_stale` reads it as: the moment work actually began.

    `only` claims that submission or nothing. `prefer` tries it first and
    falls back to oldest-first.

    `exclude` holds the jobs this pass has already run. Claiming one at a
    time means a job that fails and goes back to `queued` is immediately
    available again — so without this it would be re-claimed by the same
    pass and spend its entire retry budget in one go, on the one set of
    conditions, in seconds. The budget is meant to be spread across
    drains so a transient cause has time to clear. The batch claim got
    this for free by taking every row up front; doing it one at a time
    means saying so.
    """
    def _pick(*extra: Any) -> Any:
        return (
            select(ExtractionJob)
            .where(
                ExtractionJob.status == STATUS_QUEUED,
                ExtractionJob.id.notin_(exclude or set()),
                *extra,
            )
            .order_by(ExtractionJob.created_at.asc())
            .limit(1)
            .with_for_update(skip_locked=True)
        )

    job: ExtractionJob | None = None
    if only is not None:
        # Exactly this one. Used by the rescue script, where running
        # somebody else's job instead is worse than doing nothing.
        job = (await db.execute(
            _pick(ExtractionJob.submission_id == only)
        )).scalars().first()
    else:
        if prefer is not None:
            # A one-row hit on the unique `submission_id` index. This
            # used to be a CASE in the ORDER BY, which no index can
            # serve — it turned every submit-kicked claim into a full
            # sort of the queue.
            job = (await db.execute(
                _pick(ExtractionJob.submission_id == prefer)
            )).scalars().first()
        if job is None:
            job = (await db.execute(_pick())).scalars().first()

    if job is None:
        return None

    job.status = STATUS_RUNNING
    job.started_at = _now()
    job.attempts += 1
    await db.commit()
    return job


async def _finish(
    job_id: uuid.UUID,
    *,
    status: str,
    error: str | None = None,
    refund_attempt: bool = False,
) -> None:
    """Stamp a job's terminal state on its own session.

    Its own session because the extraction that just ran opened and
    closed one of its own; reusing that would mean holding a connection
    across a 15-second Vision call.

    `refund_attempt` gives back the attempt `_claim_one` took on the
    way in, so a platform-level stop costs time and nothing else. See
    `_is_infrastructure_stop`.
    """
    values: dict[str, Any] = {
        "status": status,
        "last_error": error,
        "updated_at": _now(),
    }
    if refund_attempt:
        # Floored, matching grading's `max(0, ...)`. Two refunds racing
        # on one row would otherwise drive the count negative and hand
        # the job an unbounded budget.
        values["attempts"] = func.greatest(0, ExtractionJob.attempts - 1)
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
            .where(
                ExtractionJob.id == job_id,
                # A coarse guard, and worth being precise about what it
                # does: it stops a NON-TERMINAL verdict landing on a row
                # that has already moved on — a requeue or a park written
                # over a job some other drain has since claimed.
                #
                # It is NOT proof of ownership. A job handed to another
                # drain by `_reclaim_stale` is also `running`, so this
                # predicate passes; distinguishing those would need a
                # claim token, which is more machinery than the failure
                # justifies.
                #
                # `done` is exempt deliberately. A landed extraction is
                # ground truth — the read exists, whoever produced it —
                # and suppressing it would leave a healthy submission
                # parked as `failed` with nothing to correct the record,
                # which is exactly the "work is owed and nobody knows"
                # state this table exists to prevent.
                or_(
                    ExtractionJob.status == STATUS_RUNNING,
                    literal(status == STATUS_DONE),
                ),
            )
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
    except Exception as exc:
        # NOT `logger.exception`. This handler catches whatever escaped
        # `_run_job`, and the likeliest way that happens is `_finish`
        # failing while a database error from the extraction write is
        # still the active context — so the traceback would carry the
        # bound parameters, and the student's transcribed homework with
        # them. See `traceback_is_safe`.
        logger.error(
            "extraction job %s crashed outside the guarded call: %s",
            job.id, safe_error(exc),
            exc_info=traceback_is_safe(exc),
        )
        # Did the read actually land before the crash? The likeliest
        # thing to escape `_run_job` is `_finish` failing right AFTER a
        # successful extraction, and parking that as `failed` would
        # leave a submission whose read exists on disk reading
        # "abandoned" forever, with nothing to correct it — the mirror
        # of the case `_finish` exempts `done` for.
        try:
            async with get_session_factory()() as db:
                landed = (await db.execute(
                    select(Submission.extraction).where(
                        Submission.id == job.submission_id,
                    )
                )).scalar_one_or_none()
        except Exception:
            landed = None

        if landed:
            try:
                await _finish(job.id, status=STATUS_DONE)
            except Exception:
                logger.exception("could not close extraction job %s", job.id)
            return _DONE

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
        # Not `done` — nothing was read, and a row saying `done` would
        # tell an operator a read exists when no call was ever made.
        await _finish(job.id, status=STATUS_SKIPPED)
        return _SKIPPED

    # Never re-read a submission that already has an extraction. A job
    # can legitimately return to `queued` AFTER the read landed — the
    # `_finish` stamp can fail on a connection blip, and a worker can
    # die between the extraction's commit and its own bookkeeping, in
    # which case `_reclaim_stale` requeues it. Without this guard the
    # retry bills a SECOND Vision call and overwrites the first read.
    #
    # That is worse than the cost. By then the student may have
    # confirmed, and their corrections are keyed "{problem}:{step}"
    # against the read they were shown — a fresh read renumbers the
    # steps, so the edits land on the wrong ones or vanish, and
    # integrity and grading then run on work the student never approved.
    # Grading guards the same way, one layer down, by skipping a
    # submission that already has a score.
    async with get_session_factory()() as db:
        already = (await db.execute(
            select(Submission.extraction).where(
                Submission.id == job.submission_id,
            )
        )).scalar_one_or_none()
    if already:
        await _finish(job.id, status=STATUS_DONE)
        return _DONE

    try:
        await run_extraction_for_submission(job.submission_id)
    except Exception as exc:
        # Budget exhausted -> park for a human. Still in budget -> back to
        # the queue for the next drain, with the error kept on the row so
        # a human can see WHY it is retrying and not merely that it is.
        # A platform stop is not this submission's fault: refund the
        # attempt and leave it queued, so the job is exactly where it
        # was once the cap resets or the breaker closes.
        stopped = _is_infrastructure_stop(exc)
        exhausted = not stopped and job.attempts >= MAX_ATTEMPTS
        await _finish(
            job.id,
            status=STATUS_FAILED if exhausted else STATUS_QUEUED,
            error=safe_error(exc),
            refund_attempt=stopped,
        )
        # NOT `logger.exception` for a database error: the traceback it
        # prints ends in the same `StatementError` string, so it would
        # leak into the log stream exactly what `safe_error` just kept
        # out of the column. Everything else keeps its traceback, which
        # is what makes an unfamiliar failure diagnosable.
        logger.error(
            "extraction job %s failed (attempt %d/%d) for submission %s: %s",
            job.id, job.attempts, MAX_ATTEMPTS, job.submission_id,
            safe_error(exc),
            exc_info=traceback_is_safe(exc),
        )
        return _FAILED

    # Success is confirmed by re-reading, not by the call not raising.
    # It does raise on failure now — but it also returns EARLY and
    # quietly when the submission or its assignment has gone, so
    # "returned without an exception" is not the same as "a read
    # landed". Without this check that gap would be recorded as `done`
    # and the student would stay stuck while the queue insisted the work
    # was finished.
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
    only: uuid.UUID | None = None,
) -> dict[str, int]:
    """One drain pass. Safe to call concurrently with itself.

    `first` runs one submission ahead of the queue and then carries on
    with the rest — what submit wants for the student now watching a
    spinner. `only` runs that submission or nothing at all — what the
    rescue script wants, where working somebody else's job instead is
    worse than reporting that nothing could be done.
    """
    async with get_session_factory()() as db:
        reclaimed = await _reclaim_stale(db)
        await db.commit()

    tally: Counter[str] = Counter()
    claimed = 0
    prefer = first
    seen: set[uuid.UUID] = set()

    # Claim-then-work, one job at a time, rather than claiming the whole
    # pass up front — see `_claim_one` for why that matters to
    # `_reclaim_stale`.
    #
    # Sequential, not gathered: each job is a full Vision call on
    # multi-megabyte photos, and running twenty at once would spike both
    # memory and the provider's rate limit for no latency benefit that
    # matters — nobody is watching this run.
    # `max(0, ...)`, not `max(1, ...)`: asking for zero jobs must run
    # zero, not one. The route clamps its input so this was latent, but
    # a caller that computes a limit and lands on 0 should get nothing.
    for _ in range(max(0, limit)):
        # The slot is taken BEFORE the claim, so a drain queueing for
        # capacity is holding nothing. Acquiring it after the claim
        # meant a job could sit `running` with a `started_at` from
        # before its wait — and once that wait pushed it past
        # STALE_RUNNING_MINUTES, `_reclaim_stale` would hand a
        # mid-flight job to another drain and the submission would be
        # read, and billed, twice. That is the same failure the
        # one-at-a-time claim removed, reintroduced by the semaphore.
        async with _SLOTS:
            async with get_session_factory()() as db:
                job = await _claim_one(
                    db, prefer=prefer, only=only, exclude=seen,
                )
            if job is None:
                break
            prefer = None
            seen.add(job.id)
            claimed += 1
            tally.update([await _extract_one(job)])
        if only is not None:
            break

    return {
        "reclaimed": reclaimed,
        "claimed": claimed,
        "succeeded": tally[_DONE],
        # Claimed, then found to owe nothing — the toggles went off.
        "skipped": tally[_SKIPPED],
        "failed": tally[_FAILED],
    }
