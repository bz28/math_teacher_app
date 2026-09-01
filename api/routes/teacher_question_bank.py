"""Teacher question bank — CRUD + AI generation pipeline.

The bank is the pool of teacher-approved questions per course. Generation
runs as an in-process fire-and-forget asyncio task scheduled by the
generate endpoint and resolved by the question_bank_generation worker.
The frontend polls the job row for status.
"""

import uuid
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.audit_log import record_activity, record_question_edit
from api.core.constants import SOLUTION_FAILED_SENTINEL_PREFIX
from api.core.entitlements import Entitlement, check_entitlement
from api.core.image_utils import validate_and_decode_upload
from api.core.question_bank_chat import CHAT_SOFT_CAP, chat_with_bank_item
from api.core.question_bank_generation import (
    _render_step_figures,
    _resolve_figure,
    regenerate_one,
    schedule_generation_job,
    snapshot_history,
)
from api.database import get_db
from api.middleware.auth import CurrentUser, get_current_user_full, require_teacher
from api.middleware.rate_limit import limiter
from api.models.course import Course
from api.models.question_bank import QuestionBankGenerationJob, QuestionBankItem
from api.models.question_edit import (
    EDIT_MANUAL,
    EDIT_WORKSHOP,
    REGEN_FRESH,
    REGEN_GUIDED,
    REJECT,
)
from api.models.user import User
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


class GenerationParams(BaseModel):
    """Teacher customizations from the Customize section of the
    generate-problems modal. Every field is optional with a default
    that produces NO prompt instruction — so omitting the whole
    object reproduces today's 1-click default flow exactly.

    Stored on QuestionBankGenerationJob.params (JSONB) and translated
    to prompt-instruction bullets in api/core/assignment_generation.
    """

    problem_type: Literal[
        "mixed", "word", "computation", "multi_step", "proof"
    ] = "mixed"
    answer_form: Literal[
        "auto", "radical", "rational_exponent", "exact", "decimal_2", "decimal_3"
    ] = "auto"
    difficulty: Literal[
        "mixed", "easy", "medium", "hard", "ramp"
    ] = "mixed"
    calculator: Literal["either", "no_calc", "calc_allowed"] = "either"
    format: Literal["frq", "mcq"] = "frq"


class GenerateRequest(BaseModel):
    count: int
    # The homework the teacher kicked this off from. Required — there's
    # no longer a standalone question-bank flow; every item belongs to
    # a HW.
    assignment_id: uuid.UUID
    # Required — generated bank items are saved under this unit. Used
    # to be nullable to allow Uncategorized; that bucket is gone.
    unit_id: uuid.UUID
    document_ids: list[uuid.UUID] = []
    constraint: str | None = None  # natural-language extra instructions
    # Customize-section selections. None = the teacher used the default
    # 1-click flow.
    params: GenerationParams | None = None

    @field_validator("count")
    @classmethod
    def _validate_count(cls, v: int) -> int:
        if v < 1 or v > 50:
            raise ValueError("count must be between 1 and 50")
        return v


