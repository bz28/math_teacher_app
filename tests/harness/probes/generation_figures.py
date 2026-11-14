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
  - the enforced rule: a problem the AI drafted a figure for (or that
    refers to one) shipped without a checked figure, must be 0;
  - step figures: counted from the solver's own output (emitted) and as
    shown, with why each was dropped. In the recorded run none is shown
    (see tests/test_generation_figure_eval.py), so step consistency (every
    step figure keeps the problem's points where they are and everything
    the problem's figure draws) is checked here only once one is;
  - negatives: for each drawn figure a known-wrong version the checker must
    reject (a hand-written NEGATIVES entry for a question figure; a moved
    point for a step figure), so the eval measures the checker;
  - missing figures (EXPECTED says "figure", none drawn; a target to bring
    down) and unwanted ones (EXPECTED "none" but drawn, or BY_EYE
    "unwanted: …"); set3 holds Ben's NO-figure cases so that bar can fail;
  - every problem in a set distinct.

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
from unittest.mock import patch

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
    # Ben's NO-figure cases, so the "unwanted" bar can fail: each of these
    # problems should ship with no figure.
    "set3": {
        "unit_name": "Unit 6", "assignment_title": "Constructions, Graphs & Solids", "count": 4,
        "brief": "Exactly four problems, one of each: (1) the student constructs the perpendicular bisector of "
                 "a segment with a compass and straightedge; (2) a percent word problem with no shape; (3) graph "
                 "the line y = 2x + 1 and give its intercepts; (4) the volume of a cylinder with radius 3 cm and "
                 "height 5 cm.",
    },
}
COUNT = 8  # problems per set unless the set gives its own "count"


def count_of(name: str) -> int:
    return int(SETS[name].get("count", COUNT))

# By-eye verdict per drawn figure, keyed "set1-p3" (the problem's figure) or
# "set1-p3-step2", with the figure's fingerprint: a figure that changes must
# be looked at again. "right", "wrong: …", "unwanted: …".
BY_EYE: dict[str, tuple[str, str]] = {
    "set1-p1": ("cadc98edaf93", "right"),  # M on AC and BD, each half ticked
    "set1-p2": ("c7e0c0288895", "right"),  # P, Q, R on circle O; inscribed ∠QPR = 37° labeled; radii OQ, OR
    "set1-p5": ("3361ded9636e", "right"),  # AB ∥ CD arrows, E the midpoint of BC ticked, ∠ABE ≅ ∠DCE arcs
    "set1-p6": ("9720b7877131", "right"),  # A, B, C, D on circle O; ∠AOB = 124°, ∠ACD = 31° labeled; ∠AOD 62° drawn
    "set1-p7": ("b4d80fecd623", "right"),  # right angles at D and C marked, AD ≅ BC ticked, shared AB
    "set2-p1": ("a498817f5848", "right"),  # AB ∥ CD, transversal EF with G past F; ∠AEG = 112° as drawn
    "set2-p3": ("b055008a90f7", "right"),  # right angle at C; AB = 17, AC = 8 labeled, in proportion
    "set2-p5": ("5237fe49f692", "right"),  # right angle at C; AB = 15, BC = 9 labeled, AC drawn 12
}

# Per problem (by the fingerprint of its text), whether a figure should be
# drawn by Ben's when-to-draw rule (2026-11-14, `WHEN_TO_DRAW` in
# api/core/assignment_generation.py): "figure" (MUST or SHOULD), "optional"
# (a formula-only shape problem) or "none" (NOT).
EXPECTED: dict[str, str] = {
    # set 1
    "6612b38f698e": "figure",  # p1: a proof about a named arrangement (MUST)
    "4d009383ce43": "figure",  # p2: inscribed and central angles (MUST)
    "df3b2e3390c3": "figure",  # p3: a ladder against a wall (SHOULD); written as a story, no points
    "f49005c8cf74": "optional",  # p4: △PQR ≅ △XYZ, solve for x from matching sides (algebra)
    "bf39fc064dfe": "figure",  # p5: parallel lines and a midpoint, a proof (MUST)
    "4c1df32a2548": "figure",  # p6: central and inscribed angles (MUST)
    "89d2f779ca14": "figure",  # p7: two right triangles on a shared side, a proof (MUST)
    "459859cb76da": "figure",  # p8: a wire from a post to the ground (SHOULD); a story, no points
    # set 2
    "ad8560639f80": "figure",  # p1: parallel lines and a transversal (MUST)
    "e5511552fced": "optional", "6cd0d1f8c203": "optional",  # p3, p5: a right triangle by its formula
    "ae3590ba66ef": "optional", "03057dcd1072": "optional", "5e6634df362b": "optional",  # p2, p4, p7: angle sums
    "2afb65b3ba64": "figure",  # p6: a transversal and co-interior angles (MUST); no points
    "9d29a5fd239e": "figure",  # p8: a floor plan (SHOULD); a story, no points
    # set 3: Ben's NO-figure cases
    "06652fefc9fc": "none",  # p1: the student constructs the perpendicular bisector
    "fe7fcabbe857": "none",  # p2: a percent problem, no shape
    "bdbfe4f4d7bd": "none",  # p3: graph a line (the tool can't draw graphs)
    "0b20295df45a": "none",  # p4: a cylinder's volume (3D)
}

