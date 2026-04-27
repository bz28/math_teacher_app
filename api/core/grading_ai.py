"""AI grading — one text-only LLM call per submission.

Consumes the extraction from the integrity pipeline's Vision call
(work steps + final answers) and compares against the teacher's answer
key and rubric. Outputs a per-problem grade that pre-fills the
teacher's review page.

This call never reads the image — extraction already did that. The
grading prompt sees structured text only, which keeps it fast, cheap,
and separable from the extraction step.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.llm_client import (
    MODEL_REASON,
    LLMMode,
    call_claude_json,
)
from api.core.llm_schemas import AI_GRADING_SCHEMA
from api.models.assignment import Assignment, Submission, SubmissionGrade
from api.services.bank import load_problems_for_assignment

logger = logging.getLogger(__name__)

_GRADING_SYSTEM = """\
You are a world-class math professor grading a student's homework submission. \
You have the student's extracted work — already converted to text and \
**grouped per problem** by a separate extraction step — plus the teacher's \
answer key for each problem. Work that couldn't be attributed to a single \
problem — or that Vision attributed to a problem that isn't on this \
assignment — is listed under "Other work" when present.

Your job:
1. For each problem, compare the student's extracted final answer against the \
answer key.
2. Assign a grade: "full" (100%), "partial" (1-99%), or "zero" (0%).
3. For partial credit, set a specific percent and explain why.
4. Emit a calibrated `confidence` score (0.0-1.0) for each grade.

Teacher's rubric (apply these criteria explicitly):
{rubric_block}

Rubric application (required for each problem):
- Does the student meet the "Full credit" criterion? If so, grade "full".
- If not, which "Partial credit" condition applies, and why?
- Did any of the listed "Common mistakes" appear in the student's work? Call them out by name.
- In your reasoning, reference the specific rubric criterion (by name) that drove the grade.

Confidence calibration — be honest:
- 0.9-1.0: Answer matches the key (or is trivially equivalent). Rubric criteria \
clearly met or clearly not met.
- 0.7-0.9: Confident in the grade, but some judgment involved — partial-credit \
percent, small extraction noise, or an interpretable rubric dimension.
- 0.4-0.7: Substantive ambiguity. Extraction unclear OR the rubric is hard to \
judge from the work shown.
- below 0.4: You are guessing. State "I'm unsure because X" in your reasoning.

