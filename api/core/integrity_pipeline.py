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
from typing import Any, Literal, NamedTuple

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.integrity_ai import (
    UNREADABLE_THRESHOLD,
    build_agent_system_prompt,
    build_problems_briefing,
    extract_student_work,
    run_agent_turn,
)
from api.core.llm_client import MODEL_HAIKU, LLMMode, call_claude_json
from api.core.llm_schemas import INTEGRITY_ANSWER_EQUIVALENCE_SCHEMA
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

# Why the pipeline picked the problem it did (stored on the submission
# + the per-problem selected_reason). The two reasons map to the two
# selector tiers — see select_probe_problem.
SELECTION_REASON_VERIFIED_HARDEST_CORRECT = "verified_hardest_correct"
SELECTION_REASON_STRUGGLING_EASIEST = "struggling_easiest"

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

# ── Adaptive probe selection ────────────────────────────────────────

# Difficulty tiers from the QuestionBankItem.difficulty column, ranked
# so higher = harder = better probe target. Anything unrecognised
# falls back to "medium" so a stray tag value doesn't crash selection.
_DIFFICULTY_RANK: dict[str, int] = {
    "easy": 0,
    "medium": 1,
    "hard": 2,
}


def _problem_difficulty_score(item: QuestionBankItem) -> tuple[int, int]:
    """Higher score = harder problem.

    Primary: difficulty tier — hard > medium > easy. This is the
    authoritative signal for "how hard is this problem" (set by the
    teacher or the generating AI).

    Tiebreak within tier: count of canonical solution_steps. NOT a
    difficulty measure — a long arithmetic problem has many steps but
    isn't conceptually hard. Only used after difficulty ties, and the
    direction follows the same comparator as the primary key:

      - verified tier (max): picks the problem with MORE canonical
        steps among same-difficulty candidates — more decision points
        for the agent to probe ("why this step?").
      - struggling tier (min): picks the problem with FEWER canonical
        steps among same-difficulty candidates — the simpler-looking
        problem to start the diagnostic.
    """
    difficulty_rank = _DIFFICULTY_RANK.get(
        (item.difficulty or "medium").lower(), 1,
    )
    steps_count = len(item.solution_steps or [])
    return (difficulty_rank, steps_count)


# ── Tier-aware probe selection ──────────────────────────────────────
# Drives WHICH problem the integrity chat will probe + downstream
# WHICH tone the agent takes.

SubmissionTier = Literal["verified", "struggling"]
"""Classifies the submission shape — drives probe selection.

  - verified: student got at least one final answer correct. Probe
    the hardest correct one to verify they actually understand.
  - struggling: zero correct final answers. Probe the easiest problem
    to find where the foundation cracks.
"""


AgentPosture = Literal[
    "verified",
    "struggling_attempted",
    "struggling_blank",
]
"""Refines the tier with the student's effort level — drives the
agent's tone (system prompt fragment + opener template).

  - verified: maps 1-1 from SubmissionTier="verified".
  - struggling_attempted: tier="struggling" + the student wrote
    real work (>= ATTEMPTED_STEP_THRESHOLD steps tagged to the
    chosen problem). Agent anchors on the attempt.
  - struggling_blank: tier="struggling" + the student barely
    engaged. Agent anchors on the problem text, not non-existent
    steps.
"""


class ProbeSelection(NamedTuple):
    """Result of select_probe_problem — the chosen bank item, the
    submission tier that drove the choice, and the selection_reason
    persisted on IntegrityCheckSubmission for the teacher panel."""
    bank_item_id: uuid.UUID
    tier: SubmissionTier
    selection_reason: str


# Min steps written for the chosen problem to count as "attempted"
# rather than "blank/minimal." Sub-variant within the struggling tier.
ATTEMPTED_STEP_THRESHOLD = 2


