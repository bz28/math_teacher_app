"""Question bank generation orchestrator.

Wraps the existing assignment_generation pipeline (which already does
question generation + parallel solution decomposition via Claude Vision)
and persists results into question_bank_items + tracks progress on
question_bank_generation_jobs.

Runs as a fire-and-forget asyncio task scheduled by the routes layer.
The task uses its own DB session — the request session is closed by
the time the task is awaited.
"""

import asyncio
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.assignment_generation import generate_questions, generate_solutions
from api.core.document_vision import MAX_VISION_IMAGES, fetch_document_images
from api.database import get_session_factory
from api.models.course import Course
from api.models.question_bank import QuestionBankGenerationJob, QuestionBankItem
from api.models.unit import Unit

logger = logging.getLogger(__name__)


# Track in-flight tasks so they aren't garbage-collected mid-flight.
_inflight: set[asyncio.Task[None]] = set()


def schedule_generation_job(job_id: uuid.UUID) -> None:
    """Schedule a generation job to run as a fire-and-forget task.

    Called from the route handler after the job row is committed. The
    task picks up the job, runs Claude, writes results, and updates the
    job's status. Lost if the process restarts mid-task — acceptable
    for v1.
    """
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.warning("No running event loop — cannot schedule generation job %s", job_id)
        return

    task = loop.create_task(_run_job(job_id))
    _inflight.add(task)
    task.add_done_callback(_inflight.discard)


async def _run_job(job_id: uuid.UUID) -> None:
    """The actual generation worker. Owns its own DB session."""
    factory = get_session_factory()
    async with factory() as db:
        job = (await db.execute(
            select(QuestionBankGenerationJob).where(QuestionBankGenerationJob.id == job_id)
        )).scalar_one_or_none()
        if not job:
            logger.error("Generation job %s not found", job_id)
            return

        try:
            await _execute(db, job)
        except Exception as e:
            logger.exception("Generation job %s failed", job_id)
            job.status = "failed"
            job.error_message = str(e)[:1000]
            job.updated_at = datetime.now(timezone.utc)
            await db.commit()


async def _execute(db: AsyncSession, job: QuestionBankGenerationJob) -> None:
    """Run the actual Claude calls and persist results.

    Status transitions: queued -> running -> done (or failed via _run_job).
    """
    job.status = "running"
    job.updated_at = datetime.now(timezone.utc)
    await db.commit()

    # Course context for the prompt
    course = (await db.execute(
        select(Course).where(Course.id == job.course_id)
    )).scalar_one()

    # Unit name (or fall back to course name if no unit)
    unit_name = course.name
    if job.unit_id:
        unit = (await db.execute(
            select(Unit).where(Unit.id == job.unit_id)
        )).scalar_one_or_none()
        if unit:
            unit_name = unit.name

    # Fetch document images for vision context
    doc_ids = [uuid.UUID(d) for d in (job.source_doc_ids or [])]
    images = await fetch_document_images(
        db, doc_ids, job.course_id, max_images=MAX_VISION_IMAGES,
    )

    # 1. Generate question texts
    question_dicts = await generate_questions(
        unit_name=unit_name,
        difficulty=job.difficulty,
        count=job.requested_count,
        course_name=course.name,
        subject=course.subject,
        user_id=str(job.created_by_id),
        images=images or None,
        extra_instructions=job.constraint,
    )

    if not question_dicts:
        raise RuntimeError(
            "The AI didn't return any questions. Try adjusting your instructions or selecting different source documents."
        )

    # 2. Solve each question in parallel (capped concurrency inside)
    solved = await generate_solutions(
        question_dicts,
        subject=course.subject,
        user_id=str(job.created_by_id),
    )

    # 3. Persist as bank items (status = pending). Commit in batches of
    # PROGRESS_BATCH so the frontend's polling banner shows real progress
    # without N+1 transactions on every single question.
    PROGRESS_BATCH = 5
    source_doc_id_strs = [str(d) for d in doc_ids] if doc_ids else None
    for idx, (q, s) in enumerate(zip(question_dicts, solved), start=1):
        item = QuestionBankItem(
            course_id=job.course_id,
            unit_id=job.unit_id,
            question=q["text"],
            solution_steps=s.get("steps") or None,
            final_answer=s.get("final_answer"),
            difficulty=q.get("difficulty") or job.difficulty,
            status="pending",
            source_doc_ids=source_doc_id_strs,
            generation_prompt=job.constraint,
            created_by_id=job.created_by_id,
        )
        db.add(item)
        if idx % PROGRESS_BATCH == 0:
            job.produced_count = idx
            job.updated_at = datetime.now(timezone.utc)
            await db.commit()

    job.status = "done"
    job.produced_count = len(question_dicts)
    job.updated_at = datetime.now(timezone.utc)
    await db.commit()
    logger.info("Generation job %s produced %d questions", job.id, len(question_dicts))


async def regenerate_one(
    db: AsyncSession,
    item: QuestionBankItem,
    course: Course,
    *,
    instructions: str | None,
    user_id: uuid.UUID,
) -> None:
    """Synchronously regenerate a single bank item, optionally with NL
    instructions ("make the numbers smaller", "redo just the solution").

    The original item is overwritten in place and reset to pending status.
    Single-question regeneration is fast enough to do inline — no job row.
    """
    unit_name = course.name
    if item.unit_id:
        unit = (await db.execute(
            select(Unit).where(Unit.id == item.unit_id)
        )).scalar_one_or_none()
        if unit:
            unit_name = unit.name

    doc_ids = [uuid.UUID(d) for d in (item.source_doc_ids or [])]
    images = await fetch_document_images(
        db, doc_ids, item.course_id, max_images=MAX_VISION_IMAGES,
    )

    # The constraint passed to Claude carries both the original generation
    # prompt and the new instructions, so the regenerated question stays
    # consistent with the rest of the bank.
    parts = []
    if item.generation_prompt:
        parts.append(item.generation_prompt)
    if instructions:
        parts.append(f"For this regeneration: {instructions.strip()}")
    parts.append(f"Original question to revise: {item.question}")
    extra = "\n\n".join(parts)

    new_qs = await generate_questions(
        unit_name=unit_name,
        difficulty=item.difficulty,
        count=1,
        course_name=course.name,
        subject=course.subject,
        user_id=str(user_id),
        images=images or None,
        extra_instructions=extra,
    )
    if not new_qs:
        raise RuntimeError("Regeneration returned no questions")

    solved = await generate_solutions(
        new_qs[:1], subject=course.subject, user_id=str(user_id),
    )

    item.question = new_qs[0]["text"]
    item.difficulty = new_qs[0].get("difficulty") or item.difficulty
    item.solution_steps = solved[0].get("steps") or None
    item.final_answer = solved[0].get("final_answer")
    item.status = "pending"
    item.updated_at = datetime.now(timezone.utc)
    await db.commit()
