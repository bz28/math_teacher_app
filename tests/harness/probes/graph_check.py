"""GraphCheckProbe — does the drawing check say what is actually drawn?

`check_drawing` judges a student's graph against a checklist, item by
item. The failure it exists to stop is over-credit: the full-page reader
described the graph the student meant, and the grader gave full credit to
wrong graphs. So the guard that matters most here is "never yes for a
feature that isn't drawn", including when the student WROTE the feature
in their work beside the graph (case written-not-drawn).

Synthetic pages with exact ground truth: we draw f(x) = 1/(x - 2) + 1, or
a deliberately wrong version of it, and straight lines a little wrong or
with no scale (where sketch tolerance stops), on lined paper with phone-photo
degradation. The checklist is fixed, so the probe measures the check, not
the checklist writer.

Replays at $0 from its own committed cassette dir.
"""

from __future__ import annotations

import base64
import io
import os
import random
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFilter

from api.core.drawing_check import ChecklistItem, check_drawing
from tests.harness.probe import Probe
from tests.harness.probes.drawing_eval import _font
from tests.harness.types import CheckResult, GeneratedItem, HarnessContext

_CASSETTE_DIR = Path(__file__).resolve().parent.parent / "_cassettes" / "graph_check"
_PAGE = (1000, 1300)
_BOX = (430, 420, 950, 940)  # where the graph is drawn, in page pixels
_UNIT_RANGE = 6  # axes run -6..6

CHECKLIST = [
    ChecklistItem("Vertical asymptote drawn at x = 2", 2),
    ChecklistItem("Horizontal asymptote drawn at y = 1", 2),
    ChecklistItem("Both asymptotes labeled", 1),
    ChecklistItem("Two branches: one upper-right and one lower-left of where the asymptotes cross", 2),
    ChecklistItem("The curve crosses the x-axis at (1, 0)", 1),
]
# The line cases test where sketch tolerance stops: read off a scale, a
# slope or a crossing one tick out is wrong; with no scale, a value can't
# be read, so it is unclear unless what can be seen is wrong.
LINE_CHECKLIST = [
    ChecklistItem("The line crosses the y-axis at (0, -1)", 2),
    ChecklistItem("The line has slope 2", 2),
]


@dataclass
class GraphCase:
    name: str
    # truth[i] for CHECKLIST item i+1: "yes", "no", or None (don't score)
    truth: list[str | None]
    va: float | None = 2.0
    ha: float | None = 1.0
    label_va: bool = True
    label_ha: bool = True
    branches: tuple[str, ...] = ("right", "left")
    written: list[str] = field(default_factory=lambda: ["4.  f(x) = 1/(x - 2) + 1", "    VA: x = 2", "    HA: y = 1",
                                                        "    x-int: (1, 0)"])
    draw_graph: bool = True
    faint: bool = False
    # Box handed to the check, as page fractions. None = the true box.
    bbox: dict[str, float] | None = None
    # (slope, y-intercept): draw this line instead of f, judged on LINE_CHECKLIST.
    line: tuple[float, float] | None = None
    # False: the axes have no tick marks or numbers.
    ticks: bool = True

    @property
    def checklist(self) -> list[ChecklistItem]:
        return LINE_CHECKLIST if self.line else CHECKLIST


CASES: list[GraphCase] = [
    GraphCase("correct", truth=["yes", "yes", "yes", "yes", "yes"]),
    GraphCase("unlabeled-horizontal-asymptote", label_ha=False, truth=["yes", "yes", "no", "yes", "yes"]),
    # Shifted one unit: asymptote and crossing in the wrong place.
    GraphCase("wrong-vertical-asymptote", va=3.0, truth=["no", "yes", None, None, "no"]),
    GraphCase("one-branch", branches=("right",), truth=["yes", "yes", "yes", "no", "no"]),
    # The student wrote "HA: y = 1" in the work but never drew it. The
    # written value must not earn the drawn feature.
    GraphCase("written-not-drawn", ha=None, label_ha=False, truth=["yes", "no", "no", "yes", "yes"]),
    GraphCase("no-graph", draw_graph=False, truth=[None] * 5),
    GraphCase("faint", faint=True, truth=["yes", "yes", "yes", "yes", "yes"]),
    # The reader's box points at the written work, not the graph: the check
    # must widen or fall back to the page and still judge the graph.
    GraphCase("box-misses-graph", bbox={"x0": 0.04, "y0": 0.06, "x1": 0.4, "y1": 0.3},
              truth=["yes", "yes", "yes", "yes", "yes"]),
    # truth "unclear": the only right answer is unclear.
    GraphCase("line-correct", line=(2, -1), written=["4.  y = 2x - 1"], truth=["yes", "yes"]),
    GraphCase("line-slope-3-not-2", line=(3, -1), written=["4.  y = 2x - 1"], truth=["yes", "no"]),
    GraphCase("line-intercept-one-tick-off", line=(2, -2), written=["4.  y = 2x - 1"], truth=["no", "yes"]),
    GraphCase("line-no-scale", line=(2, -1), ticks=False, written=["4.  y = 2x - 1"], truth=["unclear", "unclear"]),
    GraphCase("line-no-scale-wrong-side", line=(2, 3), ticks=False, written=["4.  y = 2x - 1"], truth=["no", None]),
]