# Opening-question templates appended to the agent's first user
# message (after the briefing). Each template tells the agent how to
# start the conversation. Lifted out of the inline string in
# start_integrity_check so test cases can pin behavior to the right
# template per posture.
OPENER_TEMPLATES: dict[AgentPosture, str] = {
    "verified": (
        "Greet the student warmly and ask your first question about the "
        "sampled problem above, referencing a specific step they wrote."
    ),
    "struggling_attempted": (
        "Greet the student. They got this problem wrong but tried — anchor "
        "on what they wrote and ask what they were trying to do at a "
        "specific step."
    ),
    "struggling_blank": (
        "Greet the student. They didn't get far on this problem. Don't "
        "ask about steps they didn't write. Ask what part of the problem "
        "itself feels confusing or where they got stuck before they "
        "could write anything."
    ),
}


# Canned fallback opener used when the agent's first turn errors out
# — the check must not get stuck in "extracting" because the model
# misbehaved. One variant per posture so the fallback never lands a
# kid in the wrong tone. {hw_position} is the 1-based HW position of
# the chosen problem.
FALLBACK_OPENER_TEMPLATES: dict[AgentPosture, str] = {
    "verified": (
        "Hi! I just took a look at your homework. Can you walk me through "
        "the first step you took on problem {hw_position}?"
    ),
    "struggling_attempted": (
        "Hi! I took a look at your homework. Could you tell me what you "
        "were trying to do on problem {hw_position}?"
    ),
    "struggling_blank": (
        "Hi! I took a look at your homework. What part of problem "
        "{hw_position} is feeling confusing?"
    ),
}


def build_kickoff_message(posture: AgentPosture, briefing: str) -> str:
    """Compose the agent's first user message: per-problem briefing
    plus the posture-specific opener instruction. Falls back to the
    verified opener for unrecognized postures."""
    template = OPENER_TEMPLATES.get(posture, OPENER_TEMPLATES["verified"])
    return briefing + "\n\nNow begin the conversation. " + template


def build_fallback_opener(posture: AgentPosture, hw_position: int) -> str:
    """Posture-keyed canned opener for the agent-error fallback path."""
    template = FALLBACK_OPENER_TEMPLATES.get(
        posture, FALLBACK_OPENER_TEMPLATES["verified"],
    )
    return template.format(hw_position=hw_position)


# ── Final-answer correctness check ──────────────────────────────────
# Used pre-selection to drive the upcoming tier-aware probe selector
# (verified vs struggling). AI grading also runs an equivalence check
# on the same inputs, but it gates on full grading (~30s); we run a
# faster Haiku call here so the integrity chat can pick a problem
# without waiting on grading. Two readers of the same upstream data
# (Vision's extraction + bank items' final_answer), not two competing
# sources of truth.

# Drop these wrappers before doing a literal compare, so a bank
# answer of "$6$" matches a student answer of "6" without an LLM call.
# Anything more elaborate (LaTeX command synonyms, fraction-vs-decimal,
# implicit multiplication) falls through to the LLM equivalence call.
# Order matters: longer wrappers must come first so `$$x$$` strips both
# dollars in one pass instead of leaving the inner `$x$`.
_TRIVIAL_LATEX_WRAPPERS: tuple[str, ...] = ("$$", "$")


def _normalize_answer_for_trivial_match(answer: str) -> str:
    """Strip whitespace + the outermost balanced LaTeX delimiter pair.

    Only matched, balanced wrappers are stripped (one pass, longest
    wrapper wins via _TRIVIAL_LATEX_WRAPPERS ordering). Anything fancier
    is left for the LLM equivalence call to compare.
    """
    answer = answer.strip()
    for wrapper in _TRIVIAL_LATEX_WRAPPERS:
        if (
            answer.startswith(wrapper)
            and answer.endswith(wrapper)
            and len(answer) > 2 * len(wrapper)
        ):
            answer = answer[len(wrapper):-len(wrapper)].strip()
            break
    return answer


