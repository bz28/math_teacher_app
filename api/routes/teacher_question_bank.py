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
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.image_utils import validate_and_decode_image
from api.core.question_bank_chat import CHAT_SOFT_CAP, chat_with_bank_item
from api.core.question_bank_generation import regenerate_one, schedule_generation_job, snapshot_history
from api.database import get_db
from api.middleware.auth import CurrentUser, require_teacher
from api.models.course import Course
from api.models.question_bank import QuestionBankGenerationJob, QuestionBankItem
from api.routes.teacher_assignments import get_teacher_assignment
from api.routes.teacher_courses import get_teacher_course
from api.services.bank import snapshot_bank_items, used_in_assignments_map, used_in_for_item


def _ensure_unlocked(item: QuestionBankItem) -> None:
    if item.locked:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This question is in a published homework. Unpublish it first.",
        )

router = APIRouter()

_VALID_STATUSES = {"pending", "approved", "rejected", "archived"}
_VALID_DIFFICULTIES = {"easy", "medium", "hard"}


# ── request shapes ──


class GenerateRequest(BaseModel):
    count: int
    # The homework the teacher kicked this off from. Required — there's
    # no longer a standalone question-bank flow; every item belongs to
    # a HW.
    assignment_id: uuid.UUID
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


class UploadWorksheetRequest(BaseModel):
    images: list[str]  # base64-encoded JPEG/PNG
    assignment_id: uuid.UUID
    unit_id: uuid.UUID | None = None

    @field_validator("images")
    @classmethod
    def _validate_images(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("At least one image is required")
        if len(v) > 10:
            raise ValueError("Maximum 10 images per upload")
        return v


class UpdateBankItemRequest(BaseModel):
    title: str | None = None
    question: str | None = None
    solution_steps: list[Any] | None = None
    final_answer: str | None = None
    difficulty: str | None = None
    unit_id: uuid.UUID | None = None
    clear_unit: bool = False


class RegenerateRequest(BaseModel):
    instructions: str | None = None


class GenerateSimilarRequest(BaseModel):
    count: int
    constraint: str | None = None

    @field_validator("count")
    @classmethod
    def _validate_count(cls, v: int) -> int:
        if v < 1 or v > 20:
            raise ValueError("count must be between 1 and 20")
        return v


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


async def get_bank_item(
    item_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> QuestionBankItem:
    """FastAPI dependency that loads a bank item AND verifies the
    teacher owns its course. Used by every per-item endpoint so the
    ownership check is structurally guaranteed — no helper to forget
    to call. The previous helper-based pattern (12/12 endpoints
    correct) was fine but defensive: any future endpoint that takes
    item_id must Depends(get_bank_item) to even get the item.
    """
    item = (await db.execute(
        select(QuestionBankItem).where(QuestionBankItem.id == item_id)
    )).scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found")
    await get_teacher_course(db, item.course_id, current_user.user_id)
    return item


def _serialize_item(
    item: QuestionBankItem,
    used_in: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    return {
        "id": str(item.id),
        "course_id": str(item.course_id),
        "unit_id": str(item.unit_id) if item.unit_id else None,
        "title": item.title,
        "question": item.question,
        "solution_steps": item.solution_steps,
        "final_answer": item.final_answer,
        "difficulty": item.difficulty,
        "status": item.status,
        "locked": bool(item.locked),
        "source": item.source,
        "parent_question_id": str(item.parent_question_id) if item.parent_question_id else None,
        "used_in": used_in or [],
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
        "mode": job.mode,
        "status": job.status,
        "requested_count": job.requested_count,
        "difficulty": job.difficulty,
        "constraint": job.constraint,
        "produced_count": job.produced_count,
        "error_message": job.error_message,
        "parent_question_id": str(job.parent_question_id) if job.parent_question_id else None,
        "created_at": job.created_at.isoformat(),
        "updated_at": job.updated_at.isoformat(),
    }


# ── list / get ──


@router.get("/courses/{course_id}/question-bank")
async def list_bank_items(
    course_id: uuid.UUID,
    status_filter: str | None = None,
    unit_id: uuid.UUID | None = None,
    assignment_id: uuid.UUID | None = None,
    difficulty: str | None = None,
    parent_question_id: uuid.UUID | None = None,
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
    # Per-HW scoping: HW detail pages filter to their own problems so
    # two HWs in the same unit don't share a pending pool.
    if assignment_id:
        query = query.where(QuestionBankItem.originating_assignment_id == assignment_id)
    if difficulty:
        query = query.where(QuestionBankItem.difficulty == difficulty)
    if parent_question_id:
        query = query.where(QuestionBankItem.parent_question_id == parent_question_id)
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

    used_map = await used_in_assignments_map(db, course_id)
    return {
        "items": [_serialize_item(i, used_map.get(str(i.id))) for i in items],
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

    # Validate the assignment belongs to this teacher + this course.
    # get_teacher_assignment enforces ownership; the course_id check
    # here prevents cross-course attachment.
    assignment = await get_teacher_assignment(db, body.assignment_id, current_user.user_id)
    if assignment.course_id != course_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Assignment does not belong to this course",
        )

    # Defense in depth: bank questions only live at the top-unit level.
    # Frontend gates this in the generate-questions-modal but a stale UI
    # or direct API call could bypass and save into a subfolder, leaving
    # an orphaned-looking item the rail filter can't surface naturally.
    if body.unit_id is not None:
        from api.models.unit import Unit
        unit = (await db.execute(
            select(Unit).where(Unit.id == body.unit_id, Unit.course_id == course_id)
        )).scalar_one_or_none()
        if unit is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Unit not found in this course",
            )
        if unit.parent_unit_id is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Generated questions must save into a top-level unit, not a subfolder",
            )

    job = QuestionBankGenerationJob(
        course_id=course_id,
        unit_id=body.unit_id,
        originating_assignment_id=body.assignment_id,
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


@router.post("/courses/{course_id}/question-bank/upload", status_code=status.HTTP_202_ACCEPTED)
async def upload_worksheet(
    course_id: uuid.UUID,
    body: UploadWorksheetRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Extract problems from uploaded worksheet images into the bank.

    Each image is validated (JPEG/PNG, ≤5MB), then stored on the job row
    for async extraction. The job pipeline extracts problems via Vision,
    solves each one, and persists them as pending bank items.
    """
    await get_teacher_course(db, course_id, current_user.user_id)

    if body.unit_id is not None:
        from api.models.unit import Unit
        unit = (await db.execute(
            select(Unit).where(Unit.id == body.unit_id, Unit.course_id == course_id)
        )).scalar_one_or_none()
        if unit is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Unit not found in this course",
            )
        if unit.parent_unit_id is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uploaded questions must save into a top-level unit, not a subfolder",
            )

    # Validate each image and build the stored payload
    validated_images = []
    for i, img_b64 in enumerate(body.images):
        try:
            _, media_type = validate_and_decode_image(img_b64)
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Image {i + 1}: {e}",
            ) from e
        validated_images.append({"data": img_b64, "media_type": media_type})

    # Validate the assignment belongs to this teacher + this course.
    assignment = await get_teacher_assignment(db, body.assignment_id, current_user.user_id)
    if assignment.course_id != course_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Assignment does not belong to this course",
        )

    job = QuestionBankGenerationJob(
        course_id=course_id,
        unit_id=body.unit_id,
        originating_assignment_id=body.assignment_id,
        created_by_id=current_user.user_id,
        mode="upload",
        status="queued",
        requested_count=0,  # set by worker after extraction
        difficulty="mixed",
        uploaded_images=validated_images,
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
    body: UpdateBankItemRequest,
    item: QuestionBankItem = Depends(get_bank_item),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    # Lock policy: only *content* edits are blocked when the item is in a
    # published homework. Metadata changes (unit move, difficulty tag) stay
    # allowed because they don't change what students see.
    content_changing = (
        body.question is not None
        or body.solution_steps is not None
        or body.final_answer is not None
    )
    if content_changing:
        _ensure_unlocked(item)
        snapshot_history(item)

    if body.title is not None:
        t = body.title.strip()[:120]
        if not t:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Title cannot be empty")
        item.title = t
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
    return _serialize_item(item, await used_in_for_item(db, item))


@router.post("/question-bank/{item_id}/revert")
async def revert_bank_item(
    item: QuestionBankItem = Depends(get_bank_item),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Restore the previous_* snapshot. One level of undo only — after this
    call, previous_* is cleared so the teacher can't ping-pong forever."""
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
    return _serialize_item(item, await used_in_for_item(db, item))


@router.post("/question-bank/{item_id}/approve")
async def approve_bank_item(
    item: QuestionBankItem = Depends(get_bank_item),
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Approve a bank item AND auto-attach it to its originating HW.

    Every item has `originating_assignment_id` (Feature 6d contract),
    so approval always means "add this problem to that HW's content."
    No picker, no cross-HW sharing — the plan's per-HW model.

    If the originating HW is already published, the approve still
    lands but the attach is skipped (published HWs are locked). The
    teacher can unpublish and re-approve to force attach, or leave
    the item approved for reference.
    """
    _ensure_unlocked(item)
    item.status = "approved"

    # get_teacher_assignment enforces teacher ownership of the
    # originating HW. Should always succeed since the item's FK is
    # guaranteed valid — belt-and-suspenders for the rare case of a
    # stale item row being approved after its HW was deleted.
    a = await get_teacher_assignment(db, item.originating_assignment_id, current_user.user_id)

    # Auto-attach only applies to HW primaries. Variations (children
    # of a primary via parent_question_id) are practice scaffolding
    # served through the student loop — they never belong in HW
    # content. snapshot_bank_items would reject them anyway.
    if a.status != "published" and item.parent_question_id is None:
        existing_ids: list[uuid.UUID] = []
        content = a.content if isinstance(a.content, dict) else {}
        for raw in content.get("problem_ids") or []:
            try:
                existing_ids.append(raw if isinstance(raw, uuid.UUID) else uuid.UUID(str(raw)))
            except (ValueError, TypeError):
                continue
        if item.id not in existing_ids:
            existing_ids.append(item.id)
            # snapshot_bank_items re-validates that every id in the list
            # belongs to the course and is approved — including the one
            # we just flipped above (in-memory state is "approved").
            await db.flush()
            a.content = await snapshot_bank_items(db, a.course_id, existing_ids)

    await db.commit()
    return {"status": "ok"}


@router.post("/question-bank/{item_id}/reject")
async def reject_bank_item(
    item: QuestionBankItem = Depends(get_bank_item),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    _ensure_unlocked(item)
    item.status = "rejected"
    await db.commit()
    return {"status": "ok"}


@router.post("/question-bank/{item_id}/regenerate")
async def regenerate_bank_item(
    body: RegenerateRequest,
    item: QuestionBankItem = Depends(get_bank_item),
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    _ensure_unlocked(item)
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
    return _serialize_item(item, await used_in_for_item(db, item))


@router.post("/question-bank/{item_id}/generate-similar", status_code=status.HTTP_202_ACCEPTED)
async def generate_similar_bank_questions(
    body: GenerateSimilarRequest,
    parent: QuestionBankItem = Depends(get_bank_item),
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Schedule a generation job seeded from an existing approved bank
    item. Children inherit unit + source docs from the parent and have
    parent_question_id set, building the variation tree."""
    if parent.parent_question_id is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Can only generate similar from a root question, not a variation",
        )
    if parent.status != "approved":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Approve the question before generating similar variations",
        )

    job = QuestionBankGenerationJob(
        course_id=parent.course_id,
        unit_id=parent.unit_id,
        # Children inherit the parent's originating HW — a variation
        # lives and dies with the HW its primary belongs to.
        originating_assignment_id=parent.originating_assignment_id,
        created_by_id=current_user.user_id,
        status="queued",
        requested_count=body.count,
        difficulty="mixed",
        constraint=body.constraint,
        source_doc_ids=parent.source_doc_ids,
        parent_question_id=parent.id,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    schedule_generation_job(job.id)
    return _serialize_job(job)


@router.delete("/question-bank/{item_id}")
async def delete_bank_item(
    item: QuestionBankItem = Depends(get_bank_item),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    _ensure_unlocked(item)
    await db.delete(item)
    await db.commit()
    return {"status": "ok"}


# ── workshop chat ──


@router.post("/question-bank/{item_id}/chat")
async def post_chat_message(
    body: ChatMessageRequest,
    item: QuestionBankItem = Depends(get_bank_item),
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Append a teacher message to the chat, call Claude, append the AI
    reply (with optional proposal). Returns the updated item.

    The proposal is NOT applied to live fields here — that only happens
    via /chat/accept."""
    _ensure_unlocked(item)
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

    return _serialize_item(item, await used_in_for_item(db, item))


@router.post("/question-bank/{item_id}/chat/accept")
async def accept_chat_proposal(
    body: ChatMessageIndexRequest,
    item: QuestionBankItem = Depends(get_bank_item),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Apply the proposal attached to a specific AI message in the chat.
    Snapshots the current state to previous_* before mutating, marks the
    chat message as accepted."""
    _ensure_unlocked(item)

    existing = item.chat_messages or []
    if body.message_index < 0 or body.message_index >= len(existing):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid message index")
    msg = existing[body.message_index]
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
        # Belt-and-suspenders: defense against malformed steps lingering
        # in old chat_messages written before question_bank_chat.py
        # started filtering (see cleaned_steps there). A single bad
        # entry would crash the frontend render at workshop-modal.tsx.
        raw_steps = proposal["solution_steps"]
        if isinstance(raw_steps, list):
            item.solution_steps = [
                {"title": s["title"], "description": s["description"]}
                for s in raw_steps
                if isinstance(s, dict)
                and isinstance(s.get("title"), str)
                and isinstance(s.get("description"), str)
            ]
    if proposal.get("final_answer") is not None:
        item.final_answer = str(proposal["final_answer"])

    # Build a NEW list with NEW dict copies for any modified message.
    # In-place dict mutation (e.g. `m["accepted"] = True`) would be a
    # no-op at flush time: SQLAlchemy compares old list vs new list
    # element-wise, and because a shallow `list(...)` shares dict refs
    # with the original, both sides of the comparison would show the
    # same mutated state — no UPDATE generated. Using {**m, ...} mints
    # a fresh dict so old and new actually differ. Same pattern already
    # used in core/question_bank_chat.py's superseded_history.
    item.chat_messages = [
        {**m, "accepted": True} if i == body.message_index
        else {**m, "superseded": True} if (
            m.get("role") == "ai"
            and m.get("proposal")
            and not m.get("accepted")
            and not m.get("discarded")
        )
        else m
        for i, m in enumerate(existing)
    ]
    await db.commit()
    return _serialize_item(item, await used_in_for_item(db, item))


@router.post("/question-bank/{item_id}/chat/discard")
async def discard_chat_proposal(
    body: ChatMessageIndexRequest,
    item: QuestionBankItem = Depends(get_bank_item),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Mark a proposal as discarded. No live content change."""
    existing = item.chat_messages or []
    if body.message_index < 0 or body.message_index >= len(existing):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid message index")
    msg = existing[body.message_index]
    if msg.get("role") != "ai" or not msg.get("proposal"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Not a proposal message")
    if msg.get("accepted") or msg.get("discarded"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Proposal already resolved")

    # New dict for the discarded message — see accept_chat_proposal
    # above for why in-place mutation doesn't persist.
    item.chat_messages = [
        {**m, "discarded": True} if i == body.message_index else m
        for i, m in enumerate(existing)
    ]
    await db.commit()
    return _serialize_item(item, await used_in_for_item(db, item))


@router.post("/question-bank/{item_id}/chat/clear")
async def clear_chat(
    item: QuestionBankItem = Depends(get_bank_item),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Wipe the chat history for this item. Question/solution unchanged."""
    item.chat_messages = []
    await db.commit()
    return _serialize_item(item, await used_in_for_item(db, item))
