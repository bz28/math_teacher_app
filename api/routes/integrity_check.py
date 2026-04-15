"""Integrity-check endpoints — conversational student chat + teacher
detail/dismiss view.

Mounted at /v1 (role-based prefixes live on the routes themselves).
The conversational redesign collapses the previous /next + /answer
into a single /turn endpoint: student sends a message, server
appends the turn, runs the agent loop, and returns the updated
transcript + per-problem + overall state.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.integrity_pipeline import (
    BADGE_LIKELY,
    BADGE_UNCERTAIN,
    BADGE_UNLIKELY,
    MAX_STUDENT_TURNS,
    PROBLEM_STATUS_DISMISSED,
    PROBLEM_STATUS_SKIPPED_UNREADABLE,
    STATUS_COMPLETE,
    STATUS_SKIPPED_UNREADABLE,
    count_student_turns,
    process_student_turn,
)
from api.database import get_db
from api.middleware.auth import CurrentUser, get_current_user_full, require_teacher
from api.models.assignment import Assignment, Submission
from api.models.integrity_check import (
    IntegrityCheckProblem,
    IntegrityCheckSubmission,
    IntegrityConversationTurn,
)
from api.models.question_bank import QuestionBankItem
from api.models.user import User
from api.routes.teacher_assignments import get_teacher_assignment

router = APIRouter(tags=["integrity"])

# Min chars in a student message. Same 5-char floor we enforced on
# answers in the quiz-style flow — prevents empty/"x"-spam.
MIN_MESSAGE_CHARS = 5


# ── Response shapes ─────────────────────────────────────────────────

class ProblemSummary(BaseModel):
    """Student-facing per-problem status (no extraction, no reasoning)."""
    problem_id: str
    sample_position: int
    status: str
    badge: str | None


class TurnOut(BaseModel):
    """Student-facing transcript turn. Tool calls are collapsed into
    synthetic agent text so the student chat stays simple."""
    ordinal: int
    role: str  # "agent" | "student"
    content: str
    created_at: datetime


class IntegrityStateResponse(BaseModel):
    submission_id: str
    overall_status: str
    overall_badge: str | None
    problems: list[ProblemSummary]
    transcript: list[TurnOut]


class TurnRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    # Clamped to a sane wall-clock range. Negative or absurdly large
    # values from a tampered client would otherwise land in the DB and
    # leak into the teacher transcript.
    seconds_on_turn: int | None = Field(default=None, ge=0, le=3600)


class DismissRequest(BaseModel):
    problem_id: uuid.UUID
    reason: str = Field(default="", max_length=500)


# ── Helpers ─────────────────────────────────────────────────────────

async def _load_my_submission(
    db: AsyncSession, submission_id: uuid.UUID, student_id: uuid.UUID,
) -> Submission:
    """Load a submission; 404 if not found or not yours."""
    sub = (await db.execute(
        select(Submission).where(Submission.id == submission_id)
    )).scalar_one_or_none()
    if sub is None or sub.student_id != student_id:
        raise HTTPException(status_code=404, detail="Submission not found")
    return sub


async def _load_check_for_submission(
    db: AsyncSession, submission_id: uuid.UUID,
) -> IntegrityCheckSubmission | None:
    return (await db.execute(
        select(IntegrityCheckSubmission).where(
            IntegrityCheckSubmission.submission_id == submission_id,
        )
    )).scalar_one_or_none()


async def _load_problems(
    db: AsyncSession, check_id: uuid.UUID,
) -> list[IntegrityCheckProblem]:
    return list((await db.execute(
        select(IntegrityCheckProblem)
        .where(IntegrityCheckProblem.integrity_check_submission_id == check_id)
        .order_by(IntegrityCheckProblem.sample_position.asc())
    )).scalars().all())


async def _load_transcript(
    db: AsyncSession, check_id: uuid.UUID,
) -> list[IntegrityConversationTurn]:
    return list((await db.execute(
        select(IntegrityConversationTurn)
        .where(IntegrityConversationTurn.integrity_check_submission_id == check_id)
        .order_by(IntegrityConversationTurn.ordinal.asc())
    )).scalars().all())


def _student_facing_transcript(
    turns: list[IntegrityConversationTurn],
) -> list[TurnOut]:
    """Filter the transcript to only agent + student text turns.

    Tool-call / tool-result rows are dropped — the student never
    needs to see them, and they would just be confusing in the chat.
    """
    out: list[TurnOut] = []
    for t in turns:
        if t.role not in ("agent", "student"):
            continue
        out.append(TurnOut(
            ordinal=t.ordinal,
            role=t.role,
            content=t.content,
            created_at=t.created_at,
        ))
    return out


def _problem_summaries(
    problems: list[IntegrityCheckProblem],
) -> list[ProblemSummary]:
    return [
        ProblemSummary(
            problem_id=str(p.id),
            sample_position=p.sample_position,
            status=p.status,
            badge=p.badge,
        )
        for p in problems
    ]


# ── Student endpoints ───────────────────────────────────────────────

@router.get("/school/student/integrity/submissions/{submission_id}")
async def get_my_integrity_state(
    submission_id: uuid.UUID,
    user: User = Depends(get_current_user_full),
    db: AsyncSession = Depends(get_db),
) -> IntegrityStateResponse:
    """Resume endpoint for the chat UI. Returns per-problem status +
    the student-facing transcript. Status semantics:

      - "no_check"           : HW has integrity checks disabled
      - "extracting"         : pipeline still running in background
      - "awaiting_student"   : opening agent turn ready, student not
                                yet engaged
      - "in_progress"        : student has sent >= 1 message, check
                                not yet complete
      - "complete"           : agent emitted finish_check (or was
                                force-finalized)
      - "skipped_unreadable" : handwriting was unreadable
    """
    submission = await _load_my_submission(db, submission_id, user.id)
    check = await _load_check_for_submission(db, submission_id)

    if check is None:
        enabled = (await db.execute(
            select(Assignment.integrity_check_enabled)
            .where(Assignment.id == submission.assignment_id)
        )).scalar_one_or_none()
        overall_status = "extracting" if enabled else "no_check"
        return IntegrityStateResponse(
            submission_id=str(submission_id),
            overall_status=overall_status,
            overall_badge=None,
            problems=[],
            transcript=[],
        )

    problems = await _load_problems(db, check.id)
    turns = await _load_transcript(db, check.id)

    return IntegrityStateResponse(
        submission_id=str(submission_id),
        overall_status=check.status,
        overall_badge=check.overall_badge,
        problems=_problem_summaries(problems),
        transcript=_student_facing_transcript(turns),
    )


@router.post("/school/student/integrity/submissions/{submission_id}/turn")
async def post_student_turn(
    submission_id: uuid.UUID,
    body: TurnRequest,
    user: User = Depends(get_current_user_full),
    db: AsyncSession = Depends(get_db),
) -> IntegrityStateResponse:
    """Append a student turn, run the agent loop, return fresh state."""
    await _load_my_submission(db, submission_id, user.id)
    check = await _load_check_for_submission(db, submission_id)
    if check is None:
        raise HTTPException(
            status_code=404, detail="No integrity check for this submission",
        )

    if check.status in (STATUS_COMPLETE, STATUS_SKIPPED_UNREADABLE):
        raise HTTPException(
            status_code=409, detail="Integrity check already complete",
        )
    if check.status == "extracting":
        raise HTTPException(
            status_code=409, detail="Integrity check is still preparing",
        )

    message = body.message.strip()
    if len(message) < MIN_MESSAGE_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"Message must be at least {MIN_MESSAGE_CHARS} characters",
        )

    # Enforce the hard turn cap at the endpoint too, in case the agent
    # loop in a prior turn somehow missed finalization. One count
    # query beats loading the whole transcript.
    if await count_student_turns(check.id, db) >= MAX_STUDENT_TURNS:
        raise HTTPException(
            status_code=409, detail="Integrity check already complete",
        )

    await process_student_turn(check, message, body.seconds_on_turn, db)
    await db.commit()

    # Re-read from the DB to build the response with the freshest state.
    await db.refresh(check)
    problems = await _load_problems(db, check.id)
    turns = await _load_transcript(db, check.id)
    return IntegrityStateResponse(
        submission_id=str(submission_id),
        overall_status=check.status,
        overall_badge=check.overall_badge,
        problems=_problem_summaries(problems),
        transcript=_student_facing_transcript(turns),
    )


# ── Teacher endpoints ───────────────────────────────────────────────

class TeacherTranscriptTurn(BaseModel):
    ordinal: int
    role: str  # "agent" | "student" | "tool_call" | "tool_result"
    content: str
    tool_name: str | None = None
    seconds_on_turn: int | None = None
    created_at: datetime


class TeacherIntegrityProblemRow(BaseModel):
    problem_id: str
    bank_item_id: str
    question: str
    sample_position: int
    status: str
    badge: str | None
    confidence: float | None
    ai_reasoning: str | None
    teacher_dismissed: bool
    teacher_dismissal_reason: str | None
    student_work_extraction: dict[str, Any] | None


class TeacherIntegrityDetail(BaseModel):
    submission_id: str
    overall_status: str
    overall_badge: str | None
    overall_confidence: float | None
    overall_summary: str | None
    problems: list[TeacherIntegrityProblemRow]
    transcript: list[TeacherTranscriptTurn]


@router.get("/teacher/integrity/submissions/{submission_id}")
async def teacher_get_integrity_detail(
    submission_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> TeacherIntegrityDetail:
    """Full transcript + per-problem verdicts + extraction snapshot
    for the teacher's per-submission panel. Ownership: teacher must
    own the assignment."""
    sub = (await db.execute(
        select(Submission).where(Submission.id == submission_id)
    )).scalar_one_or_none()
    if sub is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    await get_teacher_assignment(db, sub.assignment_id, current_user.user_id)

    check = await _load_check_for_submission(db, submission_id)
    if check is None:
        return TeacherIntegrityDetail(
            submission_id=str(submission_id),
            overall_status="no_check",
            overall_badge=None,
            overall_confidence=None,
            overall_summary=None,
            problems=[],
            transcript=[],
        )

    problems = await _load_problems(db, check.id)

    # One hydration query for the bank items so we can surface the
    # question text alongside the extraction.
    items_by_id: dict[uuid.UUID, QuestionBankItem] = {}
    if problems:
        item_rows = (await db.execute(
            select(QuestionBankItem)
            .where(QuestionBankItem.id.in_([p.bank_item_id for p in problems]))
        )).scalars().all()
        for it in item_rows:
            items_by_id[it.id] = it

    problem_rows: list[TeacherIntegrityProblemRow] = []
    for p in problems:
        item = items_by_id.get(p.bank_item_id)
        problem_rows.append(TeacherIntegrityProblemRow(
            problem_id=str(p.id),
            bank_item_id=str(p.bank_item_id),
            question=item.question if item else "(problem text unavailable)",
            sample_position=p.sample_position,
            status=p.status,
            badge=p.badge,
            confidence=p.confidence,
            ai_reasoning=p.ai_reasoning,
            teacher_dismissed=p.teacher_dismissed,
            teacher_dismissal_reason=p.teacher_dismissal_reason,
            student_work_extraction=p.student_work_extraction,
        ))

    turns = await _load_transcript(db, check.id)
    transcript_rows = [
        TeacherTranscriptTurn(
            ordinal=t.ordinal,
            role=t.role,
            content=t.content,
            tool_name=t.tool_name,
            seconds_on_turn=t.seconds_on_turn,
            created_at=t.created_at,
        )
        for t in turns
    ]

    return TeacherIntegrityDetail(
        submission_id=str(submission_id),
        overall_status=check.status,
        overall_badge=check.overall_badge,
        overall_confidence=check.overall_confidence,
        overall_summary=check.overall_summary,
        problems=problem_rows,
        transcript=transcript_rows,
    )


_BADGE_SEVERITY: dict[str, int] = {
    BADGE_LIKELY: 0,
    BADGE_UNCERTAIN: 1,
    BADGE_UNLIKELY: 2,
}


def _recompute_overall_badge(
    problems: list[IntegrityCheckProblem],
) -> str | None:
    """Worst-of across problems the teacher has neither dismissed nor
    marked unreadable. None when no relevant problems remain."""
    remaining = [
        p for p in problems
        if not p.teacher_dismissed
        and p.status != PROBLEM_STATUS_SKIPPED_UNREADABLE
        and p.badge in _BADGE_SEVERITY
    ]
    if not remaining:
        return None
    worst = max(remaining, key=lambda p: _BADGE_SEVERITY[p.badge or ""])
    return worst.badge


@router.post(
    "/teacher/integrity/submissions/{submission_id}/dismiss", status_code=204,
)
async def teacher_dismiss_problem(
    submission_id: uuid.UUID,
    body: DismissRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Mark a per-problem verdict as dismissed and refresh the overall
    badge so the teacher's summary reflects only the verdicts they
    still stand behind. Idempotent; re-dismissing with a new reason
    updates the reason."""
    sub = (await db.execute(
        select(Submission).where(Submission.id == submission_id)
    )).scalar_one_or_none()
    if sub is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    await get_teacher_assignment(db, sub.assignment_id, current_user.user_id)

    check = await _load_check_for_submission(db, submission_id)
    if check is None:
        raise HTTPException(status_code=404, detail="Problem not found")

    problem = (await db.execute(
        select(IntegrityCheckProblem).where(
            IntegrityCheckProblem.id == body.problem_id,
            IntegrityCheckProblem.integrity_check_submission_id == check.id,
        )
    )).scalar_one_or_none()
    if problem is None:
        raise HTTPException(status_code=404, detail="Problem not found")

    problem.teacher_dismissed = True
    problem.teacher_dismissal_reason = body.reason or None
    # Flip to dismissed unless the problem was already terminal in a
    # different terminal state (unreadable) — preserve that signal.
    if problem.status != PROBLEM_STATUS_SKIPPED_UNREADABLE:
        problem.status = PROBLEM_STATUS_DISMISSED

    # Recompute overall_badge from the surviving problems so the
    # submission header doesn't keep flagging the student on a verdict
    # the teacher has overruled.
    all_problems = await _load_problems(db, check.id)
    check.overall_badge = _recompute_overall_badge(all_problems)

    await db.commit()
