"""Admin observability for teacher AI generation.

Read-only views onto a teacher's question-bank generation jobs and the
problems they produced, plus the stored source-document image so the
founder can see exactly what a pilot teacher fed the model and what came
out of it.

There is no FK from a job to its LLM calls or its produced items, so
both are correlated after the fact:
- LLM cost: `LLMCall` rows for the job's creator, with a generation
  `function`, whose `created_at` falls inside the job's run window.
- Produced items: `QuestionBankItem` rows sharing the job's assignment,
  unit, creator (and parent, for "generate similar") created inside the
  same window.

The correlation is exact in the normal single-job-at-a-time case; only
two concurrent jobs on the identical assignment+unit could blur it,
which is acceptable for an internal observability surface.
"""

import uuid
from collections.abc import Sequence
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import CurrentUser, require_admin
from api.models.course import Course, Document
from api.models.llm_call import LLMCall
from api.models.question_bank import QuestionBankGenerationJob, QuestionBankItem
from api.models.unit import Unit
from api.models.user import User
from api.routes.admin_helpers import time_range

router = APIRouter()

# LLM `function` labels a generation job spends money on. `function` on
# LLMCall is the LLMMode value (api/core/llm_client.py). One job fans out
# to several: the question call (generate_questions, or bank_extract in
# upload mode), then per-question solution (decompose) and distractor
# (practice_eval) calls — all logged under the job creator's user_id
# inside the job's run window. The solve + distractor calls usually
# dominate cost, so leaving them out would badly understate a job's spend.
_GENERATION_FUNCTIONS = (
    "generate_questions",
    "bank_extract",
    "decompose",
    "practice_eval",
)

# The produced items / LLM calls are committed just before the job's
# updated_at is stamped "done"; a small buffer absorbs that skew.
_WINDOW_BUFFER = timedelta(seconds=60)


def _parse_uuid(label: str, value: str | None) -> uuid.UUID | None:
    if not value:
        return None
    try:
        return uuid.UUID(value)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"invalid {label}") from e


def _job_window(job: QuestionBankGenerationJob) -> tuple[Any, Any]:
    """[start, end] wall-clock range the job's items + LLM calls fall in."""
    return job.created_at, job.updated_at + _WINDOW_BUFFER


