"""DrawingEvalProbe — is the zoomed second look worth its cost?

The drawings channel reads a page twice: the full-page extraction (the
"first read") inventories each drawing, then `verify_visual_work` crops
and enlarges each one and REPLACES the inventory with what the crop shows
(the "second look"). The second look exists because the first read is
primed by the algebra beside a graph (PR #902: one line drawn, both
equations written → "2 lines plotted").

This probe measures that on synthetic pages with known ground truth, and
runs an ablation: the SAME first-read extraction graded twice — once with
the raw first-read inventory, once with the verified one.

Decision rules (fixed before any result was seen; see the PR body):
  - Keep the second look if, on the flagged-problem drawings, it corrects
    at least one first-read inventory error AND introduces no new error
    (wrong count, lost drawing, or false "unconfirmed") — with n this
    small, "fixes the one failure mode it exists for, breaks nothing" is
    the only threshold the data can support.
  - Propose removing it if it changes nothing on any case.
  - If the first read MISSES a drawn graph on a flagged problem, the
    grader's missing-drawing deduction is unsafe and must become a
    low-confidence flag instead.

Budget: the founder capped live spend at $1 for the whole PR, so this is
4 pages, 1 run each (priority b > c > h > a). It replays at $0 from its
own committed cassette directory (the shared vision cassette is a
gitignored local cache).

Cases (ground truth is exact — we drew the page):
  b  one of two lines drawn, both equations + algebra written beside it
  c  no graph drawn on a required-graph problem, algebra present
  h  two-column proof on an UNflagged problem — must yield no drawings
  a  both lines drawn, intersection circled and labeled
"""

from __future__ import annotations

import base64
import copy
import io
import json
import os
import random
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from api.core import integrity_ai
from api.core.drawing_requirement import requires_drawing
from api.core.grading_ai import grade_submission_with_ai
from tests.harness.probe import Probe
from tests.harness.types import CheckResult, GeneratedItem, HarnessContext

_CASSETTE_DIR = Path(__file__).resolve().parent.parent / "_cassettes" / "drawing_eval"
_HAND_FONTS = (
    "/System/Library/Fonts/Supplemental/Bradley Hand Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
)
_SYSTEM = "Solve the system by graphing. Identify the solution as an ordered pair. y = 2x - 1 and y = -x + 5"
_PROOF = (
    "Given: M is the midpoint of AC and BD. Prove: triangle AMB is congruent to "
    "triangle CMD. Write a two-column proof."
)
# Graph box on the 1000x1300 source page, before degradation.
_GRAPH_BOX = (520, 200, 940, 620)
_PAGE = (1000, 1300)


@dataclass
class EvalCase:
    name: str
    question: str
    answer: str
    written: list[str]
    lines: list[tuple[float, float]] = field(default_factory=list)  # (slope, intercept) drawn
    mark: tuple[int, int] | None = None  # circled + labeled point
    proof_grid: list[tuple[str, str]] | None = None
    truth: dict[str, Any] = field(default_factory=dict)
    grade: bool = True


CASES: list[EvalCase] = [
    EvalCase(
        name="b-one-of-two-lines",
        question=_SYSTEM, answer="(2, 3)",
        written=["1.  y = 2x - 1", "    y = -x + 5", "    2x - 1 = -x + 5", "    3x = 6", "    x = 2, y = 3",
                 "    (2, 3)"],
        lines=[(2, -1)],
        truth={"flagged": True, "present": True, "lines": 1, "labeled": [], "answer_on_drawing": None},
    ),
    EvalCase(
        name="c-no-graph-drawn",
        question=_SYSTEM, answer="(2, 3)",
        written=["1.  y = 2x - 1", "    y = -x + 5", "    2x - 1 = -x + 5", "    x = 2", "    y = 3",
                 "    (2, 3)"],
        truth={"flagged": True, "present": False, "lines": 0, "labeled": [], "answer_on_drawing": None},
    ),
    EvalCase(
        name="h-unflagged-two-column-proof",
        question=_PROOF, answer="Triangle AMB is congruent to triangle CMD by SAS.",
        written=["1."],
        proof_grid=[
            ("Statements", "Reasons"),
            ("M midpt of AC, BD", "Given"),
            ("AM = MC, BM = MD", "Def. midpoint"),
            ("<AMB = <CMD", "Vertical angles"),
            ("AMB = CMD", "SAS"),
        ],
        truth={"flagged": False, "present": None, "lines": 0},
        grade=False,
    ),
    EvalCase(
        name="a-both-lines",
        question=_SYSTEM, answer="(2, 3)",
        written=["1.  y = 2x - 1", "    y = -x + 5", "    (2, 3)"],
        lines=[(2, -1), (-1, 5)], mark=(2, 3),
        truth={"flagged": True, "present": True, "lines": 2, "labeled": ["(2, 3)"],
               "answer_on_drawing": "(2, 3)"},
    ),
]