def _student_answer_by_position(extraction: dict[str, Any]) -> dict[int, str]:
    """Index per-problem final answers by `problem_position`.

    Prefers `answer_latex` and falls back to `answer_plain` so the
    student-edit overlay (which clears latex and writes to plain when
    a student corrects an OCR misread on the confirm screen) is still
    visible to the integrity sampler. Mirrors the same fallthrough
    grading_ai uses (`_format_final_answer`). Skips entries with a
    null position or both fields empty. If multiple answers share a
    position (rare — schema doesn't forbid it), the last one wins.
    """
    out: dict[int, str] = {}
    for fa in extraction.get("final_answers") or []:
        pos = fa.get("problem_position")
        if not isinstance(pos, int) or isinstance(pos, bool):
            continue
        text = (
            (fa.get("answer_latex") or "").strip()
            or (fa.get("answer_plain") or "").strip()
        )
        if not text:
            continue
        out[pos] = text
    return out


def _build_equivalence_user_message(
    pairs: list[tuple[int, str, str]],
) -> str:
    """Render the user message for the batched equivalence LLM call.

    `pairs` is a list of (problem_position, student_answer, answer_key)
    triples that didn't trivially match — one entry per problem.
    """
    lines = [
        "For each problem below, decide whether the student's answer is "
        "mathematically equivalent to the answer key. Equivalent forms "
        "(1/2 == 0.5, x = 5 == 5, matrices with or without a leading "
        "variable label) count as equivalent. Different numeric values "
        "or different mathematical objects do not.",
        "",
    ]
    for pos, student, key in pairs:
        lines.append(f"Problem {pos}:")
        lines.append(f"  Student answer: {student}")
        lines.append(f"  Answer key: {key}")
        lines.append("")
    lines.append(
        "Return one entry per problem in the `results` array. Tag each "
        "entry with its `problem_position` field; entries may appear in "
        "any order."
    )
    return "\n".join(lines)


async def check_answer_correctness(
    extraction: dict[str, Any],
    candidates: dict[uuid.UUID, QuestionBankItem],
    hw_position_by_id: dict[uuid.UUID, int],
    *,
    user_id: str | None = None,
) -> dict[uuid.UUID, bool]:
    """Per-bank-item correctness, anchored on Vision's extracted final
    answers vs the bank items' `final_answer`.

    Two-stage:
      1. Trivial-normalization fast path (strip whitespace + outer
         `$...$` / `$$...$$`). Matches numerics + single-token answers
         for free.
      2. Batched Haiku equivalence call for everything that didn't
         trivially match. Cheap (~$0.005/HW typical) and tolerates the
         long tail of LaTeX synonyms.

    Returns `{bank_item_id: bool}` for every candidate. False on:
      - Bank item has no `final_answer` (proof-style)
      - Vision didn't extract a final answer for that problem
      - LLM call fails (treat all uncertain pairs as wrong; system
        falls through to the struggling tier rather than wedging)

    Pure-ish: makes one LLM call but no DB / state mutation.
    """
    student_by_position = _student_answer_by_position(extraction)

    is_correct_by_bank_id: dict[uuid.UUID, bool] = {
        bid: False for bid in candidates
    }
    uncertain: list[tuple[uuid.UUID, int, str, str]] = []

    for bid, item in candidates.items():
        bank_answer = (item.final_answer or "").strip()
        hw_pos = hw_position_by_id.get(bid)
        if hw_pos is None or not bank_answer:
            continue
        student_answer = student_by_position.get(hw_pos, "").strip()
        if not student_answer:
            continue

        if (
            _normalize_answer_for_trivial_match(student_answer)
            == _normalize_answer_for_trivial_match(bank_answer)
        ):
            is_correct_by_bank_id[bid] = True
            continue

        uncertain.append((bid, hw_pos, student_answer, bank_answer))

    if not uncertain:
        return is_correct_by_bank_id

    user_message = _build_equivalence_user_message(
        [(pos, student, key) for _, pos, student, key in uncertain],
    )
    try:
        result = await call_claude_json(
            system_prompt=(
                "You are a math grader checking equivalence of final "
                "answers. Return one entry per problem, tagging each "
                "with its `problem_position` field. Entries may be in "
                "any order."
            ),
            user_message=user_message,
            mode=LLMMode.INTEGRITY_ANSWER_EQUIVALENCE,
            tool_schema=INTEGRITY_ANSWER_EQUIVALENCE_SCHEMA,
            user_id=user_id,
            model=MODEL_HAIKU,
        )
    except Exception:
        logger.exception(
            "answer-equivalence LLM call failed; treating uncertain "
            "pairs as wrong (tier may downgrade to struggling)",
        )
        return is_correct_by_bank_id

    # Defensive parse: a malformed response degrades to "all uncertain
    # pairs stay False" rather than wedging the check.
    raw_results = result.get("results")
    equivalent_by_position: dict[int, bool] = {}
    if isinstance(raw_results, list):
        for entry in raw_results:
            if not isinstance(entry, dict):
                continue
            pos = entry.get("problem_position")
            eq = entry.get("equivalent")
            if (
                isinstance(pos, int)
                and not isinstance(pos, bool)
                and isinstance(eq, bool)
            ):
                equivalent_by_position[pos] = eq

    for bid, pos, _, _ in uncertain:
        if equivalent_by_position.get(pos):
            is_correct_by_bank_id[bid] = True

    return is_correct_by_bank_id


