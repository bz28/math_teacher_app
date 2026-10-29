"""Grading a graph problem in two parts: the drawing against its
checklist, and the written work and answer by the grader.

A graph problem with a checklist splits its points. The checklist items
are the graph part (`GraphPart.graph_points`); the rest is the work part
(`GraphPart.work_points`). The grader grades only the work and the answer,
as if they were the whole problem (`grading_ai`, a problem carrying
`graph_part`), and is re-sized into the work part's points. The drawing is
judged item by item by `drawing_check.check_drawing`, which never sees the
question, the answer key or the written work (`check_problem_drawing`).
`combine` adds the two up in code.

  - "yes": the item earns its points.
  - "no": the item's points come off, as their own deduction naming it.
  - "unclear": the item keeps its points, and the problem is marked for
    the teacher to check (`needs_check`). The check couldn't tell, so the
    teacher decides; it is never a silent zero.

Not wired into grading yet: the eval measures it first.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from dataclasses import dataclass, field
from typing import Any

from api.core.checklist_points import fit_checklist
from api.core.drawing_check import ChecklistItem, DrawingCheck, ItemResult, check_drawing
from api.core.graph_checklist import current_checklist, stored_items
from api.core.homework_points import weighted_percent
from api.core.image_utils import page_looks_sideways, pdf_pages_as_images
from api.core.integrity_ai import _strip_data_url_prefix
from api.models.question_bank import QuestionBankItem

logger = logging.getLogger(__name__)

# Whole-page looks one problem may take hunting for an unlocated drawing.
# Each is an Opus call; prod's longest upload is 4 pages.
_MAX_PAGE_LOOKS = 6
# Problems checked at once per submission.
_CHECK_CONCURRENCY = 3

_NOT_FOUND = "Couldn't find the drawing."
_FAILED = "Couldn't check the graph."
_NOT_DRAWN = "No drawing for this problem."
_SIDEWAYS = "The photo looks sideways, so the axes may have been misread."


@dataclass
class GraphPart:
    """A problem's checklist as this homework grades it: fitted to the
    problem's points and the rules the homework applies."""

    items: list[ChecklistItem]
    points: int

    @property
    def graph_points(self) -> int:
        return sum(i.points for i in self.items)

    @property
    def work_points(self) -> int:
        return self.points - self.graph_points

    @property
    def linked_rules(self) -> set[str]:
        return {i.rule_id for i in self.items if i.rule_id}

    @property
    def key(self) -> str:
        """What a stored check was made against, so a checklist or points
        change shows the stored check is for a different checklist."""
        raw = json.dumps(
            [self.points, [[i.text, i.points, i.rule_id] for i in self.items]],
            ensure_ascii=False,
        )
        return hashlib.sha256(raw.encode()).hexdigest()[:16]


def graph_part(
    item: QuestionBankItem,
    problem_points: int,
    rules: list[dict[str, Any]],
) -> GraphPart | None:
    """`item`'s graph part on a homework where it is worth
    `problem_points`, under the homework's `rules`. None — graded whole,
    as before — when the question doesn't require a drawing, has no
    current checklist, its writer read it as asking for none, or the
    problem has no room for a graph part (under 2 points)."""
    stored = current_checklist(item)
    if not item.requires_drawing or not stored or stored.get("asks_for_drawing") is False:
        return None
    if problem_points < 2:
        return None
    items = fit_checklist(
        stored_items(stored),
        int(stored.get("points") or problem_points),
        problem_points,
        rules,
    )
    # An item fitted to 0 points (more items than the graph part has
    # points) can't earn or lose anything: it isn't checked.
    items = [i for i in items if i.points > 0]
    if not items or sum(i.points for i in items) >= problem_points:
        return None
    return GraphPart(items=items, points=problem_points)


# (base64, media type) of one image; a file is one or more of them.
Image = tuple[str, str]


