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

import hashlib
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.tutor import completed_chat, step_chat
from api.database import get_db
from api.middleware.auth import get_current_user_full
from api.models.assignment import Assignment
from api.models.course import Course
from api.models.question_bank import QuestionBankItem
from api.models.student_problem_mastery import (
    STATE_NOT_STARTED,
    StudentProblemChat,
    StudentProblemMastery,
)
from api.models.user import User
from api.routes.school_student_practice import _load_assignment_for_student
from api.services.mastery import Event, MasterySnapshot, apply_event

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
    """One problem on the set Overview / session entry. Carries the
    mastery state for the dot-map plus enough payload to render the
    MCQ session page without exposing the correct answer.

    Deliberately omits `final_answer`, `distractors`, and
    `solution_steps`: if any of them shipped pre-attempt, a student
    could read the answer off the dot map and the mastery game is
    moot. `mcq_choices` is the shuffled view-of-4 (correct + 3
    distractors) — knowing the set of choices doesn't reveal which
    is correct. `solution_steps` are exposed only after the student
    opts into the walkthrough (returned by
    /problems/{id}/walkthrough-opened) — once opened, the mastery
    line is closed anyway, so it's safe."""

    bank_item_id: str
    position: int
    question: str
    difficulty: str
    format: str
    # MCQ choices in stable shuffled order. Empty for free-response
    # items. Same shuffle the existing HW-flow uses so a teacher
    # previewing the bank sees the same arrangement as students.
    mcq_choices: list[str]
    # Total number of solution steps. Lets the dot-map / session UI
    # show a step counter ("Step 1 of 4") without shipping the step
    # bodies pre-walkthrough.
    step_count: int
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
    """Returned by POST /problems/{id}/walkthrough-opened. The
    solution steps ship in this response (not in overview / next-
    problem) because opening the walkthrough is the moment the
    student commits to "show me the answer" — pre-opening, the
    steps would be a spoiler that breaks the mastery game."""

    mastery_state_after: MasteryState
    solution_steps: list[dict[str, Any]]
    final_answer: str


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

    404 on every authz failure (vs the 403 the assignment-level
    `_load_assignment_for_student` returns for not-enrolled). The
    asymmetry is intentional: assignment_ids are class-scoped and
    visible to enrolled students through the UI, so 403 gives clear
    feedback. bank_item_ids leak through this endpoint alone and are
    not enumerable from anywhere else; 404 keeps cross-class items
    opaque so a student can't probe to confirm which bank items
    exist across the school's catalog.
    """
    item = (await db.execute(
        select(QuestionBankItem).where(QuestionBankItem.id == bank_item_id)
    )).scalar_one_or_none()
    if item is None or item.status != "approved":
        raise HTTPException(status_code=404, detail="Problem not available")

    # Defer to the shared assignment-level loader for the existence
    # + published + type + enrollment checks. The helper raises
    # 403/404 depending on which check failed; we collapse all of
    # them to 404 here to preserve the bank_item-id opacity
    # guarantee (cross-class probing must look the same as
    # "doesn't exist"). Letting 5xx-class exceptions propagate.
    try:
        assignment = await _load_assignment_for_student(
            db, item.originating_assignment_id, student_id,
            expected_type="practice",
        )
    except HTTPException as e:
        if e.status_code in (403, 404):
            raise HTTPException(
                status_code=404, detail="Problem not available",
            ) from None
        raise
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


async def _apply_event_to_mastery(
    db: AsyncSession,
    student_id: uuid.UUID,
    bank_item_id: uuid.UUID,
    event: Event,
    now: datetime,
) -> StudentProblemMastery:
    """Atomically read-modify-write the (student, bank_item) mastery
    row: SELECT FOR UPDATE the existing row (or INSERT a fresh one),
    apply the state-machine event to its snapshot, persist the
    result, commit.

    The row lock serializes concurrent answer + walkthrough requests
    from the same student on the same problem so they can't read the
    same snapshot, compute conflicting next-states, and clobber each
    other on commit. In the no-row branch we race other inserts on
    the (student_id, bank_item_id) PK; an IntegrityError means
    someone else got there first, so we roll back and retry — the
    second pass takes the lock-then-mutate path."""
    for attempt in (0, 1):
        row = (await db.execute(
            select(StudentProblemMastery)
            .where(
                StudentProblemMastery.student_id == student_id,
                StudentProblemMastery.bank_item_id == bank_item_id,
            )
            .with_for_update()
        )).scalar_one_or_none()

        snap = _snapshot_from_row(row)
        after = apply_event(snap, event, now)

        if row is None:
            new_row = StudentProblemMastery(
                student_id=student_id,
                bank_item_id=bank_item_id,
                state=after.state,
                attempts=after.attempts,
                walkthrough_opened_at=after.walkthrough_opened_at,
                first_attempt_at=after.first_attempt_at,
                first_attempt_was_correct=after.first_attempt_was_correct,
                last_attempt_at=after.last_attempt_at,
                last_correct_at=after.last_correct_at,
            )
            db.add(new_row)
            try:
                await db.commit()
                return new_row
            except IntegrityError:
                await db.rollback()
                if attempt == 1:
                    # Shouldn't happen — a row that existed at the
                    # second SELECT couldn't be insert-conflicted on.
                    raise
                continue

        row.state = after.state
        row.attempts = after.attempts
        row.walkthrough_opened_at = after.walkthrough_opened_at
        row.first_attempt_at = after.first_attempt_at
        row.first_attempt_was_correct = after.first_attempt_was_correct
        row.last_attempt_at = after.last_attempt_at
        row.last_correct_at = after.last_correct_at
        await db.commit()
        return row

    # Unreachable: the loop either returns or re-raises.
    raise RuntimeError("apply_event_to_mastery exhausted retries")


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


def _mcq_choices_for_student(item: QuestionBankItem) -> list[str]:
    """Return the four MCQ choices in stable shuffled order, or [] if
    the item lacks the data to render MCQ (missing distractors or
    final_answer). Deterministic hash-of-id shuffle so the order is
    stable across every render and matches what the teacher saw on
    the bank review page.

    Deliberately ignores `item.format` (unlike the HW-context variant
    in school_student_practice). The mastery loop's Answer mode is
    structurally MCQ — server compares the picked choice string
    against final_answer. The `format` field reflects how the teacher
    wanted the *homework* posed (write work vs see choices); in
    practice mode the student is always self-checking, so we use
    MCQ whenever the distractors + final_answer are populated."""
    distractors = list(item.distractors or [])
    if len(distractors) != 3 or not item.final_answer:
        return []
    choices = [item.final_answer, *distractors]
    digest = hashlib.sha1(str(item.id).encode("utf-8")).digest()
    return [c for _, c in sorted(zip(digest[:4], choices, strict=False))]


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
        difficulty=item.difficulty,
        format=item.format,
        mcq_choices=_mcq_choices_for_student(item),
        step_count=len(item.solution_steps or []),
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
    assignment = await _load_assignment_for_student(
        db, assignment_id, user.id, expected_type="practice",
    )
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
    assignment = await _load_assignment_for_student(
        db, assignment_id, user.id, expected_type="practice",
    )

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
    row = await _apply_event_to_mastery(
        db, user.id, bank_item_id,
        "answer_correct" if correct else "answer_wrong",
        datetime.now(UTC),
    )
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
    is closed. The solution steps and final answer ship in the response
    so the client can render them immediately without a second round
    trip, and so the overview / next-problem endpoints can stay free
    of any answer-leaking fields."""
    item, _assignment = await _load_practice_problem_for_student(
        db, bank_item_id, user.id,
    )
    row = await _apply_event_to_mastery(
        db, user.id, bank_item_id, "walkthrough_opened", datetime.now(UTC),
    )
    return WalkthroughOpenedResponse(
        mastery_state_after=row.state,
        solution_steps=list(item.solution_steps or []),
        final_answer=item.final_answer,
    )


