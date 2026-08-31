"""Admin "Solution quality" report — scoring the solve call.

Scores `decompose`, the LLM call that works a question's step-by-step
solution. It is judged the only way it can be: by whether a teacher had
to fix the answer before approving the question.

## Why this replaces an LLM judge

This page previously read `quality_scores`, written by an LLM-as-judge in
`api/core/judge.py`. That judge never ran once. The commit that
introduced it (`542aa417`) added the call already commented out, with a
`TODO: re-enable once judge prompt is refined`, and a later commit
deleted the dead comment. The table was empty by construction, so the
page rendered a red "WEAK" verdict and 0.0/5 on every dimension —
asserting the AI was bad at a job nobody had ever measured.

The judge is deleted here. The signal that replaces it costs nothing: a
teacher fixing the worked answer is a human saying the solve was wrong,
and `question_edits` has recorded exactly that since the recorder learned
about fields.

## Why this matters beyond one tab

`decompose` has five callers — solving bank questions, the tutoring
session (twice), practice generation, and work diagnosis. It is ONE
prompt behind five surfaces, and the question bank is the only one where
a human corrects its output. What this page shows is the only evidence
available about a call that also runs where nobody is watching.

## Buckets

Solutions have no rejection of their own: binning belongs to the QUESTION
that owns the solution. A regeneration replaces the whole item, so it is
a generation-side event and this page judges the solution that survived.
That leaves two live buckets and two labelled exclusions:

- CLEAN     approved, solution never edited
- REPAIRED  approved, steps or final answer edited
- QUESTION REJECTED  excluded — the solution never got a real look
- AWAITING  excluded — still pending review

The rate is CLEAN / (CLEAN + REPAIRED) over approved questions only.
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
    FIELD_FINAL_ANSWER,
    FIELD_SOLUTION,
    TRACKING_SINCE,
    QuestionEdit,
)
from api.models.school import School
from api.models.user import User

router = APIRouter()

_CLEAN = "clean"
_REPAIRED = "repaired"
_OUTCOMES = (_CLEAN, _REPAIRED)

# Same floor as the generation, grading and handwriting reports, so every
# quality page agrees on what "too few to trust" means.
THIN_SAMPLE = 30

# The two fields `decompose` produces. Grouped because a teacher fixing
# either one is saying the same thing: the solve was wrong.
_SOLUTION_FIELDS = (FIELD_SOLUTION, FIELD_FINAL_ANSWER)


def _solution_repaired() -> Any:
    return (
        select(QuestionEdit.id)
        .where(
            QuestionEdit.bank_item_id == QuestionBankItem.id,
            QuestionEdit.field.in_(_SOLUTION_FIELDS),
        )
        .exists()
    )


def _outcome_expr() -> Any:
    return case((_solution_repaired(), _REPAIRED), else_=_CLEAN)


@router.get("/quality")
async def solution_quality(
    include_variations: bool = Query(default=False),
    outcome: str | None = Query(default=None, description="clean | repaired"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Every approved generated question, and whether its solution held."""
    if outcome is not None and outcome not in _OUTCOMES:
        raise HTTPException(
            status_code=400,
            detail=f"outcome must be one of: {', '.join(_OUTCOMES)}",
        )

    # Scoped exactly like the generation board, and for the same reasons:
    # only AI-written questions, variations off by default, and nothing
    # created before edits were recorded — otherwise a complete
    # denominator over a partial numerator publishes a confident rate
    # that means "we were not watching".
    scope = [
        QuestionBankItem.source == "generated",
        QuestionBankItem.created_at >= TRACKING_SINCE,
    ]
    if not include_variations:
        scope.append(QuestionBankItem.parent_question_id.is_(None))

    # Approved only. A rejected question's solution never got a real
    # look, and a pending one has not been judged yet — counting either
    # would put an unexamined solution in the numerator or denominator.
    judged_scope = [*scope, QuestionBankItem.status == "approved"]

    o = _outcome_expr()
    counts = (await db.execute(
        select(
            func.count().label("judged"),
            *[
                func.sum(case((o == name, 1), else_=0)).label(name)
                for name in _OUTCOMES
            ],
        ).select_from(QuestionBankItem).where(*judged_scope)
    )).one()

    judged = counts.judged or 0
    buckets = {name: int(getattr(counts, name) or 0) for name in _OUTCOMES}

    # The two exclusions, reported by REASON rather than lumped into one
    # "not counted" figure. "Never assessed" describes our bookkeeping;
    # "the question was rejected" describes what actually happened.
    excluded = (await db.execute(
        select(
            func.sum(case(
                (QuestionBankItem.status == "rejected", 1), else_=0,
            )).label("question_rejected"),
            func.sum(case(
                (QuestionBankItem.status == "pending", 1), else_=0,
            )).label("awaiting"),
        ).select_from(QuestionBankItem).where(*scope)
    )).one()

    list_filters = list(judged_scope)
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
            QuestionBankItem.final_answer,
            QuestionBankItem.created_at,
            o.label("outcome"),
        )
        .where(*list_filters)
        # Repairs first — a solution nobody touched has nothing to debug.
        .order_by(
            case((o == _REPAIRED, 0), else_=1).cast(Integer),
            desc(QuestionBankItem.created_at),
        )
        .offset(offset)
        .limit(limit)
    )).all()

    return {
        "summary": {
            "judged": judged,
            **buckets,
            "question_rejected": int(excluded.question_rejected or 0),
            "awaiting": int(excluded.awaiting or 0),
            "clean_rate": (
                round(buckets[_CLEAN] / judged * 100, 1) if judged else 0.0
            ),
            "thin": judged < THIN_SAMPLE,
        },
        "questions": [
            {
                "id": str(r.id),
                "title": r.title,
                "question": r.question,
                "final_answer": r.final_answer,
                "outcome": r.outcome,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
        "total_count": list_total,
        "tracking_since": TRACKING_SINCE.isoformat(),
    }


@router.get("/quality/{item_id}")
async def solution_repair_history(
    item_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """One question's solution repairs, oldest first.

    The diffs are the payload. A count tells you WHICH solution to look
    at; only the before/after tells you what the solve prompt got wrong.
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
            QuestionEdit.field,
            QuestionEdit.before,
            QuestionEdit.after,
            QuestionEdit.created_at,
            User.name.label("editor_name"),
            User.email.label("editor_email"),
            School.name.label("school_name"),
        )
        .outerjoin(User, User.id == QuestionEdit.edited_by_id)
        .outerjoin(School, School.id == QuestionEdit.school_id)
        .where(
            QuestionEdit.bank_item_id == item_id,
            QuestionEdit.field.in_(_SOLUTION_FIELDS),
        )
        .order_by(QuestionEdit.created_at.asc())
    )).all()

    return {
        "id": str(item.id),
        "title": item.title,
        "question": item.question,
        "final_answer": item.final_answer,
        "status": item.status,
        "edits": [
            {
                "id": str(e.id),
                "kind": e.kind,
                "field": e.field,
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
