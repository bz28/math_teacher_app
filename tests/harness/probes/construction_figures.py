"""ConstructionFiguresProbe — the workshop chat drawing geometry figures.

Each case is a real geometry problem from prod where a teacher asked the
workshop chat for a drawing, or whose text points at a figure (corpus:
tests/harness/_corpus/construction_figures.json — problem text, solution and
answer only). The case runs the REAL chat path, `chat_with_bank_item`, with
the teacher's request: the model describes the figure, code draws and checks
it (one retry on the checker's errors), and code writes the sentence about
the figure. Recorded once against the real model; replays at $0 from its own
cassette dir (tests/test_construction_figure_eval.py runs it in CI).

What it measures (the bar from the design doc):
  - correct-by-checker: the figure the teacher sees passed the checker;
  - honesty: no reply claims a figure that wasn't drawn;
  - the by-eye verdict for each case (EXPECTED below), recorded after
    looking at every rendered figure — a figure judged wrong that the
    checker passed would be listed there and fail the run.

Record (costs a few dollars; delete the cassette file first so stale
entries don't linger) and render every figure to PNG:
    HARNESS_LLM_MODE=auto python -m tests.harness.probes.construction_figures --png-dir /tmp/figs
Replay ($0):
    HARNESS_LLM_MODE=replay python -m tests.harness.probes.construction_figures
"""

from __future__ import annotations

import argparse
import asyncio
import contextvars
import json
import os
import re
import uuid
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

from tests.harness.probe import Probe
from tests.harness.types import CheckResult, GeneratedItem, HarnessContext

_HERE = Path(__file__).resolve().parent.parent
CORPUS = _HERE / "_corpus" / "construction_figures.json"
CASSETTE_DIR = _HERE / "_cassettes" / "construction_figures"

# By-eye verdict per case, after looking at every rendered figure:
#   "figure"  — a correct figure must be drawn;
#   "decline" — no faithful figure exists (the problem itself is broken or
#               carries no numbers), so an honest "couldn't draw" is right.
# Every case not listed expects a figure. Verdicts recorded 2026-11-12 after
# looking at every rendered figure of the recorded run.
EXPECTED: dict[str, str] = {
    # "Find the hypotenuse c in the right triangle below" with no lengths at
    # all: there is nothing to draw it from; the chat asks for the legs.
    "49c9fee5": "decline",
    # The statement to prove can't be true: AB ⊥ BE and EC ⊥ BE make B and E
    # the right angles, so △ABM ≅ △ECM would match right angle B with C.
    # (The true statement is △ABM ≅ △CEM.) No faithful figure exists.
    "ee6a495e": "decline",
}

# Figures the checker passed that were judged wrong by eye. Must stay empty.
WRONG_BUT_PASSED: dict[str, str] = {}

# A sentence claiming a figure exists.
_CLAIM = re.compile(
    r"\bI've (?:added|updated) (?:a|the) diagram\b"
    r"|\b(?:added|drew|drawn|included|attached)\b[^.]*\b(?:diagram|figure)\b",
    re.IGNORECASE,
)


def load_cases() -> list[dict[str, Any]]:
    return list(json.loads(CORPUS.read_text())["cases"])


_CASE: contextvars.ContextVar[str] = contextvars.ContextVar("construction_case", default="")


