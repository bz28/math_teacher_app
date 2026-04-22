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
from api.models.question_bank import QuestionBankItem
from api.services.bank import problem_ids_in_content

logger = logging.getLogger(__name__)

_GRADING_SYSTEM = """\
You are a world-class math professor grading a student's homework submission. \
You have the student's extracted work (what they wrote on paper, already converted \
to text by a separate extraction step) and the teacher's answer key.

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
- Grade ONLY based on the student's extracted work — do not solve the problem yourself.
- If the student's answer matches the answer key exactly (or is mathematically equivalent), \
give full credit.
- If the student's approach is correct but they made an arithmetic or sign error, give \
partial credit.
- If no extracted answer exists for a problem (student skipped it), give zero.
- Keep reasoning concise (1-2 sentences per problem)."""


def _build_rubric_block(rubric: dict[str, Any] | None) -> str:
    """Format the teacher-authored rubric as labeled fields the model can
    reference by name. Labels match the rubric-application instructions in
    the system prompt so the model can cite them in reasoning."""
    if not rubric:
        return (
            "No rubric provided. Use default criteria:\n"
            '- "Full credit": correct final answer\n'
            '- "Partial credit": right approach but arithmetic/sign error\n'
            '- "Zero": wrong answer or no attempt'
        )
    parts: list[str] = []
    if rubric.get("full_credit"):
        parts.append(f'"Full credit": {rubric["full_credit"]}')
    if rubric.get("partial_credit"):
        parts.append(f'"Partial credit": {rubric["partial_credit"]}')
    if rubric.get("common_mistakes"):
        parts.append(f'"Common mistakes": {rubric["common_mistakes"]}')
    if rubric.get("notes"):
        parts.append(f'"Additional notes": {rubric["notes"]}')
    return "\n".join(parts) if parts else "No specific criteria. Use your best judgment."


def _build_user_message(
    extraction: dict[str, Any],
    problems: list[dict[str, Any]],
) -> str:
    lines: list[str] = []

    lines.append("## Student's extracted work\n")
    final_answers = extraction.get("final_answers", [])
    if final_answers:
        for fa in final_answers:
            lines.append(
                f"Problem {fa['problem_position']}: "
                f"{fa.get('answer_latex', fa.get('answer_plain', '(no answer)'))}"
            )
    else:
        lines.append("(No per-problem answers extracted — only work steps available)")

    steps = extraction.get("steps", [])
    if steps:
        lines.append("\n## Work steps (for context)\n")
        for s in steps:
            lines.append(f"Step {s['step_num']}: {s.get('latex', '')} — {s.get('plain_english', '')}")

    lines.append("\n## Problems + Answer Key\n")
    for p in problems:
        lines.append(
            f"Problem {p['position']}: {p['question']}\n"
            f"  Answer key: {p.get('final_answer', '(no answer key)')}"
        )

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
) -> None:
    """Load the HW context, call the AI grader, and persist results.

    Writes to SubmissionGrade:
    - ai_breakdown: raw AI output (reasoning preserved for teacher)
    - ai_score: average of per-problem percents
    - breakdown: actionable grades (same shape the teacher writes to)
    - final_score: same as ai_score until teacher overrides

    If a teacher has already manually graded (reviewed_by set),
    only ai_breakdown and ai_score are written — breakdown and
    final_score are left untouched so we don't clobber their work.
    """
    sub = (await db.execute(
        select(Submission).where(Submission.id == submission_id)
    )).scalar_one_or_none()
    if not sub:
        return

    assignment = (await db.execute(
        select(Assignment).where(Assignment.id == sub.assignment_id)
    )).scalar_one_or_none()
    if not assignment:
        return

    pid_strs = problem_ids_in_content(assignment.content)
    if not pid_strs:
        return

    pid_uuids = []
    for s in pid_strs:
        try:
            pid_uuids.append(uuid.UUID(str(s)))
        except (ValueError, TypeError):
            continue
    if not pid_uuids:
        return

    items = (await db.execute(
        select(QuestionBankItem).where(QuestionBankItem.id.in_(pid_uuids))
    )).scalars().all()
    items_by_id = {it.id: it for it in items}

    problems = []
    for pos, pid in enumerate(pid_uuids, 1):
        item = items_by_id.get(pid)
        if not item:
            continue
        problems.append({
            "position": pos,
            "bank_item_id": str(pid),
            "question": item.question,
            "final_answer": item.final_answer,
        })
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
            "student_answer": g.get("student_answer", ""),
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

    if grade.reviewed_by is None:
        grade.breakdown = breakdown
        grade.final_score = ai_score
        grade.graded_at = datetime.now(UTC)
