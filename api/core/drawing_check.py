"""Graph checklists, and checking a student's drawing against one.

Grading a graph from the reader's description over-credits it. The
full-page reader sees the question and the student's algebra beside the
sketch, and describes the graph the student meant: on the Oct 2026 prod
set it was flattering on 13 of 40 graphs, and the AI gave full credit to
11 graphs that were wrong. A zoomed look at the drawing alone was right
far more often, but it only counted lines.

So a graph question gets a checklist, written once from its answer key
(`write_graph_checklist`), and each student's drawing is judged against
it item by item (`check_drawing`). The check sees only the crop and the
item text. It never sees the question, the answer key or the student's
written work.

Not wired into grading yet: this is the piece the Step 2 eval measures.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any, Literal

from api.core.checklist_points import MAX_CHECKLIST_ITEM_CHARS, MAX_CHECKLIST_ITEMS, fit_checklist
from api.core.image_utils import crop_region_for_vision, preprocess_image_for_vision, to_content_block
from api.core.llm_client import (
    MODEL_OPUS,
    MODEL_REASON,
    LLMMode,
    call_claude_json,
    call_claude_vision,
)
from api.core.llm_schemas import DRAWING_CHECK_SCHEMA, GRAPH_CHECKLIST_SCHEMA

logger = logging.getLogger(__name__)

Verdict = Literal["yes", "no", "unclear"]
# Which look settled the check: a tight crop of the reader's box, a wider
# one when the drawing ran off its edge, or the whole page when the box
# was missing or held no drawing. "none" = no image to look at.
Step = Literal["tight", "wide", "page", "none"]

# Tight enough to leave out the student's written values beside the
# graph (the old 0.35 margin plus a 22% minimum window included them in
# 35 of 39 prod crops), loose enough for the reader's rough boxes.
_TIGHT = (0.12, 0.12)  # (margin, min_frac)
_WIDE = (0.6, 0.22)


_CHECKLIST_SYSTEM = """\
You write the checklist a math teacher uses to grade a student's hand drawing: \
a graph, a number line, a chart, a diagram or a construction.

You get one question that asks for a drawing, its answer key, what the whole \
problem is worth, and the class's grading rules. List 3 to 6 features a correct \
drawing must show.

Check what a teacher checks: the features that show whether the drawing is right. \
On a graph that is where a line or curve is, which way it goes, how steep it is, \
where it crosses an axis or another line, an asymptote, or its shape. On a number \
line it is the endpoint, open or closed, and which way it is shaded. On a chart it \
is each bar's or point's value. On a construction it is each arc or line it needs.

Never check how neatly it is drawn: dots, arrowheads, ruler-straight lines, the \
scale chosen. A dot, a label or a dashed line is an item only when the question \
says to mark or label it, a class rule asks for it, or it changes the meaning \
(dashed or solid on an inequality, open or closed on a number line). Two lines \
that cross show where they intersect without a dot.

Write every item so a correct drawing sketched by hand on graph paper passes it.

Each item:
- Is ONE feature that a person looking only at the drawing can mark yes or no: \
one line or curve at one place, one crossing, one label. Never two in one item: \
not "Both asymptotes labeled", but one item per asymptote.
- Says what is drawn, not what it stands for: "Dashed horizontal line at y = 1", \
not "Line at y = 1 representing the midline".
- Uses the exact values from the answer key ("Vertical asymptote drawn at x = 2", \
"Crosses the y-axis at (0, 0.5)").
- Never says "correct", "accurate" or "properly" without saying what that means.

Cover every part the question asks the student to draw, including any guide curve, \
asymptote or reference line it names (a cosecant graphed from its sine curve needs \
the sine curve). Ask for nothing more: labels only if the question says to label, \
or a class rule requires them.

Only the drawing. The student's written work and final answer are graded \
separately, so no item is about something written beside the drawing ("The solution \
(3, 0) is written", "States the system is inconsistent"). A feature drawn ON the \
drawing is part of it ("The two lines cross at (3, 0)").