class UploadWorksheetRequest(BaseModel):
    # base64-encoded JPEG/PNG/PDF — magic bytes verified server-side
    # before extraction.
    images: list[str]
    assignment_id: uuid.UUID
    unit_id: uuid.UUID
    # Optional natural-language scope hint forwarded into the extraction
    # prompt, e.g. "Q1-13 odd" or "skip word problems". Mirrors the
    # constraint field used by the generate flow.
    constraint: str | None = None

    @field_validator("images")
    @classmethod
    def _validate_images(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("At least one file is required")
        if len(v) > 10:
            raise ValueError("Maximum 10 files per upload")
        return v


class UpdateBankItemRequest(BaseModel):
    title: str | None = None
    question: str | None = None
    solution_steps: list[Any] | None = None
    final_answer: str | None = None
    # MCQ wrong-answer choices. None = leave unchanged; must be a
    # 3-element list when set so the renderer always has exactly 4
    # choices (correct + 3 wrong). Used by the workshop modal's
    # MCQ edit fields.
    distractors: list[str] | None = None
    difficulty: str | None = None
    # None = leave unchanged; must be a real unit when set. The old
    # `clear_unit` sentinel is gone — there's no unsorted bucket to
    # move items to anymore.
    unit_id: uuid.UUID | None = None


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
        "unit_id": str(item.unit_id),
        "title": item.title,
        "question": item.question,
        "solution_steps": item.solution_steps,
        "final_answer": item.final_answer,
        "distractors": item.distractors or [],
        "difficulty": item.difficulty,
        "format": item.format,
        "status": item.status,
        "locked": bool(item.locked),
        "source": item.source,
        "parent_question_id": str(item.parent_question_id) if item.parent_question_id else None,
        "used_in": used_in or [],
        "source_doc_ids": item.source_doc_ids,
        "generation_prompt": item.generation_prompt,
        # figure_spec is the structured source-of-truth (a future
        # visual editor will mutate this); figure_svg is the cached
        # rendered display artifact. Both null on non-geometry items.
        "figure_spec": item.figure_spec,
        "figure_svg": item.figure_svg,
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
        "unit_id": str(job.unit_id),
        "mode": job.mode,
        "status": job.status,
        "requested_count": job.requested_count,
        "difficulty": job.difficulty,
        "constraint": job.constraint,
        "params": job.params,
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
@limiter.limit("3/minute")
async def generate_bank_questions(
    request: Request,
    course_id: uuid.UUID,
    body: GenerateRequest,
    current_user: CurrentUser = Depends(require_teacher),
    user: User = Depends(get_current_user_full),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    # Ownership/existence checks first so a teacher poking at someone
    # else's resource gets 404, not a misleading 429-style 'limit
    # reached today' that confirms the resource exists.
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

    # Enforce the teacher daily generation cap. Independent free
    # teachers get 10/day; pro and school-active teachers bypass.
    await check_entitlement(db, user, Entitlement.GENERATE_PROBLEM)

    # Defense in depth: bank questions only live at the top-unit level.
    # Frontend gates this in the generate-questions-modal but a stale UI
    # or direct API call could bypass and save into a subfolder, leaving
    # an orphaned-looking item the rail filter can't surface naturally.
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
        # difficulty column is legacy — hardcoded so anything still
        # reading it gets a non-empty value. The teacher's real
        # difficulty selection lives in params.difficulty below.
        difficulty="mixed",
        constraint=body.constraint,
        source_doc_ids=[str(d) for d in body.document_ids] if body.document_ids else None,
        params=body.params.model_dump() if body.params else None,
    )
    db.add(job)
    await db.flush()
    await record_activity(
        db, current_user, "generation.start", "generation_job", job.id,
        {"mode": "generate", "requested_count": body.count},
    )
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

    # Validate each file (image or PDF) and build the stored payload.
    validated_files = []
    for i, file_b64 in enumerate(body.images):
        try:
            _, media_type = validate_and_decode_upload(file_b64)
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File {i + 1}: {e}",
            ) from e
        validated_files.append({"data": file_b64, "media_type": media_type})

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
        constraint=body.constraint,
        uploaded_images=validated_files,
    )
    db.add(job)
    await db.flush()
    await record_activity(
        db, current_user, "generation.start", "generation_job", job.id,
        {"mode": "upload", "page_count": len(validated_files)},
    )
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
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    # Lock policy: only *content* edits are blocked when the item is in a
    # published homework. Metadata changes (unit move, difficulty tag) stay
    # allowed because they don't change what students see.
    content_changing = (
        body.question is not None
        or body.solution_steps is not None
        or body.final_answer is not None
        or body.distractors is not None
    )
    if content_changing:
        _ensure_unlocked(item)
        snapshot_history(item)

    # Captured before the mutations below so the activity row can name the
    # fields that ACTUALLY changed. A PATCH that re-sends identical values
    # is not an edit, and logging it as one would put a phantom entry on a
    # timeline whose whole job is to explain why an item looks the way it
    # does.
    prev_title, prev_question = item.title, item.question
    prev_steps, prev_answer = item.solution_steps, item.final_answer
    prev_distractors = item.distractors
    prev_difficulty, prev_unit_id = item.difficulty, item.unit_id

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
        # Stripped like `question` above. Unstripped, a re-save differing
        # only in trailing whitespace counts as a repair and inflates the
        # quality signal — the equivalent question edit already records
        # nothing, so this was an inconsistency waiting to mislead.
        item.final_answer = body.final_answer.strip()
    if body.distractors is not None:
        # MCQ rendering relies on exactly 3 distractors so the
        # composed [correct, ...wrong] gives 4 choices. Reject
        # anything else loudly — silently truncating would surprise
        # the teacher later when the modal renders fewer choices than
        # they typed.
        if len(body.distractors) != 3:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="distractors must contain exactly 3 wrong-answer choices",
            )
        item.distractors = [str(d) for d in body.distractors]
    if body.difficulty is not None:
        if body.difficulty not in ("easy", "medium", "hard"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid difficulty")
        item.difficulty = body.difficulty
    if body.unit_id is not None:
        item.unit_id = body.unit_id

    # A generated question a teacher had to rewrite is the clearest
    # signal the generation prompt is wrong. No-ops when the question
    # text didn't change — a title typo says nothing about the prompt.
    if content_changing:
        await record_question_edit(db, item, EDIT_MANUAL, current_user)

    # One PATCH is one teacher action, so it records at most one row.
    # Content edits and metadata retags are different signals — rewriting
    # the question is a claim about the generated problem, re-tagging its
    # difficulty is filing — so they get different action names, and
    # content wins when a single request does both.
    changed_content = [
        field
        for field, before, after in (
            ("question", prev_question, item.question),
            ("solution", prev_steps, item.solution_steps),
            ("final_answer", prev_answer, item.final_answer),
            ("distractors", prev_distractors, item.distractors),
        )
        if before != after
    ]
    if changed_content:
        await record_activity(
            db, current_user, "bank_item.edit", "bank_item", item.id,
            {"title": item.title, "fields": changed_content},
        )
    else:
        retag: dict[str, Any] = {"title": item.title}
        # The new title is already in `title`; carrying the old one is what
        # makes a rename legible as a rename rather than an unexplained row.
        if item.title != prev_title:
            retag["renamed_from"] = prev_title
        if item.difficulty != prev_difficulty:
            retag["difficulty"] = item.difficulty
        if item.unit_id != prev_unit_id:
            retag["unit_id"] = str(item.unit_id) if item.unit_id else None
        if len(retag) > 1:
            await record_activity(
                db, current_user, "bank_item.retag", "bank_item", item.id, retag,
            )

    await db.commit()
    return _serialize_item(item, await used_in_for_item(db, item))


@router.post("/question-bank/{item_id}/revert")
async def revert_bank_item(
    item: QuestionBankItem = Depends(get_bank_item),
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Restore the previous_* snapshot. One level of undo only — after this
    call, previous_* is cleared so the teacher can't ping-pong forever."""
    if item.previous_question is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No previous version to restore",
        )
    prior_status = item.status
    item.question = item.previous_question
    item.solution_steps = item.previous_solution_steps
    item.final_answer = item.previous_final_answer or ""
    if item.previous_status:
        item.status = item.previous_status
    # Restore the figure alongside the prose so the two stay in sync.
    item.figure_spec = item.previous_figure_spec
    item.figure_svg = item.previous_figure_svg
    restored_status = item.status if item.status != prior_status else None
    item.previous_question = None
    item.previous_solution_steps = None
    item.previous_final_answer = None
    item.previous_status = None
    item.previous_figure_spec = None
    item.previous_figure_svg = None
    # Undo restores the snapshot's status alongside its prose, so it can
    # move an item back to rejected (or approved) with no other trace. That
    # status is what the generation-quality board reads, so an unlogged
    # revert makes the board and this timeline disagree about the same item.
    # `restored_status` is present only when the status actually moved.
    await record_activity(
        db, current_user, "bank_item.revert", "bank_item", item.id,
        {"title": item.title, "restored_status": restored_status},
    )
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
    # Approved items are the surface the integrity-check agent reads.
    # Empty final_answer there would surface as "no answer key" in the
    # briefing — the agent's correctness anchor depends on it.
    final_answer = (item.final_answer or "").strip()
    if not final_answer:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Final answer is required before approving",
        )
    # Automatic solving stores a "(solution failed …)" placeholder as the
    # final_answer when decompose throws. It's truthy, so the emptiness
    # check above lets it through — but it's not a real answer key. Reject
    # it explicitly so it can never be approved + attached as a graded
    # answer (would anchor check_answer_correctness + AI grading on junk).
    if final_answer.startswith(SOLUTION_FAILED_SENTINEL_PREFIX):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "This problem's solution failed to generate — regenerate or "
                "solve it manually before approving."
            ),
        )
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

    await record_activity(
        db, current_user, "bank_item.approve", "bank_item", item.id,
        {"title": item.title},
    )
    await db.commit()
    return {"status": "ok"}


