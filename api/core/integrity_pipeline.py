"""Integrity-checker pipeline orchestrator + shared constants.

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

# V1 picks a single probe problem (the most differentiation-valuable
# one the student attempted). The schema + pipeline still support up
# to 3 sampled problems so a v2 escalation path ("expand to a second
# problem when signal is mixed") can land without another schema
# change.
MAX_SAMPLE = 1

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

# Tool names — must match schemas in api/core/llm_schemas.py.
TOOL_SUBMIT_VERDICT = "submit_problem_verdict"
TOOL_GENERATE_VARIANT = "generate_variant"
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

# Disposition values surfaced to the teacher. Emitted by the agent
# via finish_check; None when status=skipped_unreadable or when the
# turn cap was hit without a conclusion (teacher reviews either way).
DISPOSITION_PASS = "pass"
DISPOSITION_NEEDS_PRACTICE = "needs_practice"
DISPOSITION_TUTOR_PIVOT = "tutor_pivot"
DISPOSITION_FLAG_FOR_REVIEW = "flag_for_review"

DISPOSITION_VALUES = frozenset({
    DISPOSITION_PASS,
    DISPOSITION_NEEDS_PRACTICE,
    DISPOSITION_TUTOR_PIVOT,
    DISPOSITION_FLAG_FOR_REVIEW,
})

# Why the pipeline picked the problem(s) it did (stored on the
# submission + the per-problem selected_reason). v1 only uses the
# first two — the anomaly_* values are reserved for a v2 copy-smell
# detector (see plan section on deferred anomaly detection).
SELECTION_REASON_HIGHEST_DIFFERENTIATION = "highest_differentiation"
SELECTION_REASON_SKIP_ALL_WRONG = "skip_all_wrong"
SELECTION_REASON_ANOMALY_COPIED = "anomaly_copied"           # v2
SELECTION_REASON_ANOMALY_WRONG_METHOD = "anomaly_wrong_method"  # v2

# Inline variant disambiguator result, set by finish_check when the
# agent used generate_variant to resolve an ambiguous case.
VARIANT_RESULT_SPECIFIC_APPROACH = "specific_approach"
VARIANT_RESULT_APPROACH_AFTER_FOLLOWUP = "approach_after_followup"
VARIANT_RESULT_BLANK_OR_WRONG = "blank_or_wrong"
VARIANT_RESULT_NOT_APPLICABLE = "not_applicable"

VARIANT_RESULT_VALUES = frozenset({
    VARIANT_RESULT_SPECIFIC_APPROACH,
    VARIANT_RESULT_APPROACH_AFTER_FOLLOWUP,
    VARIANT_RESULT_BLANK_OR_WRONG,
    VARIANT_RESULT_NOT_APPLICABLE,
})

# Rubric enum values, per dimension (see INTEGRITY_SUBMIT_VERDICT_SCHEMA).
_RUBRIC_CORE_VALUES = frozenset({"low", "mid", "high"})
_RUBRIC_OPTIONAL_VALUES = frozenset({"low", "mid", "high", "not_probed"})
_RUBRIC_SELF_CORRECTION_VALUES = frozenset({
    "low", "mid", "high", "not_observed",
})

# Turn role labels.
ROLE_AGENT = "agent"
ROLE_STUDENT = "student"
ROLE_TOOL_CALL = "tool_call"
ROLE_TOOL_RESULT = "tool_result"


# ── Activity summary thresholds ─────────────────────────────────────
# Per-turn signals that promote a student turn to "notable" — the same
# evidence the teacher panel inlines under the student's bubble.
# Numbers are deliberately tight: a 10s tab-out and a 30%-of-turn
# cumulative absence are both unusual enough that a teacher should
# see something on the row. Revisit after real-teacher feedback.
ACTIVITY_LARGE_PASTE_CHARS = 100        # single paste >= 100 chars
ACTIVITY_FULL_PASTE_RATIO = 0.8         # total paste >= 80% of content len
ACTIVITY_LONG_TAB_OUT_MS = 10_000       # any one tab-out >= 10s on this turn
ACTIVITY_DOMINANT_TAB_OUT_RATIO = 0.3   # cumulative tab-out >= 30% of seconds_on_turn

# Per-turn reason codes — frontend renders matching copy.
ACTIVITY_REASON_LARGE_PASTE = "large_paste"
ACTIVITY_REASON_FULL_PASTE = "full_paste"
ACTIVITY_REASON_LONG_TAB_OUT = "long_tab_out"
ACTIVITY_REASON_DOMINANT_TAB_OUT = "dominant_tab_out"

ACTIVITY_REASON_VALUES = frozenset({
    ACTIVITY_REASON_LARGE_PASTE,
    ACTIVITY_REASON_FULL_PASTE,
    ACTIVITY_REASON_LONG_TAB_OUT,
    ACTIVITY_REASON_DOMINANT_TAB_OUT,
})

# Session-level levels.
ACTIVITY_LEVEL_CLEAN = "clean"
ACTIVITY_LEVEL_NOTABLE = "notable"
ACTIVITY_LEVEL_HEAVY = "heavy"


# ── Adaptive probe selection ────────────────────────────────────────

# Difficulty tiers from the QuestionBankItem.difficulty column, ranked
# so higher = harder = better probe target. Anything unrecognised
# falls back to "medium" so a stray tag value doesn't crash selection.
_DIFFICULTY_RANK: dict[str, int] = {
    "easy": 0,
    "medium": 1,
    "hard": 2,
}


def _differentiation_score(item: QuestionBankItem) -> tuple[int, int]:
    """Higher score = better probe target.

    Primary: difficulty tier — hard > medium > easy. This is the
    authoritative signal for "how hard is this problem" (set by the
    teacher or the generating AI).

    Tiebreak within tier: count of canonical solution_steps — more
    steps = more decision points for the agent to probe ("why this
    step?"). NOT a difficulty measure — a long arithmetic problem
    has many steps but isn't conceptually hard. Only used after
    difficulty ties.
    """
    difficulty_rank = _DIFFICULTY_RANK.get(
        (item.difficulty or "medium").lower(), 1,
    )
    steps_count = len(item.solution_steps or [])
    return (difficulty_rank, steps_count)


def select_probe_problems(
    items_by_id: dict[uuid.UUID, QuestionBankItem],
    candidate_ids: list[uuid.UUID],
    *,
    max_picks: int = MAX_SAMPLE,
) -> tuple[list[uuid.UUID], str]:
    """Pick up to `max_picks` probe targets, ordered best-first.

    v1 selection = highest differentiation value: rank by
    `_differentiation_score`, pick the top `max_picks`. No correctness
    filter (would require AI equivalence check pre-grading, which
    doubles cost/latency for marginal benefit — the agent's rubric +
    TUTOR_PIVOT disposition already handles the "student didn't get it"
    case naturally). No anomaly/copy-smell detection (v2).

    Returns (picked_ids_in_order, selection_reason). `candidate_ids`
    is filtered through `items_by_id` so callers don't have to
    pre-drop missing bank items.
    """
    candidates = [
        items_by_id[bid] for bid in candidate_ids
        if bid in items_by_id
    ]
    if not candidates:
        return ([], SELECTION_REASON_HIGHEST_DIFFERENTIATION)
    # max() gives the single best; sorted() + slice would let us
    # return the top-N for a future multi-probe escalation path.
    ranked = sorted(candidates, key=_differentiation_score, reverse=True)
    picked = ranked[:max_picks]
    return ([p.id for p in picked], SELECTION_REASON_HIGHEST_DIFFERENTIATION)


def _slice_extraction_for_problem(
    extraction: dict[str, Any], hw_position: int,
) -> dict[str, Any]:
    """Return a new extraction dict filtered down to a single
    problem's work — the steps Vision attributed to that problem
    (by problem_position) plus any unattributed scratchwork, and the
    final answer Vision emitted for that problem.

    Unattributed steps (problem_position=None) are kept as context:
    cross-problem setup, scratch calculations, and notes the agent
    might reasonably probe about are still potentially relevant.
    Steps explicitly attributed to OTHER problems are dropped —
    including them would mislabel another problem's work as the
    current problem's work in the agent's briefing.

    Preserves the extraction's top-level shape (steps / final_answers /
    confidence + any extra fields) so downstream consumers that read
    the stored blob keep working unchanged.
    """
    steps = extraction.get("steps") or []
    sliced_steps = [
        s for s in steps
        if s.get("problem_position") is None
        or s.get("problem_position") == hw_position
    ]
    final_answers = extraction.get("final_answers") or []
    sliced_finals = [
        fa for fa in final_answers
        if fa.get("problem_position") == hw_position
    ]
    return {
        **extraction,
        "steps": sliced_steps,
        "final_answers": sliced_finals,
    }


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

    # Parse every primary bank id into a candidate pool, then let the
    # selection algorithm pick the best subset. Invalid UUIDs log and
    # skip — a malformed assignment.content shouldn't wedge the check.
    candidate_uuids: list[uuid.UUID] = []
    for s in primary_id_strs:
        try:
            candidate_uuids.append(uuid.UUID(str(s)))
        except (ValueError, TypeError):
            logger.warning(
                "start_integrity_check: invalid bank id %r in assignment %s",
                s, assignment.id,
            )
    if not candidate_uuids:
        return

    # Hydrate candidates in one query so the selection algorithm can
    # score by difficulty + solution_step count.
    items_by_id: dict[uuid.UUID, QuestionBankItem] = {}
    rows = (await db.execute(
        select(QuestionBankItem).where(QuestionBankItem.id.in_(candidate_uuids))
    )).scalars().all()
    for it in rows:
        items_by_id[it.id] = it

    picked_ids, selection_reason = select_probe_problems(
        items_by_id, candidate_uuids,
    )
    if not picked_ids:
        # Every primary id was deleted between publish and submit.
        # Don't create a stuck row — just return and let the teacher
        # handle the submission without an integrity trace.
        return

    # Map bank_item_id → 1-based HW position. Position = index in the
    # assignment's problem_ids list + 1 (matching `problem_position`
    # on the extraction). Used below to slice the extraction down to
    # just the sampled problem's work before persisting — the agent
    # should see only the problem it's probing, not noise from other
    # problems on the page.
    hw_position_by_id: dict[uuid.UUID, int] = {
        cid: idx + 1 for idx, cid in enumerate(candidate_uuids)
    }

    check = IntegrityCheckSubmission(
        submission_id=submission_id,
        status=STATUS_EXTRACTING,
        probe_selection_reason=selection_reason,
    )
    db.add(check)
    await db.flush()

    # Attribute LLM calls to the student so the admin dashboard doesn't
    # show "Deleted User" against every integrity extraction + agent
    # turn. Stringified because llm_calls.user_id is stored as string.
    user_id = str(submission.student_id)

    if extraction is None:
        # Fallback extraction (caller didn't pre-extract). Build the
        # problems briefing from the candidate pool the selection
        # algorithm just scored — same bank items, already hydrated —
        # so Vision sees the HW's problem list and tags each step with
        # a problem_position without a second DB round-trip through
        # load_problems_for_assignment. Position matches the 1-based
        # index of the bank id in the assignment's primary list, i.e.
        # hw_position_by_id above.
        problems_for_briefing = [
            {
                "position": hw_position_by_id[cid],
                "question": items_by_id[cid].question,
                "final_answer": items_by_id[cid].final_answer,
            }
            for cid in candidate_uuids
            if cid in items_by_id
        ]
        extraction = await extract_student_work(
            submission_id, db, problems=problems_for_briefing, user_id=user_id,
        )
    confidence = extraction.get("confidence", 0.0)
    if confidence < UNREADABLE_THRESHOLD:
        logger.info(
            "Handwriting unreadable (confidence=%.2f) for submission %s",
            confidence, submission_id,
        )
        for sample_position, bid in enumerate(picked_ids):
            # Unreadable path: we still persist the extraction slice
            # on the row for the teacher's "What the reader got" panel,
            # but scoped to this problem — matches readable-path
            # behavior and keeps the teacher view consistent.
            problem_slice = _slice_extraction_for_problem(
                extraction, hw_position_by_id.get(bid, sample_position + 1),
            )
            db.add(IntegrityCheckProblem(
                integrity_check_submission_id=check.id,
                bank_item_id=bid,
                sample_position=sample_position,
                status=PROBLEM_STATUS_SKIPPED_UNREADABLE,
                student_work_extraction=problem_slice,
                selected_reason=selection_reason,
            ))
        # Unreadable submissions: status carries the meaning, disposition
        # stays null. Teacher dashboard surfaces the skipped-unreadable
        # bucket separately from the four integrity dispositions.
        check.status = STATUS_SKIPPED_UNREADABLE
        check.overall_summary = "Handwriting was unreadable — no questions asked."
        return

    problem_rows: list[IntegrityCheckProblem] = []
    for sample_position, bid in enumerate(picked_ids):
        # Slice the extraction down to just this problem's work
        # before persisting. Before slicing, every sampled problem
        # row stored the full extraction (all problems' steps), so
        # the agent's briefing fed it work from problems it wasn't
        # probing. Now the row carries only the sampled problem's
        # steps + final answer, plus any unattributed scratchwork.
        problem_slice = _slice_extraction_for_problem(
            extraction, hw_position_by_id.get(bid, sample_position + 1),
        )
        row = IntegrityCheckProblem(
            integrity_check_submission_id=check.id,
            bank_item_id=bid,
            sample_position=sample_position,
            status=PROBLEM_STATUS_PENDING,
            student_work_extraction=problem_slice,
            selected_reason=selection_reason,
        )
        db.add(row)
        problem_rows.append(row)
    await db.flush()

    problems_for_prompt = [
        {
            "problem_id": str(r.id),
            "sample_position": r.sample_position,
            "question": items_by_id[r.bank_item_id].question,
            "correct_final_answer": items_by_id[r.bank_item_id].final_answer,
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
    telemetry: dict[str, Any] | None = None,
) -> None:
    """Append a student turn, run the agent loop, and update in-place.

    Mutates `check` + writes new rows. Caller commits. `user_id` is
    forwarded to every agent LLM call so cost tracking / the admin
    dashboard attribute the spend to the actual student instead of
    "Deleted User". `telemetry` is the client-captured behavioral
    payload (focus-blur events, paste events, typing cadence); it's
    persisted on the student turn row as-is and only surfaced to
    teachers — never to the student.

    The agent loop:
      1. Call Claude with the current transcript.
      2. If response has tool_use blocks, validate + apply each, save
         tool_call + tool_result turns, and call Claude again with
         tool_result messages appended.
      3. Exit when the response has text with no tool_use, or when
         MAX_AGENT_LOOPS_PER_TURN is reached.
      4. If MAX_STUDENT_TURNS is reached after this turn, force-
         finalize with a null disposition (teacher reviews).
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
        telemetry=telemetry,
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
        # Pass text_reply through so finish_check can detect the
        # "asked a question AND finalized in one response" pattern.
        for block in tool_uses:
            await _record_tool_call(check.id, block, db)
            result_text = await _apply_tool_call(
                check, block, db,
                user_id=user_id,
                current_turn_text=text_reply,
            )
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
    *,
    user_id: str | None = None,
    current_turn_text: str | None = None,
) -> str:
    """Validate + apply a single tool call. Returns the tool_result
    text to persist (and echo back to the agent on the next loop).

    `current_turn_text` is the text reply the agent emitted alongside
    this tool call in the same response (None if the response was
    tool_use-only). Used by finish_check to detect the agent asking
    a question and finalizing in the same breath.
    """
    tool_name = getattr(block, "name", "")
    raw_input = getattr(block, "input", {}) or {}

    if tool_name == TOOL_SUBMIT_VERDICT:
        return await _apply_submit_verdict(check, raw_input, db)
    if tool_name == TOOL_GENERATE_VARIANT:
        return await _apply_generate_variant(
            check, raw_input, db, user_id=user_id,
        )
    if tool_name == TOOL_FINISH_CHECK:
        return await _apply_finish_check(
            check, raw_input, db, current_turn_text=current_turn_text,
        )
    return f"rejected: unknown tool '{tool_name}'"