def _font(size: int) -> Any:
    for path in _HAND_FONTS:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _pen(d: ImageDraw.ImageDraw, pts: list[tuple[float, float]], rng: random.Random, width: int = 4) -> None:
    """A slightly wobbly pen stroke through `pts`."""
    jittered = [(x + rng.uniform(-1.5, 1.5), y + rng.uniform(-1.5, 1.5)) for x, y in pts]
    d.line(jittered, fill=(28, 30, 70), width=width, joint="curve")


def render_page(case: EvalCase, seed: int = 7) -> tuple[str, str]:
    """Lined paper, handwriting, a hand-drawn graph, then phone-photo
    degradation (slight rotation, uneven light, blur, JPEG)."""
    rng = random.Random(seed)
    w, h = _PAGE
    img = Image.new("RGB", (w, h), (250, 249, 243))
    d = ImageDraw.Draw(img)
    for y in range(90, h, 48):
        d.line([(30, y), (w - 30, y)], fill=(200, 212, 232), width=2)
    f = _font(34)
    y = 110
    for line in case.written:
        d.text((60 + rng.randint(-3, 3), y + rng.randint(-2, 2)), line, font=f, fill=(30, 32, 64))
        y += 48

    if case.lines or case.truth.get("present"):
        x0, y0, x1, y1 = _GRAPH_BOX
        cx, cy, unit = (x0 + x1) / 2, (y0 + y1) / 2, 30
        _pen(d, [(x0, cy), (x1, cy)], rng, 3)
        _pen(d, [(cx, y0), (cx, y1)], rng, 3)
        for k in range(-6, 7):
            _pen(d, [(cx + k * unit, cy - 5), (cx + k * unit, cy + 5)], rng, 2)
            _pen(d, [(cx - 5, cy - k * unit), (cx + 5, cy - k * unit)], rng, 2)
        for m, b in case.lines:
            pts = []
            for i in range(0, 41):
                gx = -6 + i * 0.3
                gy = m * gx + b
                if -6.5 <= gy <= 6.5:
                    pts.append((cx + gx * unit, cy - gy * unit))
            _pen(d, pts, rng, 4)
        if case.mark:
            mx, my = cx + case.mark[0] * unit, cy - case.mark[1] * unit
            d.ellipse([mx - 11, my - 11, mx + 11, my + 11], outline=(28, 30, 70), width=3)
            d.text((mx + 14, my - 36), f"({case.mark[0]},{case.mark[1]})", font=_font(28), fill=(30, 32, 64))

    if case.proof_grid:
        gx0, gy0, colw, rowh = 60, 170, 440, 60
        for r, (left, right) in enumerate(case.proof_grid):
            top = gy0 + r * rowh
            d.text((gx0 + 10, top + 12), left, font=_font(30), fill=(30, 32, 64))
            d.text((gx0 + colw + 10, top + 12), right, font=_font(30), fill=(30, 32, 64))
            _pen(d, [(gx0, top + rowh), (gx0 + 2 * colw, top + rowh)], rng, 2)
        _pen(d, [(gx0 + colw, gy0), (gx0 + colw, gy0 + rowh * len(case.proof_grid))], rng, 2)

    img = img.rotate(1.3, resample=Image.BICUBIC, expand=False, fillcolor=(235, 232, 225))
    shade = Image.new("L", (w, h))
    sd = ImageDraw.Draw(shade)
    for x in range(w):
        sd.line([(x, 0), (x, h)], fill=int(255 - 40 * (x / w)))
    img = Image.composite(img, Image.new("RGB", (w, h), (170, 165, 150)), shade)
    img = img.filter(ImageFilter.GaussianBlur(0.7)).resize((int(w * 0.8), int(h * 0.8)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=62)
    return base64.b64encode(buf.getvalue()).decode("ascii"), "image/jpeg"


def _graph_center_norm() -> tuple[float, float]:
    x0, y0, x1, y1 = _GRAPH_BOX
    return ((x0 + x1) / 2 / _PAGE[0], (y0 + y1) / 2 / _PAGE[1])


def _bbox_contains_graph(bbox: Any) -> bool | None:
    if not isinstance(bbox, dict):
        return None
    try:
        cx, cy = _graph_center_norm()
        return float(bbox["x0"]) <= cx <= float(bbox["x1"]) and float(bbox["y0"]) <= cy <= float(bbox["y1"])
    except (KeyError, TypeError, ValueError):
        return None


def _summ(v: dict[str, Any]) -> dict[str, Any]:
    return {
        "position": v.get("problem_position"), "kind": v.get("kind"), "present": v.get("present"),
        "plotted": len([e for e in v.get("plotted_elements") or [] if isinstance(e, str) and e.strip()]),
        "plotted_elements": v.get("plotted_elements"), "labeled_points": v.get("labeled_points"),
        "answer_on_drawing": v.get("answer_on_drawing"), "bbox": v.get("bbox"),
        "verified": v.get("verified"), "unconfirmed": v.get("unconfirmed"),
        "description": v.get("description"),
    }


async def _llm_costs_since(started: float) -> tuple[float | None, list[dict[str, Any]]]:
    """Per-call cost and latency from the llm_calls log (live runs only)."""
    try:
        import asyncio
        from datetime import UTC, datetime

        # The llm_calls row is persisted fire-and-forget; give it a moment
        # or the last call of a case is attributed to nobody.
        await asyncio.sleep(2.0)

        from sqlalchemy import select

        from api.database import get_session_factory
        from api.models.llm_call import LLMCall

        since = datetime.fromtimestamp(started, UTC)
        async with get_session_factory()() as s:
            rows = (await s.execute(
                select(LLMCall).where(LLMCall.created_at >= since).order_by(LLMCall.created_at)
            )).scalars().all()
        calls = [{
            "phase": (r.call_metadata or {}).get("phase"), "cost_usd": r.cost_usd,
            "latency_ms": r.latency_ms, "in": r.input_tokens, "out": r.output_tokens,
        } for r in rows]
        return round(sum(c["cost_usd"] or 0 for c in calls), 4), calls
    except Exception:  # noqa: BLE001 — reporting only
        return None, []


class DrawingEvalProbe(Probe):
    name = "drawing-eval"
    needs_browser = False
    default_constraint = (
        "Synthetic handwritten pages with known drawings. Measures the first read vs "
        "the zoomed second look, and grades the same extraction with and without it."
    )

    def relevant_paths(self) -> list[str]:
        return [
            "api/core/integrity_ai.py",
            "api/core/drawing_requirement.py",
            "tests/harness/probes/drawing_eval.py",
        ]

    def capability_spec(self) -> str:
        return (
            "Reading a student's hand-drawn graph off a homework photo: whether a "
            "drawing is present, how many lines are actually drawn, what points are "
            "labeled, and whether an answer is marked on it — only on problems that "
            "require a drawing."
        )

    async def generate(
        self, ctx: HarnessContext, constraint: str | None = None,
    ) -> list[GeneratedItem]:
        prev_dir = os.environ.get("HARNESS_CASSETTE_DIR")
        os.environ["HARNESS_CASSETTE_DIR"] = str(_CASSETTE_DIR)
        try:
            return [await self._run_case(c) for c in CASES]
        finally:
            if prev_dir is None:
                os.environ.pop("HARNESS_CASSETTE_DIR", None)
            else:
                os.environ["HARNESS_CASSETTE_DIR"] = prev_dir

    async def _run_case(self, case: EvalCase) -> GeneratedItem:
        problems = [{
            "position": 1, "question": case.question, "final_answer": case.answer,
            "requires_drawing": requires_drawing(case.question),
        }]
        b64, media = render_page(case)
        first_read: dict[str, Any] = {}
        real_verify = integrity_ai.verify_visual_work
        verify_ms: list[float] = []

        async def snapshot_then_verify(extraction: dict[str, Any], *a: Any, **k: Any) -> None:
            first_read.update(copy.deepcopy(extraction))
            t = time.monotonic()
            await real_verify(extraction, *a, **k)
            verify_ms.append((time.monotonic() - t) * 1000)

        started = time.time()
        t0 = time.monotonic()
        integrity_ai.verify_visual_work = snapshot_then_verify  # type: ignore[assignment]
        try:
            verified = await integrity_ai.extract_student_work_from_pages(
                [{"data": b64, "media_type": media}], problems=problems,
            )
        finally:
            integrity_ai.verify_visual_work = real_verify  # type: ignore[assignment]
        total_ms = (time.monotonic() - t0) * 1000

        grades: dict[str, Any] = {}
        if case.grade:
            for path, ext in (("first_read_only", first_read), ("with_second_look", verified)):
                res = await grade_submission_with_ai(ext, problems, None)
                g = (res.get("grades") or [{}])[0]
                grades[path] = {
                    k: g.get(k) for k in ("score_status", "percent", "confidence", "reasoning", "deductions")
                }
        cost, calls = await _llm_costs_since(started)

        raw = {
            "case": case.name, "truth": case.truth, "flagged": problems[0]["requires_drawing"],
            "first_read": [_summ(v) for v in first_read.get("visual_work") or []],
            "second_look": [_summ(v) for v in verified.get("visual_work") or []],
            "final_answers": verified.get("final_answers"),
            "grades": grades,
            "latency_ms": {"extract_plus_verify": round(total_ms), "verify": round(sum(verify_ms))},
            "cost_usd": cost, "calls": calls,
        }
        for v in raw["first_read"]:
            v["bbox_contains_drawing"] = _bbox_contains_graph(v.get("bbox"))
        out_dir = os.environ.get("DRAWING_EVAL_OUT")
        if out_dir:
            Path(out_dir).mkdir(parents=True, exist_ok=True)
            (Path(out_dir) / f"{case.name}.json").write_text(json.dumps(raw, indent=2, default=str))
        return GeneratedItem(
            id=case.name, label=f"[drawing] {case.name}", problem_text=case.question,
            figure_svg=None, figure_spec=None, raw=raw,
        )

    def deterministic_checks(self, item: GeneratedItem) -> list[CheckResult]:
        truth = item.raw["truth"]
        final = [v for v in item.raw["second_look"] if v.get("present")]
        checks: list[CheckResult] = []
        if not truth["flagged"]:
            ok = item.raw["second_look"] == []
            checks.append(CheckResult(
                "unflagged problem produces no drawings", ok,
                "" if ok else f"got {item.raw['second_look']}",
            ))
            return checks
        if truth["present"]:
            counts = [v["plotted"] for v in final]
            ok = counts == [truth["lines"]] or any(v.get("unconfirmed") for v in final)
            checks.append(CheckResult(
                f"final inventory has {truth['lines']} line(s) or is honestly unconfirmed (got {counts})",
                ok, "" if ok else f"inventory {final}",
            ))
        else:
            wrong = [v for v in final if v["plotted"] > 0 and not v.get("unconfirmed")]
            checks.append(CheckResult(
                "no drawing is credited on a page with no graph", not wrong,
                "" if not wrong else f"credited {wrong}",
            ))
        return checks

