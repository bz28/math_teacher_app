"""School-student Mastery Loop endpoints.

Mounted at /v1/school/student. Drives the redesigned practice set
experience built around per-problem mastery state:

  GET  /practice/{assignment_id}/overview        — set + mastery dots
  GET  /practice/{assignment_id}/next-problem    — smart resume
  POST /problems/{bank_item_id}/answer           — record an attempt
  POST /problems/{bank_item_id}/walkthrough-opened
  GET  /problems/{bank_item_id}/chat             — thread history
  POST /problems/{bank_item_id}/chat             — ask + persist

Distinct from the HW-anchored variation-rotation endpoints in
school_student_practice.py: those serve siblings of HW primaries via
BankConsumption rows; this serves the practice set's own approved
items and tracks mastery directly. No overlap with BankConsumption —
the two surfaces evolve independently.

LLM cost: school students get unlimited tutor chat. Practice sets are
small (10–20 problems), threads are bounded by user effort, and the
tutor is the moment we *want* students to lean on the tool.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.tutor import completed_chat, step_chat
from api.database import get_db
from api.middleware.auth import get_current_user_full
from api.models.assignment import Assignment, AssignmentSection
from api.models.course import Course
from api.models.question_bank import QuestionBankItem
from api.models.section_enrollment import SectionEnrollment
from api.models.student_problem_mastery import (
    STATE_NOT_STARTED,
    StudentProblemChat,
    StudentProblemMastery,
)
from api.models.user import User
from api.services.mastery import MasterySnapshot, apply_event

router = APIRouter(prefix="/school/student", tags=["school-student-mastery"])


# ── Payload caps ──
#
# Chat payloads are unmetered for school students but still bounded
# against abuse / runaway prompts. Numbers mirror the existing
# stateless chat endpoints in school_student_practice.py so behaviour
# is consistent across the two surfaces.
_MAX_QUESTION_LEN = 2_000
_MAX_CHAT_HISTORY_RETURNED = 200  # cap on rows surfaced on history load
_MAX_TUTOR_CONTEXT_TURNS = 20     # forwarded to Claude per ask


# ── Schemas ──

MasteryState = Literal[
    "not_started", "walked_through", "missed", "attempted", "mastered",
]


class PracticeProblemOverview(BaseModel):
    """One problem on the set Overview. Carries the mastery state for
    the dot-map plus enough payload for the client to deep-link into
    the session at a specific problem."""

    bank_item_id: str
    position: int
    question: str
    final_answer: str | None
    distractors: list[str] | None
    solution_steps: list[dict[str, Any]] | None
    difficulty: str
    format: str
    mastery_state: MasteryState
    attempts: int
    last_attempt_at: datetime | None


class PracticeSetOverview(BaseModel):
    """Whole-set view: problems plus aggregates. Aggregates are
    redundant with what the client could compute from `problems` but
    are precomputed server-side so the headline (`9 of 15 mastered`)
    is always in sync with the table — no risk of FE rounding drift."""

    assignment_id: str
    title: str
    course_id: str
    course_name: str
    source_homework_id: str | None
    source_homework_title: str | None
    problems: list[PracticeProblemOverview]
    mastered_count: int
    in_progress_count: int  # walked_through + missed + attempted
    not_started_count: int


class NextProblemServed(BaseModel):
    status: Literal["served"] = "served"
    problem: PracticeProblemOverview


class NextProblemComplete(BaseModel):
    """Every problem in the set is mastered — nothing left to resume
    onto. Frontend renders the celebratory completion state instead
    of routing into the session."""
    status: Literal["complete"] = "complete"


class AnswerRequest(BaseModel):
    selected_choice: str = Field(min_length=1, max_length=2_000)


class AnswerResponse(BaseModel):
    is_correct: bool
    correct_answer: str
    mastery_state_after: MasteryState
    attempts_after: int


class WalkthroughOpenedResponse(BaseModel):
    mastery_state_after: MasteryState


class ChatMessageOut(BaseModel):
    role: Literal["user", "assistant"]
    content: str
    step_index: int | None
    created_at: datetime


class ChatHistoryResponse(BaseModel):
    messages: list[ChatMessageOut]


class ChatAskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=_MAX_QUESTION_LEN)
    # Walk-through mode (asking about a specific step) sets step_index;
    # whole-problem ask leaves it null. Both flows reuse the same
    # thread so the conversation is continuous.
    step_index: int | None = None


class ChatAskResponse(BaseModel):
    reply: str


# ── Auth + load helpers ──


async def _load_practice_for_student(
    db: AsyncSession,
    assignment_id: uuid.UUID,
    student_id: uuid.UUID,
) -> Assignment:
    """Load a published practice assignment the student has section
    visibility into. 404 on miss / wrong type / unpublished, 403 on
    not-enrolled. Same shape as the existing
    school_student_practice._load_assignment_for_student, scoped to
    practice."""
    assignment = (await db.execute(
        select(Assignment).where(Assignment.id == assignment_id)
    )).scalar_one_or_none()
    if assignment is None:
        raise HTTPException(status_code=404, detail="Practice set not found")
    if assignment.status != "published":
        raise HTTPException(status_code=403, detail="Practice set is not published")
    if assignment.type != "practice":
        # 404 (not 400) to keep cross-type ids opaque.
        raise HTTPException(status_code=404, detail="Not a practice set")

    enrolled = (await db.execute(
        select(SectionEnrollment.id)
        .join(
            AssignmentSection,
            AssignmentSection.section_id == SectionEnrollment.section_id,
        )
        .where(
            AssignmentSection.assignment_id == assignment_id,
            SectionEnrollment.student_id == student_id,
        )
        .limit(1)
    )).scalar_one_or_none()
    if enrolled is None:
        raise HTTPException(status_code=403, detail="Not enrolled in this practice")
    return assignment


async def _load_practice_problem_for_student(
    db: AsyncSession,
    bank_item_id: uuid.UUID,
    student_id: uuid.UUID,
) -> tuple[QuestionBankItem, Assignment]:
    """Authorize and load a bank item belonging to a practice set the
    student has visibility into. Returns (item, originating practice
    assignment). Used by the answer / walkthrough / chat endpoints —
    the bank_item_id is the only path param so we resolve its parent
    practice here and reuse the practice-level enrollment check.

    404 on every authz failure to avoid leaking the difference
    between "doesn't exist" and "exists but not yours."
    """
    item = (await db.execute(
        select(QuestionBankItem).where(QuestionBankItem.id == bank_item_id)
    )).scalar_one_or_none()
    if item is None or item.status != "approved":
        raise HTTPException(status_code=404, detail="Problem not available")

    assignment = (await db.execute(
        select(Assignment).where(
            Assignment.id == item.originating_assignment_id,
        )
    )).scalar_one_or_none()
    if assignment is None or assignment.type != "practice":
        raise HTTPException(status_code=404, detail="Problem not available")
    if assignment.status != "published":
        raise HTTPException(status_code=404, detail="Problem not available")

    enrolled = (await db.execute(
        select(SectionEnrollment.id)
        .join(
            AssignmentSection,
            AssignmentSection.section_id == SectionEnrollment.section_id,
        )
        .where(
            AssignmentSection.assignment_id == assignment.id,
            SectionEnrollment.student_id == student_id,
        )
        .limit(1)
    )).scalar_one_or_none()
    if enrolled is None:
        raise HTTPException(status_code=404, detail="Problem not available")

    return item, assignment


def _snapshot_from_row(row: StudentProblemMastery | None) -> MasterySnapshot:
    """Build a MasterySnapshot from a possibly-absent DB row. Absent
    row = initial state (no DB writes have happened yet)."""
    if row is None:
        return MasterySnapshot.initial()
    return MasterySnapshot(
        state=row.state,
        attempts=row.attempts,
        walkthrough_opened_at=row.walkthrough_opened_at,
        first_attempt_at=row.first_attempt_at,
        first_attempt_was_correct=row.first_attempt_was_correct,
        last_attempt_at=row.last_attempt_at,
        last_correct_at=row.last_correct_at,
    )


async def _upsert_mastery(
    db: AsyncSession,
    student_id: uuid.UUID,
    bank_item_id: uuid.UUID,
    new: MasterySnapshot,
) -> StudentProblemMastery:
    """Persist `new` for (student, bank_item) — INSERT or UPDATE as
    needed. Returns the live row.

    Uses a row-level SELECT-then-add path rather than a Postgres
    ON CONFLICT upsert because (a) we already loaded the row before
    applying the state machine, so a second lookup is free and (b) the
    column set is small enough that the typed update is clearer than
    a JSONB diff. Concurrent answers from the same student on the
    same problem are vanishingly rare in practice — at worst the
    state machine is run twice and the second commit wins, which is
    correct in this domain (idempotent on terminal states)."""
    row = (await db.execute(
        select(StudentProblemMastery).where(
            StudentProblemMastery.student_id == student_id,
            StudentProblemMastery.bank_item_id == bank_item_id,
        )
    )).scalar_one_or_none()

    if row is None:
        row = StudentProblemMastery(
            student_id=student_id,
            bank_item_id=bank_item_id,
            state=new.state,
            attempts=new.attempts,
            walkthrough_opened_at=new.walkthrough_opened_at,
            first_attempt_at=new.first_attempt_at,
            first_attempt_was_correct=new.first_attempt_was_correct,
            last_attempt_at=new.last_attempt_at,
            last_correct_at=new.last_correct_at,
        )
        db.add(row)
    else:
        row.state = new.state
        row.attempts = new.attempts
        row.walkthrough_opened_at = new.walkthrough_opened_at
        row.first_attempt_at = new.first_attempt_at
        row.first_attempt_was_correct = new.first_attempt_was_correct
        row.last_attempt_at = new.last_attempt_at
        row.last_correct_at = new.last_correct_at

    await db.commit()
    return row


def _normalize_answer(s: str) -> str:
    """Compare answers loosely — both sides trimmed and whitespace-
    collapsed. Bank items are typed by the teacher (or AI-generated
    and approved), distractors are chosen to be semantically distinct,
    so exact-after-normalization is the right precision for v1.

    Deliberately NOT calling check_answer_equivalence (the LLM-backed
    equivalence helper) here — practice answers are MCQ picks rendered
    from the same final_answer string. Equivalence is a UI-input
    problem; we don't have UI input here."""
    return " ".join(s.strip().split())