def _f(x: float, va: float) -> float:
    return 1 / (x - va) + 1


def render(case: GraphCase, seed: int = 7) -> str:
    rng = random.Random(seed)
    w, h = _PAGE
    img = Image.new("RGB", (w, h), (250, 249, 243))
    d = ImageDraw.Draw(img)
    ink = (28, 30, 70) if not case.faint else (150, 152, 175)

    def pen(pts: list[tuple[float, float]], width: int = 3, dashed: bool = False) -> None:
        pts = [(x + rng.uniform(-1.2, 1.2), y + rng.uniform(-1.2, 1.2)) for x, y in pts]
        if not dashed:
            d.line(pts, fill=ink, width=width, joint="curve")
            return
        for i in range(0, len(pts) - 1, 2):
            d.line([pts[i], pts[i + 1]], fill=ink, width=width)

    for y in range(90, h, 48):
        d.line([(30, y), (w - 30, y)], fill=(200, 212, 232), width=2)
    f = _font(32)
    for i, line in enumerate(case.written):
        d.text((60 + rng.randint(-3, 3), 110 + 48 * i), line, font=f, fill=ink)

    if case.draw_graph:
        x0, y0, x1, y1 = _BOX
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        unit = (x1 - x0) / (2 * _UNIT_RANGE + 1)

        def P(gx: float, gy: float) -> tuple[float, float]:  # noqa: N802 — graph → page
            return cx + gx * unit, cy - gy * unit

        pen([(x0, cy), (x1, cy)])
        pen([(cx, y0), (cx, y1)])
        small = _font(18)
        for t in range(-_UNIT_RANGE, _UNIT_RANGE + 1):
            if t == 0 or not case.ticks:
                continue
            tx, _ = P(t, 0)
            pen([(tx, cy - 5), (tx, cy + 5)], 2)
            d.text((tx - 6, cy + 8), str(t), font=small, fill=ink)
            _, ty = P(0, t)
            pen([(cx - 5, ty), (cx + 5, ty)], 2)
            d.text((cx - 26, ty - 9), str(t), font=small, fill=ink)
        label = _font(22)
        if case.line:
            m, b = case.line
            xs = [x / 10 for x in range(-10 * _UNIT_RANGE, 10 * _UNIT_RANGE + 1)]
            pen([P(x, m * x + b) for x in xs if abs(m * x + b) <= _UNIT_RANGE], 3)
        if case.va is not None and not case.line:
            vx, _ = P(case.va, 0)
            pen([(vx, y) for y in [y0 + k * 12 for k in range(int((y1 - y0) / 12))]], 2, dashed=True)
            if case.label_va:
                d.text((vx + 6, y0 + 4), f"x={case.va:g}", font=label, fill=ink)
        if case.ha is not None and not case.line:
            _, hy = P(0, case.ha)
            pen([(x, hy) for x in [x0 + k * 12 for k in range(int((x1 - x0) / 12))]], 2, dashed=True)
            if case.label_ha:
                d.text((x0 + 8, hy - 32), f"y={case.ha:g}", font=label, fill=ink)
        va = case.va if case.va is not None else 2.0
        for side in case.branches if not case.line else ():
            xs = ([va + 0.08 + i * 0.05 for i in range(160)] if side == "right"
                  else [va - 0.08 - i * 0.05 for i in range(160)])
            pts = [P(x, _f(x, va)) for x in xs if abs(x) <= _UNIT_RANGE and abs(_f(x, va)) <= _UNIT_RANGE]
            pen(pts, 3)

    img = img.rotate(1.1, resample=Image.BICUBIC, expand=False, fillcolor=(235, 232, 225))
    shade = Image.new("L", (w, h))
    sd = ImageDraw.Draw(shade)
    for x in range(w):
        sd.line([(x, 0), (x, h)], fill=int(255 - 36 * (x / w)))
    img = Image.composite(img, Image.new("RGB", (w, h), (170, 165, 150)), shade)
    img = img.filter(ImageFilter.GaussianBlur(1.6 if case.faint else 0.7))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=70)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _true_bbox() -> dict[str, float]:
    x0, y0, x1, y1 = _BOX
    return {"x0": x0 / _PAGE[0], "y0": y0 / _PAGE[1], "x1": x1 / _PAGE[0], "y1": y1 / _PAGE[1]}


