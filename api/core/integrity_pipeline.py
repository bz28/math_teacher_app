"""Integrity-checker pipeline orchestrator + shared constants.

Conversational redesign (plan: plans/integrity-conversational-redesign.md).
The feature runs as three phases:

1. On homework submit, `start_integrity_check` kicks off a background
   task that: runs Vision extraction, samples up to MAX_SAMPLE
   primary problems, inserts the IntegrityCheckSubmission +
   IntegrityCheckProblem rows, and generates the agent's opening
   turn (ordinal 0). The submission ends up in `awaiting_student`.

2. When the student sends a message, `process_student_turn` appends
   the student turn, runs the agent loop (text + tool_use blocks,
   looped via tool_result until the model replies with text only or
   finish_check fires), and returns the updated state.

3. Server-side caps: MAX_STUDENT_TURNS total per conversation
   (force-finalize at the cap with `uncertain`), VERDICT_STUDENT_TURN_FLOOR
   student turns on a problem before a submit_problem_verdict for it
   is accepted, TOOL_RETRIES_PER_TURN invalid tool calls per turn.
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.integrity_ai import (
    AGENT_SYSTEM_PROMPT,
    UNREADABLE_THRESHOLD,
    build_problems_briefing,
    extract_student_work,
    run_agent_turn,
)
from api.models.assignment import Assignment, Submission
from api.models.integrity_check import (
    IntegrityCheckProblem,
    IntegrityCheckSubmission,
    IntegrityConversationTurn,
)
from api.models.question_bank import QuestionBankItem
from api.services.bank import problem_ids_in_content

logger = logging.getLogger(__name__)

# Fewer problems, more depth (was 5 in the quiz-style pipeline).
MAX_SAMPLE = 3

# How many student turns (total across the conversation) before the
# server force-finalizes the check. 9 is a soft nudge; 10 is the hard
# cap.
MAX_STUDENT_TURNS = 10
SOFT_CAP_STUDENT_TURNS = 9

# Minimum student turns on a problem before submit_problem_verdict
# for that problem is accepted. Prevents the agent from verdicting on
# turn 0 with nothing from the student.
VERDICT_STUDENT_TURN_FLOOR = 1

# Agent can call tools at most this many times in a single student
# turn cycle. Prevents infinite tool_call loops when the agent keeps
# emitting invalid calls.
MAX_AGENT_LOOPS_PER_TURN = 6

# Tool names — must match INTEGRITY_SUBMIT_VERDICT_SCHEMA /
# INTEGRITY_FINISH_CHECK_SCHEMA in api/core/llm_schemas.py.
TOOL_SUBMIT_VERDICT = "submit_problem_verdict"
TOOL_FINISH_CHECK = "finish_check"

# Submission-level status state machine.
STATUS_EXTRACTING = "extracting"
STATUS_AWAITING_STUDENT = "awaiting_student"
STATUS_IN_PROGRESS = "in_progress"
STATUS_COMPLETE = "complete"
STATUS_SKIPPED_UNREADABLE = "skipped_unreadable"

# Problem-level status.
PROBLEM_STATUS_PENDING = "pending"
PROBLEM_STATUS_VERDICT_SUBMITTED = "verdict_submitted"
PROBLEM_STATUS_DISMISSED = "dismissed"
PROBLEM_STATUS_SKIPPED_UNREADABLE = "skipped_unreadable"

PROBLEM_TERMINAL_STATUSES = frozenset({
    PROBLEM_STATUS_VERDICT_SUBMITTED,
    PROBLEM_STATUS_DISMISSED,
    PROBLEM_STATUS_SKIPPED_UNREADABLE,
})

# Badge values surfaced to the teacher.
BADGE_LIKELY = "likely"
BADGE_UNCERTAIN = "uncertain"
BADGE_UNLIKELY = "unlikely"
BADGE_UNREADABLE = "unreadable"

# Turn role labels.
ROLE_AGENT = "agent"
ROLE_STUDENT = "student"
ROLE_TOOL_CALL = "tool_call"
ROLE_TOOL_RESULT = "tool_result"


# ── Pipeline start (called from submit_homework's background task) ──

async def start_integrity_check(
    submission_id: uuid.UUID,
    db: AsyncSession,
    *,
    extraction: dict[str, Any] | None = None,
) -> None:
    """Run the integrity check for a fresh submission.

    If `extraction` is provided (from a shared Vision call), uses it
    directly instead of calling extract_student_work again. This lets
    the background pipeline share one Vision call across integrity +
    AI grading.

    Idempotent: if an IntegrityCheckSubmission already exists for the
    submission_id, bails cleanly.

    Caller is responsible for committing the surrounding transaction.
    """
    submission = (await db.execute(
        select(Submission).where(Submission.id == submission_id)
    )).scalar_one_or_none()
    if submission is None:
        logger.warning(
            "start_integrity_check: submission %s not found", submission_id,
        )
        return

    assignment = (await db.execute(
        select(Assignment).where(Assignment.id == submission.assignment_id)
    )).scalar_one_or_none()
    if assignment is None:
        logger.warning(
            "start_integrity_check: assignment %s not found",
            submission.assignment_id,
        )
        return

    if not assignment.integrity_check_enabled:
        return
    if assignment.type != "homework":
        return

    # Idempotency: one IntegrityCheckSubmission row per submission.
    existing = (await db.execute(
        select(IntegrityCheckSubmission.id).where(
            IntegrityCheckSubmission.submission_id == submission_id,
        ).limit(1)
    )).scalar_one_or_none()
    if existing is not None:
        return

    primary_id_strs = problem_ids_in_content(assignment.content)
    if not primary_id_strs:
        return

    sampled_strs = primary_id_strs[:MAX_SAMPLE]
    sampled_uuids: list[uuid.UUID] = []
    for s in sampled_strs:
        try:
            sampled_uuids.append(uuid.UUID(str(s)))
        except (ValueError, TypeError):
            logger.warning(
                "start_integrity_check: invalid bank id %r in assignment %s",
                s, assignment.id,
            )
    if not sampled_uuids:
        return

    # Hydrate picked problems in a single query.
    items_by_id: dict[uuid.UUID, QuestionBankItem] = {}
    rows = (await db.execute(
        select(QuestionBankItem).where(QuestionBankItem.id.in_(sampled_uuids))
    )).scalars().all()
    for it in rows:
        items_by_id[it.id] = it

    check = IntegrityCheckSubmission(
        submission_id=submission_id,
        status=STATUS_EXTRACTING,
    )
    db.add(check)
    await db.flush()

    # Attribute LLM calls to the student so the admin dashboard doesn't
    # show "Deleted User" against every integrity extraction + agent
    # turn. Stringified because llm_calls.user_id is stored as string.
    user_id = str(submission.student_id)

    if extraction is None:
        extraction = await extract_student_work(submission_id, db, user_id=user_id)
    confidence = extraction.get("confidence", 0.0)
    if confidence < UNREADABLE_THRESHOLD:
        logger.info(
            "Handwriting unreadable (confidence=%.2f) for submission %s",
            confidence, submission_id,
        )
        for sample_position, bid in enumerate(sampled_uuids):
            if bid not in items_by_id:
                continue
            db.add(IntegrityCheckProblem(
                integrity_check_submission_id=check.id,
                bank_item_id=bid,
                sample_position=sample_position,
                status=PROBLEM_STATUS_SKIPPED_UNREADABLE,
                student_work_extraction=extraction,
                badge=BADGE_UNREADABLE,
            ))
        check.status = STATUS_SKIPPED_UNREADABLE
        check.overall_badge = BADGE_UNREADABLE
        check.overall_confidence = confidence
        check.overall_summary = "Handwriting was unreadable — no questions asked."
        return

    problem_rows: list[IntegrityCheckProblem] = []
    for sample_position, bid in enumerate(sampled_uuids):
        item = items_by_id.get(bid)
        if item is None:
            # Picked problem was deleted between publish and submit.
            continue
        row = IntegrityCheckProblem(
            integrity_check_submission_id=check.id,
            bank_item_id=bid,
            sample_position=sample_position,
            status=PROBLEM_STATUS_PENDING,
            student_work_extraction=extraction,
        )
        db.add(row)
        problem_rows.append(row)
    await db.flush()

    if not problem_rows:
        # All sampled problems were deleted — mark the check complete
        # with uncertain so we don't get stuck in extracting.
        check.status = STATUS_COMPLETE
        check.overall_badge = BADGE_UNCERTAIN
        check.overall_confidence = 0.0
        check.overall_summary = "No sampled problems were available to check."
        return

    problems_for_prompt = [
        {
            "problem_id": str(r.id),
            "sample_position": r.sample_position,
            "question": items_by_id[r.bank_item_id].question,
            "extraction": r.student_work_extraction,
            "verdict_status": "pending",
        }
        for r in problem_rows
    ]
    briefing = build_problems_briefing(problems_for_prompt)
    kickoff_user_message = (
        briefing
        + "\n\nNow begin the conversation. Greet the student warmly and ask "
        "your first question about problem 1, referencing a specific step "
        "they wrote."
    )

    # Try to generate an opening. Fall back to a canned opener if the
    # model misbehaves — the check must not get stuck in "extracting".
    try:
        content_blocks = await run_agent_turn(
            AGENT_SYSTEM_PROMPT,
            [{"role": "user", "content": kickoff_user_message}],
            user_id=user_id,
        )
        opening_text = _first_text_block(content_blocks)
    except Exception:
        logger.exception(
            "integrity opening-turn generation failed for submission %s",
            submission_id,
        )
        opening_text = None

    if not opening_text:
        opening_text = (
            "Hi! I just took a look at your homework. "
            "Can you walk me through the first step you took on problem 1?"
        )

    db.add(IntegrityConversationTurn(
        integrity_check_submission_id=check.id,
        ordinal=0,
        role=ROLE_AGENT,
        content=opening_text,
    ))
    check.status = STATUS_AWAITING_STUDENT


# ── Student turn processing ─────────────────────────────────────────

async def process_student_turn(
    check: IntegrityCheckSubmission,
    student_message: str,
    seconds_on_turn: int | None,
    db: AsyncSession,
    *,
    user_id: str | None = None,
) -> None:
    """Append a student turn, run the agent loop, and update in-place.

    Mutates `check` + writes new rows. Caller commits. `user_id` is
    forwarded to every agent LLM call so cost tracking / the admin
    dashboard attribute the spend to the actual student instead of
    "Deleted User".

    The agent loop:
      1. Call Claude with the current transcript.
      2. If response has tool_use blocks, validate + apply each, save
         tool_call + tool_result turns, and call Claude again with
         tool_result messages appended.
      3. Exit when the response has text with no tool_use, or when
         MAX_AGENT_LOOPS_PER_TURN is reached.
      4. If MAX_STUDENT_TURNS is reached after this turn, force-
         finalize with overall `uncertain`.
    """
    if check.status in (STATUS_COMPLETE, STATUS_SKIPPED_UNREADABLE):
        return

    # Append the student turn first so it shows up in the transcript
    # the agent sees on the first call.
    current_ordinal = (await db.execute(
        select(func.coalesce(func.max(IntegrityConversationTurn.ordinal), -1))
        .where(IntegrityConversationTurn.integrity_check_submission_id == check.id)
    )).scalar_one()
    student_ordinal = int(current_ordinal) + 1
    db.add(IntegrityConversationTurn(
        integrity_check_submission_id=check.id,
        ordinal=student_ordinal,
        role=ROLE_STUDENT,
        content=student_message,
        seconds_on_turn=seconds_on_turn,
    ))
    check.status = STATUS_IN_PROGRESS
    await db.flush()

    student_turn_count = await count_student_turns(check.id, db)

    # Agent loop.
    for _ in range(MAX_AGENT_LOOPS_PER_TURN):
        problems = await _load_problems_for_prompt(check.id, db)
        turns = await _load_turns(check.id, db)
        briefing = build_problems_briefing(problems)
        messages = _build_agent_messages(briefing, turns)

        try:
            content_blocks = await run_agent_turn(
                AGENT_SYSTEM_PROMPT, messages, user_id=user_id,
            )
        except Exception:
            logger.exception(
                "integrity agent turn failed for submission %s",
                check.submission_id,
            )
            # Don't leave the student staring at a spinner — write a
            # soft recovery message so the UI still shows something.
            await _append_agent_text(
                check.id,
                "Sorry, something went wrong on my end. Could you try "
                "sending that again?",
                db,
            )
            # If this was the last allowed student turn, force-finalize
            # here — otherwise the check would be stuck in in_progress
            # forever (endpoint's hard-cap guard rejects future turns).
            if student_turn_count >= MAX_STUDENT_TURNS:
                await _force_finalize_turn_cap(check, db)
            return

        text_reply = _first_text_block(content_blocks)
        tool_uses = [
            b for b in content_blocks if getattr(b, "type", None) == "tool_use"
        ]

        # Persist any text the agent produced alongside tool calls.
        if text_reply:
            await _append_agent_text(check.id, text_reply, db)

        if not tool_uses:
            # Pure text reply — done with this student turn.
            break

        # Apply tool calls, persisting tool_call + tool_result turns.
        for block in tool_uses:
            await _record_tool_call(check.id, block, db)
            result_text = await _apply_tool_call(check, block, db)
            await _record_tool_result(
                check.id, getattr(block, "id", ""), result_text, db,
            )

        # After tool calls, keep looping so the agent can continue
        # (it will see the tool_results when we rebuild messages).
        # When finish_check succeeds, the check is complete — write a
        # canned closing so the student sees a clear goodbye and exit
        # the loop.
        if check.status == STATUS_COMPLETE:
            await _append_agent_text(
                check.id,
                "Thanks for talking through your work with me! Your "
                "homework is with your teacher now.",
                db,
            )
            break

    # Hard cap on student turns: if this was the 10th student turn
    # and the check isn't complete, force-finalize.
    if check.status != STATUS_COMPLETE and student_turn_count >= MAX_STUDENT_TURNS:
        await _force_finalize_turn_cap(check, db)
    # Soft nudge: after the 9th student turn, inject a wrap-up prompt
    # (an agent turn) so the agent sees the signal next time. Only
    # emit this nudge once — check for a prior nudge by scanning
    # recent agent turns.
    elif (
        check.status != STATUS_COMPLETE
        and student_turn_count >= SOFT_CAP_STUDENT_TURNS
        and not await _soft_nudge_already_sent(check.id, db)
    ):
        await _append_agent_text(
            check.id,
            f"{_SOFT_NUDGE_MARKER} only one question left before we stop. "
            "Pick the problem you still have the most doubt on.)",
            db,
        )


# ── Agent-loop helpers ──────────────────────────────────────────────

def _first_text_block(content_blocks: list[Any]) -> str | None:
    for b in content_blocks:
        if getattr(b, "type", None) == "text":
            text = getattr(b, "text", "") or ""
            if text.strip():
                return text.strip()
    return None


async def _append_agent_text(
    check_id: uuid.UUID, text: str, db: AsyncSession,
) -> None:
    ordinal = await _next_ordinal(check_id, db)
    db.add(IntegrityConversationTurn(
        integrity_check_submission_id=check_id,
        ordinal=ordinal,
        role=ROLE_AGENT,
        content=text,
    ))
    await db.flush()


async def _record_tool_call(
    check_id: uuid.UUID, block: Any, db: AsyncSession,
) -> None:
    tool_name = getattr(block, "name", "") or ""
    tool_use_id = getattr(block, "id", "") or ""
    raw_input = getattr(block, "input", {}) or {}
    ordinal = await _next_ordinal(check_id, db)
    db.add(IntegrityConversationTurn(
        integrity_check_submission_id=check_id,
        ordinal=ordinal,
        role=ROLE_TOOL_CALL,
        content=json.dumps(raw_input, ensure_ascii=False),
        tool_name=tool_name,
        tool_use_id=tool_use_id,
    ))
    await db.flush()


async def _record_tool_result(
    check_id: uuid.UUID, tool_use_id: str, text: str, db: AsyncSession,
) -> None:
    ordinal = await _next_ordinal(check_id, db)
    db.add(IntegrityConversationTurn(
        integrity_check_submission_id=check_id,
        ordinal=ordinal,
        role=ROLE_TOOL_RESULT,
        content=text,
        tool_use_id=tool_use_id,
    ))
    await db.flush()


async def _apply_tool_call(
    check: IntegrityCheckSubmission,
    block: Any,
    db: AsyncSession,
) -> str:
    """Validate + apply a single tool call. Returns the tool_result
    text to persist (and echo back to the agent on the next loop)."""
    tool_name = getattr(block, "name", "")
    raw_input = getattr(block, "input", {}) or {}

    if tool_name == TOOL_SUBMIT_VERDICT:
        return await _apply_submit_verdict(check, raw_input, db)
    if tool_name == TOOL_FINISH_CHECK:
        return await _apply_finish_check(check, raw_input, db)
    return f"rejected: unknown tool '{tool_name}'"


async def _apply_submit_verdict(
    check: IntegrityCheckSubmission,
    raw_input: dict[str, Any],
    db: AsyncSession,
) -> str:
    problem_id_str = raw_input.get("problem_id") or ""
    badge = raw_input.get("badge")
    confidence = raw_input.get("confidence")
    reasoning = raw_input.get("reasoning") or ""

    try:
        problem_id = uuid.UUID(str(problem_id_str))
    except (ValueError, TypeError):
        return f"rejected: problem_id {problem_id_str!r} is not a valid UUID"

    problem = (await db.execute(
        select(IntegrityCheckProblem).where(
            IntegrityCheckProblem.id == problem_id,
            IntegrityCheckProblem.integrity_check_submission_id == check.id,
        )
    )).scalar_one_or_none()
    if problem is None:
        return (
            "rejected: problem_id does not match any sampled problem for "
            "this conversation"
        )

    # Teacher may have dismissed or closed this problem between turns.
    # Don't let the agent overwrite either terminal state — they outrank
    # the agent's view.
    if problem.teacher_dismissed:
        return "rejected: teacher has dismissed this problem; no verdict needed"
    if problem.status == PROBLEM_STATUS_SKIPPED_UNREADABLE:
        return "rejected: this problem was skipped as unreadable"

    if badge not in (BADGE_LIKELY, BADGE_UNCERTAIN, BADGE_UNLIKELY):
        return f"rejected: badge must be one of likely/uncertain/unlikely (got {badge!r})"

    # isinstance(True, int) is True in Python, but bool confidences
    # are nonsensical here — guard explicitly.
    if isinstance(confidence, bool) or not isinstance(confidence, int | float):
        return "rejected: confidence must be a number between 0.0 and 1.0"
    confidence_f = float(confidence)
    if confidence_f < 0.0 or confidence_f > 1.0:
        return "rejected: confidence must be between 0.0 and 1.0"

    student_turn_count = await count_student_turns(check.id, db)
    if student_turn_count < VERDICT_STUDENT_TURN_FLOOR:
        return (
            "rejected: need at least "
            f"{VERDICT_STUDENT_TURN_FLOOR} student turn(s) before a verdict; "
            "ask the student a question first"
        )

    problem.status = PROBLEM_STATUS_VERDICT_SUBMITTED
    problem.badge = badge
    problem.confidence = confidence_f
    problem.ai_reasoning = reasoning
    await db.flush()
    return f"accepted: recorded {badge} ({confidence_f:.2f}) for this problem"


async def _apply_finish_check(
    check: IntegrityCheckSubmission,
    raw_input: dict[str, Any],
    db: AsyncSession,
) -> str:
    overall_badge = raw_input.get("overall_badge")
    overall_confidence = raw_input.get("overall_confidence")
    summary = raw_input.get("summary") or ""

    if overall_badge not in (BADGE_LIKELY, BADGE_UNCERTAIN, BADGE_UNLIKELY):
        return (
            "rejected: overall_badge must be one of likely/uncertain/unlikely "
            f"(got {overall_badge!r})"
        )
    if (
        isinstance(overall_confidence, bool)
        or not isinstance(overall_confidence, int | float)
    ):
        return "rejected: overall_confidence must be a number between 0.0 and 1.0"
    conf_f = float(overall_confidence)
    if conf_f < 0.0 or conf_f > 1.0:
        return "rejected: overall_confidence must be between 0.0 and 1.0"

    problems = (await db.execute(
        select(IntegrityCheckProblem).where(
            IntegrityCheckProblem.integrity_check_submission_id == check.id,
        )
    )).scalars().all()
    missing = [
        p for p in problems
        if p.status == PROBLEM_STATUS_PENDING
    ]
    if missing:
        ids = ", ".join(str(p.id) for p in missing)
        return (
            "rejected: still missing submit_problem_verdict for problems: "
            + ids
        )

    check.status = STATUS_COMPLETE
    check.overall_badge = overall_badge
    check.overall_confidence = conf_f
    check.overall_summary = summary
    await db.flush()
    return f"accepted: overall {overall_badge} ({conf_f:.2f}), check complete"


async def _force_finalize_turn_cap(
    check: IntegrityCheckSubmission, db: AsyncSession,
) -> None:
    """Hard-cap enforcement: 10 student turns without a finish_check."""
    problems = (await db.execute(
        select(IntegrityCheckProblem).where(
            IntegrityCheckProblem.integrity_check_submission_id == check.id,
        )
    )).scalars().all()
    for p in problems:
        if p.status == PROBLEM_STATUS_PENDING:
            p.status = PROBLEM_STATUS_VERDICT_SUBMITTED
            p.badge = BADGE_UNCERTAIN
            p.confidence = 0.0
            p.ai_reasoning = "Conversation hit the turn cap before this problem was verdicted."
    check.status = STATUS_COMPLETE
    check.overall_badge = BADGE_UNCERTAIN
    check.overall_confidence = 0.0
    check.overall_summary = "Conversation hit the turn cap — verdict is inconclusive."
    await _append_agent_text(
        check.id,
        "Thanks for sticking with this. That's all the time we have — your "
        "work is with your teacher.",
        db,
    )


_SOFT_NUDGE_MARKER = "(Wrap up:"


async def _soft_nudge_already_sent(
    check_id: uuid.UUID, db: AsyncSession,
) -> bool:
    """True if an agent turn containing the soft-nudge marker exists."""
    hit = (await db.execute(
        select(IntegrityConversationTurn.id)
        .where(
            IntegrityConversationTurn.integrity_check_submission_id == check_id,
            IntegrityConversationTurn.role == ROLE_AGENT,
            IntegrityConversationTurn.content.like(f"{_SOFT_NUDGE_MARKER}%"),
        )
        .limit(1)
    )).scalar_one_or_none()
    return hit is not None


# ── Message + transcript helpers ────────────────────────────────────

async def _next_ordinal(check_id: uuid.UUID, db: AsyncSession) -> int:
    current = (await db.execute(
        select(func.coalesce(func.max(IntegrityConversationTurn.ordinal), -1))
        .where(IntegrityConversationTurn.integrity_check_submission_id == check_id)
    )).scalar_one()
    return int(current) + 1


async def count_student_turns(
    check_id: uuid.UUID, db: AsyncSession,
) -> int:
    count = (await db.execute(
        select(func.count(IntegrityConversationTurn.id)).where(
            IntegrityConversationTurn.integrity_check_submission_id == check_id,
            IntegrityConversationTurn.role == ROLE_STUDENT,
        )
    )).scalar_one()
    return int(count)


async def _load_turns(
    check_id: uuid.UUID, db: AsyncSession,
) -> list[IntegrityConversationTurn]:
    return list((await db.execute(
        select(IntegrityConversationTurn)
        .where(IntegrityConversationTurn.integrity_check_submission_id == check_id)
        .order_by(IntegrityConversationTurn.ordinal.asc())
    )).scalars().all())


async def _load_problems_for_prompt(
    check_id: uuid.UUID, db: AsyncSession,
) -> list[dict[str, Any]]:
    """Build the per-problem dicts used by build_problems_briefing,
    with up-to-date verdict status."""
    problems = (await db.execute(
        select(IntegrityCheckProblem)
        .where(IntegrityCheckProblem.integrity_check_submission_id == check_id)
        .order_by(IntegrityCheckProblem.sample_position.asc())
    )).scalars().all()

    if not problems:
        return []

    items_by_id: dict[uuid.UUID, QuestionBankItem] = {}
    item_rows = (await db.execute(
        select(QuestionBankItem)
        .where(QuestionBankItem.id.in_([p.bank_item_id for p in problems]))
    )).scalars().all()
    for it in item_rows:
        items_by_id[it.id] = it

    out: list[dict[str, Any]] = []
    for p in problems:
        item = items_by_id.get(p.bank_item_id)
        question_text = item.question if item else "(problem text unavailable)"
        out.append({
            "problem_id": str(p.id),
            "sample_position": p.sample_position,
            "question": question_text,
            "extraction": p.student_work_extraction,
            "verdict_status": p.status,
        })
    return out


def _build_agent_messages(
    briefing: str,
    turns: list[IntegrityConversationTurn],
) -> list[dict[str, Any]]:
    """Fold the stored transcript into Anthropic-shaped messages.

    Opens with a user message containing the problems briefing plus a
    kickoff instruction. Pairs tool_call turns into assistant
    messages with `tool_use` content; pairs tool_result turns into
    user messages with `tool_result` content.
    """
    messages: list[dict[str, Any]] = [{
        "role": "user",
        "content": (
            briefing
            + "\n\nContinue the conversation with the student. "
            "Refer back to the problems by problem_id when calling tools."
        ),
    }]

    i = 0
    while i < len(turns):
        t = turns[i]
        if t.role == ROLE_AGENT:
            # Agent text turn — may be followed by tool_call turns
            # that the agent emitted in the same model response. Group
            # them into a single assistant message.
            content_blocks: list[dict[str, Any]] = [
                {"type": "text", "text": t.content},
            ]
            j = i + 1
            while j < len(turns) and turns[j].role == ROLE_TOOL_CALL:
                tc = turns[j]
                try:
                    tc_input = json.loads(tc.content) if tc.content else {}
                except json.JSONDecodeError:
                    tc_input = {}
                content_blocks.append({
                    "type": "tool_use",
                    "id": tc.tool_use_id or "",
                    "name": tc.tool_name or "",
                    "input": tc_input,
                })
                j += 1
            messages.append({"role": "assistant", "content": content_blocks})
            i = j
            continue

        if t.role == ROLE_TOOL_CALL:
            # Tool call without a preceding text — wrap on its own.
            try:
                tc_input = json.loads(t.content) if t.content else {}
            except json.JSONDecodeError:
                tc_input = {}
            messages.append({
                "role": "assistant",
                "content": [{
                    "type": "tool_use",
                    "id": t.tool_use_id or "",
                    "name": t.tool_name or "",
                    "input": tc_input,
                }],
            })
            i += 1
            continue

        if t.role == ROLE_TOOL_RESULT:
            messages.append({
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": t.tool_use_id or "",
                    "content": t.content,
                }],
            })
            i += 1
            continue

        if t.role == ROLE_STUDENT:
            messages.append({"role": "user", "content": t.content})
            i += 1
            continue

        # Unknown role — skip defensively.
        i += 1

    return messages