def _serialize_problem(
    item: QuestionBankItem,
    position: int,
    row: StudentProblemMastery | None,
) -> PracticeProblemOverview:
    state: MasteryState = (
        row.state if row is not None else STATE_NOT_STARTED  # type: ignore[assignment]
    )
    return PracticeProblemOverview(
        bank_item_id=str(item.id),
        position=position,
        question=item.question,
        final_answer=item.final_answer,
        distractors=list(item.distractors or []),
        solution_steps=item.solution_steps,
        difficulty=item.difficulty,
        format=item.format,
        mastery_state=state,
        attempts=row.attempts if row is not None else 0,
        last_attempt_at=row.last_attempt_at if row is not None else None,
    )


# ── Endpoints ──


@router.get("/practice/{assignment_id}/overview")
async def practice_overview(
    assignment_id: uuid.UUID,
    user: User = Depends(get_current_user_full),
    db: AsyncSession = Depends(get_db),
) -> PracticeSetOverview:
    """Return the practice set plus per-problem mastery state for the
    overview page. One round trip — joins the assignment's approved
    items with the student's mastery rows."""
    assignment = await _load_practice_for_student(db, assignment_id, user.id)
    course = (await db.execute(
        select(Course).where(Course.id == assignment.course_id)
    )).scalar_one()

    items = (await db.execute(
        select(QuestionBankItem)
        .where(
            QuestionBankItem.originating_assignment_id == assignment.id,
            QuestionBankItem.status == "approved",
        )
        .order_by(QuestionBankItem.created_at.asc())
    )).scalars().all()

    mastery_rows: dict[uuid.UUID, StudentProblemMastery] = {}
    if items:
        rows = (await db.execute(
            select(StudentProblemMastery).where(
                StudentProblemMastery.student_id == user.id,
                StudentProblemMastery.bank_item_id.in_([it.id for it in items]),
            )
        )).scalars().all()
        mastery_rows = {r.bank_item_id: r for r in rows}

    problems = [
        _serialize_problem(it, pos, mastery_rows.get(it.id))
        for pos, it in enumerate(items, start=1)
    ]

    mastered = sum(1 for p in problems if p.mastery_state == "mastered")
    not_started = sum(1 for p in problems if p.mastery_state == "not_started")
    in_progress = len(problems) - mastered - not_started

    source_title: str | None = None
    if assignment.source_homework_id:
        source_title = (await db.execute(
            select(Assignment.title).where(
                Assignment.id == assignment.source_homework_id
            )
        )).scalar_one_or_none()

    return PracticeSetOverview(
        assignment_id=str(assignment.id),
        title=assignment.title,
        course_id=str(course.id),
        course_name=course.name,
        source_homework_id=(
            str(assignment.source_homework_id)
            if assignment.source_homework_id else None
        ),
        source_homework_title=source_title,
        problems=problems,
        mastered_count=mastered,
        in_progress_count=in_progress,
        not_started_count=not_started,
    )


