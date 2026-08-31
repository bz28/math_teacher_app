"""Admin: which generated questions teachers had to fix.

The question this answers is "is our generation prompt wrong?", and the
evidence is teachers rewriting what it produced. One teacher fixing one
question is taste. Four teachers fixing the same shape of question is a
defect with an address.

So the default order is most-edited-first, not newest-first. A
chronological list would make you do the analysis; ranking by how much
human repair a question needed makes the page do it — the same
"what's broken" framing the admin Overview already uses.

## The board has a denominator, and that is the whole point

The old page could only ever show bad news: a question appeared ONLY
after someone edited it, so a perfect question was invisible and "0
repairs" had nothing to divide by. `/generation-quality/board` reports
every settled generated question and what became of it:

- CLEAN     approved, question never edited
- REPAIRED  edited by hand, in the workshop, or regenerated WITH
            direction — the teacher salvaged it
- REDONE    regenerated with NO direction, which makes the prompt builder
            drop the original entirely and start over. The teacher judged
            the output unusable, which is a different claim from "needed
            a tweak" and must not average into it.
- REJECTED  binned outright — the strongest evidence the prompt is wrong
- AWAITING  still pending review, EXCLUDED from the rate

Severity is preserved rather than summed: one rejection is not four
edits. The headline is CLEAN / settled, with the three failure modes
reported as their own counts.

## Honesty about what isn't known

`question_edits` starts empty and only ever records forward: the
intermediate states of every edit made before it shipped are genuinely
gone (see `api.models.question_edit`). Every response therefore carries
`tracking_since`, so the UI can say "tracking began …" instead of
letting a zero read as "never edited".

The denominator is scoped to items CREATED since tracking began, for the
same reason. Question status reaches back forever while edits only reach
back to TRACKING_SINCE, and dividing a complete denominator by a partial
numerator would publish a confident "100% clean" that actually means "we
were not watching" — the precise misreading the constant exists to
prevent, reintroduced through the back door.
"""

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import Integer, case, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import CurrentUser, require_admin
from api.models.question_bank import QuestionBankItem
from api.models.question_edit import (
    EDIT_KINDS,
    FIELD_QUESTION,
    REGEN_FRESH,
    REGEN_GUIDED,
    TRACKING_SINCE,
    QuestionEdit,
)
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
    kind: str | None = Query(default=None, description="edit_manual | edit_workshop"),
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
        # Scoped so `edit_count` still counts what it counted before the
        # recorder learned to write solution, regenerate and reject rows.
        # Without this the number silently changes meaning: one PATCH can
        # now emit a row per changed field, a regenerate rewrites all
        # three at once, and a reject records a row for a question that
        # was never repaired at all — so a single click would outrank
        # four genuine hand-edits against thresholds (2 = a pattern,
        # 4 = arrived wrong) calibrated on one-row-per-edit. Widening
        # what this page counts is a deliberate redesign, not a
        # side-effect of widening what gets recorded.
        .where(
            QuestionEdit.field == FIELD_QUESTION,
            QuestionEdit.kind.in_(EDIT_KINDS),
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
        # Same scope as the list above, and for a second reason: this
        # drill-in labels its two columns "The AI wrote" and "The teacher
        # changed it to". A solution row would put step prose under a
        # question label, and a reject row writes the item's CURRENT text
        # as `before` — which, if the teacher edited it before binning
        # it, is the teacher's own words displayed as the AI's.
        .where(
            QuestionEdit.bank_item_id == item_id,
            QuestionEdit.field == FIELD_QUESTION,
            QuestionEdit.kind.in_(EDIT_KINDS),
        )
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

    # Scoped like the list: these tiles say "a teacher changed the
    # wording" and "across every question", so counting solution repairs
    # or a reject (where nothing was repaired at all) would make them
    # assert something untrue.
    base = select(QuestionEdit).where(
        QuestionEdit.field == FIELD_QUESTION,
        QuestionEdit.kind.in_(EDIT_KINDS),
    )
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


# ── The board ────────────────────────────────────────────────────────

_CLEAN = "clean"
_REPAIRED = "repaired"
_REDONE = "redone"
_REJECTED = "rejected"
_OUTCOMES = (_CLEAN, _REPAIRED, _REDONE, _REJECTED)

# Below this many settled questions the percentage is noise. Same floor
# the grading and handwriting reports use, so all three agree on what
# "too few to trust" means rather than each inventing its own.
THIN_SAMPLE = 30

# Statuses that represent a verdict. `pending` is a question nobody has
# ruled on yet and `archived` is lifecycle rather than a generation
# defect — neither belongs in a rate about prompt quality.
_SETTLED_STATUSES = ("approved", "rejected")


def _has_kind(*kinds: str) -> Any:
    """EXISTS a question-field edit of any of these kinds on this item."""
    return (
        select(QuestionEdit.id)
        .where(
            QuestionEdit.bank_item_id == QuestionBankItem.id,
            QuestionEdit.field == FIELD_QUESTION,
            QuestionEdit.kind.in_(kinds),
        )
        .exists()
    )


def _outcome_expr() -> Any:
    """Worst outcome wins.

    A question regenerated from scratch AND then rejected is reported as
    rejected; one edited twice then regenerated blind is reported as
    redone. Taking maximum severity rather than the last event keeps the
    buckets disjoint, so they always sum to the denominator and the board
    can never show more outcomes than questions.
    """
    return case(
        (QuestionBankItem.status == "rejected", _REJECTED),
        (_has_kind(REGEN_FRESH), _REDONE),
        (_has_kind(*EDIT_KINDS, REGEN_GUIDED), _REPAIRED),
        else_=_CLEAN,
    )


@router.get("/generation-quality/board")
async def generation_board(
    include_variations: bool = Query(
        default=False,
        description="Include practice variations (generate-similar output)",
    ),
    outcome: str | None = Query(
        default=None, description="clean | repaired | redone | rejected",
    ),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Every generated question and what became of it.

    The denominator this page never had. See the module docstring for why
    it is scoped to items created since tracking began, and why the three
    failure modes are counted separately rather than summed.
    """
    if outcome is not None and outcome not in _OUTCOMES:
        # Silently ignoring an unknown value returns the UNFILTERED list,
        # which reads as "no such questions exist" — the opposite of the
        # truth on a page whose only job is to be trustworthy.
        raise HTTPException(
            status_code=400,
            detail=f"outcome must be one of: {', '.join(_OUTCOMES)}",
        )

    # Only AI-written questions: a teacher's own hand-written question
    # (source='manual') and a PDF extraction (source='imported') say
    # nothing about the generation prompt. Practice variations come from
    # a different prompt path (generate-similar) and are off by default
    # so they cannot dilute the primary signal.
    # generate-similar output is stamped source='practice', NOT
    # 'generated' — so the source filter alone already excludes it, and
    # toggling parent_question_id would have done nothing. Widen the
    # source instead, or the flag is dead API surface that silently
    # returns an identical result set.
    sources = ["generated", "practice"] if include_variations else ["generated"]
    scope = [
        QuestionBankItem.source.in_(sources),
        QuestionBankItem.created_at >= TRACKING_SINCE,
    ]

    settled_scope = [*scope, QuestionBankItem.status.in_(_SETTLED_STATUSES)]

    o = _outcome_expr()
    counts = (await db.execute(
        select(
            func.count().label("settled"),
            *[
                func.sum(case((o == name, 1), else_=0)).label(name)
                for name in _OUTCOMES
            ],
        ).select_from(QuestionBankItem).where(*settled_scope)
    )).one()

    settled = counts.settled or 0
    buckets = {name: int(getattr(counts, name) or 0) for name in _OUTCOMES}

    # Awaiting review. Reported beside the rate, never inside it: a
    # question nobody has ruled on is not a pass and not a failure.
    awaiting = (await db.execute(
        select(func.count()).select_from(QuestionBankItem)
        .where(*scope, QuestionBankItem.status == "pending")
    )).scalar_one() or 0

    list_filters = list(settled_scope)
    if outcome is not None:
        list_filters.append(o == outcome)

    list_total = (await db.execute(
        select(func.count()).select_from(QuestionBankItem).where(*list_filters)
    )).scalar_one() or 0

    rows = (await db.execute(
        select(
            QuestionBankItem.id,
            QuestionBankItem.title,
            QuestionBankItem.question,
            QuestionBankItem.status,
            QuestionBankItem.generation_prompt,
            QuestionBankItem.created_at,
            o.label("outcome"),
        )
        .where(*list_filters)
        # Worst first, so what needs reading is on top.
        .order_by(
            case(
                (o == _REJECTED, 0), (o == _REDONE, 1), (o == _REPAIRED, 2),
                else_=3,
            ).cast(Integer),
            desc(QuestionBankItem.created_at),
        )
        .offset(offset)
        .limit(limit)
    )).all()

    return {
        "summary": {
            "settled": settled,
            **buckets,
            "awaiting": awaiting,
            "clean_rate": (
                round(buckets[_CLEAN] / settled * 100, 1) if settled else 0.0
            ),
            "thin": settled < THIN_SAMPLE,
        },
        "questions": [
            {
                "id": str(r.id),
                "title": r.title,
                "question": r.question,
                "status": r.status,
                "outcome": r.outcome,
                "generation_prompt": r.generation_prompt,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
        "total_count": list_total,
        "tracking_since": TRACKING_SINCE.isoformat(),
    }
