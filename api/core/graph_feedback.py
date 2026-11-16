"""The note a student reads under a graph problem, written once both parts
are graded.

A graph problem is graded in two parts that run side by side: the grader
grades the written work and the answer, and the drawing check marks the
drawing against its checklist (`graph_grading`). The grader writes its note
before the drawing is marked, so on its own it praised a right answer next
to a drawing that cost most of the points ("Correct, nice job" beside 10%,
8 of 10 graph problems in the Nov 2026 graph eval). This writes the note
from both parts and the final score instead.

Only the note: the score, the deductions and the checklist results are
already final and never change here. When the note can't be written (the
model fails), `fallback_feedback` builds one in code from the same facts.
"""

from __future__ import annotations

import logging
from typing import Any

from api.core.llm_client import MODEL_SONNET, LLMMode, call_claude_json
from api.core.llm_schemas import GRAPH_FEEDBACK_SCHEMA

logger = logging.getLogger(__name__)

_SYSTEM = """\
You write the short note a student reads under one graded homework problem \
that asked for a graph or another drawing.

The problem was graded in two parts. A grader marked the written work and the \
answer and wrote a note about them. A separate check marked the drawing, \
feature by feature: yes (drawn right), no (missing or clearly wrong), or \
unclear (the teacher will look at it). You get both, and the score.

Write 1 to 3 sentences to the student ("you"), in plain words:
- Agree with the score. Never say "correct", "well done", "great job" or \
anything like it about the whole problem when points were lost.
- Say what was right first, in a few words, then the one or two things that \
cost the most, saying what to fix ("Your line for y = 2x - 1 should cross the \
y-axis at -1").
- A feature marked no is a mistake to fix; one marked unclear is not: don't \
call it wrong.
- When there was no drawing, say the problem asked for one. When the drawing \
couldn't be checked, say the teacher will look at it; never call it missing.
- Keep any useful point from the grader's note about the written work.
- No points, percents or scores, and no mention of a checklist or a check.
"""


def _item_lines(items: list[dict[str, Any]]) -> str:
    return "\n".join(
        f"- {i.get('verdict')}: {i.get('text')}" + (f" (seen: {i['seen']})" if i.get("seen") else "")
        for i in items
    ) or "(none)"


def needs_note(entry: dict[str, Any]) -> bool:
    """Whether a combined graph-problem entry needs its note rewritten:
    the drawing lost points or awaits the teacher. A full-marks problem
    keeps the grader's note, which can't contradict it."""
    graph = entry.get("graph") or {}
    items = graph.get("items") or []
    return any(i.get("verdict") != "yes" for i in items) or (entry.get("percent") or 0) < 100


_DRAWING_LINE = {
    "found": "yes",
    "none": "no, the problem asked for one and none was submitted",
    "unchecked": "couldn't be checked; the teacher will look at it",
}


def fallback_feedback(work_feedback: str | None, items: list[dict[str, Any]], drawing: str = "found") -> str:
    """A note built in code when the model can't write one: the grader's
    note is about the written work only, so it says so, and the drawing's
    misses are named after it (or its absence, or that the teacher will
    look at it)."""
    misses = [str(i.get("text") or "").rstrip(".") for i in items if i.get("verdict") == "no"]
    parts = []
    if work_feedback:
        parts.append(f"Your written work: {work_feedback.strip()}")
    if drawing == "none":
        parts.append("This problem asked for a drawing, and none was found.")
    elif drawing == "unchecked":
        parts.append("Your teacher will look at your drawing.")
    elif misses:
        parts.append("On your drawing, check: " + "; ".join(misses[:2]) + ".")
    return " ".join(parts) or "See your teacher's comments on this problem."


async def write_graph_note(
    question: str,
    final_answer: str,
    entry: dict[str, Any],
    work_feedback: str | None,
    *,
    drawing: str,
    user_id: str | None = None,
    submission_id: str | None = None,
) -> str:
    """The student's note for one combined graph-problem entry
    (`graph_grading.combine`); `drawing` is "found", "none" or "unchecked"
    (`grading_ai._drawing_state`). Never raises: a failed call falls back to
    `fallback_feedback`."""
    graph = entry.get("graph") or {}
    items = graph.get("items") or []
    percent = float(entry.get("percent") or 0)
    try:
        out = await call_claude_json(
            _SYSTEM,
            (
                f"Question:\n{question}\n\nAnswer key:\n{final_answer}\n\n"
                f"Score on this problem: {percent:.0f}%\n"
                f"Drawing found: {_DRAWING_LINE.get(drawing, 'yes')}\n\n"
                f"Drawing, feature by feature:\n{_item_lines(items)}\n\n"
                f"Grader's note on the written work and answer:\n{work_feedback or '(none)'}"
            ),
            LLMMode.GRAPH_FEEDBACK,
            tool_schema=GRAPH_FEEDBACK_SCHEMA,
            model=MODEL_SONNET,
            max_tokens=400,
            temperature=0.0,
            user_id=user_id,
            submission_id=submission_id,
        )
        note = str(out.get("feedback") or "").strip()
        if note:
            return note
    except Exception:  # noqa: BLE001 — a note is never worth failing a grade over
        logger.exception("graph note failed submission=%s", submission_id)
    return fallback_feedback(work_feedback, items, drawing)