def page_images(files: list[dict[str, Any]]) -> list[list[Image]]:
    """The images of each uploaded file, in the reader's page order: the
    reader numbers files, so `page_index` N is file N. A photo is one
    image; a PDF is one image per page (the reader saw all of them under
    one page number); anything else has none."""
    out: list[list[Image]] = []
    for f in files:
        data, media_type = _strip_data_url_prefix(f.get("data", ""), f.get("media_type", "image/jpeg"))
        if media_type == "application/pdf":
            out.append([(page, "image/jpeg") for page in pdf_pages_as_images(data)])
        elif media_type.startswith("image/"):
            out.append([(data, media_type)])
        else:
            out.append([])
    return out


@dataclass
class ProblemGraphCheck:
    """The drawing check for one problem. `note`: "not_drawn" when the
    reader recorded no drawing and no look found one; "failed" when the
    check raised; else None."""

    step: str
    in_view: str
    items: list[ItemResult] = field(default_factory=list)
    note: str | None = None

    def stored(self, part: GraphPart) -> dict[str, Any]:
        """The shape kept on `SubmissionGrade.graph_checks[problem_id]`.

        The checklist is frozen with its verdicts, so the review page
        shows what the grade was charged against even after the teacher
        edits the checklist. `teacher`: her ✓ ("yes") or ✗ ("no") on an
        unclear item (`set_teacher_verdict`); `overridden`: she changed
        the problem's score by hand, so its unclear items no longer wait
        on her (`note_hand_edits`)."""
        return {
            "checklist_key": part.key,
            "points": part.points,
            "step": self.step,
            "in_view": self.in_view,
            "note": self.note,
            "overridden": False,
            "items": [
                {"n": r.n, "text": i.text, "points": i.points, "rule_id": i.rule_id,
                 "verdict": r.verdict, "seen": r.seen, "teacher": None}
                for i, r in zip(part.items, self.items, strict=True)
            ],
        }

    @classmethod
    def from_stored(cls, stored: dict[str, Any]) -> ProblemGraphCheck:
        """The check a stored one recorded, without the teacher's calls:
        a regrade re-applies the drawing check, not her review."""
        return cls(
            str(stored.get("step") or "none"), str(stored.get("in_view") or "not_found"),
            [ItemResult(int(i["n"]), i["verdict"], str(i.get("seen") or "")) for i in stored.get("items") or []],
            stored.get("note"),
        )


def _all(items: list[ChecklistItem], verdict: str, seen: str) -> list[ItemResult]:
    return [ItemResult(n, verdict, seen) for n in range(1, len(items) + 1)]  # type: ignore[arg-type]


def _page_number(value: Any, pages: int) -> int | None:
    if isinstance(value, int) and not isinstance(value, bool) and 1 <= value <= pages:
        return value
    return None


def uploads_look_sideways(pages: list[list[Image]]) -> bool:
    """Any page of the upload lying on its side. A student photographs
    every page the same way, and the drawing page itself is often too
    sparse for `page_looks_sideways` to read, so one sideways page counts
    for the whole upload."""
    return any(page_looks_sideways(data) for imgs in pages for data, _ in imgs)


def _doubt_noes(results: list[ItemResult], sideways: bool) -> list[ItemResult]:
    """On a sideways upload a "no" is unclear: the check can misread a
    sideways grid's axes (8 of its 13 wrong "no"s on correct drawings in
    the Oct 2026 eval), so the teacher decides. A "yes" stands."""
    if not sideways:
        return results
    return [
        ItemResult(r.n, "unclear", f"{r.seen} {_SIDEWAYS}".strip()) if r.verdict == "no" else r
        for r in results
    ]