@router.get("/generation/jobs")
async def generation_jobs(
    teacher_id: str | None = Query(default=None),
    school_id: str | None = Query(default=None),
    status: str | None = Query(default=None),
    hours: int = Query(default=720, ge=1, le=8760),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Paginated list of a teacher's generation jobs with correlated cost."""
    teacher_uuid = _parse_uuid("teacher_id", teacher_id)
    school_uuid = _parse_uuid("school_id", school_id)
    since = time_range(hours)

    base = select(QuestionBankGenerationJob).where(
        QuestionBankGenerationJob.created_at >= since
    )
    if teacher_uuid is not None:
        base = base.where(QuestionBankGenerationJob.created_by_id == teacher_uuid)
    if status:
        base = base.where(QuestionBankGenerationJob.status == status)
    if school_uuid is not None:
        base = base.where(
            QuestionBankGenerationJob.created_by_id.in_(
                select(User.id).where(User.school_id == school_uuid)
            )
        )

    total = (
        await db.execute(select(func.count()).select_from(base.subquery()))
    ).scalar() or 0

    jobs = (
        await db.execute(
            base.order_by(QuestionBankGenerationJob.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
    ).scalars().all()

    course_names = await _name_lookup(db, Course, {j.course_id for j in jobs})
    unit_names = await _name_lookup(db, Unit, {j.unit_id for j in jobs})
    cost_by_job = await _correlate_costs(db, jobs)

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "jobs": [
            _job_summary(
                j,
                course_names.get(j.course_id),
                unit_names.get(j.unit_id),
                cost_by_job.get(j.id, (0.0, 0)),
            )
            for j in jobs
        ],
    }


@router.get("/generation/jobs/{job_id}")
async def generation_job_detail(
    job_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """One generation job: its focus/params, produced problems, the
    correlated LLM calls (with cost + expandable input/output), and the
    stored source documents so the dashboard can render the worksheet."""
    job = (
        await db.execute(
            select(QuestionBankGenerationJob).where(
                QuestionBankGenerationJob.id == job_id
            )
        )
    ).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Generation job not found")

    course_name = (await _name_lookup(db, Course, {job.course_id})).get(job.course_id)
    unit_name = (await _name_lookup(db, Unit, {job.unit_id})).get(job.unit_id)
    cost = (await _correlate_costs(db, [job])).get(job.id, (0.0, 0))

    start, end = _job_window(job)

    item_q = (
        select(QuestionBankItem)
        .where(
            QuestionBankItem.originating_assignment_id
            == job.originating_assignment_id,
            QuestionBankItem.unit_id == job.unit_id,
            QuestionBankItem.created_by_id == job.created_by_id,
            QuestionBankItem.created_at >= start,
            QuestionBankItem.created_at <= end,
        )
        .order_by(QuestionBankItem.created_at.asc())
    )
    if job.parent_question_id is not None:
        item_q = item_q.where(
            QuestionBankItem.parent_question_id == job.parent_question_id
        )
    else:
        item_q = item_q.where(QuestionBankItem.parent_question_id.is_(None))
    items = (await db.execute(item_q)).scalars().all()

    calls = (
        await db.execute(
            select(LLMCall)
            .where(
                LLMCall.user_id == job.created_by_id,
                LLMCall.function.in_(_GENERATION_FUNCTIONS),
                LLMCall.created_at >= start,
                LLMCall.created_at <= end,
            )
            .order_by(LLMCall.created_at.asc())
        )
    ).scalars().all()

    source_docs: list[dict[str, Any]] = []
    if job.source_doc_ids:
        doc_uuids = [uuid.UUID(str(d)) for d in job.source_doc_ids]
        docs = (
            await db.execute(
                select(Document.id, Document.filename, Document.file_type).where(
                    Document.id.in_(doc_uuids)
                )
            )
        ).all()
        source_docs = [
            {"id": str(d.id), "filename": d.filename, "file_type": d.file_type}
            for d in docs
        ]

    # Upload-mode jobs carry their source pages as transient base64 on
    # the job itself (not Documents). Surface renderable images inline so
    # the founder can still see what was fed. PDFs are flagged, not embedded.
    uploaded_images: list[dict[str, Any]] = []
    for idx, raw in enumerate(job.uploaded_images or []):
        if not isinstance(raw, dict):
            continue
        media_type = raw.get("media_type") or ""
        uploaded_images.append(
            {
                "index": idx,
                "media_type": media_type,
                "image_data": raw.get("data") if media_type.startswith("image/") else None,
            }
        )

    return {
        "job": _job_summary(job, course_name, unit_name, cost)
        | {
            "params": job.params,
            "source_doc_ids": [str(d) for d in (job.source_doc_ids or [])],
            "error_message": job.error_message,
        },
        # Which attached docs actually reached the model, read straight
        # from the generation call's logged provenance (source of truth —
        # reflects the MAX_VISION_IMAGES cap at run time, not a re-derived
        # guess). None when the job attached no documents.
        "attachments": _attachments_from_calls(calls),
        "source_documents": source_docs,
        "uploaded_images": uploaded_images,
        "items": [
            {
                "id": str(it.id),
                "title": it.title,
                "question": it.question,
                "final_answer": it.final_answer,
                "solution_steps": it.solution_steps,
                "difficulty": it.difficulty,
                "format": it.format,
                "status": it.status,
                "figure_svg": it.figure_svg,
            }
            for it in items
        ],
        "llm_calls": [
            {
                "id": str(c.id),
                "function": c.function,
                "model": c.model,
                "cost_usd": c.cost_usd,
                "input_tokens": c.input_tokens,
                "output_tokens": c.output_tokens,
                "latency_ms": c.latency_ms,
                "success": c.success,
                "created_at": c.created_at.isoformat(),
                "input_text": c.input_text,
                "output_text": c.output_text,
            }
            for c in calls
        ],
    }


@router.get("/documents/{document_id}/content")
async def document_content(
    document_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Serve a stored document's base64 image so the dashboard can render
    the actual uploaded worksheet. Admin-only — this is course material,
    invisible admin-side until now."""
    doc = (
        await db.execute(
            select(
                Document.id,
                Document.filename,
                Document.file_type,
                Document.file_size,
                Document.image_data,
            ).where(Document.id == document_id)
        )
    ).one_or_none()
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return {
        "id": str(doc.id),
        "filename": doc.filename,
        "file_type": doc.file_type,
        "file_size": doc.file_size,
        # Data-URI-ready base64 (or None if the row never stored bytes).
        "image_data": doc.image_data,
    }


def _attachments_from_calls(
    calls: Sequence[LLMCall],
) -> dict[str, Any] | None:
    """Pull attached-document provenance off whichever generation call
    recorded it (build_attachment_metadata stamps the question call).
    Returns {selected, used, filenames} or None if no call carried it."""
    for c in calls:
        meta = c.call_metadata or {}
        if "attached_docs_selected" in meta:
            return {
                "selected": meta.get("attached_docs_selected") or 0,
                "used": meta.get("attached_docs_used") or 0,
                "filenames": meta.get("attached_doc_filenames") or [],
            }
    return None


async def _name_lookup(
    db: AsyncSession, model: Any, ids: set[uuid.UUID]
) -> dict[uuid.UUID, str]:
    if not ids:
        return {}
    rows = (
        await db.execute(select(model.id, model.name).where(model.id.in_(ids)))
    ).all()
    return {r.id: r.name for r in rows}


async def _correlate_costs(
    db: AsyncSession, jobs: Sequence[QuestionBankGenerationJob]
) -> dict[uuid.UUID, tuple[float, int]]:
    """Map job_id -> (total_cost_usd, call_count) by bucketing each
    creator's generation LLM calls into the job whose run window contains
    it. One query across the whole page, bucketed in Python."""
    if not jobs:
        return {}

    creator_ids = {j.created_by_id for j in jobs}
    overall_start = min(j.created_at for j in jobs)
    overall_end = max(_job_window(j)[1] for j in jobs)

    calls = (
        await db.execute(
            select(
                LLMCall.user_id, LLMCall.created_at, LLMCall.cost_usd
            ).where(
                LLMCall.user_id.in_(creator_ids),
                LLMCall.function.in_(_GENERATION_FUNCTIONS),
                LLMCall.created_at >= overall_start,
                LLMCall.created_at <= overall_end,
            )
        )
    ).all()

    # Sort each creator's jobs by start so a call lands in the latest job
    # that had already started — the natural owner when windows abut.
    jobs_by_creator: dict[uuid.UUID, list[QuestionBankGenerationJob]] = {}
    for j in jobs:
        jobs_by_creator.setdefault(j.created_by_id, []).append(j)
    for lst in jobs_by_creator.values():
        lst.sort(key=lambda j: j.created_at)

    result: dict[uuid.UUID, tuple[float, int]] = {}
    for user_id, created_at, cost_usd in calls:
        owner: QuestionBankGenerationJob | None = None
        for j in jobs_by_creator.get(user_id, []):
            start, end = _job_window(j)
            if start <= created_at <= end:
                owner = j  # keep last (latest-started) match
        if owner is None:
            continue
        prev_cost, prev_count = result.get(owner.id, (0.0, 0))
        result[owner.id] = (prev_cost + (cost_usd or 0.0), prev_count + 1)
    return result


def _job_summary(
    job: QuestionBankGenerationJob,
    course_name: str | None,
    unit_name: str | None,
    cost: tuple[float, int],
) -> dict[str, Any]:
    return {
        "id": str(job.id),
        "mode": job.mode,
        "status": job.status,
        "requested_count": job.requested_count,
        "produced_count": job.produced_count,
        "constraint": job.constraint,
        "source_doc_count": len(job.source_doc_ids or []),
        "course_id": str(job.course_id),
        "course_name": course_name,
        "unit_id": str(job.unit_id),
        "unit_name": unit_name,
        "created_by_id": str(job.created_by_id),
        "created_at": job.created_at.isoformat(),
        "updated_at": job.updated_at.isoformat(),
        "llm_cost_usd": round(cost[0], 6),
        "llm_call_count": cost[1],
    }