def select_probe_problem(
    items_by_id: dict[uuid.UUID, QuestionBankItem],
    candidate_ids: list[uuid.UUID],
    correct_by_bank_id: dict[uuid.UUID, bool],
) -> ProbeSelection | None:
    """Pick the single problem the integrity chat will probe.

    Two tiers, driven by the per-bank-item correctness map from
    check_answer_correctness:

      - verified: the student got at least one final answer correct.
        Pick the *hardest* correct problem so the chat verifies their
        win (cheating-detection target).
      - struggling: zero correct final answers. Pick the *easiest*
        problem so the chat can find where the foundation cracks
        (diagnostic / tutor-pivot target).

    `_problem_difficulty_score` is the same scoring used for both
    directions — `max` for verified, `min` for struggling.

    Returns None when there are no candidates (every problem deleted
    between publish and submit). Caller bails cleanly.
    """
    valid_ids = [bid for bid in candidate_ids if bid in items_by_id]
    if not valid_ids:
        return None

    correct_ids = [bid for bid in valid_ids if correct_by_bank_id.get(bid)]
    if correct_ids:
        pick = max(correct_ids, key=lambda b: _problem_difficulty_score(items_by_id[b]))
        return ProbeSelection(
            bank_item_id=pick,
            tier="verified",
            selection_reason=SELECTION_REASON_VERIFIED_HARDEST_CORRECT,
        )
    pick = min(valid_ids, key=lambda b: _problem_difficulty_score(items_by_id[b]))
    return ProbeSelection(
        bank_item_id=pick,
        tier="struggling",
        selection_reason=SELECTION_REASON_STRUGGLING_EASIEST,
    )


def derive_agent_posture(
    tier: SubmissionTier,
    attempted_step_count: int,
) -> AgentPosture:
    """Refine the tier with the student's effort level.

    Verified always maps 1-1. Struggling splits two ways: if the
    student wrote real work for the chosen problem (>= ATTEMPTED_STEP_THRESHOLD
    steps), the agent will anchor on their attempt; otherwise it
    anchors on the problem text itself, since there's nothing
    student-written to discuss.
    """
    if tier == "verified":
        return "verified"
    if attempted_step_count >= ATTEMPTED_STEP_THRESHOLD:
        return "struggling_attempted"
    return "struggling_blank"