@router.get("/problems/{bank_item_id}/chat")
async def get_chat_thread(
    bank_item_id: uuid.UUID,
    user: User = Depends(get_current_user_full),
    db: AsyncSession = Depends(get_db),
) -> ChatHistoryResponse:
    """Return the last `_MAX_CHAT_HISTORY_RETURNED` chat turns for
    this (student, bank_item) pair, oldest first. The chat is global
    to the problem — student returning a week later sees their
    earlier conversation, which is the point: past confusion + the
    tutor's reply is study material.

    We fetch the *newest* N (DESC + LIMIT) then reverse in Python.
    The older ASC + LIMIT path silently dropped the most recent
    messages once a thread exceeded N — backwards for a chat
    history."""
    await _load_practice_problem_for_student(db, bank_item_id, user.id)

    rows = (await db.execute(
        select(StudentProblemChat)
        .where(
            StudentProblemChat.student_id == user.id,
            StudentProblemChat.bank_item_id == bank_item_id,
        )
        .order_by(StudentProblemChat.created_at.desc())
        .limit(_MAX_CHAT_HISTORY_RETURNED)
    )).scalars().all()
    rows = list(reversed(rows))

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
            # +1µs so the assistant row sorts strictly after the user
            # row on ORDER BY created_at. Without the delta the two
            # rows share a timestamp and Postgres tie-breaks
            # arbitrarily — fine in practice, undefined in spec.
            created_at=now + timedelta(microseconds=1),
        ),
    ])
    await db.commit()

    return ChatAskResponse(reply=result.feedback)