async def _apply_generate_variant(
    check: IntegrityCheckSubmission,
    raw_input: dict[str, Any],
    db: AsyncSession,
    *,
    user_id: str | None = None,
) -> str:
    """Handle the inline-variant disambiguator tool.

    Generates a fresh isomorphic problem for the given sampled problem
    and returns it as tool_result text. The agent's next turn will
    paste the variant into the chat and ask for the student's approach.

    Guardrails:
    - The variant can only be called once per session (flips
      `inline_variant_used=True` on success; refuses thereafter).
    - Must reference a sampled problem for this check.
    - Requires at least one student turn first, same floor as
      submit_problem_verdict — we're not running the disambiguator
      before even hearing from the student.
    - On LLM failure, returns an error tool_result rather than
      crashing the agent loop.
    """
    from api.core.practice import generate_similar_questions

    problem_id_str = raw_input.get("problem_id") or ""
    try:
        problem_id = uuid.UUID(str(problem_id_str))
    except (ValueError, TypeError):
        return f"rejected: problem_id {problem_id_str!r} is not a valid UUID"

    if check.inline_variant_used:
        return (
            "rejected: generate_variant can only be called once per session "
            "and this check has already used it"
        )

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

    student_turn_count = await count_student_turns(check.id, db)
    if student_turn_count < VERDICT_STUDENT_TURN_FLOOR:
        return (
            "rejected: need at least "
            f"{VERDICT_STUDENT_TURN_FLOOR} student turn(s) before "
            "generating a variant; ask the student a question first"
        )

    item = (await db.execute(
        select(QuestionBankItem).where(
            QuestionBankItem.id == problem.bank_item_id,
        )
    )).scalar_one_or_none()
    if item is None:
        return "rejected: bank item no longer exists (was it deleted?)"

    try:
        generated = await generate_similar_questions(
            [item.question], user_id=user_id, difficulty="same",
        )
    except Exception:
        logger.exception(
            "generate_variant: similar-question generation failed for "
            "check %s problem %s", check.id, problem_id,
        )
        return (
            "rejected: variant generation failed — proceed without the "
            "variant for this session"
        )
    if not generated or not generated[0].strip():
        return (
            "rejected: variant generation returned empty — proceed "
            "without the variant for this session"
        )

    check.inline_variant_used = True
    await db.flush()
    return (
        f"accepted: variant problem (present this to the student and ask "
        f"how they'd approach it — NOT to solve it): {generated[0].strip()}"
    )


