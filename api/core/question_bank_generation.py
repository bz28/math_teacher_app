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
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.assignment_generation import generate_questions, generate_solutions
from api.core.document_vision import MAX_VISION_IMAGES, build_vision_content, fetch_document_images
from api.core.llm_client import MODEL_REASON, LLMMode, call_claude_json, call_claude_vision
from api.core.llm_schemas import GENERATE_QUESTIONS_SCHEMA, REGENERATE_QA_SCHEMA
from api.core.practice import generate_distractors
from api.core.subjects import get_config
from api.database import get_session_factory
from api.models.course import Course
from api.models.question_bank import QuestionBankGenerationJob, QuestionBankItem
from api.models.unit import Unit

logger = logging.getLogger(__name__)


# Track in-flight tasks so they aren't garbage-collected mid-flight.
_inflight: set[asyncio.Task[None]] = set()

# Commit every N persisted questions during bulk generation so the
# frontend polling banner ticks visibly without N+1 transactions.
_PROGRESS_BATCH = 5


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
            job.updated_at = datetime.now(UTC)
            await db.commit()


_EXTRACT_WORKSHEET_TEMPLATE = """\
You are a {professor_role} extracting problems from a teacher's worksheet.

The teacher has uploaded images of an existing worksheet or problem set.
Extract every individual problem exactly as written — do NOT rewrite,
simplify, or invent new problems. Preserve the original wording and
any LaTeX notation.

Rules:
- Extract each problem as a separate item
- Use LaTeX with $ delimiters for math expressions
- Use single backslashes for LaTeX commands (e.g. \\frac, \\sqrt)
- If a problem references a diagram or figure, describe it in brackets
  at the end of the problem text (same as image extraction rules)
- Skip headers, instructions, page numbers, and non-problem text
- If you cannot read something clearly, skip it rather than guessing
- Rate each problem's difficulty based on the content
- Extract at most 40 problems. If the worksheet has more, extract the
  first 40 and stop.
"""


async def _extract_from_images(
    images: list[dict[str, str]],
    *,
    subject: str,
    user_id: str,
) -> list[dict[str, str]]:
    """Extract problems from worksheet images via Claude Vision.

    Returns list of {"title", "text", "difficulty"} — same shape as
    generate_questions() so the downstream pipeline is unchanged.
    """
    cfg = get_config(subject)
    system_prompt = _EXTRACT_WORKSHEET_TEMPLATE.format(
        professor_role=cfg["professor_role"],
    )

    content: list[dict[str, Any]] = []
    for img in images:
        content.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": img["media_type"],
                "data": img["data"],
            },
        })
    content.append({
        "type": "text",
        "text": (
            f"{system_prompt}\n\n"
            "Extract all problems from the worksheet images above."
        ),
    })

    result = await call_claude_vision(
        content,
        mode=LLMMode.BANK_EXTRACT,
        tool_schema=GENERATE_QUESTIONS_SCHEMA,
        user_id=user_id,
        model=MODEL_REASON,
        max_tokens=4096,
    )

    questions: list[Any] = result.get("questions", [])  # type: ignore[assignment]
    normalized = []
    for q in questions:
        if not isinstance(q, dict) or "text" not in q:
            continue
        normalized.append({
            "title": str(q.get("title") or "")[:120],
            "text": str(q["text"]),
            "difficulty": str(q.get("difficulty", "medium")),
        })
    return normalized


