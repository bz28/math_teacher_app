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
    MAX_STUDENT_TURNS,
    PROBLEM_STATUS_DISMISSED,
    PROBLEM_STATUS_SKIPPED_UNREADABLE,
    STATUS_COMPLETE,
    STATUS_SKIPPED_UNREADABLE,
    TOOL_GENERATE_VARIANT,
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
    """Student-facing per-problem summary. Carries the question text
    so the chat can show students what the agent is asking about
    (they need to reference it while answering). No rubric, no
    reasoning — those are teacher-only.
    """
    problem_id: str
    sample_position: int
    status: str
    # Question prompt the student is being asked about. Null as a
    # fallback when the bank item has been deleted between publish and
    # the state request (pathological).
    question: str | None


class TurnOut(BaseModel):
    """Student-facing transcript turn. Tool calls are collapsed into
    synthetic agent text so the student chat stays simple."""
    ordinal: int
    role: str  # "agent" | "student"
    content: str
    created_at: datetime
    # True on the agent reply that immediately follows a generate_variant
    # tool call — i.e., the turn in which the agent presents the fresh
    # isomorphic problem to the student. Frontend renders this turn as a
    # distinguished "Quick practice" card so the student visually
    # registers "this is a fresh problem to approach", not normal chat.
    # False on every other agent turn.
    is_variant_probe: bool = False


class IntegrityStateResponse(BaseModel):
    submission_id: str
    overall_status: str
    # One of pass / needs_practice / tutor_pivot / flag_for_review.
    # Null when status is extracting/awaiting_student/in_progress/
    # skipped_unreadable, or when the turn cap was hit without a
    # conclusion. Student-facing UI doesn't distinguish pass vs
    # flag_for_review — both look the same at the door.
    disposition: str | None
    student_flagged_extraction: bool
    # Vision-extracted steps from the student's own handwritten work.
    # Surfaced so the confirm screen can show the reader's take before
    # the chat starts. All sampled problems share one extraction, so
    # this lives on the response root rather than per-problem.
    extraction: dict[str, Any] | None
    problems: list[ProblemSummary]
    transcript: list[TurnOut]


# Per-event and array-length caps. A tampered client can't land
# arbitrarily large events in the teacher record. 24h = same ceiling
# as seconds_on_turn. 1 MB paste + 256 events per turn are both
# generous but finite.
_MAX_BLUR_DURATION_MS = 86_400_000
_MAX_PASTE_BYTE_COUNT = 1_000_000
_MAX_EVENTS_PER_TURN = 256
_MAX_CADENCE_MS = 86_400_000
_MAX_CADENCE_COUNTER = 100_000


class FocusBlurEvent(BaseModel):
    """One interval the chat window was backgrounded/unfocused."""

    at: str = Field(max_length=32)  # ISO timestamp
    duration_ms: int = Field(ge=0, le=_MAX_BLUR_DURATION_MS)


class PasteEvent(BaseModel):
    """One paste event on the chat textarea. Size only — never content."""

    at: str = Field(max_length=32)
    byte_count: int = Field(ge=0, le=_MAX_PASTE_BYTE_COUNT)


class TypingCadence(BaseModel):
    """Typing-pattern summary for the turn. Distinguishes steady-
    typing-with-edits from silent-then-bulk-insert."""

    total_ms: int = Field(ge=0, le=_MAX_CADENCE_MS)
    pauses_over_3s: int = Field(ge=0, le=_MAX_CADENCE_COUNTER)
    edits: int = Field(ge=0, le=_MAX_CADENCE_COUNTER)


class TurnTelemetry(BaseModel):
    """Client-captured behavioral signals attached to a student turn.

    All teacher-facing evidence; never surfaced to the student. The
    pipeline stores this as-is on `IntegrityConversationTurn.telemetry`
    and the teacher dashboard will render it on flag_for_review cases.
    Nested event models + array caps stop a tampered client from
    polluting the teacher record with absurd values or unbounded lists.
    """

    focus_blur_events: list[FocusBlurEvent] = Field(
        default_factory=list, max_length=_MAX_EVENTS_PER_TURN,
    )
    paste_events: list[PasteEvent] = Field(
        default_factory=list, max_length=_MAX_EVENTS_PER_TURN,
    )
    typing_cadence: TypingCadence | None = None

    # Whether the user tapped the "need more time" button at any point
    # during this turn. Non-punitive — just noted for teacher context.
    # Wiring for the button itself lands with the student UX PR.
    need_more_time_used: bool = False

    # Viewport type as reported by the client. Informational; not used
    # to gate anything.
    device_type: str | None = Field(default=None, max_length=16)


class TurnRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    # Clamped so a tampered client can't land negative/absurd values in
    # the teacher transcript. Upper bound = 24h; students can legitimately
    # leave the chat open, walk away, and come back much later than an
    # hour to finish — so the cap only filters tampering, not real use.
    seconds_on_turn: int | None = Field(default=None, ge=0, le=86400)
    # Behavioral signals captured client-side during the turn. Optional
    # so older clients / mobile (pre-telemetry) keep working.
    telemetry: TurnTelemetry | None = None


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
    One derived flag: the first agent turn after a SUCCESSFUL
    generate_variant call is marked `is_variant_probe=True` so the
    frontend can render it as a distinguished "quick practice" card.

    Success is determined by pairing tool_call → tool_result via
    tool_use_id. A tool_call alone isn't enough — a rejected
    generate_variant (second call in session, bogus problem_id, LLM
    failure) shouldn't flag the next agent recovery text as a
    variant probe, because no variant actually got generated.
    """
    # Build a tool_use_id → tool_name map so we can match tool_results
    # back to their originating tool_calls.
    tool_name_by_use_id: dict[str, str] = {}
    for t in turns:
        if t.role == "tool_call" and t.tool_use_id and t.tool_name:
            tool_name_by_use_id[t.tool_use_id] = t.tool_name

    out: list[TurnOut] = []
    pending_variant = False
    for t in turns:
        if t.role == "tool_call":
            continue
        if t.role == "tool_result":
            # Only arm on successful generate_variant tool_results.
            # Handler returns a string starting with "accepted:" on
            # success; anything else (including "rejected: ...") is
            # treated as non-variant.
            if (
                t.tool_use_id
                and tool_name_by_use_id.get(t.tool_use_id) == TOOL_GENERATE_VARIANT
                and t.content.startswith("accepted:")
            ):
                pending_variant = True
            continue
        if t.role not in ("agent", "student"):
            continue
        is_variant_probe = t.role == "agent" and pending_variant
        # Consume the flag on the first agent turn after it was armed;
        # only that one turn renders as the variant probe card.
        if is_variant_probe:
            pending_variant = False
        out.append(TurnOut(
            ordinal=t.ordinal,
            role=t.role,
            content=t.content,
            created_at=t.created_at,
            is_variant_probe=is_variant_probe,
        ))
    return out


def _problem_summaries(
    problems: list[IntegrityCheckProblem],
    questions_by_bank_id: dict[uuid.UUID, str],
) -> list[ProblemSummary]:
    return [
        ProblemSummary(
            problem_id=str(p.id),
            sample_position=p.sample_position,
            status=p.status,
            question=questions_by_bank_id.get(p.bank_item_id),
        )
        for p in problems
    ]


async def _load_problem_questions(
    db: AsyncSession, problems: list[IntegrityCheckProblem],
) -> dict[uuid.UUID, str]:
    """Batch-fetch the question text for every probed problem. Used
    to populate the student-facing summary so the chat can show the
    problem alongside the agent's questions."""
    if not problems:
        return {}
    bank_ids = [p.bank_item_id for p in problems]
    rows = (await db.execute(
        select(QuestionBankItem.id, QuestionBankItem.question)
        .where(QuestionBankItem.id.in_(bank_ids))
    )).all()
    return {row.id: row.question for row in rows}


def _first_extraction(
    problems: list[IntegrityCheckProblem],
) -> dict[str, Any] | None:
    """All sampled problems share one extraction today (the pipeline
    writes the same dict to every row in start_integrity_check). Pick
    any non-null copy. Returns None when no problems exist or none
    carry an extraction (pathological edge case). If per-problem
    extractions ever diverge, revisit this — callers expect one
    extraction per submission.
    """
    for p in problems:
        if p.student_work_extraction:
            return p.student_work_extraction
    return None


