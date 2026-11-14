"""GenerationFiguresProbe — generated homework sets deciding their own figures.

Each set is one teacher-style generation request (unit, title, brief) run
through the REAL generation path without a database:
`generate_checked_problems` (generate, draw each figure, check it against
the problem's two agreed readings, one redraw, one replacement round) and
`solve_checked_problems` (solve, drop a figure that prints the answer, read
and check each step figure against the problem's figure, one redraw).
Recorded once against the real model; replays at $0 from its own cassette
dir (tests/test_generation_figure_eval.py runs it in CI).

What it measures (the bars):
  - wrong figures: every drawn figure (question and step) has a by-eye
    verdict (BY_EYE, keyed by fingerprint); none may be "wrong";
  - references to a missing figure: a problem that says "the figure below"
    and has none, must be 0;
  - the enforced rule: a problem that names points (or refers to a figure)
    shipped without a checked figure, must be 0;
  - step consistency: every step figure keeps the problem's points where
    they are and everything the problem's figure draws, 100%;
  - negatives: for each drawn figure a known-wrong version the checker must
    reject (a hand-written NEGATIVES entry for a question figure; a moved
    point for a step figure), so the eval measures the checker;
  - missing figures (EXPECTED says "figure", none drawn) and unwanted ones
    (BY_EYE "unwanted: …"), reported.

Record one set at a time, each under its spending cap, and render every
figure to PNG:
    HARNESS_LLM_MODE=auto python -m tests.harness.probes.generation_figures --set set1 --cap 2.5 --png-dir /tmp/g
Replay ($0):
    HARNESS_LLM_MODE=replay python -m tests.harness.probes.generation_figures
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import math
import os
from pathlib import Path
from typing import Any

_HERE = Path(__file__).resolve().parent.parent
CASSETTE_DIR = _HERE / "_cassettes" / "generation_figures"

SETS: dict[str, dict[str, Any]] = {
    "set1": {
        "unit_name": "Unit 4", "assignment_title": "Congruent Triangles & Circles",
        "brief": "Mix of congruent-triangle proofs and find-the-measure problems (SSS/SAS/ASA/AAS/HL) and "
                 "circle problems (inscribed and central angles, chords, tangents). Include a short word problem "
                 "and one problem that only describes a layout in words.",
    },
    "set2": {
        "unit_name": "Unit 3", "assignment_title": "Parallel Lines, Angle Pairs & Area",
        "brief": "Parallel lines cut by a transversal, angle pairs, polygon angle sums, and areas of composite "
                 "figures, including a floor-plan and a ladder-against-a-wall problem.",
    },
}
COUNT = 8

# By-eye verdict per drawn figure, keyed "set1-p3" (the problem's figure) or
# "set1-p3-step2", with the figure's fingerprint: a figure that changes must
# be looked at again. "right", "wrong: …", "unwanted: …".
BY_EYE: dict[str, tuple[str, str]] = {
    "set1-p1": ("98f255504d99", "right"),  # M's ticks on AM, MC; right angle at M
    "set1-p2": ("e931d838a625", "right"),  # AB ∥ DC arrows, AB ≅ DC ticks (see the note in the PR: the
    # problem proves △ABC ≅ △DCB, which its givens imply only for a rectangle; the figure draws one)
    "set1-p4": ("7faeca401aca", "right"),  # M on AC and BD with each half ticked; AB ≅ CD
    "set1-p5": ("7f1bf39c18e0", "right"),  # BC ∥ DE; AC ≅ AE ticks; arcs at ∠ABC and ∠AED
    "set1-p6": ("86b58ec1e0aa", "right"),  # right angles at D and C; AD ≅ BC ticks
    "set2-p5": ("0ef172ddddd8", "right"),  # right angle at C; AB = 13, AC = 5 labeled, in proportion
}

# Per problem (by the fingerprint of its text), whether a figure should be
# drawn by Ben's rubric ("When to draw"): "figure" or "none".
EXPECTED: dict[str, str] = {
    "e7d71e19e64a": "figure", "86495fd98dee": "figure", "f19f2a454ad0": "figure", "a82476422a9a": "figure",
    "c6959fba65f6": "figure", "0a643caa6304": "figure",
    "181c568b27e0": "figure",  # set1-p3: two tangent segments from an external point (a board sketch); names no points
    "b57d0518763d": "figure",  # set2-p1: parallel lines p, q cut by transversal t; names lines, no points
    "c7d00d408b7d": "figure",  # set2-p4: a floor plan (a board sketch); names no points
    "0169cf2ab7dd": "none", "96aa828a0374": "none",  # a hexagon's angle sum: no shape to show
    "a4cfd8a2a478": "none",  # a regular polygon's exterior angle: no shape to show
}

# A known-wrong version of each drawn question figure (keyed like BY_EYE),
# which the checker must reject: {"move": {"D": [x, y]}}, {"drop": ["BD"]},
# {"label": {"ABC": "47°"}}, {"side_label": {"AB": "9"}}.
NEGATIVES: dict[str, dict[str, Any]] = {
    "set1-p1": {"move": {"M": [3, 0]}},  # M no longer the midpoint, BM not ⊥ AC
    "set1-p2": {"move": {"D": [1, 0]}},  # DC shorter than AB
    "set1-p4": {"move": {"M": [3, 2]}},  # M off AC
    "set1-p5": {"move": {"E": [8, 10]}},  # AE no longer ≅ AC
    "set1-p6": {"move": {"C": [4.5, 3.5]}},  # ∠ACB no longer right
    "set2-p5": {"move": {"B": [0, 8]}},  # AB = 13, AC = 5 out of proportion
}


def fingerprint(x: Any) -> str:
    """Twelve hex digits that change whenever the figure (or text) does."""
    return hashlib.sha256(json.dumps(x, sort_keys=True).encode()).hexdigest()[:12]


def mutate(spec: dict[str, Any], change: dict[str, Any]) -> dict[str, Any]:
    from tests.harness.probes.construction_figures import mutate as m

    return m(spec, change)


async def run_set(name: str, only: list[int] | None = None) -> list[dict[str, Any]]:
    """One set through the real generation path. `only` (1-based problem
    numbers) limits which generated problems go on to be solved."""
    import api.core.question_bank_generation as qbg
    from api.core import step_decomposition

    s = SETS[name]
    step_decomposition._cache.clear()  # replay must not depend on what ran before
    questions = await qbg.generate_checked_problems(
        unit_name=s["unit_name"], count=COUNT, course_name="Geometry", subject="math",
        user_id="00000000-0000-0000-0000-000000000000", images=None, constraint_text=s["brief"],
        assignment_title=s["assignment_title"], params=None, call_metadata=None, job_id=None,
    )
    if only:
        questions = [q for i, q in enumerate(questions, start=1) if i in only]
    questions, solutions = await qbg.solve_checked_problems(
        questions, subject="math", user_id="00000000-0000-0000-0000-000000000000", job_id=None,
    )
    out = []
    for i, (q, sol) in enumerate(zip(questions, solutions), start=1):
        steps = sol.get("steps") or []
        out.append({
            "set": name, "key": f"{name}-p{i}", "text": q.get("text") or "",
            "final_answer": sol.get("final_answer") or "",
            "figure_spec": q.get("figure_spec") if q.get("figure_svg") else None,
            "figure_svg": q.get("figure_svg"), "figure_facts": q.get("figure_facts"),
            "steps": [
                {"step": n, "text": f"{st.get('title', '')}: {st.get('description', '')}",
                 "spec": st.get("figure_spec"), "svg": st.get("figure_svg"), "facts": st.get("figure_facts")}
                for n, st in enumerate(steps, start=1) if isinstance(st, dict)
            ],
        })
    return out


async def run_all(sets: list[str] | None = None) -> list[dict[str, Any]]:
    prev = os.environ.get("HARNESS_CASSETTE_DIR")
    os.environ["HARNESS_CASSETTE_DIR"] = str(CASSETTE_DIR)
    try:
        out: list[dict[str, Any]] = []
        for name in sets or list(SETS):  # one set at a time: the decompose cache is shared
            out += await run_set(name)
        return out
    finally:
        if prev is None:
            os.environ.pop("HARNESS_CASSETTE_DIR", None)
        else:
            os.environ["HARNESS_CASSETTE_DIR"] = prev


def drawn_figures(p: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    """(BY_EYE key, spec) for every figure the problem shows."""
    out = [(p["key"], p["figure_spec"])] if p["figure_svg"] else []
    return out + [(f"{p['key']}-step{st['step']}", st["spec"]) for st in p["steps"] if st["svg"]]


def verdict(key: str, spec: dict[str, Any]) -> str:
    sha, said = BY_EYE.get(key, ("", ""))
    return said if sha == fingerprint(spec) else ""


def _visible(spec: dict[str, Any]) -> dict[str, tuple[float, float]]:
    return {n: (float(x), float(y)) for n, (x, y) in (spec.get("points") or {}).items()}


def step_consistent(question: dict[str, Any], step: dict[str, Any]) -> bool:
    """Read straight from the specs (not the checker's code): every point of
    the problem's figure is in the step figure at the same place, and every
    segment, ray, line and circle it draws is still drawn."""
    qp, sp = _visible(question), _visible(step)
    xs = [x for x, _ in qp.values()] + [y for _, y in qp.values()]
    span = max(xs) - min(xs) if xs else 1.0
    for n, (x, y) in qp.items():
        if n not in sp or math.dist((x, y), sp[n]) > 0.01 * span:
            return False

    def pieces(spec: dict[str, Any]) -> set[Any]:
        from api.core.geometry.dsl import split_points

        segs = {("s", frozenset(split_points(r, 2))) for r in spec.get("segments") or []}
        rays = {("r", tuple(split_points(r, 2))) for r in spec.get("rays") or []}
        lines = {("l", frozenset(ln.get("through") or [])) for ln in spec.get("lines") or []}
        circles = {("c", c.get("center"), c.get("through"), c.get("radius")) for c in spec.get("circles") or []}
        return segs | rays | lines | circles

    return pieces(question) <= pieces(step)


def _moved(spec: dict[str, Any], base: dict[str, Any]) -> dict[str, Any]:
    """A step figure with the problem's first point moved by a fifth of the
    figure's size: a step figure the checker must reject."""
    pts = _visible(base)
    name = sorted(pts)[0]
    xs = [x for x, _ in pts.values()]
    ys = [y for _, y in pts.values()]
    d = 0.2 * max(max(xs) - min(xs), max(ys) - min(ys), 1.0)
    x, y = pts[name]
    return mutate(spec, {"move": {name: [x + d, y + d]}})


def negatives(p: dict[str, Any]) -> dict[str, bool | None]:
    """Per drawn figure: the checker rejects its known-wrong version (None:
    no negative written for a question figure)."""
    import api.core.question_bank_generation as qbg

    out: dict[str, bool | None] = {}
    if p["figure_svg"]:
        change = NEGATIVES.get(p["key"])
        if change is None:
            out[p["key"]] = None
        else:
            _s, svg, _i = qbg._check_figure(mutate(p["figure_spec"], change), p["text"],
                                            final_answer=p["final_answer"], facts=p["figure_facts"])
            out[p["key"]] = svg is None
    for st in p["steps"]:
        if st["svg"] and p["figure_spec"]:
            _s, svg, _i = qbg._check_figure(
                _moved(st["spec"], p["figure_spec"]), p["text"], step_text=st["text"],
                base=p["figure_spec"], facts=st["facts"],
            )
            out[f"{p['key']}-step{st['step']}"] = svg is None
    return out


def summarize(results: list[dict[str, Any]]) -> dict[str, Any]:
    import api.core.question_bank_generation as qbg

    figures = [(k, spec) for p in results for k, spec in drawn_figures(p)]
    said = {k: verdict(k, spec) for k, spec in figures}
    neg = {k: v for p in results for k, v in negatives(p).items()}
    steps_drawn = [(p, st) for p in results for st in p["steps"] if st["svg"]]
    return {
        "problems": len(results),
        "question_figures": sum(1 for p in results if p["figure_svg"]),
        "step_figures": len(steps_drawn),
        "step_figures_emitted": sum(1 for p in results for st in p["steps"] if st["spec"]),
        "wrong": [f"{k}: {v}" for k, v in said.items() if v.startswith("wrong")],
        "unwanted": [f"{k}: {v}" for k, v in said.items() if v.startswith("unwanted")],
        "not_looked_at": [k for k, v in said.items() if not v],
        "missing_reference": [p["key"] for p in results
                              if qbg._FIGURE_REFERENCE.search(p["text"]) and not p["figure_svg"]],
        "rule_broken": [p["key"] for p in results if qbg._lacks_figure({**p, "text": p["text"]}, "math")],
        "steps_inconsistent": [f"{p['key']}-step{st['step']}" for p, st in steps_drawn
                               if not p["figure_spec"] or not step_consistent(p["figure_spec"], st["spec"])],
        "missing_figures": [p["key"] for p in results
                            if EXPECTED.get(fingerprint(p["text"])) == "figure" and not p["figure_svg"]],
        "not_expected": [p["key"] for p in results if fingerprint(p["text"]) not in EXPECTED],
        "negatives_rejected": sum(1 for v in neg.values() if v),
        "negatives_missing": [k for k, v in neg.items() if v is None],
        "negatives_passed": [k for k, v in neg.items() if v is False],
    }


def _png(svg: str, path: Path) -> None:
    import cairosvg

    cairosvg.svg2png(bytestring=svg.replace("currentColor", "#1d2633").encode(), write_to=str(path),
                     output_width=520, background_color="white")


def main() -> None:
    from tests.harness.budget import ledger_from_env, spending_cap

    parser = argparse.ArgumentParser()
    parser.add_argument("--set", choices=sorted(SETS))
    parser.add_argument("--only", nargs="*", type=int)
    parser.add_argument("--cap", type=float, default=2.5)
    parser.add_argument("--png-dir", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    ledger, total = ledger_from_env()
    prev = os.environ.get("HARNESS_CASSETTE_DIR")
    os.environ["HARNESS_CASSETTE_DIR"] = str(CASSETTE_DIR)
    try:
        with spending_cap(f"generation-{args.set or 'all'}", cap_usd=args.cap, ledger=ledger,
                          total_usd=total) as spend:
            if args.set:
                results = asyncio.run(run_set(args.set, args.only))
            else:
                results = asyncio.run(run_all())
    finally:
        if prev is None:
            os.environ.pop("HARNESS_CASSETTE_DIR", None)
        else:
            os.environ["HARNESS_CASSETTE_DIR"] = prev
    cost = spend.row(problems=len(results))
    if args.png_dir:
        args.png_dir.mkdir(parents=True, exist_ok=True)
    for p in results:
        fig = fingerprint(p["figure_spec"]) if p["figure_svg"] else "-"
        print(f"{p['key']:<10} text={fingerprint(p['text'])} fig={fig}"
              f" steps={[(st['step'], fingerprint(st['spec'])) for st in p['steps'] if st['svg']]}"
              f" emitted={[st['step'] for st in p['steps'] if st['spec']]}")
        print("    ", p["text"].replace("\n", " ")[:400])
        if args.png_dir:
            if p["figure_svg"]:
                _png(p["figure_svg"], args.png_dir / f"{p['key']}.png")
            for st in p["steps"]:
                if st["svg"]:
                    _png(st["svg"], args.png_dir / f"{p['key']}-step{st['step']}.png")
    print(json.dumps(summarize(results), indent=1, ensure_ascii=False))
    print("COST", json.dumps(cost))
    if spend.stopped:
        print(spend.stopped)
    if args.out:
        args.out.write_text(json.dumps(results, indent=1, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()