Only the values the question and answer key give. Reading one off is fine (the line \
y = -2x + 6 crosses the y-axis at (0, 6)); working out a new one is not (asymptotes \
from a period). When the key doesn't give a feature's values, describe it without \
them ("A vertical asymptote between each pair of branches").

If the question doesn't ask the student to draw anything (it is a calculation, or \
only reads a printed figure), set asks_for_drawing to false and list no items.

Points: whole numbers, weighted by how much each feature matters. Together they \
are the drawing's share of the problem: leave at least 1 point for the written work \
and the answer.

Class rules: when an item is exactly what a class rule asks for, set its rule_id \
to that rule's bracketed id and use the rule's points. Otherwise rule_id is null.
"""

_CHECK_SYSTEM = """\
You check a student's hand-drawn graph against a short list of features.

You see a photo of the drawing and the list. Judge only what is actually drawn:
- yes: clearly drawn as described.
- no: visibly missing, or drawn differently. Say what is there instead.
- unclear: this image can't settle it (too faint, cut off, a label you can't read).

Judge the strokes, not what the student probably meant. A feature that is almost \
right, implied, or only written as an equation somewhere is not drawn. Writing \
that is part of the drawing (axis labels, a label beside a line, a marked point) \
counts. Worked math beside the drawing does not.