async def check_problem_drawing(
    extraction: dict[str, Any],
    pages: list[list[Image]],
    position: int,
    part: GraphPart,
    *,
    sideways: bool = False,
    user_id: str | None = None,
    submission_id: str | None = None,
) -> ProblemGraphCheck | None:
    """Check the drawing for problem `position` against `part`.

    None when the problem is blank (no work, no answer, no drawing, and
    no drawing the reader left untied to a problem): it is
    graded as it always was. A drawing the reader located (a page and a
    box on a one-image page) is cropped there. Otherwise the check looks
    at whole pages, the ones the reader tied to this problem first, until
    one shows the drawing. When none does, every item is unclear, except
    when the reader also recorded no drawing: two looks agree it isn't
    there, so every item is "no". A check that fails is every item
    unclear, for the teacher. On a `sideways` upload (`uploads_look_sideways`)
    every "no" the check returns is unclear (`_doubt_noes`)."""
    visuals = [
        v for v in extraction.get("visual_work") or [] if isinstance(v, dict) and v.get("problem_position") == position
    ]
    # A table of values beside a graph is a drawing too, but the last
    # place to look for the graph.
    drawn = sorted(
        (v for v in visuals if v.get("present", True) is not False),
        key=lambda v: v.get("kind") == "table",
    )
    steps = [s for s in extraction.get("steps") or [] if s.get("problem_position") == position]
    finals = [f for f in extraction.get("final_answers") or [] if f.get("problem_position") == position]
    # A drawing the reader couldn't tie to a problem may be this one's, so
    # the problem isn't blank while one exists: the pages are searched.
    unattributed = any(
        isinstance(v, dict) and v.get("present", True) is not False and not isinstance(v.get("problem_position"), int)
        for v in extraction.get("visual_work") or []
    )
    if not drawn and not steps and not finals and not unattributed:
        return None

    async def look(data: str, media_type: str, bbox: dict[str, Any] | None) -> DrawingCheck:
        return await check_drawing(
            data,
            media_type,
            bbox,
            part.items,
            problem_position=position,
            user_id=user_id,
            submission_id=submission_id,
        )

    located: int | None = None
    try:
        for v in drawn:
            page = _page_number(v.get("page_index"), len(pages)) or (1 if len(pages) == 1 else None)
            if page and isinstance(v.get("bbox"), dict) and len(pages[page - 1]) == 1:
                data, media_type = pages[page - 1][0]
                check = await look(data, media_type, v["bbox"])
                if check.in_view != "not_found":
                    return ProblemGraphCheck(check.step, check.in_view, _doubt_noes(check.items, sideways))
                # Not on the page the reader put it on (its crops and that
                # whole page): the reader's page can be wrong, so hunt the rest.
                located = page
                break
        hinted = [
            n
            for n in dict.fromkeys(_page_number(e.get("page_index"), len(pages)) for e in drawn + steps + finals)
            if n and n != located
        ]
        order = hinted + [n for n in range(1, len(pages) + 1) if n not in hinted and n != located]
        looks = [img for n in order for img in pages[n - 1]][: _MAX_PAGE_LOOKS - (located is not None)]
        for data, media_type in looks:
            check = await look(data, media_type, None)
            if check.in_view != "not_found":
                return ProblemGraphCheck(check.step, check.in_view, _doubt_noes(check.items, sideways))
    except Exception:  # noqa: BLE001 — a failed check is the teacher's call, never a failed grade
        logger.exception("graph check failed submission=%s problem=%s", submission_id, position)
        return ProblemGraphCheck("none", "not_found", _all(part.items, "unclear", _FAILED), note="failed")
    step = "page" if looks or located else "none"
    if not drawn and any(v.get("present") is False for v in visuals):
        return ProblemGraphCheck(step, "not_found", _all(part.items, "no", _NOT_DRAWN), note="not_drawn")
    return ProblemGraphCheck(step, "not_found", _all(part.items, "unclear", _NOT_FOUND))