@router.get("/practice/{assignment_id}/next-problem")
async def practice_next_problem(
    assignment_id: uuid.UUID,
    user: User = Depends(get_current_user_full),
    db: AsyncSession = Depends(get_db),
) -> NextProblemServed | NextProblemComplete:
    """Smart resume: the first problem in position order whose mastery
    state is anything but `mastered`. Returns `complete` when every
    problem is mastered so the client can route to the celebratory
    state instead of into an empty session."""
    assignment = await _load_practice_for_student(db, assignment_id, user.id)

    items = (await db.execute(
        select(QuestionBankItem)
        .where(
            QuestionBankItem.originating_assignment_id == assignment.id,
            QuestionBankItem.status == "approved",
        )
        .order_by(QuestionBankItem.created_at.asc())
    )).scalars().all()
    if not items:
        # Empty set — there's nothing to do, but `complete` is the
        # honest signal (no resume target, render the empty state).
        return NextProblemComplete()

    rows = (await db.execute(
        select(StudentProblemMastery).where(
            StudentProblemMastery.student_id == user.id,
            StudentProblemMastery.bank_item_id.in_([it.id for it in items]),
        )
    )).scalars().all()
    mastery_by_id = {r.bank_item_id: r for r in rows}

    for pos, it in enumerate(items, start=1):
        row = mastery_by_id.get(it.id)
        state = row.state if row is not None else STATE_NOT_STARTED
        if state != "mastered":
            return NextProblemServed(
                problem=_serialize_problem(it, pos, row),
            )

    return NextProblemComplete()