def _validate_rubric(raw: Any) -> tuple[dict[str, str] | None, str | None]:
    """Validate a rubric dict submitted by the agent.

    Returns (normalized_rubric, error_message). On success
    error_message is None; on failure normalized_rubric is None and
    error_message explains what's wrong.

    The agent is free to omit optional dimensions entirely; we fill in
    the sentinel values ('not_probed' / 'not_observed') so the stored
    rubric is always complete. paraphrase_originality and
    causal_fluency are always required.
    """
    if not isinstance(raw, dict):
        return None, "rubric must be an object"

    paraphrase = raw.get("paraphrase_originality")
    if paraphrase not in _RUBRIC_CORE_VALUES:
        return None, (
            "rubric.paraphrase_originality must be low/mid/high "
            f"(got {paraphrase!r})"
        )
    causal = raw.get("causal_fluency")
    if causal not in _RUBRIC_CORE_VALUES:
        return None, (
            "rubric.causal_fluency must be low/mid/high "
            f"(got {causal!r})"
        )

    transfer = raw.get("transfer", "not_probed")
    if transfer not in _RUBRIC_OPTIONAL_VALUES:
        return None, (
            "rubric.transfer must be low/mid/high/not_probed "
            f"(got {transfer!r})"
        )
    prediction = raw.get("prediction", "not_probed")
    if prediction not in _RUBRIC_OPTIONAL_VALUES:
        return None, (
            "rubric.prediction must be low/mid/high/not_probed "
            f"(got {prediction!r})"
        )
    authority = raw.get("authority_resistance", "not_probed")
    if authority not in _RUBRIC_OPTIONAL_VALUES:
        return None, (
            "rubric.authority_resistance must be low/mid/high/not_probed "
            f"(got {authority!r})"
        )
    self_corr = raw.get("self_correction", "not_observed")
    if self_corr not in _RUBRIC_SELF_CORRECTION_VALUES:
        return None, (
            "rubric.self_correction must be low/mid/high/not_observed "
            f"(got {self_corr!r})"
        )

    return {
        "paraphrase_originality": paraphrase,
        "causal_fluency": causal,
        "transfer": transfer,
        "prediction": prediction,
        "authority_resistance": authority,
        "self_correction": self_corr,
    }, None