# ── History tab ──
#
# Per-class study record: heatmap of activity, mastery aggregates,
# current streak, "needs review" queue, per-set breakdown. All in
# one round trip — the History tab loads as a unit.
#
# Scoped to a single course (third tab inside courses/[id]?tab=history)
# because the primary student use case is studying for an upcoming
# test in one class. Cross-class roll-up can live on the dashboard
# later if it proves useful.

# Cap on the rolling heatmap window. 20 weeks ≈ 5 months — long
# enough to feel like a record, short enough that the response stays
# small. Aligns with the consumer "github contributions" feel.
_HISTORY_HEATMAP_WEEKS = 20
_NEEDS_REVIEW_LIMIT = 20


class HistoryHeatmapDay(BaseModel):
    """One bar in the activity heatmap. `count` is the number of
    distinct (student, bank_item) interactions whose most-recent
    timestamp falls on this UTC date.

    Caveat: because mastery rows store only `last_attempt_at` (not a
    full per-attempt log), the heatmap is approximate for problems
    re-attempted across multiple days. v1 ships this as-is; a real
    event log can land later if the surface proves valuable enough
    to warrant it."""

    date: str  # YYYY-MM-DD, UTC
    count: int


class HistoryReviewItem(BaseModel):
    bank_item_id: str
    practice_assignment_id: str
    practice_title: str
    question: str
    mastery_state: MasteryState
    last_attempt_at: datetime


class HistorySetBreakdown(BaseModel):
    assignment_id: str
    title: str
    problem_count: int
    mastered_count: int


class CourseHistorySummary(BaseModel):
    course_id: str
    course_name: str
    mastered_count: int
    total_problems: int
    streak_days: int
    heatmap: list[HistoryHeatmapDay]
    needs_review: list[HistoryReviewItem]
    sets: list[HistorySetBreakdown]


def _streak_days(dates: set[date], today: date) -> int:
    """Count consecutive UTC days back from `today` that appear in
    `dates`. The cursor starts at today; if today is missing, allow
    a one-day grace (yesterday) so a student in a far-west timezone
    who studied mid-day local but before UTC midnight isn't
    penalized. Walk back until the first missing day, then stop.

    All bucketing is UTC for v1; the common case (US/EU schools) is
    close enough. A tz-aware computation can land later if it
    proves needed."""
    if not dates:
        return 0
    cursor = today
    if cursor not in dates:
        cursor = cursor - timedelta(days=1)
    streak = 0
    while cursor in dates:
        streak += 1
        cursor = cursor - timedelta(days=1)
    return streak


