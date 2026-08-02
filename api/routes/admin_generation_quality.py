"""Admin: which generated questions teachers had to fix.

The question this answers is "is our generation prompt wrong?", and the
evidence is teachers rewriting what it produced. One teacher fixing one
question is taste. Four teachers fixing the same shape of question is a
defect with an address.

So the default order is most-edited-first, not newest-first. A
chronological list would make you do the analysis; ranking by how much
human repair a question needed makes the page do it — the same
"what's broken" framing the admin Overview already uses.

## Honesty about what isn't known

`question_edits` starts empty and only ever records forward: the
intermediate states of every edit made before it shipped are genuinely
gone (see `api.models.question_edit`). Every response therefore carries
`tracking_since`, so the UI can say "tracking began …" instead of
letting a zero read as "never edited". Without that, the page would
quietly assert the opposite of the truth about historical questions —
on the one surface built to make quality legible.
"""

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import CurrentUser, require_admin
from api.models.question_bank import QuestionBankItem
from api.models.question_edit import TRACKING_SINCE, QuestionEdit
from api.models.school import School
from api.models.user import User

router = APIRouter()


def _parse_uuid(label: str, value: str | None) -> uuid.UUID | None:
    if not value:
        return None
    try:
        return uuid.UUID(value)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid {label}") from None


@router.get("/generation-quality/questions")
async def edited_questions(
    teacher_id: str | None = Query(default=None),
    school_id: str | None = Query(default=None),
    kind: str | None = Query(default=None, description="manual | chat"),
    min_edits: int = Query(default=1, ge=1, le=50),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Generated questions ranked by how much repair a teacher had to do.

    `min_edits` defaults to 1 rather than 0 on purpose: a question
    nobody touched is not evidence about the prompt, and including the
    whole bank would bury the eleven rows that matter under thousands
    that don't.
    """
    teacher_uuid = _parse_uuid("teacher_id", teacher_id)
    school_uuid = _parse_uuid("school_id", school_id)

    counts = (
        select(
            QuestionEdit.bank_item_id.label("item_id"),
            func.count().label("edit_count"),
            func.max(QuestionEdit.created_at).label("last_edited_at"),
        )
        .group_by(QuestionEdit.bank_item_id)
    )
    if teacher_uuid is not None:
        counts = counts.where(QuestionEdit.edited_by_id == teacher_uuid)
    if school_uuid is not None:
        counts = counts.where(QuestionEdit.school_id == school_uuid)
    if kind is not None:
        counts = counts.where(QuestionEdit.kind == kind)
    counts_sq = counts.having(func.count() >= min_edits).subquery()

    rows = (await db.execute(
        select(
            QuestionBankItem.id,
            QuestionBankItem.title,
            QuestionBankItem.question,
            QuestionBankItem.status,
            QuestionBankItem.source,
            QuestionBankItem.generation_prompt,
            counts_sq.c.edit_count,
            counts_sq.c.last_edited_at,
        )
        .join(counts_sq, counts_sq.c.item_id == QuestionBankItem.id)
        # Most-repaired first: the page should rank by how much human
        # correction a question needed, not by when it happened.
        .order_by(desc(counts_sq.c.edit_count), desc(counts_sq.c.last_edited_at))
        .limit(limit)
        .offset(offset)
    )).all()

    total = (await db.execute(
        select(func.count()).select_from(counts_sq)
    )).scalar_one()

    return {
        "questions": [
            {
                "id": str(r.id),
                "title": r.title,
                "question": r.question,
                "status": r.status,
                "source": r.source,
                "generation_prompt": r.generation_prompt,
                "edit_count": r.edit_count,
                "last_edited_at": r.last_edited_at.isoformat()
                if r.last_edited_at else None,
            }
            for r in rows
        ],
        "total": total,
        # So the UI can say "tracking began …" rather than let an empty
        # result read as "no teacher has ever edited a question".
        "tracking_since": TRACKING_SINCE.isoformat(),
    }


@router.get("/generation-quality/questions/{item_id}")
async def question_edit_history(
    item_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """One question's full repair history, oldest first.

    The diffs are the payload. A count tells you WHICH question to look
    at; only the before/after tells you what the prompt got wrong — and
    that is the thing you can actually act on.
    """
    item = (await db.execute(
        select(QuestionBankItem).where(QuestionBankItem.id == item_id)
    )).scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="Question not found")

    edits = (await db.execute(
        select(
            QuestionEdit.id,
            QuestionEdit.kind,
            QuestionEdit.before,
            QuestionEdit.after,
            QuestionEdit.created_at,
            User.name.label("editor_name"),
            User.email.label("editor_email"),
            School.name.label("school_name"),
        )
        .outerjoin(User, User.id == QuestionEdit.edited_by_id)
        .outerjoin(School, School.id == QuestionEdit.school_id)
        .where(QuestionEdit.bank_item_id == item_id)
        # Oldest first: you read a repair history forward, watching what
        # the teacher kept fighting with.
        .order_by(QuestionEdit.created_at.asc())
    )).all()

    return {
        "id": str(item.id),
        "title": item.title,
        "question": item.question,
        "final_answer": item.final_answer,
        "status": item.status,
        "source": item.source,
        # What produced it. This is the thing you change once the
        # pattern across several questions is clear.
        "generation_prompt": item.generation_prompt,
        "edits": [
            {
                "id": str(e.id),
                "kind": e.kind,
                "before": e.before,
                "after": e.after,
                "created_at": e.created_at.isoformat(),
                "editor": e.editor_name or e.editor_email,
                "school": e.school_name,
            }
            for e in edits
        ],
        "tracking_since": TRACKING_SINCE.isoformat(),
    }


@router.get("/generation-quality/summary")
async def generation_quality_summary(
    school_id: str | None = Query(default=None),
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Headline counters for the page's stat row."""
    school_uuid = _parse_uuid("school_id", school_id)

    base = select(QuestionEdit)
    if school_uuid is not None:
        base = base.where(QuestionEdit.school_id == school_uuid)
    sub = base.subquery()

    total_edits = (await db.execute(
        select(func.count()).select_from(sub)
    )).scalar_one()
    questions_touched = (await db.execute(
        select(func.count(func.distinct(sub.c.bank_item_id)))
    )).scalar_one()
    kind_rows = (await db.execute(
        select(sub.c.kind, func.count()).group_by(sub.c.kind)
    )).all()
    by_kind: dict[str, int] = {str(k): int(n) for k, n in kind_rows}

    return {
        "total_edits": total_edits,
        "questions_touched": questions_touched,
        "by_kind": by_kind,
        "tracking_since": TRACKING_SINCE.isoformat(),
    }
