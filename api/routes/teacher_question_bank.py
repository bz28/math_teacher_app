"""Teacher question bank — CRUD + AI generation pipeline.

The bank is the pool of teacher-approved questions per course. Generation
runs as an in-process fire-and-forget asyncio task scheduled by the
generate endpoint and resolved by the question_bank_generation worker.
The frontend polls the job row for status.
"""

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.question_bank_chat import CHAT_SOFT_CAP, chat_with_bank_item
from api.core.question_bank_generation import regenerate_one, schedule_generation_job, snapshot_history
from api.database import get_db
from api.middleware.auth import CurrentUser, require_teacher
from api.models.course import Course
from api.models.question_bank import QuestionBankGenerationJob, QuestionBankItem
from api.routes.teacher_courses import get_teacher_course

router = APIRouter()

_VALID_STATUSES = {"pending", "approved", "rejected", "archived"}
_VALID_DIFFICULTIES = {"easy", "medium", "hard"}


# ── request shapes ──


class GenerateRequest(BaseModel):
    count: int
    unit_id: uuid.UUID | None = None
    document_ids: list[uuid.UUID] = []
    constraint: str | None = None  # natural-language extra instructions
    # difficulty intentionally absent: questions are modeled after the source
    # documents, and the teacher can specify difficulty in `constraint` if they
    # want it (e.g. "all hard" or "mostly easy").

    @field_validator("count")
    @classmethod
    def _validate_count(cls, v: int) -> int:
        if v < 1 or v > 50:
            raise ValueError("count must be between 1 and 50")
        return v


class UpdateBankItemRequest(BaseModel):
    question: str | None = None
    solution_steps: list[Any] | None = None
    final_answer: str | None = None
    difficulty: str | None = None
    unit_id: uuid.UUID | None = None
    clear_unit: bool = False


class RegenerateRequest(BaseModel):
    instructions: str | None = None


class ChatMessageRequest(BaseModel):
    message: str

    @field_validator("message")
    @classmethod
    def _validate(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Message cannot be empty")
        if len(v) > 2000:
            raise ValueError("Message too long (max 2000 chars)")
        return v


class ChatMessageIndexRequest(BaseModel):
    message_index: int


# ── helpers ──


async def _get_bank_item_for_teacher(
    db: AsyncSession, item_id: uuid.UUID, teacher_id: uuid.UUID,
) -> QuestionBankItem:
    item = (await db.execute(
        select(QuestionBankItem).where(QuestionBankItem.id == item_id)
    )).scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found")
    # Ownership: must be teacher of the course this item belongs to
    await get_teacher_course(db, item.course_id, teacher_id)
    return item


def _serialize_item(item: QuestionBankItem) -> dict[str, Any]:
    return {
        "id": str(item.id),
        "course_id": str(item.course_id),
        "unit_id": str(item.unit_id) if item.unit_id else None,
        "question": item.question,
        "solution_steps": item.solution_steps,
        "final_answer": item.final_answer,
        "difficulty": item.difficulty,
        "status": item.status,
        "source_doc_ids": item.source_doc_ids,
        "generation_prompt": item.generation_prompt,
        "has_previous_version": item.previous_question is not None,
        "chat_messages": item.chat_messages or [],
        "chat_soft_cap": CHAT_SOFT_CAP,
        "created_at": item.created_at.isoformat(),
        "updated_at": item.updated_at.isoformat(),
    }


def _serialize_job(job: QuestionBankGenerationJob) -> dict[str, Any]:
    return {
        "id": str(job.id),
        "course_id": str(job.course_id),
        "unit_id": str(job.unit_id) if job.unit_id else None,
        "status": job.status,
        "requested_count": job.requested_count,
        "difficulty": job.difficulty,
        "constraint": job.constraint,
        "produced_count": job.produced_count,
        "error_message": job.error_message,
        "created_at": job.created_at.isoformat(),
        "updated_at": job.updated_at.isoformat(),
    }


# ── list / get ──


@router.get("/courses/{course_id}/question-bank")
async def list_bank_items(
    course_id: uuid.UUID,
    status_filter: str | None = None,
    unit_id: uuid.UUID | None = None,
    difficulty: str | None = None,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await get_teacher_course(db, course_id, current_user.user_id)

    if status_filter is not None and status_filter not in _VALID_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid status filter (must be one of: {', '.join(sorted(_VALID_STATUSES))})",
        )
    if difficulty is not None and difficulty not in _VALID_DIFFICULTIES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid difficulty filter (must be one of: {', '.join(sorted(_VALID_DIFFICULTIES))})",
        )

    query = select(QuestionBankItem).where(QuestionBankItem.course_id == course_id)
    if status_filter:
        query = query.where(QuestionBankItem.status == status_filter)
    if unit_id:
        query = query.where(QuestionBankItem.unit_id == unit_id)
    if difficulty:
        query = query.where(QuestionBankItem.difficulty == difficulty)
    query = query.order_by(QuestionBankItem.created_at.desc())

    items = (await db.execute(query)).scalars().all()

    # Counts (always for the full bank, regardless of filter — used by the tab header).
    # GROUP BY in SQL so we don't pull every row just to count statuses.
    count_rows = (await db.execute(
        select(QuestionBankItem.status, func.count().label("c"))
        .where(QuestionBankItem.course_id == course_id)
        .group_by(QuestionBankItem.status)
    )).all()
    counts = {"pending": 0, "approved": 0, "rejected": 0, "archived": 0}
    for s, c in count_rows:
        if s in counts:
            counts[s] = c

    return {
        "items": [_serialize_item(i) for i in items],
        "counts": counts,
    }