# A known-wrong version of each drawn question figure (keyed like BY_EYE),
# which the checker must reject: {"move": {"D": [x, y]}}, {"drop": ["BD"]},
# {"label": {"ABC": "47°"}}, {"side_label": {"AB": "9"}}.
NEGATIVES: dict[str, dict[str, Any]] = {
    "set1-p1": {"move": {"M": [2.5, 2]}},  # M no longer the midpoint of AC or BD
    "set1-p2": {"move": {"P": [4, 1]}},  # P off circle O
    "set1-p5": {"move": {"E": [4, 2.5]}},  # E off BC, no longer its midpoint
    "set1-p6": {"move": {"D": [2, 5]}},  # D off circle O
    "set1-p7": {"move": {"C": [5, -1]}},  # no right angle at C, BC no longer ≅ AD
    "set2-p1": {"move": {"C": [0, 1]}},  # line CD no longer ∥ AB
    "set2-p3": {"move": {"B": [0, 10]}},  # AB = 17, AC = 8 out of proportion
    "set2-p5": {"move": {"A": [0, 4]}},  # AB = 15, BC = 9 out of proportion
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
    request = qbg.ProblemRequest(
        unit_name=s["unit_name"], course_name="Geometry", subject="math",
        user_id="00000000-0000-0000-0000-000000000000", constraint_text=s["brief"],
        assignment_title=s["assignment_title"],
    )
    questions = await qbg.generate_checked_problems(request, count=count_of(name))
    if only:
        questions = [q for i, q in enumerate(questions, start=1) if i in only]
    # What the solver emitted, before any step figure is checked (and
    # dropped), and why each step figure was dropped.
    emitted: dict[str, list[bool]] = {}
    dropped: dict[str, dict[int, list[str]]] = {}
    real_solve, real_steps = qbg.generate_solutions, qbg._render_step_figures_with_retry

    async def solve(qs: list[dict[str, Any]], **kw: Any) -> list[dict[str, Any]]:
        sols = await real_solve(qs, **kw)
        for q, sol in zip(qs, sols):
            emitted[q.get("text") or ""] = [
                qbg._is_construction(st.get("figure_spec")) for st in sol.get("steps") or [] if isinstance(st, dict)
            ]
        return sols

    async def render(steps: list[Any], **kw: Any) -> Any:
        out, drops, reading = await real_steps(steps, **kw)
        dropped[kw.get("question_text") or ""] = drops
        return out, drops, reading

    with patch.object(qbg, "generate_solutions", solve), patch.object(qbg, "_render_step_figures_with_retry", render):
        questions, solutions = await qbg.solve_checked_problems(
            questions, subject="math", user_id="00000000-0000-0000-0000-000000000000", job_id=None,
            request=request,
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
                 "spec": st.get("figure_spec"), "svg": st.get("figure_svg"), "facts": st.get("figure_facts"),
                 "emitted": n <= len(emitted.get(q.get("text") or "", [])) and emitted[q.get("text") or ""][n - 1],
                 "dropped": dropped.get(q.get("text") or "", {}).get(n)}
                for n, st in enumerate((st for st in steps if isinstance(st, dict)), start=1)
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
        # Counted from the solver's own output, before the checks drop any.
        "step_figures_emitted": sum(1 for p in results for st in p["steps"] if st["emitted"]),
        "step_figures_dropped": {f"{p['key']}-step{st['step']}": "; ".join(st["dropped"] or ["no reason given"])
                                 for p in results for st in p["steps"] if st["emitted"] and not st["svg"]},
        "distinct_problems": len({(p["set"], " ".join(p["text"].split()).casefold()) for p in results}),
        "wrong": [f"{k}: {v}" for k, v in said.items() if v.startswith("wrong")],
        "unwanted": [f"{k}: {v}" for k, v in said.items() if v.startswith("unwanted")]
        + [f"{p['key']}: drawn, but the rule says no figure" for p in results
           if p["figure_svg"] and EXPECTED.get(fingerprint(p["text"])) == "none"],
        "not_looked_at": [k for k, v in said.items() if not v],
        "missing_reference": [p["key"] for p in results
                              if qbg._FIGURE_REFERENCE.search(p["text"]) and not p["figure_svg"]],
        "rule_broken": [p["key"] for p in results if qbg._lacks_figure(p)],
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
              f" emitted={[st['step'] for st in p['steps'] if st['emitted']]}")
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