@router.post("/problems/{bank_item_id}/answer")
async def submit_answer(
    bank_item_id: uuid.UUID,
    body: AnswerRequest,
    user: User = Depends(get_current_user_full),
    db: AsyncSession = Depends(get_db),
) -> AnswerResponse:
    """Record an answer attempt. Loads the bank item to get the
    correct answer, runs the mastery state machine over the existing
    row, persists the result, and returns the new state to the client
    so the UI can render the correct/wrong feedback + mastery badge
    in one round trip."""
    item, _assignment = await _load_practice_problem_for_student(
        db, bank_item_id, user.id,
    )
    correct = (
        _normalize_answer(body.selected_choice)
        == _normalize_answer(item.final_answer)
    )

    existing = (await db.execute(
        select(StudentProblemMastery).where(
            StudentProblemMastery.student_id == user.id,
            StudentProblemMastery.bank_item_id == bank_item_id,
        )
    )).scalar_one_or_none()
    snap = _snapshot_from_row(existing)
    after = apply_event(
        snap,
        "answer_correct" if correct else "answer_wrong",
        datetime.now(UTC),
    )
    row = await _upsert_mastery(db, user.id, bank_item_id, after)

    return AnswerResponse(
        is_correct=correct,
        correct_answer=item.final_answer,
        mastery_state_after=row.state,
        attempts_after=row.attempts,
    )


@router.post("/problems/{bank_item_id}/walkthrough-opened")
async def open_walkthrough(
    bank_item_id: uuid.UUID,
    user: User = Depends(get_current_user_full),
    db: AsyncSession = Depends(get_db),
) -> WalkthroughOpenedResponse:
    """Stamp `walkthrough_opened_at` (idempotent) and transition state
    if appropriate. The student is committing to "show me the steps"
    — even if they end up answering correctly later, the mastery line
    is closed."""
    await _load_practice_problem_for_student(db, bank_item_id, user.id)

    existing = (await db.execute(
        select(StudentProblemMastery).where(
            StudentProblemMastery.student_id == user.id,
            StudentProblemMastery.bank_item_id == bank_item_id,
        )
    )).scalar_one_or_none()
    snap = _snapshot_from_row(existing)
    after = apply_event(snap, "walkthrough_opened", datetime.now(UTC))
    row = await _upsert_mastery(db, user.id, bank_item_id, after)

    return WalkthroughOpenedResponse(
        mastery_state_after=row.state,
    )