# ── generation ──


@router.post("/courses/{course_id}/question-bank/generate", status_code=status.HTTP_202_ACCEPTED)
async def generate_bank_questions(
    course_id: uuid.UUID,
    body: GenerateRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await get_teacher_course(db, course_id, current_user.user_id)

    job = QuestionBankGenerationJob(
        course_id=course_id,
        unit_id=body.unit_id,
        created_by_id=current_user.user_id,
        status="queued",
        requested_count=body.count,
        # difficulty column is legacy — hardcoded so generate_questions still
        # gets a non-empty value but the teacher never picks it
        difficulty="mixed",
        constraint=body.constraint,
        source_doc_ids=[str(d) for d in body.document_ids] if body.document_ids else None,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    schedule_generation_job(job.id)
    return _serialize_job(job)


@router.get("/courses/{course_id}/question-bank/generation-jobs/{job_id}")
async def get_generation_job(
    course_id: uuid.UUID,
    job_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await get_teacher_course(db, course_id, current_user.user_id)
    job = (await db.execute(
        select(QuestionBankGenerationJob).where(
            QuestionBankGenerationJob.id == job_id,
            QuestionBankGenerationJob.course_id == course_id,
        )
    )).scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    return _serialize_job(job)


# ── per-item actions ──


@router.patch("/question-bank/{item_id}")
async def update_bank_item(
    item_id: uuid.UUID,
    body: UpdateBankItemRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    item = await _get_bank_item_for_teacher(db, item_id, current_user.user_id)

    # If any content fields are touched, snapshot the previous state for undo.
    content_changing = (
        body.question is not None
        or body.solution_steps is not None
        or body.final_answer is not None
    )
    if content_changing:
        snapshot_history(item)

    if body.question is not None:
        q = body.question.strip()
        if not q:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Question cannot be empty")
        item.question = q
    if body.solution_steps is not None:
        item.solution_steps = body.solution_steps
    if body.final_answer is not None:
        item.final_answer = body.final_answer
    if body.difficulty is not None:
        if body.difficulty not in ("easy", "medium", "hard"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid difficulty")
        item.difficulty = body.difficulty
    if body.clear_unit:
        item.unit_id = None
    elif body.unit_id is not None:
        item.unit_id = body.unit_id

    await db.commit()
    return {"status": "ok"}


@router.post("/question-bank/{item_id}/revert")
async def revert_bank_item(
    item_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Restore the previous_* snapshot. One level of undo only — after this
    call, previous_* is cleared so the teacher can't ping-pong forever."""
    item = await _get_bank_item_for_teacher(db, item_id, current_user.user_id)
    if item.previous_question is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No previous version to restore",
        )
    item.question = item.previous_question
    item.solution_steps = item.previous_solution_steps
    item.final_answer = item.previous_final_answer
    if item.previous_status:
        item.status = item.previous_status
    item.previous_question = None
    item.previous_solution_steps = None
    item.previous_final_answer = None
    item.previous_status = None
    await db.commit()
    return _serialize_item(item)


@router.post("/question-bank/{item_id}/approve")
async def approve_bank_item(
    item_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    item = await _get_bank_item_for_teacher(db, item_id, current_user.user_id)
    item.status = "approved"
    await db.commit()
    return {"status": "ok"}


@router.post("/question-bank/{item_id}/reject")
async def reject_bank_item(
    item_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    item = await _get_bank_item_for_teacher(db, item_id, current_user.user_id)
    item.status = "rejected"
    await db.commit()
    return {"status": "ok"}


@router.post("/question-bank/{item_id}/regenerate")
async def regenerate_bank_item(
    item_id: uuid.UUID,
    body: RegenerateRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    item = await _get_bank_item_for_teacher(db, item_id, current_user.user_id)
    course = (await db.execute(
        select(Course).where(Course.id == item.course_id)
    )).scalar_one()
    try:
        await regenerate_one(
            db, item, course,
            instructions=body.instructions,
            user_id=current_user.user_id,
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Regeneration failed: {e}",
        ) from e
    return _serialize_item(item)


@router.delete("/question-bank/{item_id}")
async def delete_bank_item(
    item_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    item = await _get_bank_item_for_teacher(db, item_id, current_user.user_id)
    await db.delete(item)
    await db.commit()
    return {"status": "ok"}


# ── workshop chat ──


@router.post("/question-bank/{item_id}/chat")
async def post_chat_message(
    item_id: uuid.UUID,
    body: ChatMessageRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Append a teacher message to the chat, call Claude, append the AI
    reply (with optional proposal). Returns the updated item.

    The proposal is NOT applied to live fields here — that only happens
    via /chat/accept."""
    item = await _get_bank_item_for_teacher(db, item_id, current_user.user_id)
    course = (await db.execute(select(Course).where(Course.id == item.course_id))).scalar_one()

    try:
        await chat_with_bank_item(
            db, item, course,
            teacher_message=body.message,
            user_id=current_user.user_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Chat failed: {e}",
        ) from e

    return _serialize_item(item)


@router.post("/question-bank/{item_id}/chat/accept")
async def accept_chat_proposal(
    item_id: uuid.UUID,
    body: ChatMessageIndexRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Apply the proposal attached to a specific AI message in the chat.
    Snapshots the current state to previous_* before mutating, marks the
    chat message as accepted."""
    item = await _get_bank_item_for_teacher(db, item_id, current_user.user_id)

    messages = list(item.chat_messages or [])
    if body.message_index < 0 or body.message_index >= len(messages):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid message index")
    msg = messages[body.message_index]
    if msg.get("role") != "ai":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Not an AI message")
    proposal = msg.get("proposal")
    if not proposal:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No proposal on this message")
    if msg.get("accepted") or msg.get("discarded"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Proposal already resolved")

    snapshot_history(item)

    if proposal.get("question") is not None:
        item.question = str(proposal["question"]).strip()
    if proposal.get("solution_steps") is not None:
        item.solution_steps = proposal["solution_steps"]
    if proposal.get("final_answer") is not None:
        item.final_answer = str(proposal["final_answer"])

    # Mark the message accepted (and any other pending proposals as superseded)
    for i, m in enumerate(messages):
        if i == body.message_index:
            m["accepted"] = True
        elif (
            m.get("role") == "ai"
            and m.get("proposal")
            and not m.get("accepted")
            and not m.get("discarded")
        ):
            m["superseded"] = True
    item.chat_messages = messages
    item.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return _serialize_item(item)


@router.post("/question-bank/{item_id}/chat/discard")
async def discard_chat_proposal(
    item_id: uuid.UUID,
    body: ChatMessageIndexRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Mark a proposal as discarded. No live content change."""
    item = await _get_bank_item_for_teacher(db, item_id, current_user.user_id)

    messages = list(item.chat_messages or [])
    if body.message_index < 0 or body.message_index >= len(messages):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid message index")
    msg = messages[body.message_index]
    if msg.get("role") != "ai" or not msg.get("proposal"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Not a proposal message")
    if msg.get("accepted") or msg.get("discarded"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Proposal already resolved")

    msg["discarded"] = True
    item.chat_messages = messages
    item.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return _serialize_item(item)


@router.post("/question-bank/{item_id}/chat/clear")
async def clear_chat(
    item_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Wipe the chat history for this item. Question/solution unchanged."""
    item = await _get_bank_item_for_teacher(db, item_id, current_user.user_id)
    item.chat_messages = []
    item.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return _serialize_item(item)