class GraphCheckProbe(Probe):
    name = "graph-check"
    needs_browser = False
    default_constraint = (
        "Synthetic graphs with known features, judged against a fixed checklist: "
        "never yes for a feature that isn't drawn."
    )

    def relevant_paths(self) -> list[str]:
        return [
            "api/core/drawing_check.py",
            "api/core/image_utils.py",
            "tests/harness/probes/graph_check.py",
        ]

    def capability_spec(self) -> str:
        return (
            "Judging a student's hand drawing against a checklist of features: "
            "yes only when the feature is drawn, no when it is missing or wrong, "
            "unclear when the image can't settle it."
        )

    async def generate(self, ctx: HarnessContext, constraint: str | None = None) -> list[GeneratedItem]:
        only = {c for c in os.environ.get("GRAPH_CHECK_CASES", "").split(",") if c}
        prev = os.environ.get("HARNESS_CASSETTE_DIR")
        os.environ["HARNESS_CASSETTE_DIR"] = str(_CASSETTE_DIR)
        try:
            return [await self._run(c) for c in CASES if not only or c.name in only]
        finally:
            if prev is None:
                os.environ.pop("HARNESS_CASSETTE_DIR", None)
            else:
                os.environ["HARNESS_CASSETTE_DIR"] = prev

    async def _run(self, case: GraphCase) -> GeneratedItem:
        result = await check_drawing(
            render(case), "image/jpeg", case.bbox or _true_bbox(), case.checklist, problem_position=4,
        )
        raw: dict[str, Any] = {
            "case": case.name,
            "truth": case.truth,
            "step": result.step,
            "in_view": result.in_view,
            "items": [asdict(i) for i in result.items],
            "draw_graph": case.draw_graph,
            "items_expected": len(case.checklist),
        }
        return GeneratedItem(
            id=case.name, label=f"[graph-check] {case.name}", problem_text="Graph f(x) = 1/(x - 2) + 1",
            figure_svg=None, figure_spec=None, raw=raw,
        )

    def deterministic_checks(self, item: GeneratedItem) -> list[CheckResult]:
        """Conservative on purpose: "unclear" is never a failure (it sends
        the item to the teacher), only a verdict that contradicts the drawing."""
        raw = item.raw
        verdicts = [i["verdict"] for i in raw["items"]]
        checks = [CheckResult(
            "one verdict per checklist item", len(verdicts) == raw["items_expected"], f"got {len(verdicts)}",
        )]
        if not raw["draw_graph"]:
            ok = all(v == "unclear" for v in verdicts)
            checks.append(CheckResult("no drawing: every item left to the teacher", ok, f"verdicts {verdicts}"))
            return checks
        false_yes = [n for n, (t, v) in enumerate(zip(raw["truth"], verdicts, strict=True), 1)
                     if t == "no" and v == "yes"]
        checks.append(CheckResult(
            "never yes for a feature that isn't drawn", not false_yes,
            "" if not false_yes else f"items {false_yes}: {[raw['items'][n - 1] for n in false_yes]}",
        ))
        false_no = [n for n, (t, v) in enumerate(zip(raw["truth"], verdicts, strict=True), 1)
                    if t == "yes" and v == "no"]
        checks.append(CheckResult(
            "never no for a feature that is drawn", not false_no,
            "" if not false_no else f"items {false_no}: {[raw['items'][n - 1] for n in false_no]}",
        ))
        not_unclear = [n for n, (t, v) in enumerate(zip(raw["truth"], verdicts, strict=True), 1)
                       if t == "unclear" and v != "unclear"]
        checks.append(CheckResult(
            "unclear when the value can't be read", not not_unclear,
            "" if not not_unclear else f"items {not_unclear}: {[raw['items'][n - 1] for n in not_unclear]}",
        ))
        return checks