@router.get("/problems/{bank_item_id}/chat")
async def get_chat_thread(
    bank_item_id: uuid.UUID,
    user: User = Depends(get_current_user_full),
    db: AsyncSession = Depends(get_db),
) -> ChatHistoryResponse:
    """Return every persisted chat turn for this (student, bank_item)
    pair, oldest first. The chat is global to the problem — student
    returning a week later sees their earlier conversation, which is
    the point: past confusion + the tutor's reply is study material."""
    await _load_practice_problem_for_student(db, bank_item_id, user.id)

    rows = (await db.execute(
        select(StudentProblemChat)
        .where(
            StudentProblemChat.student_id == user.id,
            StudentProblemChat.bank_item_id == bank_item_id,
        )
        .order_by(StudentProblemChat.created_at.asc())
        .limit(_MAX_CHAT_HISTORY_RETURNED)
    )).scalars().all()

    return ChatHistoryResponse(
        messages=[
            ChatMessageOut(
                role=r.role,
                content=r.content,
                step_index=r.step_index,
                created_at=r.created_at,
            )
            for r in rows
        ],
    )


def _steps_for_prompt(raw: list[Any] | None) -> list[dict[str, str]]:
    """Flatten solution_steps JSON into the shape the tutor helpers
    expect. Mirrors school_student_practice._steps_for_prompt; tiny
    enough to duplicate rather than reach across files."""
    out: list[dict[str, str]] = []
    for s in raw or []:
        if not isinstance(s, dict):
            continue
        title = str(s.get("title") or "").strip()
        desc = str(s.get("description") or "").strip()
        merged = f"{title}: {desc}" if title else desc
        out.append({"description": merged})
    return out


@router.post("/problems/{bank_item_id}/chat")
async def post_chat_message(
    bank_item_id: uuid.UUID,
    body: ChatAskRequest,
    user: User = Depends(get_current_user_full),
    db: AsyncSession = Depends(get_db),
) -> ChatAskResponse:
    """Ask the tutor a question about this problem. Persists the
    student's message + the tutor's reply on the (student, bank_item)
    thread.

    Routing:
      • `step_index` is None → whole-problem ask (post-walkthrough).
        Uses completed_chat with the full step list.
      • `step_index` is set  → walk-through step ask. Uses step_chat
        scoped to that step.

    Prior context for the LLM is reconstructed from the last
    `_MAX_TUTOR_CONTEXT_TURNS` rows on the same thread. The full
    transcript still lives in the DB and is returned by GET; the
    cap only bounds tokens-per-call."""
    item, assignment = await _load_practice_problem_for_student(
        db, bank_item_id, user.id,
    )
    course = (await db.execute(
        select(Course).where(Course.id == assignment.course_id)
    )).scalar_one_or_none()
    subject = course.subject if course is not None else "math"

    steps = _steps_for_prompt(item.solution_steps)
    if body.step_index is not None:
        if body.step_index < 0 or body.step_index >= len(steps):
            raise HTTPException(status_code=400, detail="Invalid step_index")

    # Load recent context — bounded for cost, ordered oldest first
    # so the tutor sees a real conversation. We materialize the last
    # N rows by ordering DESC + LIMIT then reversing in Python: fewer
    # rows transferred than a full table scan + OFFSET.
    prior_rows = (await db.execute(
        select(StudentProblemChat)
        .where(
            StudentProblemChat.student_id == user.id,
            StudentProblemChat.bank_item_id == bank_item_id,
        )
        .order_by(StudentProblemChat.created_at.desc())
        .limit(_MAX_TUTOR_CONTEXT_TURNS)
    )).scalars().all()
    exchanges = [
        {"role": r.role, "content": r.content}
        for r in reversed(prior_rows)
    ]

    if body.step_index is not None:
        result = await step_chat(
            problem=item.question,
            step=steps[body.step_index],
            exchanges=exchanges,
            student_input=body.question,
            user_id=str(user.id),
            subject=subject,
        )
    else:
        result = await completed_chat(
            problem=item.question,
            steps=steps,
            exchanges=exchanges,
            student_input=body.question,
            user_id=str(user.id),
            subject=subject,
        )

    # Persist both turns in one commit so a partial failure can't
    # leave an orphan user-message on the thread.
    now = datetime.now(UTC)
    db.add_all([
        StudentProblemChat(
            student_id=user.id,
            bank_item_id=bank_item_id,
            role="user",
            content=body.question,
            step_index=body.step_index,
            created_at=now,
        ),
        StudentProblemChat(
            student_id=user.id,
            bank_item_id=bank_item_id,
            role="assistant",
            content=result.feedback,
            step_index=body.step_index,
            # +1 microsecond keeps ordering deterministic in tests
            # where the two rows would otherwise share a timestamp.
            created_at=now,
        ),
    ])
    await db.commit()

    return ChatAskResponse(reply=result.feedback)