def _tier_from_reason(reason: str | None) -> SubmissionTier:
    """Recover the SubmissionTier from a persisted selection_reason.

    Reverse of select_probe_problem's reason-setting. Used by
    `_agent_posture_for_check` so process_student_turn can re-derive
    the posture without re-running correctness or storing a new
    column on the submission row.
    """
    if reason == SELECTION_REASON_VERIFIED_HARDEST_CORRECT:
        return "verified"
    return "struggling"


async def _agent_posture_for_check(
    check: IntegrityCheckSubmission,
    db: AsyncSession,
) -> AgentPosture:
    """Re-derive the agent's posture for an in-progress check.

    Reads the tier from `check.probe_selection_reason` and the
    attempted-step count from the chosen problem's persisted slice.
    Cheap — no LLM, one DB query for the lowest-sample-position
    problem row. Mirrors the derivation `start_integrity_check`
    runs once at chat start so per-turn calls land the same posture.
    """
    tier = _tier_from_reason(check.probe_selection_reason)
    row = (await db.execute(
        select(IntegrityCheckProblem)
        .where(
            IntegrityCheckProblem.integrity_check_submission_id == check.id,
        )
        .order_by(IntegrityCheckProblem.sample_position)
        .limit(1)
    )).scalar_one_or_none()
    if row is None:
        return derive_agent_posture(tier, 0)
    chosen_slice = row.student_work_extraction or {}
    attempted_step_count = len(chosen_slice.get("steps") or [])
    return derive_agent_posture(tier, attempted_step_count)


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

    # Hydrate candidates in one query so the selector can score by
    # difficulty + solution_step count and check_answer_correctness
    # can read each item's final_answer.
    items_by_id: dict[uuid.UUID, QuestionBankItem] = {}
    rows = (await db.execute(
        select(QuestionBankItem).where(QuestionBankItem.id.in_(candidate_uuids))
    )).scalars().all()
    for it in rows:
        items_by_id[it.id] = it

    # Map bank_item_id → 1-based HW position. Position = index in the
    # assignment's problem_ids list + 1 (matching `problem_position`
    # on the extraction). Used by check_answer_correctness, the
    # extraction slicer, and the agent's briefing.
    hw_position_by_id: dict[uuid.UUID, int] = {
        cid: idx + 1 for idx, cid in enumerate(candidate_uuids)
    }

    # Attribute LLM calls to the student so the admin dashboard doesn't
    # show "Deleted User" against every integrity extraction + agent
    # turn. Stringified because llm_calls.user_id is stored as string.
    user_id = str(submission.student_id)

    if extraction is None:
        # Fallback extraction (caller didn't pre-extract). Build the
        # problems briefing from the candidate pool — same bank items,
        # already hydrated — so Vision sees the HW's problem list and
        # tags each step with a problem_position without a second DB
        # round-trip. Position matches hw_position_by_id above.
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

    # Unreadable submissions short-circuit before tier classification:
    # no usable correctness signal means there's nothing to probe and
    # the chat will never start. Persist a SKIPPED_UNREADABLE row scoped
    # to one (arbitrary, deterministic) candidate so the teacher's
    # "What the reader got" panel still has something to render, then
    # bail. selection_reason is null — there was no real selection.
    if confidence < UNREADABLE_THRESHOLD:
        logger.info(
            "Handwriting unreadable (confidence=%.2f) for submission %s",
            confidence, submission_id,
        )
        check = IntegrityCheckSubmission(
            submission_id=submission_id,
            status=STATUS_SKIPPED_UNREADABLE,
            overall_summary="Handwriting was unreadable — no questions asked.",
        )
        db.add(check)
        await db.flush()
        chosen_bid = candidate_uuids[0]
        problem_slice = _slice_extraction_for_problem(
            extraction, hw_position_by_id[chosen_bid],
        )
        db.add(IntegrityCheckProblem(
            integrity_check_submission_id=check.id,
            bank_item_id=chosen_bid,
            sample_position=0,
            status=PROBLEM_STATUS_SKIPPED_UNREADABLE,
            student_work_extraction=problem_slice,
        ))
        return

    is_correct_by_bank_id = await check_answer_correctness(
        extraction, items_by_id, hw_position_by_id, user_id=user_id,
    )
    selection = select_probe_problem(
        items_by_id, candidate_uuids, is_correct_by_bank_id,
    )
    if selection is None:
        # Every primary id was deleted between publish and submit.
        # Don't create a stuck row — let the teacher handle the
        # submission without an integrity trace.
        return

    check = IntegrityCheckSubmission(
        submission_id=submission_id,
        status=STATUS_EXTRACTING,
        probe_selection_reason=selection.selection_reason,
    )
    db.add(check)
    await db.flush()

    # Slice the extraction down to just the chosen problem's work
    # before persisting. Row carries only the sampled problem's steps +
    # final answer, plus any unattributed scratchwork.
    chosen_hw_position = hw_position_by_id[selection.bank_item_id]
    problem_slice = _slice_extraction_for_problem(extraction, chosen_hw_position)
    chosen_row = IntegrityCheckProblem(
        integrity_check_submission_id=check.id,
        bank_item_id=selection.bank_item_id,
        sample_position=0,
        status=PROBLEM_STATUS_PENDING,
        student_work_extraction=problem_slice,
        selected_reason=selection.selection_reason,
    )
    db.add(chosen_row)
    await db.flush()

    # Derive the agent's posture from the tier + how much real work
    # the student wrote on the chosen problem. Posture conditions the
    # agent's tone (system prompt fragment) and the opener template
    # — see derive_agent_posture + the kickoff message below.
    attempted_step_count = len(problem_slice.get("steps") or [])
    posture = derive_agent_posture(selection.tier, attempted_step_count)

    briefing = build_problems_briefing([
        {
            "problem_id": str(chosen_row.id),
            "sample_position": 0,
            # 1-based homework position — what the student sees in the
            # chat reference panel as "Problem N". Keeps the agent's
            # labeling end-to-end consistent with the student's view.
            "hw_position": chosen_hw_position,
            "question": items_by_id[selection.bank_item_id].question,
            "correct_final_answer": items_by_id[selection.bank_item_id].final_answer,
            "extraction": problem_slice,
            "verdict_status": "pending",
        }
    ])
    kickoff_user_message = build_kickoff_message(posture, briefing)

    # Try to generate an opening. Fall back to a canned opener if the
    # model misbehaves — the check must not get stuck in "extracting".
    try:
        content_blocks = await run_agent_turn(
            build_agent_system_prompt(posture),
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
        # Posture-keyed canned fallback so the opener never lands a
        # kid in the wrong tone. hw_position keeps "Problem N" matching
        # what the student sees in the chat reference panel.
        opening_text = build_fallback_opener(posture, chosen_hw_position)

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

    # Re-derive the posture from persisted state — same source data
    # as start_integrity_check used (selection_reason → tier; chosen
    # problem's slice → attempted_step_count). One read once per
    # process_student_turn call so every agent loop iteration below
    # uses a consistent system prompt.
    posture = await _agent_posture_for_check(check, db)
    system_prompt = build_agent_system_prompt(posture)

    # Agent loop.
    for _ in range(MAX_AGENT_LOOPS_PER_TURN):
        problems = await _load_problems_for_prompt(check.id, db)
        turns = await _load_turns(check.id, db)
        briefing = build_problems_briefing(problems)
        messages = _build_agent_messages(briefing, turns)

        try:
            content_blocks = await run_agent_turn(
                system_prompt, messages, user_id=user_id,
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
            result_text = await _apply_tool_call(
                check, block, db,
                user_id=user_id,
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
) -> str:
    """Validate + apply a single tool call. Returns the tool_result
    text to persist (and echo back to the agent on the next loop).
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
        return await _apply_finish_check(check, raw_input, db)
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
) -> str:
    disposition = raw_input.get("disposition")
    summary = raw_input.get("summary") or ""
    variant_result = raw_input.get("inline_variant_result")

    # Guard against the "ask a question AND finalize" bug — see
    # _has_unanswered_agent_question. The agent can split the question
    # and finish_check across iterations of the agent loop within one
    # process_student_turn call, so the guard inspects persisted turns
    # rather than just this iteration's text.
    if await _has_unanswered_agent_question(check.id, db):
        return (
            "rejected: your latest message to the student contains a "
            "question. finish_check is terminal — don't call it while "
            "you have an outstanding question. Either wait for the "
            "student's reply (no finish_check this turn) or drop the "
            "question from your response before finalizing."
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


async def _has_unanswered_agent_question(
    check_id: uuid.UUID, db: AsyncSession,
) -> bool:
    """True if the latest persisted agent turn contains a `?` and no
    student turn has landed since.

    Used by `_apply_finish_check` to reject finalization when the agent
    asked a question that's still on the student's screen — including
    the cross-iteration split where the question is in turn N and
    finish_check is fired in turn N+M of the same process_student_turn
    call. We use `"?" in content` (not `endswith("?")`) so patterns like
    "got it??", "really?!", and "what did you get? take your time"
    still trip the guard. The cost of a false positive (agent quotes a
    student question while finalizing) is just the agent rephrasing —
    the cost of a false negative is the bug we're guarding against.
    """
    latest_agent_turn = (await db.execute(
        select(IntegrityConversationTurn)
        .where(
            IntegrityConversationTurn.integrity_check_submission_id == check_id,
            IntegrityConversationTurn.role == ROLE_AGENT,
        )
        .order_by(IntegrityConversationTurn.ordinal.desc())
        .limit(1)
    )).scalar_one_or_none()
    if latest_agent_turn is None or "?" not in latest_agent_turn.content:
        return False
    later_student_turn = (await db.execute(
        select(IntegrityConversationTurn.id)
        .where(
            IntegrityConversationTurn.integrity_check_submission_id == check_id,
            IntegrityConversationTurn.role == ROLE_STUDENT,
            IntegrityConversationTurn.ordinal > latest_agent_turn.ordinal,
        )
        .limit(1)
    )).scalar_one_or_none()
    return later_student_turn is None


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

        reasons = _notable_reasons_for_turn(t)
        if reasons:
            notable_turns.append({"ordinal": t.ordinal, "reasons": reasons})

    return {
        "totals": {
            "tab_out_count": tab_out_count,
            "tab_out_total_ms": tab_out_total_ms,
            "paste_count": paste_count,
            "paste_total_chars": paste_total_chars,
            "paste_largest_chars": paste_largest_chars,
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

    # Look up the 1-based homework position for each sampled bank
    # item — same source the slicer + the student's chat panel use.
    # `problem_ids` lives inside `Assignment.content` (JSON), so we
    # fetch the content blob and unpack via the bank service helper
    # rather than projecting a non-existent column.
    hw_position_by_bank_id: dict[uuid.UUID, int] = {}
    if problems:
        content = (await db.execute(
            select(Assignment.content)
            .join(Submission, Submission.assignment_id == Assignment.id)
            .join(
                IntegrityCheckSubmission,
                IntegrityCheckSubmission.submission_id == Submission.id,
            )
            .where(IntegrityCheckSubmission.id == check_id)
        )).scalar_one_or_none()
        hw_position_by_bank_id = {
            uuid.UUID(bid): i + 1
            for i, bid in enumerate(problem_ids_in_content(content))
        }

    out: list[dict[str, Any]] = []
    for p in problems:
        item = items_by_id.get(p.bank_item_id)
        question_text = item.question if item else "(problem text unavailable)"
        correct_final_answer = item.final_answer if item else None
        out.append({
            "problem_id": str(p.id),
            "sample_position": p.sample_position,
            "hw_position": hw_position_by_bank_id.get(
                p.bank_item_id, p.sample_position + 1,
            ),
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