@router.get("/courses/{course_id}/history/summary")
async def course_history_summary(
    course_id: uuid.UUID,
    user: User = Depends(get_current_user_full),
    db: AsyncSession = Depends(get_db),
) -> CourseHistorySummary:
    """All-in-one read for the History tab inside a course page.

    Scoped to bank items that originate from a published practice
    assignment in this course that the student has section
    enrollment for. Mastery rows for items the student can no
    longer access (teacher unpublished, item removed, etc.) are
    excluded from every aggregate so stale data doesn't show up."""
    from api.models.course import Course as CourseModel

    # Verify the student is enrolled in at least one section of
    # this course. We don't reuse the per-assignment loader because
    # there's no specific assignment to load — this is course-level.
    enrolled = (await db.execute(
        select(SectionEnrollment.id)
        .join(
            AssignmentSection,
            AssignmentSection.section_id == SectionEnrollment.section_id,
        )
        .join(Assignment, Assignment.id == AssignmentSection.assignment_id)
        .where(
            Assignment.course_id == course_id,
            SectionEnrollment.student_id == user.id,
        )
        .limit(1)
    )).scalar_one_or_none()
    if enrolled is None:
        raise HTTPException(status_code=403, detail="Not enrolled in this class")

    course = (await db.execute(
        select(CourseModel).where(CourseModel.id == course_id)
    )).scalar_one_or_none()
    if course is None:
        raise HTTPException(status_code=404, detail="Class not found")

    # All bank items the student has access to via published
    # practice sets in this course. Subquery so we can reuse it for
    # the mastery aggregate + needs-review join.
    eligible_subq = (
        select(QuestionBankItem.id)
        .join(
            Assignment,
            Assignment.id == QuestionBankItem.originating_assignment_id,
        )
        .join(AssignmentSection, AssignmentSection.assignment_id == Assignment.id)
        .join(
            SectionEnrollment,
            and_(
                SectionEnrollment.section_id == AssignmentSection.section_id,
                SectionEnrollment.student_id == user.id,
            ),
        )
        .where(
            Assignment.course_id == course_id,
            Assignment.type == "practice",
            Assignment.status == "published",
            QuestionBankItem.status == "approved",
        )
        .distinct()
        .subquery()
    )

    total_problems = int((await db.execute(
        select(func.count()).select_from(eligible_subq)
    )).scalar_one())

    # Mastery rows for the student, filtered to eligible items only.
    mastery_rows = (await db.execute(
        select(StudentProblemMastery)
        .where(
            StudentProblemMastery.student_id == user.id,
            StudentProblemMastery.bank_item_id.in_(select(eligible_subq)),
        )
    )).scalars().all()

    mastered_count = sum(1 for r in mastery_rows if r.state == "mastered")

    # Heatmap + streak: bucket distinct UTC dates from each row's
    # last_attempt_at (the most recent interaction). first_attempt_at
    # is also folded in so a student who attempted on day A and then
    # again on day B contributes to both days even though we only
    # store the last timestamp. (Still lossy for 3+ days of activity
    # on the same problem; acceptable for v1.)
    # Heatmap counts DISTINCT (problem, day) interactions — a row
    # whose first_attempt_at, last_attempt_at, and walkthrough_opened_at
    # all land on the same day must contribute exactly 1 to that
    # day's bucket, not 3. We dedup per problem before counting.
    now = datetime.now(UTC)
    window_start = (now - timedelta(weeks=_HISTORY_HEATMAP_WEEKS)).date()
    activity_dates: set[date] = set()
    interactions: set[tuple[uuid.UUID, date]] = set()
    for r in mastery_rows:
        for ts in (r.first_attempt_at, r.last_attempt_at, r.walkthrough_opened_at):
            if ts is None:
                continue
            d = ts.astimezone(UTC).date()
            activity_dates.add(d)
            if d >= window_start:
                interactions.add((r.bank_item_id, d))
    bucket_counts: dict[date, int] = {}
    for _, d in interactions:
        bucket_counts[d] = bucket_counts.get(d, 0) + 1
    heatmap = [
        HistoryHeatmapDay(date=d.isoformat(), count=n)
        for d, n in sorted(bucket_counts.items())
    ]
    streak = _streak_days(activity_dates, now.date())

    # Needs-review: missed / walked_through / attempted, ordered by
    # last_attempt_at desc, capped. Joins with bank item + assignment
    # for the question text and practice title.
    # "Worth a second look" surfaces walked_through, missed, and
    # attempted rows. Order by the most recent interaction —
    # COALESCE so a row with only walkthrough_opened_at (no answer
    # yet) still surfaces; otherwise a walked-through-but-not-
    # answered problem would never appear in review.
    review_ordering = func.coalesce(
        StudentProblemMastery.last_attempt_at,
        StudentProblemMastery.walkthrough_opened_at,
    )
    review_rows = (await db.execute(
        select(StudentProblemMastery, QuestionBankItem, Assignment)
        .join(QuestionBankItem, QuestionBankItem.id == StudentProblemMastery.bank_item_id)
        .join(Assignment, Assignment.id == QuestionBankItem.originating_assignment_id)
        .where(
            StudentProblemMastery.student_id == user.id,
            StudentProblemMastery.state.in_(
                ["missed", "walked_through", "attempted"],
            ),
            StudentProblemMastery.bank_item_id.in_(select(eligible_subq)),
        )
        .order_by(review_ordering.desc())
        .limit(_NEEDS_REVIEW_LIMIT)
    )).all()
    needs_review: list[HistoryReviewItem] = []
    for m, it, a in review_rows:
        # Use last_attempt_at when present, fall back to walkthrough
        # timestamp for walked-through-only rows.
        when = m.last_attempt_at or m.walkthrough_opened_at
        if when is None:
            continue
        needs_review.append(HistoryReviewItem(
            bank_item_id=str(it.id),
            practice_assignment_id=str(a.id),
            practice_title=a.title,
            question=it.question,
            mastery_state=m.state,
            last_attempt_at=when,
        ))

    # Per-set breakdown: every published practice set in this course
    # visible to the student, with mastery count over its problems.
    # Two queries (one for set metadata, one for per-set counts) and
    # then we stitch in Python — simpler than a window function.
    # Postgres requires DISTINCT'd select columns to include any
    # ORDER BY targets — fetch `created_at` too and discard it after
    # ordering. Cheaper than the subquery alternative.
    sets_rows_raw = (await db.execute(
        select(Assignment.id, Assignment.title, Assignment.created_at)
        .join(AssignmentSection, AssignmentSection.assignment_id == Assignment.id)
        .join(
            SectionEnrollment,
            and_(
                SectionEnrollment.section_id == AssignmentSection.section_id,
                SectionEnrollment.student_id == user.id,
            ),
        )
        .where(
            Assignment.course_id == course_id,
            Assignment.type == "practice",
            Assignment.status == "published",
        )
        .distinct()
        .order_by(Assignment.created_at.desc())
    )).all()
    sets_rows = [(aid, title) for aid, title, _ in sets_rows_raw]

    set_ids = [aid for aid, _ in sets_rows]
    set_problem_counts: dict[uuid.UUID, int] = {}
    set_mastered_counts: dict[uuid.UUID, int] = {}
    if set_ids:
        rows = (await db.execute(
            select(
                QuestionBankItem.originating_assignment_id,
                func.count(QuestionBankItem.id),
            )
            .where(
                QuestionBankItem.originating_assignment_id.in_(set_ids),
                QuestionBankItem.status == "approved",
            )
            .group_by(QuestionBankItem.originating_assignment_id)
        )).all()
        set_problem_counts = {aid: int(n) for aid, n in rows}

        # Mastered counts per set: join mastery → bank_item, filtered
        # by the SAME `status == 'approved'` predicate used for the
        # problem-count query so the two stay consistent. Without
        # this, a mastery row whose bank item has since been demoted
        # to pending/rejected would still count as mastered while no
        # longer being counted as a problem — producing the
        # impossible `mastered_count > problem_count` for a set.
        rows = (await db.execute(
            select(
                QuestionBankItem.originating_assignment_id,
                func.count(StudentProblemMastery.bank_item_id),
            )
            .join(
                StudentProblemMastery,
                StudentProblemMastery.bank_item_id == QuestionBankItem.id,
            )
            .where(
                StudentProblemMastery.student_id == user.id,
                StudentProblemMastery.state == "mastered",
                QuestionBankItem.status == "approved",
                QuestionBankItem.originating_assignment_id.in_(set_ids),
            )
            .group_by(QuestionBankItem.originating_assignment_id)
        )).all()
        set_mastered_counts = {aid: int(n) for aid, n in rows}

    sets = [
        HistorySetBreakdown(
            assignment_id=str(aid),
            title=title,
            problem_count=set_problem_counts.get(aid, 0),
            mastered_count=set_mastered_counts.get(aid, 0),
        )
        for aid, title in sets_rows
    ]

    return CourseHistorySummary(
        course_id=str(course.id),
        course_name=course.name,
        mastered_count=mastered_count,
        total_problems=total_problems,
        streak_days=streak,
        heatmap=heatmap,
        needs_review=needs_review,
        sets=sets,
    )