async def run_case(case: dict[str, Any]) -> dict[str, Any]:
    """One teacher request through the real chat path, no database."""
    import api.core.question_bank_chat as qbc

    _CASE.set(case["id"])
    item = SimpleNamespace(
        id=uuid.uuid4(), course_id=uuid.uuid4(), unit_id=None, source_doc_ids=None,
        question=case["question"], solution_steps=case["solution_steps"] or None,
        final_answer=case["final_answer"], generation_prompt=None, chat_messages=[],
        figure_spec=None, figure_svg=None,
    )
    course = SimpleNamespace(subject="math", name="Geometry Honors/Trig")
    db = MagicMock()
    db.commit = AsyncMock()

    msg = await qbc.chat_with_bank_item(
        db, item, course, teacher_message=case["request"], user_id=uuid.UUID(int=0),  # type: ignore[arg-type]
    )
    proposal = msg.get("proposal") or {}
    steps = proposal.get("solution_steps") or []
    return {
        "id": case["id"],
        "question": proposal.get("question") or case["question"],
        "reply": msg["text"],
        "figure_spec": proposal.get("figure_spec"),
        "figure_svg": proposal.get("figure_svg"),
        "step_figures": [
            {"step": i, "spec": s.get("figure_spec"), "svg": s.get("figure_svg")}
            for i, s in enumerate(steps, start=1) if isinstance(s, dict) and s.get("figure_svg")
        ],
    }