async def _build_state_response(
    submission_id: uuid.UUID,
    check: IntegrityCheckSubmission | None,
    problems: list[IntegrityCheckProblem],
    turns: list[IntegrityConversationTurn],
    db: AsyncSession,
    *,
    fallback_status: str,
) -> IntegrityStateResponse:
    """One source of truth for the student-facing state payload.

    `fallback_status` is used when the submission has no
    IntegrityCheckSubmission row yet — "extracting" when the pipeline
    is still running in the background, "no_check" when integrity is
    disabled on the assignment.
    """
    if check is None:
        return IntegrityStateResponse(
            submission_id=str(submission_id),
            overall_status=fallback_status,
            disposition=None,
            student_flagged_extraction=False,
            extraction=None,
            problems=[],
            transcript=[],
        )
    questions = await _load_problem_questions(db, problems)
    return IntegrityStateResponse(
        submission_id=str(submission_id),
        overall_status=check.status,
        disposition=check.disposition,
        student_flagged_extraction=check.student_flagged_extraction,
        extraction=_first_extraction(problems),
        problems=_problem_summaries(problems, questions),
        transcript=_student_facing_transcript(turns),
    )


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
        return await _build_state_response(
            submission_id, None, [], [], db,
            fallback_status="extracting" if enabled else "no_check",
        )

    problems = await _load_problems(db, check.id)
    turns = await _load_transcript(db, check.id)
    return await _build_state_response(
        submission_id, check, problems, turns, db, fallback_status="no_check",
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

    telemetry = (
        body.telemetry.model_dump(mode="json") if body.telemetry else None
    )
    await process_student_turn(
        check, message, body.seconds_on_turn, db,
        user_id=str(user.id),
        telemetry=telemetry,
    )
    await db.commit()

    # `check` was mutated in-memory and the session uses
    # expire_on_commit=False, so attrs are already current. Problems +
    # transcript are re-read fresh so the response reflects any tool
    # calls that landed during the agent loop.
    problems = await _load_problems(db, check.id)
    turns = await _load_transcript(db, check.id)
    return await _build_state_response(
        submission_id, check, problems, turns, db, fallback_status="no_check",
    )


@router.post(
    "/school/student/integrity/submissions/{submission_id}/flag-extraction"
)
async def flag_extraction(
    submission_id: uuid.UUID,
    user: User = Depends(get_current_user_full),
    db: AsyncSession = Depends(get_db),
) -> IntegrityStateResponse:
    """Student-raised flag: the Vision reader got my work wrong.

    Idempotent — re-flagging is a no-op. Un-flagging is not supported:
    once raised, the teacher sees the flag as an audit signal. 409s if
    the check is already complete (too late to influence the agent's
    judgment — the flag is meant to weigh the verdict as it's being
    formed).
    """
    await _load_my_submission(db, submission_id, user.id)
    check = await _load_check_for_submission(db, submission_id)
    if check is None:
        raise HTTPException(
            status_code=404, detail="No integrity check for this submission",
        )
    if check.status in (STATUS_COMPLETE, STATUS_SKIPPED_UNREADABLE):
        raise HTTPException(
            status_code=409,
            detail="Integrity check already finalized",
        )

    if not check.student_flagged_extraction:
        check.student_flagged_extraction = True
        await db.commit()

    problems = await _load_problems(db, check.id)
    turns = await _load_transcript(db, check.id)
    return await _build_state_response(
        submission_id, check, problems, turns, db, fallback_status="no_check",
    )


# ── Teacher endpoints ───────────────────────────────────────────────

class TeacherTranscriptTurn(BaseModel):
    ordinal: int
    role: str  # "agent" | "student" | "tool_call" | "tool_result"
    content: str
    tool_name: str | None = None
    seconds_on_turn: int | None = None
    created_at: datetime
    # Client-captured behavioral signals from the student's chat for
    # this turn. Populated on student rows only; null elsewhere.
    # Teacher-facing evidence for flag_for_review cases.
    telemetry: dict[str, Any] | None = None


class TeacherIntegrityProblemRow(BaseModel):
    problem_id: str
    bank_item_id: str
    question: str
    sample_position: int
    status: str
    # Six-dimension rubric dict, or null when the agent hasn't
    # verdicted this problem yet (e.g. pending or turn-cap-force-finalize).
    rubric: dict[str, Any] | None
    ai_reasoning: str | None
    selected_reason: str | None
    teacher_dismissed: bool
    teacher_dismissal_reason: str | None
    student_work_extraction: dict[str, Any] | None


class TeacherIntegrityDetail(BaseModel):
    submission_id: str
    overall_status: str
    # One of pass / needs_practice / tutor_pivot / flag_for_review.
    # Null when status is skipped_unreadable or when the agent couldn't
    # conclude (turn cap or no sampled problems).
    disposition: str | None
    overall_summary: str | None
    probe_selection_reason: str | None
    inline_variant_used: bool
    inline_variant_result: str | None
    student_flagged_extraction: bool
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
            disposition=None,
            overall_summary=None,
            probe_selection_reason=None,
            inline_variant_used=False,
            inline_variant_result=None,
            student_flagged_extraction=False,
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
            rubric=p.rubric,
            ai_reasoning=p.ai_reasoning,
            selected_reason=p.selected_reason,
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
            telemetry=t.telemetry,
        )
        for t in turns
    ]

    return TeacherIntegrityDetail(
        submission_id=str(submission_id),
        overall_status=check.status,
        disposition=check.disposition,
        overall_summary=check.overall_summary,
        probe_selection_reason=check.probe_selection_reason,
        inline_variant_used=check.inline_variant_used,
        inline_variant_result=check.inline_variant_result,
        student_flagged_extraction=check.student_flagged_extraction,
        problems=problem_rows,
        transcript=transcript_rows,
    )


@router.post(
    "/teacher/integrity/submissions/{submission_id}/dismiss", status_code=204,
)
async def teacher_dismiss_problem(
    submission_id: uuid.UUID,
    body: DismissRequest,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Mark a per-problem verdict as dismissed.

    Session-level disposition is the agent's holistic judgment and is
    NOT recomputed when one problem is dismissed — the teacher UI
    shows the original disposition alongside dismissed-problem
    indicators and interprets both together. Idempotent:
    re-dismissing with a new reason just updates the reason."""
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

    # Session-level disposition is a holistic judgment from the agent —
    # it's not a derivative of per-problem verdicts, so we don't
    # recompute it when a teacher dismisses one problem. The teacher UI
    # shows the agent's original disposition alongside which problems
    # were dismissed; teacher interprets.

    await db.commit()