async def _apply_submit_verdict(
    check: IntegrityCheckSubmission,
    raw_input: dict[str, Any],
    db: AsyncSession,
) -> str:
    problem_id_str = raw_input.get("problem_id") or ""
    raw_rubric = raw_input.get("rubric")
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

    rubric, rubric_err = _validate_rubric(raw_rubric)
    if rubric_err is not None or rubric is None:
        return f"rejected: {rubric_err or 'rubric validation failed'}"

    student_turn_count = await count_student_turns(check.id, db)
    if student_turn_count < VERDICT_STUDENT_TURN_FLOOR:
        return (
            "rejected: need at least "
            f"{VERDICT_STUDENT_TURN_FLOOR} student turn(s) before a verdict; "
            "ask the student a question first"
        )

    problem.status = PROBLEM_STATUS_VERDICT_SUBMITTED
    problem.rubric = rubric
    problem.ai_reasoning = reasoning
    await db.flush()
    return (
        f"accepted: rubric recorded (paraphrase={rubric['paraphrase_originality']}, "
        f"causal={rubric['causal_fluency']})"
    )


async def _apply_finish_check(
    check: IntegrityCheckSubmission,
    raw_input: dict[str, Any],
    db: AsyncSession,
    *,
    current_turn_text: str | None = None,
) -> str:
    disposition = raw_input.get("disposition")
    summary = raw_input.get("summary") or ""
    variant_result = raw_input.get("inline_variant_result")

    # Guard against the "ask a question AND finalize" bug. If the
    # agent's text in this same response ends with a question mark,
    # there's an outstanding question the student hasn't answered —
    # don't let the agent finalize underneath it. Force the agent to
    # either drop the question or wait for the reply. The trailing "?"
    # heuristic is coarse but catches the real failure mode cleanly
    # (the alternative is an LLM judging whether prose contains a
    # question, which is overkill for this guard).
    if current_turn_text and current_turn_text.rstrip().endswith("?"):
        return (
            "rejected: you just asked the student a question in this "
            "same response. finish_check is terminal — don't call it "
            "while you have an outstanding question. Either wait for "
            "the student's reply (no finish_check this turn) or drop "
            "the question from your response before finalizing."
        )

    if disposition not in DISPOSITION_VALUES:
        return (
            "rejected: disposition must be one of "
            "pass/needs_practice/tutor_pivot/flag_for_review "
            f"(got {disposition!r})"
        )
    if variant_result not in VARIANT_RESULT_VALUES:
        return (
            "rejected: inline_variant_result must be one of "
            "specific_approach/approach_after_followup/blank_or_wrong/"
            f"not_applicable (got {variant_result!r})"
        )
    # If the agent says the variant disambiguator actually ran, the
    # pipeline must have already set inline_variant_used=True when
    # generate_variant was called. Reject if we see a concrete result
    # without that state — protects against stale agents reporting a
    # variant result for a flow that didn't happen.
    if (
        variant_result != VARIANT_RESULT_NOT_APPLICABLE
        and not check.inline_variant_used
    ):
        return (
            "rejected: inline_variant_result reports a variant outcome but "
            "generate_variant was never called this session. Use "
            "'not_applicable' when you didn't run the variant."
        )

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
    check.disposition = disposition
    check.overall_summary = summary
    check.inline_variant_result = variant_result
    check.activity_summary = compute_activity_summary(
        await _load_turns(check.id, db),
    )
    await db.flush()
    return f"accepted: disposition {disposition}, check complete"


