"""Teacher: "add this to your rubric?" offers after lowering a grade.

The offer is made by `api.core.rubric_suggestions`; these routes ask for
one (after the teacher lowers a grade and writes why), record the
teacher's answer, and list what a class declined so a "no" can be undone.
"""

import uuid
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.class_rubric import MAX_RULE_CHARS, class_rules, rubric_revision
from api.core.rubric_suggestions import decide, offer_json, suggest_for_edit
from api.database import get_db
from api.middleware.auth import CurrentUser, require_teacher
from api.middleware.rate_limit import limiter
from api.models.assignment import Submission, SubmissionGrade
from api.models.course import Course
from api.models.rubric_suggestion import RubricSuggestion
from api.routes.teacher_assignments import get_teacher_assignment
from api.routes.teacher_courses import get_teacher_course
from api.services.bank import load_problems_for_assignment

router = APIRouter()


class SuggestRequest(BaseModel):
    problem_id: uuid.UUID
    # The teacher's grade and comment as just entered — sent with the ask
    # rather than read back, so the offer never races the grade save.
    teacher_percent: float = Field(ge=0, le=100)
    comment: str = Field(max_length=4000)


class DecideRequest(BaseModel):
    action: Literal["add_class", "add_homework", "decline"]
    text: str | None = Field(default=None, max_length=MAX_RULE_CHARS)
    points: int | None = Field(default=None, ge=0, le=100)


# Each ask is one small paid call; a teacher grading at full speed lowers
# a few grades a minute, nowhere near this.
@router.post("/submissions/{submission_id}/rubric-suggestion")
@limiter.limit("60/minute")
async def suggest_rubric_rule(
    request: Request,
    submission_id: uuid.UUID,
    body: SuggestRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """After a teacher lowers an AI grade with a comment: the rule to offer
    adding to the class rubric, or null. Never changes a rubric."""
    sub = (await db.execute(
        select(Submission).where(Submission.id == submission_id)
    )).scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")
    # The same check as saving the grade: only the homework's teacher.
    assignment = await get_teacher_assignment(db, sub.assignment_id, current_user.user_id)

    ai = (await db.execute(
        select(SubmissionGrade.ai_breakdown).where(SubmissionGrade.submission_id == sub.id)
    )).scalar_one_or_none()
    problems = await load_problems_for_assignment(db, assignment)
    problem = next((p for p in problems if p["bank_item_id"] == str(body.problem_id)), None)
    ai_grade = next(
        (g for g in (ai or {}).get("grades", [])
         if problem and g.get("problem_position") == problem["position"]),
        None,
    )
    ai_percent = ai_grade.get("percent") if ai_grade else None
    if problem is None or not isinstance(ai_percent, (int, float)):
        return {"suggestion": None}  # no AI grade to have lowered
    # The feedback box starts pre-filled with the AI's draft, and teachers
    # usually add a line after it rather than rewrite it. Only what the
    # teacher added is their reason; the draft itself is none.
    said = _teacher_words(body.comment, ai_grade)
    if not said:
        return {"suggestion": None}

    offer = await suggest_for_edit(
        db,
        assignment=assignment,
        submission_id=sub.id,
        problem_id=body.problem_id,
        question=str(problem.get("question") or ""),
        answer_key=str(problem.get("final_answer") or ""),
        student_answer=str(ai_grade.get("student_answer") or "") if ai_grade else "",
        ai_percent=float(ai_percent),
        teacher_percent=body.teacher_percent,
        comment=said,
        teacher_id=current_user.user_id,
    )
    await db.commit()
    return {"suggestion": offer_json(offer) if offer else None}


def _teacher_words(comment: str, ai_grade: dict[str, Any] | None) -> str:
    """The comment minus the AI's pre-filled draft it starts with (the
    box shows `student_feedback`, or `reasoning` on older grades)."""
    said = comment.strip()
    for k in ("student_feedback", "reasoning"):
        draft = str((ai_grade or {}).get(k) or "").strip()
        if draft and said.startswith(draft):
            return said[len(draft):].strip()
    return said


@router.post("/rubric-suggestions/{suggestion_id}/decide")
async def decide_rubric_suggestion(
    suggestion_id: uuid.UUID,
    body: DecideRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Record the teacher's answer: add to the class rubric, add to this
    homework only, or decline (never offered again)."""
    # Locked: two surfaces answering the same offer (the review card and
    # the declined list) must not both add it.
    offer = (await db.execute(
        select(RubricSuggestion).where(RubricSuggestion.id == suggestion_id).with_for_update()
    )).scalar_one_or_none()
    if not offer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Suggestion not found")
    await get_teacher_course(db, offer.course_id, current_user.user_id)
    if body.action == "add_homework":
        # Writing a homework's rubric is its teacher's call, as on the
        # homework page.
        if offer.assignment_id is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="That homework no longer exists. Add the rule to the class rubric instead.",
            )
        await get_teacher_assignment(db, offer.assignment_id, current_user.user_id)
    if offer.status in ("added", "added_homework"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Already added")
    try:
        await decide(
            db, offer, action=body.action, text=body.text, points=body.points,
            points_set="points" in body.model_fields_set,
        )
    except (ValidationError, ValueError) as e:
        await db.rollback()
        detail = (
            "This class already has the most rules it can hold"
            if isinstance(e, ValidationError) else str(e)
        )
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=detail) from e
    await db.commit()
    rubric = (await db.execute(
        select(Course.rubric).where(Course.id == offer.course_id)
    )).scalar_one_or_none()
    return {"suggestion": offer_json(offer), "rules": class_rules(rubric), "rev": rubric_revision(rubric)}


@router.get("/courses/{course_id}/rubric-suggestions")
async def list_rubric_suggestions(
    course_id: uuid.UUID,
    status_filter: Literal["declined", "pending"] = "declined",
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """A class's offers by status — the declined list lets a "no" be undone."""
    await get_teacher_course(db, course_id, current_user.user_id)
    rows = (await db.execute(
        select(RubricSuggestion)
        .where(RubricSuggestion.course_id == course_id, RubricSuggestion.status == status_filter)
        .order_by(RubricSuggestion.decided_at.desc().nullslast(), RubricSuggestion.created_at.desc())
    )).scalars().all()
    return {"suggestions": [offer_json(s) for s in rows]}