Also say whether the whole drawing is in the image.
"""


@dataclass
class ChecklistItem:
    text: str
    points: int
    rule_id: str | None = None
    # Numbers in the item that the question and answer key never give:
    # the writer worked them out, so the teacher checks them.
    values_to_check: list[str] = field(default_factory=list)


@dataclass
class WrittenChecklist:
    items: list[ChecklistItem]
    # False when the writer read the question as asking for no drawing
    # (a calculation, or a printed figure): the flag is likely wrong.
    asks_for_drawing: bool = True


# A number, with its sign. A minus counts when it sits right before the
# digits ("(0, -3)", "x - 3" both give -3), so x = 3 doesn't vouch for
# x = -3. "1,000" is one number; ".5" is 0.5. Exponents ("x^2") aren't
# values a graph shows, so they're skipped.
_NUMBER = re.compile(r"(?<![\w.^])(-\s?)?(\d{1,3}(?:,\d{3})+(?!\d)|\d+(?:\.\d+)?|\.\d+)")
_LATEX_FRACTION = re.compile(r"\\[dt]?frac(?:\{(\d+)\}\{(\d+)\}|(\d)(\d))")
_UNICODE_FRACTIONS = {"½": "1/2", "⅓": "1/3", "⅔": "2/3", "¼": "1/4", "¾": "3/4"}


def _numbers(text: str) -> list[str]:
    """The numbers in `text`, in order, normalized ("2.50" is "2.5",
    "−½" is -1 over 2). Mirrored by `splitValues` in graph-checklist.tsx."""
    text = text.replace("−", "-")
    text = _LATEX_FRACTION.sub(lambda m: f"{m[1] or m[3]}/{m[2] or m[4]}", text)
    for k, v in _UNICODE_FRACTIONS.items():
        text = text.replace(k, v)
    out = []
    for m in _NUMBER.finditer(text):
        if text[: m.start()].endswith("^{"):
            continue
        n = m[2].replace(",", "")
        if n.startswith("."):
            n = "0" + n
        if "." in n:
            n = n.rstrip("0").rstrip(".")
        out.append("0" if n == "0" else f"-{n}" if m[1] else n)
    return out


def values_not_given(text: str, *sources: str) -> list[str]:
    """The numbers in `text` that none of `sources` contains, in the
    order they appear. 0 always counts as given (the axes)."""
    given = {n for s in sources for n in _numbers(s)} | {"0"}
    return list(dict.fromkeys(n for n in _numbers(text) if n not in given))


@dataclass
class ItemResult:
    n: int
    verdict: Verdict
    seen: str


@dataclass
class DrawingCheck:
    step: Step
    in_view: str
    items: list[ItemResult] = field(default_factory=list)


def _format_rules(class_rules: list[dict[str, Any]] | None) -> str:
    lines = []
    for r in class_rules or []:
        cost = f" (take off {r['points']} points)" if r.get("points") is not None else ""
        lines.append(f"[{r['id']}] {r['text']}{cost}")
    return "\n".join(lines) or "(none)"


def _whole_points(value: Any) -> int:
    """The model's points for an item, defensively: anything that isn't a
    positive whole number is 1, and `fit_checklist` re-sizes the total."""
    try:
        n = int(value)
    except (TypeError, ValueError):
        return 1
    return n if n >= 1 else 1


async def write_graph_checklist(
    question: str,
    final_answer: str,
    problem_points: int,
    *,
    class_rules: list[dict[str, Any]] | None = None,
    user_id: str | None = None,
) -> WrittenChecklist:
    """The features a correct graph for `question` must show, for a
    problem worth `problem_points` in all. The model suggests the split:
    the items add up to the graph's share, and at least 1 point is left
    for the work and the answer. Temperature 0, but not reproducible:
    runs on the same question and key can differ, so the teacher sees it.

    What comes back is held to the rules in code, not just the prompt:
    at most `MAX_CHECKLIST_ITEMS` items, each with text; a rule-linked
    item takes its rule's points; and the sum is trimmed below
    `problem_points` (`fit_checklist`). Empty when the problem has no
    room for a graph part (under 2 points)."""
    if problem_points < 2:
        return WrittenChecklist([])
    out = await call_claude_json(
        _CHECKLIST_SYSTEM,
        (
            f"Question:\n{question}\n\nAnswer key:\n{final_answer}\n\n"
            f"The whole problem is worth {problem_points} points.\n\n"
            f"Class rules:\n{_format_rules(class_rules)}"
        ),
        LLMMode.GRAPH_CHECKLIST,
        tool_schema=GRAPH_CHECKLIST_SCHEMA,
        model=MODEL_REASON,
        max_tokens=1500,
        temperature=0.0,
        user_id=user_id,
    )
    if out.get("asks_for_drawing") is False:
        return WrittenChecklist([], asks_for_drawing=False)
    rule_text = " ".join(str(r.get("text") or "") for r in class_rules or [])
    items = []
    raw_items = out.get("items")
    for raw in raw_items if isinstance(raw_items, list) else []:
        if not isinstance(raw, dict) or not str(raw.get("text") or "").strip():
            continue
        rule_id = raw.get("rule_id")
        text = str(raw["text"]).strip()[:MAX_CHECKLIST_ITEM_CHARS]
        items.append(ChecklistItem(
            text=text,
            points=_whole_points(raw.get("points")),
            rule_id=rule_id if isinstance(rule_id, str) else None,
            values_to_check=values_not_given(text, question, final_answer, rule_text),
        ))
    return WrittenChecklist(
        fit_checklist(items[:MAX_CHECKLIST_ITEMS], problem_points, problem_points, class_rules),
    )


def _parse_check(out: dict[str, Any], count: int) -> tuple[str, list[ItemResult]]:
    """Every item gets exactly one result. Anything the model skipped,
    numbered wrong or answered off-script is "unclear": the teacher
    decides, rather than the code guessing in either direction."""
    by_n: dict[int, ItemResult] = {}
    for raw in out.get("items") or []:
        if not isinstance(raw, dict):
            continue
        n, verdict = raw.get("n"), raw.get("verdict")
        if (isinstance(n, int) and not isinstance(n, bool) and 1 <= n <= count and n not in by_n
                and verdict in ("yes", "no", "unclear")):
            by_n[n] = ItemResult(n=n, verdict=verdict, seen=str(raw.get("seen") or ""))
    in_view = out.get("in_view") if out.get("in_view") in ("whole", "cut_off", "not_found") else "not_found"
    return str(in_view), [by_n.get(n) or ItemResult(n=n, verdict="unclear", seen="") for n in range(1, count + 1)]


def _item_list(items: list[ChecklistItem]) -> str:
    return "\n".join(f"{i}. {item.text}" for i, item in enumerate(items, 1))


async def _look(
    image_b64: str,
    media_type: str,
    items: list[ChecklistItem],
    *,
    find_problem: int | None,
    user_id: str | None,
    submission_id: str | None,
    phase: str,
) -> tuple[str, list[ItemResult]]:
    where = (
        f"This is a whole homework page. Find the student's drawing for problem "
        f"{find_problem} and check only that drawing. If there isn't one, say not_found.\n\n"
        if find_problem is not None else ""
    )
    content = [
        to_content_block(media_type, image_b64),
        {"type": "text", "text": f"{where}Features to check:\n{_item_list(items)}"},
    ]
    # One retry for a malformed answer: Opus occasionally writes the
    # `items` array as raw parameter text (2 of 44 looks in the Oct 2026
    # eval), or answers without the tool. Both surface as RuntimeError
    # from the client; API errors are their own types and aren't retried
    # here. A second failure is the caller's to handle.
    for attempt in (1, 2):
        try:
            out = await call_claude_vision(
                content,
                LLMMode.DRAWING_CHECK,
                tool_schema=DRAWING_CHECK_SCHEMA,
                system_prompt=_CHECK_SYSTEM,
                model=MODEL_OPUS,
                max_tokens=8000,
                user_id=user_id,
                submission_id=submission_id,
                call_metadata={"phase": phase, "problem_position": find_problem, "items": len(items),
                               "attempt": attempt},
            )
            break
        except RuntimeError:
            if attempt == 2:
                raise
            logger.warning("drawing check: malformed answer, retrying submission=%s", submission_id)
    return _parse_check(out, len(items))


async def check_drawing(
    page_b64: str,
    media_type: str,
    bbox: dict[str, Any] | None,
    items: list[ChecklistItem],
    *,
    problem_position: int,
    user_id: str | None = None,
    submission_id: str | None = None,
) -> DrawingCheck:
    """Judge one student's drawing against `items`.

    Looks as narrowly as it can, widening only when it has to: a tight crop
    of the reader's `bbox`, then a wider crop when the drawing runs off an
    edge or isn't in it, then the whole page (still without the question or
    the answer key) when there is no usable box or the crops found nothing.
    `step` records which look settled it, so the eval can see how often
    the reader's boxes are good enough.
    """
    if not items or not media_type.startswith("image/"):
        return DrawingCheck(step="none", in_view="not_found",
                            items=[ItemResult(n, "unclear", "") for n in range(1, len(items) + 1)])
    common = {"user_id": user_id, "submission_id": submission_id}
    if isinstance(bbox, dict):
        last: tuple[str, list[ItemResult]] | None = None
        looks: tuple[tuple[Step, tuple[float, float]], ...] = (("tight", _TIGHT), ("wide", _WIDE))
        for step, (margin, min_frac) in looks:
            crop = crop_region_for_vision(page_b64, media_type, bbox, margin=margin, min_frac=min_frac)
            if crop is None:
                break
            last = await _look(crop, "image/jpeg", items, find_problem=None, phase=f"drawing_check_{step}", **common)
            if last[0] == "whole":
                return DrawingCheck(step=step, in_view=last[0], items=last[1])
        # A drawing cut off even in the wide crop is still the best view we
        # have of it; the whole page would only show it smaller.
        if last is not None and last[0] == "cut_off":
            return DrawingCheck(step="wide", in_view=last[0], items=last[1])
    # The same oriented, downscaled page the reader saw.
    page = preprocess_image_for_vision(page_b64, media_type)
    in_view, results = await _look(
        page, media_type, items, find_problem=problem_position, phase="drawing_check_page", **common,
    )
    if in_view == "not_found":
        # Nothing to judge: every item is the teacher's call, never a
        # silent zero from a look that couldn't find the drawing.
        results = [ItemResult(r.n, "unclear", r.seen or "Couldn't find the drawing.") for r in results]
    return DrawingCheck(step="page", in_view=in_view, items=results)
