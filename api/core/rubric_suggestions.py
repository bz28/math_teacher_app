"""Offer to add a teacher's grading reason to the class rubric.

A teacher lowers an AI grade and says why. If the reason is a standard
they'd hold any student to ("final answers need units"), the AI should
apply it from now on — but only if the teacher says so. This module
decides whether to offer, and remembers the answer:

1. Only a LOWERED grade with a comment qualifies (code, not AI).
2. One small AI call reads the comment against the problem and answers
   two things: is it a standing rule or a one-off about this student's
   work, and is it the same as a rule the class already has, or one it
   was already offered? Teachers word the same standard many ways
   ("should be in feet", "degrees missing"), which is why matching is the
   AI's job and not a string compare.
3. Code decides from that: no offer for a one-off, a rule the class has,
   or one the teacher declined; the same pending offer again for one they
   ignored; otherwise a new offer. Points are what the teacher took off.

Nothing is ever added to a rubric here — that takes the teacher's tap
(`decide`).
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.class_rubric import ClassRubric, class_rules
from api.core.constants import MAX_RUBRIC_FIELD_CHARS
from api.models.assignment import Assignment
from api.models.course import Course
from api.models.rubric_suggestion import RubricSuggestion

logger = logging.getLogger(__name__)

# Sits behind a teacher's edit, so it's time-boxed: past this, no offer.
_SUGGEST_TIMEOUT_S = 8.0

_SUGGEST_SYSTEM = (
    "A teacher lowered the grade an AI gave a student's homework problem and "
    "wrote why. Decide whether the reason is a standing grading rule this "
    "teacher would apply to any student on any problem it covers — like "
    "\"final answers need units\", \"show your work\", \"label every key point "
    "on graphs\", \"write the axis as an equation\" — or a one-off about this "
    "student's particular work: a specific mistake, a misread, a wrong value, "
    "an incomplete answer, or something only this problem asks for. When "
    "unsure, it is a one-off.\n\n"
    "For a rule, word it as a short instruction a grader could apply to every "
    "homework in the class, in the teacher's terms, without points. Then check "
    "it against the listed rules: if one already says the same thing, even in "
    "different words, give its id in same_as."
)


async def _classify(
    *,
    question: str,
    answer_key: str,
    student_answer: str,
    ai_percent: float,
    teacher_percent: float,
    comment: str,
    known: list[tuple[str, str]],
    user_id: str | None,
) -> dict[str, Any] | None:
    """The one AI call. None when it fails, times out, or answers oddly."""
    from api.core.llm_client import MODEL_CLASSIFY, LLMMode, call_claude_json
    from api.core.llm_schemas import RUBRIC_RULE_SUGGESTION_SCHEMA

    listed = "\n".join(f"[{i}] {t}" for i, t in known) or "(none)"
    message = (
        f"Problem: {question}\n"
        f"Answer key: {answer_key}\n"
        f"Student's answer: {student_answer or '(none)'}\n"
        f"AI's grade: {ai_percent:g}%. Teacher's grade: {teacher_percent:g}%.\n"
        f"Teacher's comment: {comment}\n\n"
        f"Rules this class already has or was already offered:\n{listed}"
    )
    try:
        result = await asyncio.wait_for(call_claude_json(
            _SUGGEST_SYSTEM,
            message,
            LLMMode.SUGGEST_RUBRIC_RULE,
            tool_schema=RUBRIC_RULE_SUGGESTION_SCHEMA,
            model=MODEL_CLASSIFY,
            max_tokens=200,
            temperature=0.0,
            max_retries=1,
            user_id=user_id,
        ), timeout=_SUGGEST_TIMEOUT_S)
    except Exception:  # noqa: BLE001 — no offer is the safe fallback
        logger.warning("rubric rule suggestion failed; no offer", exc_info=True)
        return None
    if not isinstance(result, dict) or result.get("kind") not in ("rule", "one_off"):
        return None
    return result


async def suggest_for_edit(
    db: AsyncSession,
    *,
    assignment: Assignment,
    submission_id: uuid.UUID,
    problem_id: uuid.UUID,
    question: str,
    answer_key: str,
    student_answer: str,
    ai_percent: float,
    teacher_percent: float,
    comment: str,
    teacher_id: uuid.UUID,
) -> RubricSuggestion | None:
    """The offer to show for this edit, or None. May add a pending row
    (the caller commits)."""
    comment = comment.strip()
    if teacher_percent >= ai_percent or not comment:
        return None

    course = (await db.execute(
        select(Course).where(Course.id == assignment.course_id)
    )).scalar_one()
    past = (await db.execute(
        select(RubricSuggestion).where(RubricSuggestion.course_id == course.id)
        .order_by(RubricSuggestion.created_at)
    )).scalars().all()

    # Everything the AI should recognize as "already covered", by an id it
    # can echo back.
    known: dict[str, tuple[str, RubricSuggestion | None]] = {}
    for r in class_rules(course.rubric):
        known[r["id"]] = (r["text"], None)
    for s in past:
        known[f"s{s.id.hex[:8]}"] = (s.text, s)

    result = await _classify(
        question=question, answer_key=answer_key, student_answer=student_answer,
        ai_percent=ai_percent, teacher_percent=teacher_percent, comment=comment,
        known=[(k, t) for k, (t, _) in known.items()], user_id=str(teacher_id),
    )
    if result is None or result["kind"] != "rule":
        return None
    text = str(result.get("rule_text") or "").strip()
    if not text:
        return None

    match = known.get(str(result.get("same_as") or "").strip("[]"))
    if match is not None and match[1] is None:
        return None  # the class already has this rule
    # Every past offer of this rule — the matched one and any with the
    # same wording (it may have been offered more than once). The
    # strongest answer wins: declined or added means never again.
    same = [s for s in past if _same_text(s.text, text)]
    if match is not None and match[1] is not None:
        same.append(match[1])
    if any(s.status in ("declined", "added") for s in same):
        return None
    if any(s.status == "added_homework" and s.assignment_id == assignment.id for s in same):
        return None  # already in this homework's extra rules
    pending = next((s for s in same if s.status == "pending"), None)
    if pending is not None:
        return pending  # ignored before — offer it again

    offer = RubricSuggestion(
        course_id=course.id,
        assignment_id=assignment.id,
        submission_id=submission_id,
        problem_id=problem_id,
        teacher_id=teacher_id,
        text=text[:300],
        points=max(1, min(100, round(ai_percent - teacher_percent))),
        source_label=assignment.title[:300],
        teacher_comment=comment[:2000],
        status="pending",
    )
    db.add(offer)
    await db.flush()
    return offer


async def decide(
    db: AsyncSession,
    offer: RubricSuggestion,
    *,
    action: str,
    text: str | None,
    points: int | None,
    points_set: bool,
) -> None:
    """Apply the teacher's answer. `text`/`points` override the offer's
    (the "Edit first" path); `points_set` distinguishes "clear the points"
    (None, sent) from "keep them" (not sent). The caller commits."""
    if text is not None and text.strip():
        offer.text = text.strip()[:300]
    if points_set:
        offer.points = points

    if action == "add_class":
        course = (await db.execute(
            select(Course).where(Course.id == offer.course_id).with_for_update()
        )).scalar_one()
        current = class_rules(course.rubric)
        body = ClassRubric.model_validate({"rules": [
            *({"id": r["id"], "text": r["text"], "points": r.get("points")} for r in current),
            {"text": offer.text, "points": offer.points,
             "source": "suggestion", "source_label": offer.source_label},
        ]})
        course.rubric = body.to_stored(course.rubric)
        offer.status = "added"
    elif action == "add_homework":
        hw = (await db.execute(
            select(Assignment).where(Assignment.id == offer.assignment_id).with_for_update()
        )).scalar_one_or_none()
        if hw is None:
            raise ValueError("That homework no longer exists. Add the rule to the class rubric instead.")
        line = offer.text + (f" Take off {offer.points}." if offer.points else "")
        rubric = dict(hw.rubric or {})
        notes = (rubric.get("notes") or "").strip()
        merged = f"{notes}\n{line}" if notes else line
        if len(merged) > MAX_RUBRIC_FIELD_CHARS:
            raise ValueError("This homework's extra rules are full")
        rubric["notes"] = merged
        hw.rubric = rubric
        offer.status = "added_homework"
    else:
        offer.status = "declined"
    offer.decided_at = datetime.now(UTC)


def _same_text(a: str, b: str) -> bool:
    """Same rule wording, ignoring case, spacing and full stops."""
    def norm(t: str) -> str:
        return " ".join(t.lower().replace(".", " ").split())
    return norm(a) == norm(b)


def offer_json(offer: RubricSuggestion) -> dict[str, Any]:
    return {
        "id": str(offer.id),
        "text": offer.text,
        "points": offer.points,
        "source_label": offer.source_label,
        "status": offer.status,
        "created_at": offer.created_at.isoformat() if offer.created_at else None,
    }