@router.post("/question-bank/{item_id}/reject")
async def reject_bank_item(
    item: QuestionBankItem = Depends(get_bank_item),
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    _ensure_unlocked(item)
    already_rejected = item.status == "rejected"
    item.status = "rejected"
    # A teacher binning the question outright is the strongest evidence
    # the generation prompt is wrong — stronger than any edit, because
    # nothing about the output was worth keeping. Recorded as an event
    # rather than read from `status` alone, because status carries no
    # timestamp and the report needs one to trend.
    #
    # Guarded on the prior status so a repeated POST (a double-click, a
    # retried request) records one rejection rather than several. The
    # endpoint is otherwise idempotent and the signal must be too.
    if not already_rejected:
        await record_question_edit(db, item, REJECT, current_user)
    await record_activity(
        db, current_user, "bank_item.reject", "bank_item", item.id,
        {"title": item.title},
    )
    await db.commit()
    return {"status": "ok"}


@router.post("/question-bank/{item_id}/regenerate")
@limiter.limit("6/minute")
async def regenerate_bank_item(
    request: Request,
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

    # Two different signals wear the same button. With instructions,
    # `regenerate_one` keeps the original as an anchor and revises it —
    # the teacher salvaged the output. Without, it DROPS the original
    # entirely and asks for a fresh take — the teacher judged the output
    # unusable, which is evidence against the prompt in a way a guided
    # revision is not. Recorded separately so they can't average away.
    kind = REGEN_GUIDED if (body.instructions or "").strip() else REGEN_FRESH
    await record_question_edit(db, item, kind, current_user)
    # The instructions themselves stay out of the activity log — that surface
    # is compliance reporting with a small-metadata contract, and
    # `record_question_edit` above already keeps the full before/after for
    # quality analysis. Only which of the two buttons was pressed is here.
    await record_activity(
        db, current_user, "bank_item.regenerate", "bank_item", item.id,
        {"title": item.title, "mode": "guided" if kind == REGEN_GUIDED else "fresh"},
    )
    await db.commit()

    return _serialize_item(item, await used_in_for_item(db, item))


@router.post("/question-bank/{item_id}/generate-similar", status_code=status.HTTP_202_ACCEPTED)
@limiter.limit("3/minute")
async def generate_similar_bank_questions(
    request: Request,
    body: GenerateSimilarRequest,
    parent: QuestionBankItem = Depends(get_bank_item),
    current_user: CurrentUser = Depends(require_teacher),
    user: User = Depends(get_current_user_full),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Schedule a generation job seeded from an existing approved bank
    item. Children inherit unit + source docs from the parent and have
    parent_question_id set, building the variation tree."""
    await check_entitlement(db, user, Entitlement.GENERATE_PROBLEM)
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
    await db.flush()
    await record_activity(
        db, current_user, "generation.start", "generation_job", job.id,
        {"mode": "similar", "requested_count": body.count, "parent_id": str(parent.id)},
    )
    await db.commit()
    await db.refresh(job)

    schedule_generation_job(job.id)
    return _serialize_job(job)


@router.delete("/question-bank/{item_id}")
async def delete_bank_item(
    item: QuestionBankItem = Depends(get_bank_item),
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    _ensure_unlocked(item)
    # Recorded BEFORE the delete: the title is the only thing that makes the
    # row readable afterwards, and it goes with the row. `target_id` is a
    # plain UUID with no FK, so it survives the delete the same way
    # `user.delete` does in admin_users.
    await record_activity(
        db, current_user, "bank_item.delete", "bank_item", item.id,
        {"title": item.title, "status": item.status},
    )
    await db.delete(item)
    await db.commit()
    return {"status": "ok"}


# ── workshop chat ──


@router.post("/question-bank/{item_id}/chat")
@limiter.limit("10/minute")
async def post_chat_message(
    request: Request,
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

    # Recorded BEFORE the call because `chat_with_bank_item` owns the commit
    # for this request (it persists the teacher message and the AI reply
    # atomically). record_activity only stages a row, so it rides that same
    # commit — and is rolled back with everything else if Claude fails, which
    # is exactly the "log lives or dies with the work" contract in
    # api/core/audit_log. The message text is deliberately not logged: this
    # surface is compliance reporting, and chat prose is neither small nor
    # compliance data.
    await record_activity(
        db, current_user, "bank_item.workshop_chat", "bank_item", item.id,
        {"title": item.title, "message_count": len(item.chat_messages or [])},
    )

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
    current_user: CurrentUser = Depends(require_teacher),
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
            cleaned_steps: list[dict[str, Any]] = []
            for s in raw_steps:
                if not isinstance(s, dict):
                    continue
                if not isinstance(s.get("title"), str) or not isinstance(s.get("description"), str):
                    continue
                step: dict[str, Any] = {
                    "title": s["title"], "description": s["description"],
                }
                # Carry over a per-step figure if the proposal included one.
                # _render_step_figures (called below if needed) validates +
                # renders the spec; we hold the raw value here so the
                # render helper sees it.
                if isinstance(s.get("figure_spec"), dict):
                    step["figure_spec"] = s["figure_spec"]
                cleaned_steps.append(step)
            item.solution_steps = _render_step_figures(cleaned_steps)
    if proposal.get("final_answer") is not None:
        # Stripped, matching the PATCH path and the question field beside
        # it. Whitespace-only difference is not a repair, and recording it
        # as one inflates the very signal the quality reports read.
        item.final_answer = str(proposal["final_answer"]).strip()
    # Top-level question-figure on the proposal. Three cases:
    #   1. Proposal includes a NEW figure_spec → render + persist.
    #   2. Proposal rewrites the question but omits figure_spec →
    #      clear the stale figure. Preview-side UI (workshop-modal's
    #      previewFigureSvg) already hides the figure in this case
    #      so the teacher sees "no diagram" before accepting; persist
    #      logic must match what they previewed, otherwise we'd save
    #      old-figure-paired-with-new-prose. Caught by the full-stack
    #      audit as a state desync between preview and accept.
    #   3. Proposal touches neither question nor figure_spec → leave
    #      the existing figure alone.
    if proposal.get("figure_spec") is not None:
        new_figure_spec, new_figure_svg = _resolve_figure(proposal["figure_spec"])
        item.figure_spec = new_figure_spec
        item.figure_svg = new_figure_svg
    elif proposal.get("question") is not None:
        # Question rewritten without a fresh figure → the old figure
        # almost certainly no longer describes the new question.
        # Match what the preview showed (no figure).
        item.figure_spec = None
        item.figure_svg = None

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
        else _shed_resolved_figure_svg({**m, "superseded": True}) if (
            m.get("role") == "ai"
            and m.get("proposal")
            and not m.get("accepted")
            and not m.get("discarded")
        )
        else m
        for i, m in enumerate(existing)
    ]
    await record_question_edit(db, item, EDIT_WORKSHOP, current_user)
    await record_activity(
        db, current_user, "bank_item.workshop_accept", "bank_item", item.id,
        {
            "title": item.title,
            "fields": [
                f for f in ("question", "solution_steps", "final_answer")
                if proposal.get(f) is not None
            ],
        },
    )
    await db.commit()
    return _serialize_item(item, await used_in_for_item(db, item))


@router.post("/question-bank/{item_id}/chat/discard")
async def discard_chat_proposal(
    body: ChatMessageIndexRequest,
    item: QuestionBankItem = Depends(get_bank_item),
    current_user: CurrentUser = Depends(require_teacher),
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
        _shed_resolved_figure_svg({**m, "discarded": True})
        if i == body.message_index else m
        for i, m in enumerate(existing)
    ]
    await record_activity(
        db, current_user, "bank_item.workshop_discard", "bank_item", item.id,
        {"title": item.title},
    )
    await db.commit()
    return _serialize_item(item, await used_in_for_item(db, item))


def _shed_resolved_figure_svg(msg: dict[str, Any]) -> dict[str, Any]:
    """Strip pre-rendered figure_svg from a resolved (accepted is
    handled separately via accept_chat_proposal mutating the item
    directly, so accept doesn't pass through here; this is for
    discarded + superseded paths) chat-message proposal.

    Background: at proposal time the chat orchestrator pre-renders
    the figure_svg so the preview UI can show it before Accept.
    Once a proposal is resolved (discarded or superseded), nothing
    will ever need to render that SVG again — and a single rendered
    SVG can run several KB. Over a long chat with several geometry
    revisions, accumulated stale SVGs bloat the chat_messages JSON
    column. Stripping leaves the canonical figure_spec in place
    (compact, useful for audit/replay) but drops the rendered cache.
    """
    proposal = msg.get("proposal")
    if not isinstance(proposal, dict):
        return msg
    cleaned_proposal: dict[str, Any] = {
        k: v for k, v in proposal.items() if k != "figure_svg"
    }
    # Per-step figure_svg also goes — same rationale, same size impact.
    steps = cleaned_proposal.get("solution_steps")
    if isinstance(steps, list):
        cleaned_proposal["solution_steps"] = [
            {k: v for k, v in s.items() if k != "figure_svg"}
            if isinstance(s, dict) else s
            for s in steps
        ]
    return {**msg, "proposal": cleaned_proposal}


@router.post("/question-bank/{item_id}/chat/clear")
async def clear_chat(
    item: QuestionBankItem = Depends(get_bank_item),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Wipe the chat history for this item. Question/solution unchanged."""
    item.chat_messages = []
    await db.commit()
    return _serialize_item(item, await used_in_for_item(db, item))