Rules:
- Grade each problem against its own block (question + answer key + student's \
work steps for that problem + student's final answer).
- Grade ONLY based on the student's extracted work — do not solve the problem yourself.
- If the student's answer matches the answer key exactly (or is mathematically equivalent), \
give full credit.
- If the student's approach is correct but they made an arithmetic or sign error, give \
partial credit.
- If no extracted answer exists for a problem (student skipped it), give zero \
AND set `student_answer` to null. Do not invent placeholder prose for the answer field.
- Keep reasoning concise (1-2 sentences per problem)."""


# Default rubric strings. KEEP IN SYNC with the frontend pre-fill in
# web/src/components/school/teacher/_pieces/grading-setup-card.tsx
# (GRADING_SETUP_DEFAULTS). When the teacher doesn't author a rubric,
# the frontend shows these strings in the textareas and the backend
# grades against them — so what the teacher sees is what the AI
# applies. If you update one side, update the other.
_DEFAULT_FULL_CREDIT = (
    "Correct final answer (mathematically equivalent forms like 1/2 "
    "and 0.5 both count). Enough work shown that the reasoning is "
    "followable — students can skip routine or mental steps as long "
    "as the path from set-up to answer is unambiguous to the grader, "
    "with no non-obvious leaps. A bare final answer with no set-up "
    "doesn't qualify."
)
_DEFAULT_PARTIAL_CREDIT = (
    "Anchor partial credit on how much of the correct reasoning is "
    "intact. Right approach with a small execution error (sign flip, "
    "arithmetic slip) — around 95%. Right approach with multiple "
    "errors or stopped mid-solution — around 60%. Right setup but "
    "substantially incomplete, or a plausible attempt with a wrong "
    "method — around 30%. Use judgment between these anchors. "
    "Incoherent attempts that show no sign of the right concept are "
    "zero, not partial."
)


def _build_rubric_block(rubric: dict[str, Any] | None) -> str:
    """Format the teacher-authored rubric as labeled fields the model can
    reference by name. Labels match the rubric-application instructions in
    the system prompt so the model can cite them in reasoning. Any field
    the teacher left unset falls back to the default string so the model
    always sees complete criteria."""
    full_credit = (rubric or {}).get("full_credit") or _DEFAULT_FULL_CREDIT
    partial_credit = (
        (rubric or {}).get("partial_credit") or _DEFAULT_PARTIAL_CREDIT
    )
    parts: list[str] = [
        f'"Full credit": {full_credit}',
        f'"Partial credit": {partial_credit}',
    ]
    if rubric and rubric.get("common_mistakes"):
        parts.append(f'"Common mistakes": {rubric["common_mistakes"]}')
    if rubric and rubric.get("notes"):
        parts.append(f'"Notes": {rubric["notes"]}')
    return "\n".join(parts)


def _format_step(step: dict[str, Any]) -> str:
    """Render one extraction step as a single line for the grader's
    user message. Prefer LaTeX + plain-english side-by-side — the
    extractor sets either to empty string when only one is meaningful,
    so we use ` or ` fallthrough to skip empty fields rather than
    printing bare separators."""
    latex = step.get("latex") or ""
    plain = step.get("plain_english") or ""
    label = f"Step {step.get('step_num', '?')}"
    if latex and plain:
        return f"{label}: {latex} — {plain}"
    return f"{label}: {latex or plain or '(empty step)'}"


def _format_final_answer(fa: dict[str, Any]) -> str:
    """Render one extraction final_answer. Prefer LaTeX; fall back to
    plain-english when the student wrote prose (extractor emits
    answer_latex='' in that case). `or` fallthrough handles empty
    strings — `dict.get(k, default)` returns '' when the key exists,
    which would silently drop prose answers."""
    return (
        fa.get("answer_latex") or fa.get("answer_plain") or "(no answer)"
    )


def _build_user_message(
    extraction: dict[str, Any],
    problems: list[dict[str, Any]],
) -> str:
    """Render the grading user message as per-problem blocks. Each block
    contains question + answer key + the student's work steps for that
    problem + the student's final answer — everything the grader needs
    to grade a problem, co-located. Steps Vision couldn't attribute
    (problem_position=null) OR attributed to a position that isn't on
    this assignment (e.g. a hallucinated position, or a bank item
    deleted between extract and grade) land in a trailing "Other work"
    block so context isn't lost but isn't mis-graded.

    Duplicate final_answers for the same position (schema doesn't
    enforce uniqueness) are all rendered — the grader sees every
    candidate final answer Vision pulled for a problem rather than
    silently losing all but the last.

    Relies on the extractor having tagged each step with a
    `problem_position`; pre-extractor-upgrade data (no positions)
    falls entirely into "Other work" and the grader still gets the
    per-problem questions + final answers, just without step-level
    attribution — same behavior as before the upgrade."""
    steps = extraction.get("steps", [])
    final_answers = extraction.get("final_answers", [])
    valid_positions = {p["position"] for p in problems}

    # Bucket steps + final answers by problem_position. Integer keys
    # matching a problem on this assignment go per-problem; everything
    # else (None, hallucinated positions) falls into "Other work".
    steps_by_pos: dict[int, list[dict[str, Any]]] = {}
    unattributed_steps: list[dict[str, Any]] = []
    for s in steps:
        pos = s.get("problem_position")
        if isinstance(pos, int) and not isinstance(pos, bool) and pos in valid_positions:
            steps_by_pos.setdefault(pos, []).append(s)
        else:
            unattributed_steps.append(s)

    finals_by_pos: dict[int, list[dict[str, Any]]] = {}
    unattributed_finals: list[dict[str, Any]] = []
    for fa in final_answers:
        pos = fa.get("problem_position")
        if isinstance(pos, int) and not isinstance(pos, bool) and pos in valid_positions:
            finals_by_pos.setdefault(pos, []).append(fa)
        else:
            unattributed_finals.append(fa)

    lines: list[str] = []
    for p in problems:
        position = p["position"]
        lines.append(f"## Problem {position}")
        lines.append(f"Question: {p['question']}")
        lines.append(
            f"Answer key: {p.get('final_answer') or '(no answer key)'}"
        )

        problem_steps = steps_by_pos.get(position, [])
        lines.append("Student's work:")
        if problem_steps:
            for s in problem_steps:
                lines.append(f"  {_format_step(s)}")
        else:
            lines.append("  (no work shown for this problem)")

        problem_finals = finals_by_pos.get(position, [])
        if not problem_finals:
            lines.append("Student's final answer: (no final answer shown)")
        elif len(problem_finals) == 1:
            lines.append(
                f"Student's final answer: {_format_final_answer(problem_finals[0])}"
            )
        else:
            lines.append("Student's final answer (multiple extracted):")
            for fa in problem_finals:
                lines.append(f"  - {_format_final_answer(fa)}")

        lines.append("")  # blank line between problem blocks

    if unattributed_steps or unattributed_finals:
        lines.append("## Other work (not attributed to a specific problem)")
        lines.append(
            "These entries couldn't be tied to one problem on this "
            "assignment. Use them as context only — they don't change "
            "a problem's grade on their own."
        )
        for s in unattributed_steps:
            lines.append(f"  {_format_step(s)}")
        for fa in unattributed_finals:
            lines.append(f"  Final answer: {_format_final_answer(fa)}")

    return "\n".join(lines)


async def grade_submission_with_ai(
    extraction: dict[str, Any],
    problems: list[dict[str, Any]],
    rubric: dict[str, Any] | None,
    *,
    user_id: str | None = None,
) -> dict[str, Any]:
    """Grade a submission using the already-extracted student work.

    Args:
        extraction: Output of extract_student_work() — contains steps
            and final_answers.
        problems: List of dicts with {position, question, final_answer}
            from the HW's bank items.
        rubric: Teacher's rubric from Assignment.rubric (optional).
        user_id: For cost-tracking attribution.

    Returns:
        {"grades": [{problem_position, student_answer, score_status,
                      percent, confidence, reasoning}]}
    """
    system = _GRADING_SYSTEM.format(
        rubric_block=_build_rubric_block(rubric),
    )
    user_message = _build_user_message(extraction, problems)

    # Extended thinking lets the model reason through partial-credit
    # calls, ambiguous extractions, and rubric judgments privately before
    # committing to a grade. Budget must be < max_tokens (see
    # llm_client._build_thinking_kwargs); 2048 thinking + 4096 response
    # gives room for both. Pipeline runs in the background, so the 2-3x
    # latency is not user-visible.
    result = await call_claude_json(
        system,
        user_message,
        LLMMode.AI_GRADING,
        tool_schema=AI_GRADING_SCHEMA,
        model=MODEL_REASON,
        max_tokens=4096,
        thinking_budget=2048,
        user_id=user_id,
    )
    return result


# ── Pipeline integration ───────────────────────────────────────────


async def run_ai_grading_for_submission(
    submission_id: uuid.UUID,
    extraction: dict[str, Any],
    db: AsyncSession,
    *,
    user_id: str | None = None,
    force: bool = False,
) -> None:
    """Load the HW context, call the AI grader, and persist results.

    Writes to SubmissionGrade:
    - ai_breakdown: raw AI output (reasoning preserved for teacher)
    - ai_score: average of per-problem percents
    - rubric_snapshot: the rubric this run applied, for drift detection
    - breakdown: actionable grades (same shape the teacher writes to)
    - final_score: same as ai_score until teacher overrides

    Default (pipeline path): if a teacher has already manually graded
    (reviewed_by set), only ai_breakdown/ai_score/rubric_snapshot are
    written so we don't clobber their edits.

    `force=True` (teacher-initiated regrade): overrides any prior
    teacher edits. Breakdown/final_score/graded_at are rewritten and
    reviewed_by/reviewed_at are cleared — the teacher has explicitly
    asked to replace their review with a fresh AI pass against the
    current rubric.
    """
    sub = (await db.execute(
        select(Submission).where(Submission.id == submission_id)
    )).scalar_one_or_none()
    if not sub:
        return

    # Idempotency: if this submission is already AI-graded (final_score
    # set) and the caller isn't a teacher-initiated regrade, skip the
    # LLM call. Guards against a concurrent spawn (e.g. confirm called
    # twice in quick succession) re-running grading and racing writers
    # on the same SubmissionGrade row.
    if not force:
        existing = (await db.execute(
            select(SubmissionGrade.final_score).where(
                SubmissionGrade.submission_id == submission_id,
            )
        )).scalar_one_or_none()
        if existing is not None:
            return

    assignment = (await db.execute(
        select(Assignment).where(Assignment.id == sub.assignment_id)
    )).scalar_one_or_none()
    if not assignment:
        return

    problems = await load_problems_for_assignment(db, assignment)
    if not problems:
        return

    result = await grade_submission_with_ai(
        extraction, problems, assignment.rubric, user_id=user_id,
    )
    grades = result.get("grades", [])
    if not grades:
        return

    # Clamp confidence to [0, 1] in place on each grade entry so both the
    # raw ai_breakdown (read for the "AI's call" badge on the UI) and the
    # actionable breakdown carry bounded values. Non-numeric / missing
    # values become None so the UI renders a neutral state.
    for g in grades:
        raw_conf = g.get("confidence")
        if isinstance(raw_conf, (int, float)):
            g["confidence"] = max(0.0, min(1.0, float(raw_conf)))
        else:
            g["confidence"] = None

    # Map position → bank_item_id so breakdown uses the same IDs as
    # the teacher's manual grading flow.
    pos_to_bid = {p["position"]: p["bank_item_id"] for p in problems}

    breakdown = []
    total_percent = 0.0
    for g in grades:
        bid = pos_to_bid.get(g.get("problem_position"))
        if not bid:
            continue
        status = g.get("score_status", "zero")
        percent = 100.0 if status == "full" else 0.0 if status == "zero" else float(g.get("percent", 0))
        breakdown.append({
            "problem_id": bid,
            "score_status": status,
            "percent": percent,
            "confidence": g.get("confidence"),
            "feedback": g.get("reasoning"),
            "student_answer": g.get("student_answer"),
        })
        total_percent += percent

    ai_score = total_percent / len(breakdown) if breakdown else None

    # Upsert the grade row (race-safe with teacher manual grading).
    await db.execute(
        pg_insert(SubmissionGrade)
        .values(submission_id=sub.id)
        .on_conflict_do_nothing(index_elements=["submission_id"])
    )
    grade = (await db.execute(
        select(SubmissionGrade).where(SubmissionGrade.submission_id == sub.id)
    )).scalar_one()

    grade.ai_breakdown = result
    grade.ai_score = ai_score
    # Freeze the rubric we actually graded against so the review page can
    # diff against Assignment.rubric later and surface a regrade CTA when
    # the teacher has edited the rubric since this run.
    grade.rubric_snapshot = assignment.rubric

    if force or grade.reviewed_by is None:
        grade.breakdown = breakdown
        grade.final_score = ai_score
        grade.graded_at = datetime.now(UTC)
        if force:
            # Regrade wipes the manual-review marker so the row once
            # again reflects "last touched by AI." If the grade was
            # published, `grade_published_at` stays set and the live
            # draft is dirty vs the published snapshot — the teacher
            # republishes when ready.
            grade.reviewed_by = None
            grade.reviewed_at = None