async def _force_finalize_turn_cap(
    check: IntegrityCheckSubmission, db: AsyncSession,
) -> None:
    """Hard-cap enforcement: 10 student turns without a finish_check.

    Emits no disposition (left null) so the teacher dashboard surfaces
    this as "inconclusive — agent ran out of time" rather than any of
    the four intent-carrying dispositions. Per-problem rubrics are
    likewise left null on pending problems; the teacher sees the
    partial transcript and decides.
    """
    problems = (await db.execute(
        select(IntegrityCheckProblem).where(
            IntegrityCheckProblem.integrity_check_submission_id == check.id,
        )
    )).scalars().all()
    for p in problems:
        if p.status == PROBLEM_STATUS_PENDING:
            p.status = PROBLEM_STATUS_VERDICT_SUBMITTED
            p.ai_reasoning = (
                "Conversation hit the turn cap before this problem was "
                "verdicted."
            )
    check.status = STATUS_COMPLETE
    check.overall_summary = (
        "Conversation hit the turn cap — inconclusive. Teacher review."
    )
    await _append_agent_text(
        check.id,
        "Thanks for sticking with this. That's all the time we have — your "
        "work is with your teacher.",
        db,
    )
    check.activity_summary = compute_activity_summary(
        await _load_turns(check.id, db),
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


# ── Activity summary aggregator ─────────────────────────────────────

def _notable_reasons_for_turn(
    turn: IntegrityConversationTurn,
) -> list[str]:
    """Return the reason codes that mark this student turn as notable.

    Pure function over a single turn — the per-turn evidence the
    teacher panel renders inline under the student bubble.
    """
    telemetry = turn.telemetry
    if not telemetry:
        return []

    reasons: list[str] = []

    pastes = telemetry.get("paste_events") or []
    paste_total = sum(int(p.get("byte_count") or 0) for p in pastes)
    paste_largest = max(
        (int(p.get("byte_count") or 0) for p in pastes), default=0,
    )
    if paste_largest >= ACTIVITY_LARGE_PASTE_CHARS:
        reasons.append(ACTIVITY_REASON_LARGE_PASTE)

    # full_paste = the turn's content is essentially the paste. The
    # cadence object being missing OR reporting zero typing is the
    # tell — the student didn't type, they pasted everything.
    content_len = len(turn.content or "")
    cadence = telemetry.get("typing_cadence")
    typed_anything = bool(cadence and (cadence.get("total_ms") or 0) > 0)
    if (
        content_len > 0
        and paste_total >= ACTIVITY_FULL_PASTE_RATIO * content_len
        and not typed_anything
    ):
        reasons.append(ACTIVITY_REASON_FULL_PASTE)

    blurs = telemetry.get("focus_blur_events") or []
    blur_total_ms = sum(int(b.get("duration_ms") or 0) for b in blurs)
    blur_longest_ms = max(
        (int(b.get("duration_ms") or 0) for b in blurs), default=0,
    )
    if blur_longest_ms >= ACTIVITY_LONG_TAB_OUT_MS:
        reasons.append(ACTIVITY_REASON_LONG_TAB_OUT)

    seconds_on_turn = turn.seconds_on_turn
    if (
        seconds_on_turn is not None
        and seconds_on_turn > 0
        and blur_total_ms >= ACTIVITY_DOMINANT_TAB_OUT_RATIO * seconds_on_turn * 1000
        # Don't double-count: a single long tab-out already trips
        # long_tab_out. dominant_tab_out is for turns where many short
        # tab-outs cumulatively dominate without any one being long.
        and ACTIVITY_REASON_LONG_TAB_OUT not in reasons
    ):
        reasons.append(ACTIVITY_REASON_DOMINANT_TAB_OUT)

    return reasons


def compute_activity_summary(
    turns: list[IntegrityConversationTurn],
) -> dict[str, Any] | None:
    """Roll up student-turn telemetry into the session-level
    activity_summary blob. Returns None when no student turn carries
    telemetry (older sessions, future mobile, or checks that finished
    before any student message landed) — the teacher UI hides the
    Activity surface on a null summary.

    Pure function — no DB. Caller persists the return on the
    IntegrityCheckSubmission row.
    """
    student_turns = [t for t in turns if t.role == ROLE_STUDENT and t.telemetry]
    if not student_turns:
        return None

    tab_out_count = 0
    tab_out_total_ms = 0
    paste_count = 0
    paste_total_chars = 0
    paste_largest_chars = 0
    long_pause_count = 0
    notable_turns: list[dict[str, Any]] = []

    for t in student_turns:
        tel = t.telemetry or {}
        for ev in tel.get("focus_blur_events") or []:
            tab_out_count += 1
            tab_out_total_ms += int(ev.get("duration_ms") or 0)
        for ev in tel.get("paste_events") or []:
            byte_count = int(ev.get("byte_count") or 0)
            paste_count += 1
            paste_total_chars += byte_count
            if byte_count > paste_largest_chars:
                paste_largest_chars = byte_count
        cadence = tel.get("typing_cadence") or {}
        long_pause_count += int(cadence.get("pauses_over_3s") or 0)

        reasons = _notable_reasons_for_turn(t)
        if reasons:
            notable_turns.append({"ordinal": t.ordinal, "reasons": reasons})

    # Level rule: clean = no notable turns. heavy = 2+ notable turns OR
    # any full_paste turn (full_paste alone is severe enough to skip
    # the "notable" middle ground). notable = 1 notable turn.
    has_full_paste = any(
        ACTIVITY_REASON_FULL_PASTE in nt["reasons"] for nt in notable_turns
    )
    if not notable_turns:
        level = ACTIVITY_LEVEL_CLEAN
    elif len(notable_turns) >= 2 or has_full_paste:
        level = ACTIVITY_LEVEL_HEAVY
    else:
        level = ACTIVITY_LEVEL_NOTABLE

    return {
        "level": level,
        "totals": {
            "tab_out_count": tab_out_count,
            "tab_out_total_ms": tab_out_total_ms,
            "paste_count": paste_count,
            "paste_total_chars": paste_total_chars,
            "paste_largest_chars": paste_largest_chars,
            "long_pause_count": long_pause_count,
        },
        "notable_turns": notable_turns,
    }


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
        correct_final_answer = item.final_answer if item else None
        out.append({
            "problem_id": str(p.id),
            "sample_position": p.sample_position,
            "question": question_text,
            "correct_final_answer": correct_final_answer,
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