async def _execute(db: AsyncSession, job: QuestionBankGenerationJob) -> None:
    """Run the actual Claude calls and persist results.

    Status transitions: queued -> running -> done (or failed via _run_job).
    """
    job.status = "running"
    job.updated_at = datetime.now(UTC)
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

    # 1. Get question texts — either extract from uploaded images or
    # generate via AI, depending on job mode.
    if job.mode == "upload":
        # Upload mode: extract problems from worksheet images stored on
        # the job row. Images are [{data, media_type}].
        raw_images = job.uploaded_images or []
        if not raw_images:
            raise RuntimeError("No images found on upload job")
        question_dicts = await _extract_from_images(
            raw_images,
            subject=course.subject,
            user_id=str(job.created_by_id),
        )
        if not question_dicts:
            raise RuntimeError(
                "No problems could be extracted from the uploaded images. "
                "Make sure the images are clear and contain readable problems."
            )
        # Set requested_count to actual extracted count (was 0 at creation)
        job.requested_count = len(question_dicts)
    else:
        # Generate mode: AI invents new questions
        doc_ids = [uuid.UUID(d) for d in (job.source_doc_ids or [])]
        images = await fetch_document_images(
            db, doc_ids, job.course_id, max_images=MAX_VISION_IMAGES,
        )

        constraint_text = job.constraint
        if job.parent_question_id:
            parent = (await db.execute(
                select(QuestionBankItem).where(QuestionBankItem.id == job.parent_question_id)
            )).scalar_one_or_none()
            if not parent:
                raise RuntimeError(
                    "Parent question was deleted before its variations could be generated"
                )
            seed_block = (
                "Generate questions that are SIMILAR TO but DIFFERENT FROM "
                "this reference question. Match the same topic, difficulty, "
                "and pedagogical style, but use different numbers, contexts, "
                "or framing so each variation is its own problem.\n\n"
                f"Reference question:\n{parent.question}"
            )
            constraint_text = (
                f"{seed_block}\n\nAdditional constraint: {job.constraint}"
                if job.constraint else seed_block
            )

        question_dicts = await generate_questions(
            unit_name=unit_name,
            count=job.requested_count,
            course_name=course.name,
            subject=course.subject,
            user_id=str(job.created_by_id),
            images=images or None,
            extra_instructions=constraint_text,
        )
        if not question_dicts:
            raise RuntimeError(
                "The AI didn't return any questions. Try adjusting your "
                "instructions or selecting different source documents."
            )

    # 2. Solve each question in parallel (capped concurrency inside)
    solved = await generate_solutions(
        question_dicts,
        subject=course.subject,
        user_id=str(job.created_by_id),
    )

    # 2b. Generate 3 MCQ distractors per question. Stored on the bank
    # item so the school-student practice loop can serve MCQs with
    # zero LLM calls per kid — the teacher pays for distractor
    # generation once at publish time. Capped concurrency mirrors the
    # solve step. On failure for any one item we keep an empty list
    # rather than blocking the whole job; the consuming endpoint can
    # decide how to render that case.
    distractors_sem = asyncio.Semaphore(5)

    async def make_distractors(idx: int, q: dict[str, Any], s: dict[str, Any]) -> list[str]:
        final = s.get("final_answer")
        if not final or final.startswith("(solution failed"):
            return []
        async with distractors_sem:
            try:
                return await generate_distractors(
                    q["text"],
                    final,
                    user_id=str(job.created_by_id),
                    subject=course.subject,
                )
            except Exception:
                logger.warning("Distractor generation failed for question %d in job %s", idx, job.id)
                return []

    distractor_lists = await asyncio.gather(
        *[make_distractors(i, q, s) for i, (q, s) in enumerate(zip(question_dicts, solved))]
    )

    # 3. Persist as bank items (status = pending). Commit in batches of
    # _PROGRESS_BATCH so the frontend's polling banner shows real progress
    # without N+1 transactions on every single question.
    source_doc_id_strs = (
        [str(d) for d in job.source_doc_ids] if job.source_doc_ids else None
    )
    # Provenance: upload → imported, generate-similar → practice, else generated
    if job.mode == "upload":
        item_source = "imported"
    elif job.parent_question_id:
        item_source = "practice"
    else:
        item_source = "generated"

    for idx, (q, s) in enumerate(zip(question_dicts, solved), start=1):
        item = QuestionBankItem(
            course_id=job.course_id,
            unit_id=job.unit_id,
            # Stamp every produced item with the job's originating HW.
            # This is how the HW detail banner filters pending items
            # and how approved items know which HW to auto-attach to.
            originating_assignment_id=job.originating_assignment_id,
            title=q.get("title") or None,
            question=q["text"],
            solution_steps=s.get("steps") or None,
            final_answer=s.get("final_answer"),
            distractors=distractor_lists[idx - 1] or None,
            difficulty=q.get("difficulty") or "medium",
            status="pending",
            source_doc_ids=source_doc_id_strs,
            generation_prompt=job.constraint,
            created_by_id=job.created_by_id,
            parent_question_id=job.parent_question_id,
            source=item_source,
        )
        db.add(item)
        if idx % _PROGRESS_BATCH == 0:
            job.produced_count = idx
            job.updated_at = datetime.now(UTC)
            await db.commit()

    job.status = "done"
    job.produced_count = len(question_dicts)
    job.updated_at = datetime.now(UTC)
    await db.commit()
    logger.info("Generation job %s produced %d questions", job.id, len(question_dicts))


