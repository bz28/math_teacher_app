"""Teacher question bank — CRUD + AI generation pipeline.

The bank is the pool of teacher-approved questions per course. Generation
runs as an in-process fire-and-forget asyncio task scheduled by the
generate endpoint and resolved by the question_bank_generation worker.
The frontend polls the job row for status.
"""

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.question_bank_generation import regenerate_one, schedule_generation_job
from api.database import get_db
from api.middleware.auth import CurrentUser, require_teacher
from api.models.course import Course
from api.models.question_bank import QuestionBankGenerationJob, QuestionBankItem
from api.routes.teacher_courses import get_teacher_course

router = APIRouter()


# ── request shapes ──


class GenerateRequest(BaseModel):
    count: int
    difficulty: str = "mixed"
    unit_id: uuid.UUID | None = None
    document_ids: list[uuid.UUID] = []
    constraint: str | None = None  # natural-language extra instructions

    @field_validator("count")
    @classmethod
    def _validate_count(cls, v: int) -> int:
        if v < 1 or v > 50:
            raise ValueError("count must be between 1 and 50")
        return v

    @field_validator("difficulty")
    @classmethod
    def _validate_difficulty(cls, v: str) -> str:
        if v not in ("easy", "medium", "hard", "mixed"):
            raise ValueError("difficulty must be one of: easy, medium, hard, mixed")
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

    query = select(QuestionBankItem).where(QuestionBankItem.course_id == course_id)
    if status_filter:
        query = query.where(QuestionBankItem.status == status_filter)
    if unit_id:
        query = query.where(QuestionBankItem.unit_id == unit_id)
    if difficulty:
        query = query.where(QuestionBankItem.difficulty == difficulty)
    query = query.order_by(QuestionBankItem.created_at.desc())

    items = (await db.execute(query)).scalars().all()

    # Counts (always compute, regardless of filter — used by the tab header)
    counts_query = await db.execute(
        select(QuestionBankItem.status, QuestionBankItem.id).where(
            QuestionBankItem.course_id == course_id
        )
    )
    counts = {"pending": 0, "approved": 0, "rejected": 0, "archived": 0}
    for s, _ in counts_query.all():
        if s in counts:
            counts[s] += 1

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
        difficulty=body.difficulty,
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
