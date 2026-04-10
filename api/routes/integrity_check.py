"""Integrity-check endpoints — student-facing chat flow + teacher
detail/dismiss view.

Mounted at /v1 (the role-based prefixes live on the routes
themselves). PR 1 ships the entire HTTP surface so PR 2 (student
chat UI) and PR 3 (teacher badges + expand view) can wire against
real endpoints with no further backend work.

Zero LLM calls in this module — scoring goes through the stub.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.integrity_ai import score_answer
from api.core.integrity_pipeline import (
    STATUS_COMPLETE,
    STATUS_DISMISSED,
    STATUS_SKIPPED_UNREADABLE,
    TERMINAL_STATUSES,
    VERDICT_SKIPPED,
    compute_badge,
)
from api.database import get_db
from api.middleware.auth import CurrentUser, get_current_user_full, require_teacher
from api.models.assignment import Assignment, Submission
from api.models.integrity_check import IntegrityCheckProblem, IntegrityCheckResponse
from api.models.user import User
from api.routes.teacher_assignments import get_teacher_assignment

router = APIRouter(tags=["integrity"])

# Per the parent plan §2.2: minimum 5 chars to prevent empty-spam.
MIN_ANSWER_CHARS = 5


# ── Response shapes ──

class IntegrityProblemSummary(BaseModel):
    problem_id: str
    sample_position: int
    status: str
    question_count: int
    answered_count: int


class IntegrityStateResponse(BaseModel):
    submission_id: str
    overall_status: str  # "in_progress" | "complete" | "no_check"
    problems: list[IntegrityProblemSummary]


class NextQuestionDone(BaseModel):
    done: bool = True


class NextQuestionServed(BaseModel):
    done: bool = False
    problem_id: str
    problem_position: int  # 1-based for UI ("Problem 1 of 5")
    total_problems: int
    question_id: str
    question_index: int  # 0-based; UI shows index+1
    questions_in_problem: int
    question_text: str
    rephrase_used: bool


class AnswerRequest(BaseModel):
    question_id: uuid.UUID
    answer: str
    seconds_on_question: int | None = None
    tab_switch_count: int = 0


class DismissRequest(BaseModel):
    problem_id: uuid.UUID
    reason: str = Field(default="", max_length=500)


# ── Helpers ──

async def _load_my_submission(
    db: AsyncSession, submission_id: uuid.UUID, student_id: uuid.UUID,
) -> Submission:
    """Load a submission and enforce that it belongs to the calling
    student. 404 on either not found or not yours — never leak
    existence."""
    sub = (await db.execute(
        select(Submission).where(Submission.id == submission_id)
    )).scalar_one_or_none()
    if sub is None or sub.student_id != student_id:
        raise HTTPException(status_code=404, detail="Submission not found")
    return sub


async def _load_problems_with_responses(
    db: AsyncSession, submission_id: uuid.UUID,
) -> list[tuple[IntegrityCheckProblem, list[IntegrityCheckResponse]]]:
    """Two queries (problems + responses) joined in Python. Avoids
    the JSON-equality DISTINCT issue and keeps the row mapping
    explicit."""
    problems = (await db.execute(
        select(IntegrityCheckProblem)
        .where(IntegrityCheckProblem.submission_id == submission_id)
        .order_by(IntegrityCheckProblem.sample_position.asc())
    )).scalars().all()
    if not problems:
        return []
    responses = (await db.execute(
        select(IntegrityCheckResponse)
        .where(IntegrityCheckResponse.integrity_check_problem_id.in_(
            [p.id for p in problems],
        ))
        .order_by(IntegrityCheckResponse.question_index.asc())
    )).scalars().all()
    by_problem: dict[uuid.UUID, list[IntegrityCheckResponse]] = {p.id: [] for p in problems}
    for r in responses:
        by_problem[r.integrity_check_problem_id].append(r)
    return [(p, by_problem[p.id]) for p in problems]


def _derive_overall_status(
    problems: list[tuple[IntegrityCheckProblem, list[IntegrityCheckResponse]]],
) -> str:
    if not problems:
        return "no_check"
    if all(p.status in TERMINAL_STATUSES for p, _ in problems):
        return STATUS_COMPLETE
    return "in_progress"


# ── Student endpoints ──

@router.get("/school/student/integrity/submissions/{submission_id}")
async def get_my_integrity_state(
    submission_id: uuid.UUID,
    user: User = Depends(get_current_user_full),
    db: AsyncSession = Depends(get_db),
) -> IntegrityStateResponse:
    """Resume / progress endpoint. Returns the per-problem status
    summary so the chat UI knows what's done and what's pending.

    Overall status:
    - "complete": all problems in a terminal state
    - "in_progress": problem rows exist but not all terminal
    - "pending": no problem rows yet AND the HW has integrity
      checks enabled (pipeline is running in the background)
    - "no_check": no problem rows AND the HW has integrity checks
      disabled (nothing to do — pipeline will never run)
    """
    submission = await _load_my_submission(db, submission_id, user.id)
    grouped = await _load_problems_with_responses(db, submission_id)

    summaries: list[IntegrityProblemSummary] = []
    for p, responses in grouped:
        answered = sum(1 for r in responses if r.student_answer is not None)
        summaries.append(IntegrityProblemSummary(
            problem_id=str(p.id),
            sample_position=p.sample_position,
            status=p.status,
            question_count=len(responses),
            answered_count=answered,
        ))

    # When there are no problem rows, we have to disambiguate between
    # "the pipeline is still running in the background" and "this HW
    # doesn't have integrity checks enabled." One extra query only on
    # the empty path.
    if not grouped:
        enabled = (await db.execute(
            select(Assignment.integrity_check_enabled)
            .where(Assignment.id == submission.assignment_id)
        )).scalar_one_or_none()
        overall_status = "pending" if enabled else "no_check"
    else:
        overall_status = _derive_overall_status(grouped)

    return IntegrityStateResponse(
        submission_id=str(submission_id),
        overall_status=overall_status,
        problems=summaries,
    )


@router.get("/school/student/integrity/submissions/{submission_id}/next")
async def get_next_question(
    submission_id: uuid.UUID,
    user: User = Depends(get_current_user_full),
    db: AsyncSession = Depends(get_db),
) -> NextQuestionServed | NextQuestionDone:
    """Return the next pending question (lowest sample_position →
    lowest question_index) or {done: true}. Pure read — no state
    changes."""
    await _load_my_submission(db, submission_id, user.id)
    grouped = await _load_problems_with_responses(db, submission_id)
    if not grouped:
        return NextQuestionDone()

    total_problems = len(grouped)
    for p, responses in grouped:
        if p.status in (STATUS_DISMISSED, STATUS_SKIPPED_UNREADABLE):
            continue
        for r in responses:
            if r.student_answer is None:
                return NextQuestionServed(
                    problem_id=str(p.id),
                    problem_position=p.sample_position + 1,
                    total_problems=total_problems,
                    question_id=str(r.id),
                    question_index=r.question_index,
                    questions_in_problem=len(responses),
                    question_text=r.question_text,
                    rephrase_used=r.rephrase_used,
                )
    return NextQuestionDone()


@router.post("/school/student/integrity/submissions/{submission_id}/answer")
async def submit_answer(
    submission_id: uuid.UUID,
    body: AnswerRequest,
    user: User = Depends(get_current_user_full),
    db: AsyncSession = Depends(get_db),
) -> NextQuestionServed | NextQuestionDone:
    """Score the kid's answer (via stub), advance state, return next.

    Idempotent on (question_id): re-posting the same question_id
    overwrites the previous answer. Per the parent plan §2.2 the
    minimum answer length is 5 chars to prevent empty-spam.
    """
    await _load_my_submission(db, submission_id, user.id)

    response = (await db.execute(
        select(IntegrityCheckResponse).where(IntegrityCheckResponse.id == body.question_id)
    )).scalar_one_or_none()
    if response is None:
        raise HTTPException(status_code=404, detail="Question not found")

    # Ownership: the response's parent problem must belong to this submission.
    problem = (await db.execute(
        select(IntegrityCheckProblem).where(
            IntegrityCheckProblem.id == response.integrity_check_problem_id,
        )
    )).scalar_one_or_none()
    if problem is None or problem.submission_id != submission_id:
        raise HTTPException(status_code=404, detail="Question not found")

    if len(body.answer.strip()) < MIN_ANSWER_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"Answer must be at least {MIN_ANSWER_CHARS} characters",
        )

    # Pass the student's work extraction so the scorer can check
    # answers against what the student actually wrote.
    extraction = problem.student_work_extraction or {}
    score = await score_answer(
        {
            "question_text": response.question_text,
            "expected_shape": response.expected_shape,
            "rubric_hint": response.rubric_hint,
        },
        body.answer,
        extraction=extraction,
    )
    now = datetime.now(UTC)
    response.student_answer = body.answer
    response.answer_verdict = score["verdict"]
    response.seconds_on_question = body.seconds_on_question
    response.tab_switch_count = body.tab_switch_count
    response.answered_at = now
    response.scored_at = now

    # If all questions for this problem are now answered, compute
    # the badge and mark the problem complete.
    siblings = (await db.execute(
        select(IntegrityCheckResponse)
        .where(IntegrityCheckResponse.integrity_check_problem_id == problem.id)
    )).scalars().all()
    all_answered = all(r.student_answer is not None for r in siblings)
    if all_answered:
        verdicts = [r.answer_verdict or VERDICT_SKIPPED for r in siblings]
        flags = score.get("flags", [])
        badge, raw = compute_badge(verdicts, flags)
        problem.status = STATUS_COMPLETE
        problem.badge = badge
        problem.raw_score = raw
        problem.ai_reasoning = score.get("reasoning", "")

    await db.commit()

    # Return the next question (or done) so the client only does
    # one round trip per answer.
    return await get_next_question(submission_id, user, db)



# ── Teacher endpoints ──

class TeacherIntegrityResponseRow(BaseModel):
    response_id: str
    question_index: int
    question_text: str
    student_answer: str | None
    answer_verdict: str | None
    seconds_on_question: int | None
    tab_switch_count: int
    rephrase_used: bool


class TeacherIntegrityProblemRow(BaseModel):
    problem_id: str
    bank_item_id: str
    sample_position: int
    status: str
    badge: str | None
    raw_score: float | None
    ai_reasoning: str | None
    teacher_dismissed: bool
    teacher_dismissal_reason: str | None
    responses: list[TeacherIntegrityResponseRow]


class TeacherIntegrityDetail(BaseModel):
    submission_id: str
    overall_status: str
    problems: list[TeacherIntegrityProblemRow]


@router.get("/teacher/integrity/submissions/{submission_id}")
async def teacher_get_integrity_detail(
    submission_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> TeacherIntegrityDetail:
    """Full Q&A + reasoning payload for the teacher's per-submission
    panel. Ownership: teacher must own the assignment."""
    sub = (await db.execute(
        select(Submission).where(Submission.id == submission_id)
    )).scalar_one_or_none()
    if sub is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    # Ownership via the assignment
    await get_teacher_assignment(db, sub.assignment_id, current_user.user_id)

    grouped = await _load_problems_with_responses(db, submission_id)

    out_problems: list[TeacherIntegrityProblemRow] = []
    for p, responses in grouped:
        out_problems.append(TeacherIntegrityProblemRow(
            problem_id=str(p.id),
            bank_item_id=str(p.bank_item_id),
            sample_position=p.sample_position,
            status=p.status,
            badge=p.badge,
            raw_score=p.raw_score,
            ai_reasoning=p.ai_reasoning,
            teacher_dismissed=p.teacher_dismissed,
            teacher_dismissal_reason=p.teacher_dismissal_reason,
            responses=[
                TeacherIntegrityResponseRow(
                    response_id=str(r.id),
                    question_index=r.question_index,
                    question_text=r.question_text,
                    student_answer=r.student_answer,
                    answer_verdict=r.answer_verdict,
                    seconds_on_question=r.seconds_on_question,
                    tab_switch_count=r.tab_switch_count,
                    rephrase_used=r.rephrase_used,
                )
                for r in responses
            ],
        ))

    return TeacherIntegrityDetail(
        submission_id=str(submission_id),
        overall_status=_derive_overall_status(grouped),
        problems=out_problems,
    )


@router.post("/teacher/integrity/submissions/{submission_id}/dismiss", status_code=204)
async def teacher_dismiss_problem(
    submission_id: uuid.UUID,
    body: DismissRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Mark a problem's check as dismissed (teacher's call). The row
    is preserved for audit / future model improvement. Idempotent —
    re-dismissing is a no-op."""
    sub = (await db.execute(
        select(Submission).where(Submission.id == submission_id)
    )).scalar_one_or_none()
    if sub is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    await get_teacher_assignment(db, sub.assignment_id, current_user.user_id)

    problem = (await db.execute(
        select(IntegrityCheckProblem).where(IntegrityCheckProblem.id == body.problem_id)
    )).scalar_one_or_none()
    if problem is None or problem.submission_id != submission_id:
        raise HTTPException(status_code=404, detail="Problem not found")

    # Always apply: a teacher who re-dismisses with a different
    # reason should be able to update it (the previous behavior
    # silently dropped the new reason). The status flip is
    # idempotent — re-setting to dismissed is a no-op write.
    problem.teacher_dismissed = True
    problem.teacher_dismissal_reason = body.reason or None
    problem.status = STATUS_DISMISSED
    await db.commit()