async def check_graphs(
    extraction: dict[str, Any],
    files: list[dict[str, Any]],
    problems: list[dict[str, Any]],
    *,
    user_id: str | None = None,
    submission_id: str | None = None,
) -> dict[str, ProblemGraphCheck | None]:
    """`check_problem_drawing` for every problem carrying a `graph_part`,
    keyed by bank item id. The files are rendered once for all of them."""
    with_part = [p for p in problems if p.get("graph_part")]
    if not with_part:
        return {}
    # Rendering PDFs and the sideways check are CPU work: off the loop.
    pages = await asyncio.to_thread(page_images, files)
    sideways = await asyncio.to_thread(uploads_look_sideways, pages)
    gate = asyncio.Semaphore(_CHECK_CONCURRENCY)

    async def one(p: dict[str, Any]) -> ProblemGraphCheck | None:
        async with gate:
            return await check_problem_drawing(
                extraction,
                pages,
                p["position"],
                p["graph_part"],
                sideways=sideways,
                user_id=user_id,
                submission_id=submission_id,
            )

    results = await asyncio.gather(*(one(p) for p in with_part))
    return {p["bank_item_id"]: r for p, r in zip(with_part, results, strict=True)}


def combine(entry: dict[str, Any], part: GraphPart, check: ProblemGraphCheck | None) -> dict[str, Any]:
    """One problem's grade from its two parts. `entry` is the grader's
    breakdown entry for the work, already charged in the work part's
    points (`_build_breakdown` with `points` set to `part.work_points`);
    `check` is its drawing check (None: the problem is blank, so nothing
    was drawn). Returns the entry for the whole problem: percent of all
    its points, and a ledger that adds up to it."""
    points, work = part.points, part.work_points
    work_percent = entry["percent"]
    work_deductions = []
    for d in entry["deductions"]:
        # The checklist owns a rule it is linked to; the grader is told not
        # to apply it, and a deduction citing it anyway is given back.
        if d.get("rule_id") in part.linked_rules:
            work_percent += d["points_off"]
        else:
            work_deductions.append({**d, "points_off": d["points_off"] * work / points})
    work_earned = work * min(work_percent, 100.0) / 100

    results = check.items if check else _all(part.items, "no", _NOT_DRAWN)
    graph_earned = 0
    graph_deductions = []
    for item, r in zip(part.items, results, strict=True):
        if r.verdict == "no":
            graph_deductions.append(
                {
                    "points_off": item.points * 100 / points,
                    "reason": f"Graph: {item.text}",
                    "step_ref": None,
                    "rule_id": item.rule_id,
                    "source": "graph_checklist",
                }
            )
        else:
            graph_earned += item.points

    percent = (graph_earned + work_earned) * 100 / points
    return {
        **entry,
        "score_status": "full" if percent >= 100 else "zero" if percent <= 0 else "partial",
        "percent": percent,
        "deductions": work_deductions + graph_deductions,
        "needs_check": any(r.verdict == "unclear" for r in results),
        "graph": {
            "points": part.graph_points,
            "earned": graph_earned,
            "items": [
                {"n": r.n, "text": item.text, "points": item.points, "verdict": r.verdict, "seen": r.seen}
                for item, r in zip(part.items, results, strict=True)
            ],
        },
    }


def apply_graph_parts(
    breakdown: list[dict[str, Any]],
    parts: dict[str, GraphPart],
    checks: dict[str, ProblemGraphCheck | None],
    points: dict[str, int],
) -> tuple[list[dict[str, Any]], float | None]:
    """`combine` every problem in `breakdown` with a graph part, and the
    homework's score over its full `points` ({problem_id: points})."""
    out = [
        combine(e, parts[e["problem_id"]], checks.get(e["problem_id"])) if e["problem_id"] in parts else e
        for e in breakdown
    ]
    return out, weighted_percent(((e["problem_id"], e["percent"]) for e in out), points)