def snapshot_history(item: QuestionBankItem) -> None:
    """Capture the current state into the previous_* columns so the teacher
    has a one-level undo. Called by both manual edits and AI regenerations
    just before mutating the live fields."""
    item.previous_question = item.question
    item.previous_solution_steps = item.solution_steps
    item.previous_final_answer = item.final_answer
    item.previous_status = item.status


_REGENERATE_SYSTEM_TEMPLATE = """\
You are a {professor_role} revising a single problem for a teacher's question bank.

Return one question with its complete worked solution and final answer. The
solution must be step-by-step and pedagogically clear. Use LaTeX with $ delimiters
for math expressions. Use single backslashes for LaTeX commands (e.g. \\frac, \\sqrt,
\\begin{{pmatrix}}). Do not double-escape.

Each step must have a short title (2-5 words) and a full description.
"""


async def regenerate_one(
    db: AsyncSession,
    item: QuestionBankItem,
    course: Course,
    *,
    instructions: str | None,
    user_id: uuid.UUID,
) -> None:
    """Synchronously regenerate a single bank item with one Claude call.

    Behaviour:
    - One combined Claude call returns question + solution + final answer.
    - When instructions is empty, we DROP the "original question to revise"
      anchor entirely and ask for a fresh take on the same topic. When
      instructions is provided, we include the original so Claude can build
      on it.
    - Approved questions stay approved if the teacher is just polishing
      (status preservation). Pending questions stay pending.
    - The previous version is snapshotted to previous_* columns so the
      teacher can undo via /revert.
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

    cfg = get_config(course.subject)
    system_prompt = _REGENERATE_SYSTEM_TEMPLATE.format(professor_role=cfg["professor_role"])

    # User message: include the topic + original constraint always; only
    # include the original question + instructions when the teacher provided
    # specific instructions to revise it.
    parts: list[str] = [
        f"Course: {course.name}",
        f"Topic: {unit_name}",
    ]
    if item.generation_prompt:
        parts.append(f"Original generation constraint: {item.generation_prompt}")

    has_instructions = bool(instructions and instructions.strip())
    if has_instructions:
        parts.append(f"Original question:\n{item.question}")
        parts.append(f"Revise it according to these instructions:\n{instructions.strip()}")  # type: ignore[union-attr]
    else:
        parts.append(
            "Generate a fresh question on the same topic and constraint. "
            "Do not reuse the original question's wording."
        )

    user_message = "\n\n".join(parts)

    try:
        if images:
            content = build_vision_content(images, user_message)
            result = await call_claude_vision(
                content,
                mode=LLMMode.REGENERATE_BANK_ITEM,
                tool_schema=REGENERATE_QA_SCHEMA,
                user_id=str(user_id),
                model=MODEL_REASON,
                max_tokens=4096,
            )
        else:
            result = await call_claude_json(
                system_prompt,
                user_message,
                mode=LLMMode.REGENERATE_BANK_ITEM,
                tool_schema=REGENERATE_QA_SCHEMA,
                user_id=str(user_id),
                model=MODEL_REASON,
                max_tokens=4096,
            )
    except Exception as e:
        raise RuntimeError(f"AI revision failed: {e}") from e

    new_title = result.get("title")
    new_question = result.get("question")
    new_steps = result.get("solution_steps")
    new_answer = result.get("final_answer")
    if not new_question:
        raise RuntimeError("AI revision returned no question text")

    snapshot_history(item)
    if new_title:
        item.title = str(new_title)[:120]
    item.question = str(new_question)
    item.solution_steps = new_steps if isinstance(new_steps, list) else None
    item.final_answer = str(new_answer) if new_answer else None
    # Regenerate distractors to match the new question/answer. The old
    # distractors were keyed off the old wrong-answer patterns and would
    # be misleading on the new problem. Failure here is non-fatal —
    # we drop to None and let the next student-facing fetch handle it.
    if item.final_answer:
        try:
            item.distractors = await generate_distractors(
                item.question,
                item.final_answer,
                user_id=str(user_id),
                subject=course.subject,
            ) or None
        except Exception:
            logger.warning("Distractor regeneration failed for item %s", item.id)
            item.distractors = None
    else:
        item.distractors = None
    # Status is preserved (approved stays approved). New rows from /generate
    # already start as pending; this only affects already-curated items.
    item.updated_at = datetime.now(UTC)
    await db.commit()