async def run_all(cases: list[dict[str, Any]] | None = None) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Every case, in the cassette dir. HARNESS_LLM_MODE picks record/replay."""
    import api.core.question_bank_chat as qbc
    import api.core.question_bank_generation as qbg

    cases = cases if cases is not None else load_cases()
    prev = os.environ.get("HARNESS_CASSETTE_DIR")
    os.environ["HARNESS_CASSETTE_DIR"] = str(CASSETTE_DIR)
    saved = (qbg.redraw_figure, qbc.fetch_source_documents)
    redraws: dict[str, int] = {}
    real_redraw = qbg.redraw_figure

    async def counted(*args: Any, **kwargs: Any) -> Any:
        redraws[_CASE.get()] = redraws.get(_CASE.get(), 0) + 1
        return await real_redraw(*args, **kwargs)

    qbg.redraw_figure = counted  # type: ignore[assignment]
    qbc.fetch_source_documents = AsyncMock(return_value=[])  # type: ignore[assignment]
    sem = asyncio.Semaphore(6)

    async def one(c: dict[str, Any]) -> dict[str, Any]:
        async with sem:
            return await run_case(c)

    try:
        results = await asyncio.gather(*(one(c) for c in cases))
    finally:
        qbg.redraw_figure, qbc.fetch_source_documents = saved  # type: ignore[assignment]
        if prev is None:
            os.environ.pop("HARNESS_CASSETTE_DIR", None)
        else:
            os.environ["HARNESS_CASSETTE_DIR"] = prev
    return list(results), redraws


def checks(result: dict[str, Any]) -> list[CheckResult]:
    """The bar, for one case."""
    drew = bool(result["figure_svg"]) or bool(result["step_figures"])
    expected = EXPECTED.get(result["id"], "figure")
    out = [
        CheckResult(
            "no reply claims a figure that wasn't drawn",
            drew or not _CLAIM.search(result["reply"]),
            result["reply"][:160],
        ),
        CheckResult(
            f"by-eye verdict holds ({expected})",
            bool(result["figure_svg"]) == (expected == "figure"),
            result["reply"][:160],
        ),
        CheckResult(
            "no figure judged wrong by eye passed the checker",
            not (result["figure_svg"] and result["id"] in WRONG_BUT_PASSED),
            WRONG_BUT_PASSED.get(result["id"], ""),
        ),
    ]
    if result["figure_svg"]:
        # The reply names only points that are drawn.
        named = re.search(r"with points ([A-Z0-9', ]+?)(?: and ([A-Z][0-9]*'*))?(?:,|;|\.)", result["reply"])
        visible = {n for n in (result["figure_spec"] or {}).get("points", {}) if not n.startswith("_")}
        if named:
            said = set(re.findall(r"[A-Z][0-9]*'*", named.group(0).removeprefix("with points")))
            out.append(CheckResult("the reply names only drawn points", said <= visible, str(said - visible)))
    return out


def summarize(results: list[dict[str, Any]], redraws: dict[str, int]) -> dict[str, Any]:
    """The eval table: how many figures were drawn, first try or after the
    one retry, the honest declines, and the step figures."""
    want = [r for r in results if EXPECTED.get(r["id"], "figure") == "figure"]
    drawn = [r for r in want if r["figure_svg"]]
    moved = [r["id"] for r in results if "is not where the question's figure puts it" in r["reply"]]
    return {
        "cases": len(results),
        "expect_figure": len(want),
        "drawn": len(drawn),
        "first_try": sum(1 for r in drawn if not redraws.get(r["id"])),
        "after_retry": sum(1 for r in drawn if redraws.get(r["id"])),
        "declined_correctly": sum(
            1 for r in results if EXPECTED.get(r["id"]) == "decline" and not r["figure_svg"]
        ),
        "wrong_but_passed": len(WRONG_BUT_PASSED),
        "false_claims": sum(
            1 for r in results if not (r["figure_svg"] or r["step_figures"]) and _CLAIM.search(r["reply"])
        ),
        "step_figures": sum(len(r["step_figures"]) for r in results),
        "step_figures_moved": moved,
    }


class ConstructionFiguresProbe(Probe):
    name = "construction-figures"
    needs_browser = False
    default_constraint = "Prod geometry problems: the workshop chat draws each figure on request."

    def relevant_paths(self) -> list[str]:
        return [
            "api/core/geometry/",
            "api/core/construction_figures.py",
            "api/core/question_bank_chat.py",
            "api/core/question_bank_generation.py",
            "tests/harness/probes/construction_figures.py",
        ]

    def capability_spec(self) -> str:
        return (
            "Drawing a geometry figure for a homework problem on a teacher's request: points, "
            "segments, rays, named lines, circles, arcs, tick marks, angle arcs, right-angle boxes, "
            "parallel arrows and labels, checked against the problem's givens and the statement "
            "to prove, with the chat's sentence about the figure written by code."
        )

    async def generate(self, ctx: HarnessContext, constraint: str | None = None) -> list[GeneratedItem]:
        results, _ = await run_all()
        return [
            GeneratedItem(
                id=r["id"], label=r["id"], problem_text=r["question"],
                figure_svg=r["figure_svg"], figure_spec=r["figure_spec"], raw=r,
            )
            for r in results
        ]

    def deterministic_checks(self, item: GeneratedItem) -> list[CheckResult]:
        return checks(item.raw)


def _png(svg: str, path: Path) -> None:
    import cairosvg

    cairosvg.svg2png(
        bytestring=svg.replace("currentColor", "#1d2633").encode(), write_to=str(path),
        output_width=520, background_color="white",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--png-dir", type=Path)
    parser.add_argument("--only", nargs="*")
    args = parser.parse_args()
    cases = load_cases()
    if args.only:
        cases = [c for c in cases if c["id"] in args.only]
    results, redraws = asyncio.run(run_all(cases))
    if args.png_dir:
        args.png_dir.mkdir(parents=True, exist_ok=True)
    report = []
    for r in results:
        verdicts = checks(r)
        if args.png_dir:
            if r["figure_svg"]:
                _png(r["figure_svg"], args.png_dir / f"{r['id']}.png")
            for sf in r["step_figures"]:
                _png(sf["svg"], args.png_dir / f"{r['id']}-step{sf['step']}.png")
        report.append({
            "id": r["id"], "figure": bool(r["figure_svg"]), "steps_drawn": [s["step"] for s in r["step_figures"]],
            "redraws": redraws.get(r["id"], 0), "reply": r["reply"],
            "failed_checks": [c.name for c in verdicts if not c.passed], "spec": r["figure_spec"],
        })
        print(f"{r['id']:<14} fig={'Y' if r['figure_svg'] else '-'} steps={[s['step'] for s in r['step_figures']]} "
              f"redraws={redraws.get(r['id'], 0)} fails={[c.name for c in verdicts if not c.passed]}")
        print("    ", r["reply"].replace("\n", " ")[:300])
    summary = summarize(results, redraws)
    print(json.dumps(summary, indent=1))
    if args.png_dir:
        (args.png_dir / "report.json").write_text(json.dumps(report, indent=1, ensure_ascii=False))
        (args.png_dir / "summary.json").write_text(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