def split_graph_fields(
    combined: list[dict[str, Any]],
    parts: dict[str, GraphPart],
    checks: dict[str, ProblemGraphCheck | None],
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    """The breakdown as the teacher edits it (the `graph` and
    `needs_check` fields `combine` adds lifted off), and each graph
    problem's stored check for `SubmissionGrade.graph_checks`. A blank
    problem (no check) is stored as every item "no"."""
    breakdown, stored = [], {}
    for e in combined:
        entry = {k: v for k, v in e.items() if k not in ("graph", "needs_check")}
        breakdown.append(entry)
        pid = e["problem_id"]
        if pid in parts:
            part = parts[pid]
            check = checks.get(pid) or ProblemGraphCheck(
                "none", "not_found", _all(part.items, "no", _NOT_DRAWN), note="not_drawn",
            )
            stored[pid] = check.stored(part)
    return breakdown, stored


def _effective(item: dict[str, Any]) -> str:
    return str(item.get("teacher") or item["verdict"])


def open_items(stored: dict[str, Any] | None) -> list[dict[str, Any]]:
    """The unclear items still waiting on the teacher: no ✓/✗ from her,
    and she hasn't re-scored the problem by hand."""
    if not stored or stored.get("overridden"):
        return []
    return [i for i in stored.get("items") or [] if i["verdict"] == "unclear" and not i.get("teacher")]


def open_item_count(graph_checks: dict[str, Any] | None) -> int:
    return sum(len(open_items(s)) for s in (graph_checks or {}).values())


class VerdictError(ValueError):
    pass


def set_teacher_verdict(
    entry: dict[str, Any], stored: dict[str, Any], n: int, verdict: str,
) -> None:
    """The teacher's ✓ ("yes") or ✗ ("no") on unclear item `n`, applied
    in place to the problem's breakdown `entry` and its stored check.

    An unclear item kept its points, so ✓ changes no score and ✗ takes
    the item's points off as its own deduction, exactly as a "no" from
    the check would have (`combine`). Changing her mind reverses it. Only
    items the check left unclear take her call: a "yes" or "no" is the
    check's, and a re-scored problem is hers already."""
    if verdict not in ("yes", "no"):
        raise VerdictError("Verdict must be yes or no")
    if stored.get("overridden"):
        raise VerdictError("You've re-scored this problem by hand, so its graph checklist no longer sets its score")
    item = next((i for i in stored.get("items") or [] if i["n"] == n), None)
    if item is None:
        raise VerdictError("No such checklist item")
    if item["verdict"] != "unclear":
        raise VerdictError("Only items the check couldn't decide take your call")
    before, item["teacher"] = _effective(item), verdict
    if before == verdict or (before == "unclear" and verdict == "yes"):
        return
    off = item["points"] * 100 / stored["points"]
    reason = f"Graph: {item['text']}"
    deductions = list(entry.get("deductions") or [])
    if verdict == "no":
        percent = entry["percent"] - off
        deductions.append({"points_off": off, "reason": reason, "step_ref": None,
                           "rule_id": item.get("rule_id"), "source": "graph_checklist"})
    else:
        percent = entry["percent"] + off
        i = next(
            (k for k, d in enumerate(deductions) if d.get("source") == "graph_checklist" and d.get("reason") == reason),
            None,
        )
        if i is not None:
            deductions.pop(i)
    # Snapped to the ends so taking a third off and putting it back lands
    # on 100 again, and the status reads as `combine` would call it.
    percent = 100.0 if percent >= 100 - 1e-6 else 0.0 if percent <= 1e-6 else percent
    entry["percent"] = percent
    entry["score_status"] = "full" if percent >= 100 else "zero" if percent <= 0 else "partial"
    if entry.get("deductions") is not None:
        entry["deductions"] = deductions


def note_hand_edits(
    graph_checks: dict[str, Any] | None,
    before: list[dict[str, Any]] | None,
    after: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """Mark each graph problem whose score the teacher changed by hand
    as `overridden`: her number stands, and its unclear items stop
    waiting on her. A save that keeps the score (feedback, or
    confirming the AI's grade) changes nothing. Returns the new value."""
    if not graph_checks:
        return graph_checks
    old = {e["problem_id"]: e.get("percent") for e in before or []}
    new = {e["problem_id"]: e.get("percent") for e in after}
    out = dict(graph_checks)
    for pid, stored in graph_checks.items():
        a, b = old.get(pid), new.get(pid)
        if stored.get("overridden") or a is None:
            continue
        if b is None or abs(float(a) - float(b)) > 1e-6:
            out[pid] = {**stored, "overridden": True}
    return out
