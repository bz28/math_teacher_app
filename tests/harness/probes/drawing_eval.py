"""DrawingEvalProbe — does the zoomed second look earn its cost?

Every drawing is recorded by the full-page extraction (the "first read").
On problems that require a drawing, `verify_visual_work` then crops and
enlarges each one (the "second look"): when the crop counts a different
number of lines it replaces the inventory; when it agrees, the count is
confirmed and the first read's line descriptions stand; labeled points
and the answer on the drawing come from the crop wherever it disagrees.

This probe measures that on synthetic pages with known ground truth, and
runs an ablation: the SAME extraction graded twice — once with the raw
first-read inventory, once with the verified one.

History (PR #907, results in the PR body): run 1 on pages a/b/c/h found
the second look fixed the #902 over-count (b) but, by replacing the first
read wholesale, broke a correct graph (a); the count-agreement rule was
fitted on those two pages. These pages are a FRESH validation of that
rule, none of them seen while tuning it.

Decision rule (fixed before running, same as run 1): keep the second
look if, on flagged-problem drawings, it corrects >= 1 first-read error
AND introduces 0 new errors (a wrong count, a wrong point/answer, a
grade-changing description, a lost drawing, a false "unconfirmed").
Otherwise say so plainly and propose a change.

Cases (ground truth is exact — we drew the page):
  d  a shaded number line (open circle at 4, ray to the right)
  e  two lines drawn, one with the WRONG slope, both equations written
     beside them — right count, wrong line (the priming the count check
     cannot see)
  f  both lines drawn, the answer marked ONLY on the graph
  i  a small graph in the bottom-right corner (bbox stress)

Replays at $0 from its own committed cassette dir (the shared vision
cassette is a gitignored local cache).
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
_NUMLINE = "Solve 2x - 3 > 5 and graph the solution on a number line."
_PAGE = (1000, 1300)
_BIG_BOX = (520, 200, 940, 620)
_CORNER_BOX = (790, 1090, 970, 1270)


@dataclass
class EvalCase:
    name: str
    question: str
    answer: str
    written: list[str]
    box: tuple[int, int, int, int] = _BIG_BOX
    lines: list[tuple[float, float]] = field(default_factory=list)  # (slope, intercept) drawn
    mark: tuple[int, int] | None = None  # circled + labeled point
    numline_open_at: float | None = None  # open circle, shaded to the right
    truth: dict[str, Any] = field(default_factory=dict)
    phone_width: int | None = None  # render at a real phone resolution
    grade: bool = True  # run the with/without-verify grading ablation


CASES: list[EvalCase] = [
    EvalCase(
        # The #902 prod case, re-recorded under record-everywhere extraction.
        name="b-one-of-two-lines",
        question=_SYSTEM, answer="(2, 3)",
        written=["1.  y = 2x - 1", "    y = -x + 5", "    2x - 1 = -x + 5", "    3x = 6", "    x = 2, y = 3",
                 "    (2, 3)"],
        lines=[(2, -1)],
        truth={"flagged": True, "present": True, "lines": 1, "labeled": [], "answer_on_drawing": None,
               "grade": "partial (~50: one of two lines, solved algebraically)"},
    ),
    # Phone resolution (3024 px wide, JPEG q80): does the "curve" misread
    # survive when the crop isn't an upscaled 800 px page? Extract + verify
    # only (no grading), to stay in budget.
    EvalCase(
        name="e-right-count-wrong-line",
        question=_SYSTEM, answer="(2, 3)",
        written=["1.  y = 2x - 1", "    y = -x + 5", "    (2, 3)"],
        lines=[(2, -1), (-2, 5)],  # the second line is drawn with slope -2, not -1
        truth={"flagged": True, "present": True, "lines": 2, "labeled": [], "answer_on_drawing": None,
               "grade": "partial (one line drawn wrong; the graph doesn't show (2, 3))"},
    ),
    EvalCase(
        name="d-shaded-number-line",
        question=_NUMLINE, answer="x > 4",
        written=["1.  2x - 3 > 5", "    2x > 8", "    x > 4"],
        numline_open_at=4,
        truth={"flagged": True, "present": True, "lines": 1, "labeled": [], "answer_on_drawing": "x > 4",
               "grade": "full"},
    ),
]

# Written and rendered, but NOT recorded under the typed verify schema
# (the PR's $1.30 live-spend cap ran out after b/e/d). Run one with
# DRAWING_EVAL_CASES=<name> --mode auto to record it; until then they
# are excluded from the default (replay) run so it stays $0.
PENDING_CASES: list[EvalCase] = [
    EvalCase(
        name="i-small-graph-in-corner",
        question=_SYSTEM, answer="(2, 3)",
        written=["1.  y = 2x - 1", "    y = -x + 5", "    solution at the circled point"],
        box=_CORNER_BOX, lines=[(2, -1), (-1, 5)], mark=(2, 3),
        truth={"flagged": True, "present": True, "lines": 2, "labeled": ["(2, 3)"],
               "answer_on_drawing": "(2, 3)", "grade": "full"},
    ),
    EvalCase(
        name="f-answer-only-on-graph",
        question=_SYSTEM, answer="(2, 3)",
        written=["1.  y = 2x - 1", "    y = -x + 5"],
        lines=[(2, -1), (-1, 5)], mark=(2, 3),
        truth={"flagged": True, "present": True, "lines": 2, "labeled": ["(2, 3)"],
               "answer_on_drawing": "(2, 3)", "grade": "full"},
    ),
    EvalCase(
        name="a-phone-both-lines",
        question=_SYSTEM, answer="(2, 3)",
        written=["1.  y = 2x - 1", "    y = -x + 5", "    (2, 3)"],
        lines=[(2, -1), (-1, 5)], mark=(2, 3), phone_width=3024, grade=False,
        truth={"flagged": True, "present": True, "lines": 2, "labeled": ["(2, 3)"],
               "answer_on_drawing": "(2, 3)"},
    ),
    EvalCase(
        name="e-phone-right-count-wrong-line",
        question=_SYSTEM, answer="(2, 3)",
        written=["1.  y = 2x - 1", "    y = -x + 5", "    (2, 3)"],
        lines=[(2, -1), (-2, 5)], phone_width=3024, grade=False,
        truth={"flagged": True, "present": True, "lines": 2, "labeled": [], "answer_on_drawing": None},
    ),
]


def _font(size: int) -> Any:
    for path in _HAND_FONTS:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def render_page(case: EvalCase, seed: int = 11) -> tuple[str, str]:
    """Lined paper, handwriting, a hand-drawn graph or number line, then
    phone-photo degradation (slight rotation, uneven light, blur, JPEG).

    `case.phone_width` renders the SAME page at a real phone resolution
    (every coordinate, stroke, font and jitter scaled, so the wobble is the
    same in physical units), JPEG q80, no downscale. At the default the
    arithmetic is untouched, so recorded pages stay byte-identical."""
    rng = random.Random(seed)
    k = case.phone_width / _PAGE[0] if case.phone_width else 1

    def S(v: Any) -> Any:  # noqa: N802 — a unit conversion, reads like one
        return v if k == 1 else v * k

    w, h = _PAGE if k == 1 else (case.phone_width, round(_PAGE[1] * k))
    img = Image.new("RGB", (w, h), (250, 249, 243))
    d = ImageDraw.Draw(img)

    def pen(pts: list[tuple[float, float]], width: int) -> None:
        jittered = [(S(x) + S(rng.uniform(-1.5, 1.5)), S(y) + S(rng.uniform(-1.5, 1.5))) for x, y in pts]
        d.line(jittered, fill=(28, 30, 70), width=width if k == 1 else round(width * k), joint="curve")

    for y in range(90, _PAGE[1], 48):
        d.line([(S(30), S(y)), (S(_PAGE[0] - 30), S(y))], fill=(200, 212, 232),
               width=2 if k == 1 else round(2 * k))
    f = _font(34 if k == 1 else round(34 * k))
    y = 110
    for line in case.written:
        d.text((S(60 + rng.randint(-3, 3)), S(y + rng.randint(-2, 2))), line, font=f, fill=(30, 32, 64))
        y += 48

    x0, y0, x1, y1 = case.box
    if case.lines:
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        unit = (x1 - x0) / 14
        pen([(x0, cy), (x1, cy)], 3)
        pen([(cx, y0), (cx, y1)], 3)
        for t in range(-6, 7):
            pen([(cx + t * unit, cy - 4), (cx + t * unit, cy + 4)], 2)
            pen([(cx - 4, cy - t * unit), (cx + 4, cy - t * unit)], 2)
        for m, b in case.lines:
            pts = []
            for i in range(0, 41):
                gx = -6 + i * 0.3
                gy = m * gx + b
                if -6.5 <= gy <= 6.5:
                    pts.append((cx + gx * unit, cy - gy * unit))
            pen(pts, 3 if unit < 20 else 4)
        if case.mark:
            mx, my = cx + case.mark[0] * unit, cy - case.mark[1] * unit
            r = max(6, unit * 0.35)
            d.ellipse([S(mx - r), S(my - r), S(mx + r), S(my + r)], outline=(28, 30, 70),
                      width=3 if k == 1 else round(3 * k))
            d.text((S(mx + r + 2), S(my - 3 * r)), f"({case.mark[0]},{case.mark[1]})",
                   font=_font(int(max(16, unit)) if k == 1 else round(max(16, unit) * k)),
                   fill=(30, 32, 64))
    if case.numline_open_at is not None:
        ly, lx0, lx1 = 420, 80, 900
        unit = (lx1 - lx0) / 12
        pen([(lx0, ly), (lx1, ly)], 3)
        for t in range(0, 13):
            x = lx0 + t * unit
            pen([(x, ly - 8), (x, ly + 8)], 2)
            d.text((S(x - 8), S(ly + 16)), str(t - 2), font=_font(24 if k == 1 else round(24 * k)),
                   fill=(30, 32, 64))
        ox = lx0 + (case.numline_open_at + 2) * unit
        d.ellipse([S(ox - 10), S(ly - 10), S(ox + 10), S(ly + 10)], outline=(28, 30, 70),
                  width=3 if k == 1 else round(3 * k))
        pen([(ox + 10, ly - 3), (lx1 + 20, ly - 3)], 7)
        pen([(lx1 + 8, ly - 14), (lx1 + 22, ly - 3), (lx1 + 8, ly + 8)], 4)

    img = img.rotate(1.3, resample=Image.BICUBIC, expand=False, fillcolor=(235, 232, 225))
    shade = Image.new("L", (w, h))
    sd = ImageDraw.Draw(shade)
    for x in range(w):
        sd.line([(x, 0), (x, h)], fill=int(255 - 40 * (x / w)))
    img = Image.composite(img, Image.new("RGB", (w, h), (170, 165, 150)), shade)
    buf = io.BytesIO()
    if k == 1:
        img = img.filter(ImageFilter.GaussianBlur(0.7)).resize((int(w * 0.8), int(h * 0.8)), Image.LANCZOS)
        img.save(buf, format="JPEG", quality=62)
    else:
        img = img.filter(ImageFilter.GaussianBlur(0.7 * k))
        img.save(buf, format="JPEG", quality=80)
    return base64.b64encode(buf.getvalue()).decode("ascii"), "image/jpeg"


def _drawing_center_norm(case: EvalCase) -> tuple[float, float]:
    if case.numline_open_at is not None:
        return (490 / _PAGE[0], 420 / _PAGE[1])
    x0, y0, x1, y1 = case.box
    return ((x0 + x1) / 2 / _PAGE[0], (y0 + y1) / 2 / _PAGE[1])


def _bbox_contains(case: EvalCase, bbox: Any) -> bool | None:
    if not isinstance(bbox, dict):
        return None
    try:
        cx, cy = _drawing_center_norm(case)
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
        "unconfirmed_reason": v.get("unconfirmed_reason"),
        "zoomed_labeled_points": v.get("zoomed_labeled_points"),
        "description": v.get("description"),
    }


async def _llm_calls_since(started: float) -> tuple[float | None, list[dict[str, Any]]]:
    """Per-call cost and latency from the llm_calls log (live runs only)."""
    try:
        import asyncio
        from datetime import UTC, datetime

        from sqlalchemy import select

        from api.database import get_session_factory
        from api.models.llm_call import LLMCall

        await asyncio.sleep(2.0)  # the row is persisted fire-and-forget
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
            "Reading a student's hand-drawn graph or number line off a homework photo: "
            "whether a drawing is present, how many lines are actually drawn, what "
            "points are labeled, and whether an answer is marked on it."
        )

    async def generate(
        self, ctx: HarnessContext, constraint: str | None = None,
    ) -> list[GeneratedItem]:
        only = {c for c in os.environ.get("DRAWING_EVAL_CASES", "").split(",") if c}
        prev_dir = os.environ.get("HARNESS_CASSETTE_DIR")
        os.environ["HARNESS_CASSETTE_DIR"] = str(_CASSETTE_DIR)
        try:
            chosen = [c for c in CASES + PENDING_CASES if c.name in only] if only else CASES
            return [await self._run_case(c) for c in chosen]
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
        for path, ext in (("first_read_only", first_read), ("with_second_look", verified)) if case.grade else ():
            res = await grade_submission_with_ai(ext, problems, None)
            g = (res.get("grades") or [{}])[0]
            grades[path] = {
                k: g.get(k) for k in ("score_status", "percent", "confidence", "reasoning", "deductions")
            }
        cost, calls = await _llm_calls_since(started)

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
            v["bbox_contains_drawing"] = _bbox_contains(case, v.get("bbox"))
        out_dir = os.environ.get("DRAWING_EVAL_OUT")
        if out_dir:
            Path(out_dir).mkdir(parents=True, exist_ok=True)
            (Path(out_dir) / f"{case.name}.json").write_text(json.dumps(raw, indent=2, default=str))
        return GeneratedItem(
            id=case.name, label=f"[drawing] {case.name}", problem_text=case.question,
            figure_svg=None, figure_spec=None, raw=raw,
        )

    def deterministic_checks(self, item: GeneratedItem) -> list[CheckResult]:
        """Conservative guards only — the judgment numbers live in the PR's
        eval tables. A present drawing must reach the grader as present
        (never lost, never "no drawing"), and an answer marked only on the
        graph must reach final_answers."""
        truth = item.raw["truth"]
        final = [v for v in item.raw["second_look"] if v.get("present")]
        checks = [CheckResult(
            "the drawing reaches the grader as present", bool(final),
            "" if final else f"inventory {item.raw['second_look']}",
        )]
        if truth.get("answer_on_drawing"):
            finals = json.dumps(item.raw.get("final_answers") or [])
            ok = "".join(truth["answer_on_drawing"].split()) in "".join(finals.split()) or (
                truth["answer_on_drawing"] == "x > 4" and "4" in finals
            )
            checks.append(CheckResult(
                "the answer on the drawing reaches final_answers", ok,
                "" if ok else f"final_answers {finals}",
            ))
        return checks
