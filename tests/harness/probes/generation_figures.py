"""GenerationFiguresProbe — generated homework sets deciding their own figures.

Each set is one teacher-style generation request (unit, title, brief) run
through the REAL generation path without a database:
`generate_checked_problems` (generate: the AI writes each figure problem as
a fact card, code writes its words; draw each figure, check it against the
card, one redraw, one fresh drawing from the card, one replacement round,
else the slot is left out) and `solve_checked_problems` (solve, drop a
figure that prints the answer, read and check each step figure against the
problem's figure, one redraw). Recorded once against the real model;
replays at $0 from its own cassette dir (tests/test_generation_figure_eval.py
runs it in CI once recorded).

The fact-card mode (this PR) is NOT recorded yet: its cassette dir
`_cassettes/generation_figures_cards/` is empty, and the CI test skips until
it is. #998's recordings (the reading mode) no longer apply: the generation
schema and prompt changed. Their 8 drawings are kept, checked against hand
cards at $0, in tests/harness/probes/fact_card_recorded.py.

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
  - every problem in a set distinct;
  - fact cards (this PR): no question figure is read back from the words
    (`question_readings` = 0), every stored card is the author's, no figure
    draws a part the student constructs (`constructed_drawn`, read straight
    from the spec and the stored card, not with fact_card's own code), and
    a slot left out counts as missing (`left_out`). set4 holds the
    who-draws-it cases: auxiliary-line proofs (shown) and constructions.

Record one set at a time, each under its spending cap, and render every
figure to PNG. The shared eval budget comes from ~/.veradic/evals/budget.env
(its ledger and total), sourced first:
    source ~/.veradic/evals/budget.env && HARNESS_LLM_MODE=auto \
        python -m tests.harness.probes.generation_figures --set set4 --cap 0.75 --png-dir /tmp/g
then set3 (--cap 0.25), set2 (--cap 1.25), set1 (--cap 1.5). Look at every
PNG and fill BY_EYE, EXPECTED and NEGATIVES before the CI test can pass.
A real job's brief (Eval 1): export it to JSON (see `load_brief`), then
    ... --brief briefs/job-bd113585.json --set job-bd113585 --cap 0.5
Replay ($0):
    HARNESS_LLM_MODE=replay python -m tests.harness.probes.generation_figures
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import json
import math
import os
from pathlib import Path
from typing import Any
from unittest.mock import patch

from tests.harness.cassette import CassetteMissError

_HERE = Path(__file__).resolve().parent.parent
CASSETTE_DIR = _HERE / "_cassettes" / "generation_figures_cards"

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
    # Who draws it (fact cards): auxiliary lines the figure shows, and
    # constructions the student makes on a figure of the givens.
    "set4": {
        "unit_name": "Unit 5", "assignment_title": "Auxiliary Lines & Constructions", "count": 4,
        "brief": "Exactly four problems, one of each: (1) isosceles triangle ABC with AB = AC; draw the median AD "
                 "and prove angle B is congruent to angle C; (2) parallelogram ABCD; draw diagonal AC and prove "
                 "triangle ABC is congruent to triangle CDA; (3) in isosceles triangle ABC, the student constructs "
                 "the bisector of angle A with a compass and straightedge, meeting BC at D, then proves triangle ABD "
                 "is congruent to triangle ACD; (4) the student constructs the perpendicular bisector of a given "
                 "segment AB with a compass and straightedge.",
    },
}
COUNT = 8  # problems per set unless the set gives its own "count"


class NotRecordedError(CassetteMissError):
    """Replay asked for sets with no recording yet. A CassetteMissError, so a
    caller that already treats a cassette miss as "not recorded" (the
    scorecard) does the same here, and never reports PASS."""

    def __init__(self, missing: list[str]) -> None:
        self.missing = missing
        super().__init__(
            f"generation_figures (fact-card mode) is not recorded yet for {', '.join(missing)}: see the "
            "probe's docstring for the record command (Eval 1 records it)"
        )


def _manifest() -> Path:
    """Which sets are recorded: the cassette file holds every call of every
    set, so set by set is kept here (a set is recorded one run at a time)."""
    return CASSETTE_DIR / "recorded_sets.json"


def missing_sets(sets: list[str] | None = None) -> list[str]:
    """The sets (default: all) with no recording."""
    want = list(sets or SETS)
    try:
        done = set(json.loads(_manifest().read_text())) if (CASSETTE_DIR / "call_claude_json.json").exists() else set()
    except (OSError, ValueError):
        done = set()
    return [name for name in want if name not in done]


def recorded(sets: list[str] | None = None) -> bool:
    """Every requested set (default: all) is recorded."""
    return not missing_sets(sets)


def finished_recording(mode: str | None, only: list[int] | None, stopped: str) -> bool:
    """A run may mark its sets recorded only when it recorded (auto/record),
    ran every problem, and the spending cap never stopped a call: a stopped
    call is swallowed by the app, so the run "finishes" with problems that
    lost their figure or steps, and replaying it would score a cut-short
    run as the real one."""
    return mode in ("auto", "record") and not only and not stopped


def mark_recorded(sets: list[str]) -> None:
    """After a recording run finishes: these sets are now in the cassette."""
    try:
        done = set(json.loads(_manifest().read_text()))
    except (OSError, ValueError):
        done = set()
    _manifest().write_text(json.dumps(sorted(done | set(sets)), indent=1) + "\n")


def load_brief(path: Path) -> str:
    """Register a set from a real generation job's brief (a JSON file), so
    Eval 1 can re-run prod jobs. The probe never reads a database: the
    brief is exported by whoever runs the eval. Fields:
      {"name": "job-bd113585", "course_name": "...", "unit_name": "...",
       "assignment_title": "...", "constraint": "...", "count": 8,
       "source_docs": [{"filename": "ws.pdf", "media_type": "application/pdf",
                        "path": "docs/ws.pdf"}]}
    `path` in a source doc is relative to the brief's folder; a doc may give
    "base64" instead. Returns the set's name."""
    raw = json.loads(Path(path).read_text())
    name = str(raw["name"])
    docs: list[dict[str, str]] = []
    for d in raw.get("source_docs") or []:
        data = d.get("base64") or base64.b64encode((Path(path).parent / d["path"]).read_bytes()).decode()
        docs.append({"filename": str(d.get("filename") or d.get("path") or "doc"),
                     "media_type": str(d["media_type"]), "base64": data})
    SETS[name] = {
        "unit_name": str(raw["unit_name"]), "course_name": str(raw.get("course_name") or "Geometry"),
        "assignment_title": raw.get("assignment_title"), "brief": raw.get("constraint") or "",
        "count": int(raw.get("count") or COUNT), "images": docs or None,
    }
    return name


def count_of(name: str) -> int:
    return int(SETS[name].get("count", COUNT))

# By-eye verdict per drawn figure, keyed "set1-p3" (the problem's figure) or
# "set1-p3-step2", with the figure's fingerprint: a figure that changes must
# be looked at again. "right", "wrong: …", "unwanted: …".
BY_EYE: dict[str, tuple[str, str]] = {
    # Filled in after recording the fact-card mode (none recorded yet).
}

# Per problem (by the fingerprint of its text), whether a figure should be
# drawn by Ben's when-to-draw rule (2026-11-14, `WHEN_TO_DRAW` in
# api/core/assignment_generation.py): "figure" (MUST or SHOULD), "optional"
# (a formula-only shape problem) or "none" (NOT).
EXPECTED: dict[str, str] = {
    # Filled in after recording, by Ben's rule; set4 p1, p2 are "figure"
    # (an auxiliary line shown), p3 "figure" (the givens, never D or AD),
    # p4 "none" or "optional" (only the segment AB to construct on).
}

# A known-wrong version of each drawn question figure (keyed like BY_EYE),
# which the checker must reject: {"move": {"D": [x, y]}}, {"drop": ["BD"]},
# {"label": {"ABC": "47°"}}, {"side_label": {"AB": "9"}}.
NEGATIVES: dict[str, dict[str, Any]] = {
    # Filled in after recording: one known-wrong version per drawn figure.
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
        unit_name=s["unit_name"], course_name=s.get("course_name", "Geometry"), subject="math",
        user_id="00000000-0000-0000-0000-000000000000", constraint_text=s["brief"] or None,
        assignment_title=s["assignment_title"], images=s.get("images"),
    )
    readings: list[str] = []
    real_read = qbg.read_figure_facts

    async def read(text: str, **kw: Any) -> Any:
        if kw.get("step_of") is None:
            readings.append(text)  # a question read back from its words: the card path never should
        return await real_read(text, **kw)

    with patch.object(qbg, "read_figure_facts", read):
        questions = await qbg.generate_checked_problems(request, count=count_of(name))
    left_out = count_of(name) - len(questions)
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

    with (
        patch.object(qbg, "generate_solutions", solve), patch.object(qbg, "_render_step_figures_with_retry", render),
        patch.object(qbg, "read_figure_facts", read),
    ):
        solved, solutions = await qbg.solve_checked_problems(
            questions, subject="math", user_id="00000000-0000-0000-0000-000000000000", job_id=None,
        )
    left_out += len(questions) - len(solved)
    questions = solved
    out = []
    for i, (q, sol) in enumerate(zip(questions, solutions), start=1):
        steps = sol.get("steps") or []
        out.append({
            "set": name, "key": f"{name}-p{i}", "text": q.get("text") or "",
            "final_answer": sol.get("final_answer") or "",
            "figure_spec": q.get("figure_spec") if q.get("figure_svg") else None,
            "figure_svg": q.get("figure_svg"), "figure_facts": q.get("figure_facts"),
            # The AI's own choice (it drafted a figure), for the rule_broken bar.
            "figure_wanted": bool(q.get("figure_wanted")),
            "requires_drawing": bool(q.get("requires_drawing")),
            "card_refused": q.get("card_refused") or [],
            "left_out": left_out if i == 1 else 0, "readings": len(readings) if i == 1 else 0,
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
    """Every set (or `sets`) through the real path. In replay with nothing
    recorded it raises NotRecordedError rather than a cassette miss mid-run, so a
    report reads "not recorded" and an empty result never reads as a pass."""
    missing = missing_sets(sets)
    if os.environ.get("HARNESS_LLM_MODE", "off") == "replay" and missing:
        raise NotRecordedError(missing)
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


def constructed_drawn(p: dict[str, Any]) -> list[str]:
    """Points only the student's construction makes that the problem's
    figure draws, read straight from the stored card and the spec (not with
    fact_card's code): a point named in `constructs` and not in `points`."""
    card, spec = p.get("figure_facts") or {}, p.get("figure_spec") or {}
    shown = set(card.get("points") or [])
    made: set[str] = set()
    for f in card.get("constructs") or []:
        for x in [*(f.get("items") or []), f.get("point") or ""]:
            made |= {c for c in x if c.isupper()}
    return sorted((made - shown) & set(spec.get("points") or {}))


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
        # Fact cards (this PR).
        "question_readings": sum(p.get("readings", 0) for p in results),
        "left_out": sum(p.get("left_out", 0) for p in results),
        "missing_total": len([p for p in results if EXPECTED.get(fingerprint(p["text"])) == "figure"
                              and not p["figure_svg"]]) + sum(p.get("left_out", 0) for p in results),
        "not_author_cards": [p["key"] for p in results if p["figure_svg"]
                             and (p.get("figure_facts") or {}).get("source") != "author"],
        "constructed_drawn": [f"{p['key']}: {constructed_drawn(p)}" for p in results if constructed_drawn(p)],
        "constructs_without_drawing_flag": [p["key"] for p in results
                                            if (p.get("figure_facts") or {}).get("constructs")
                                            and not p.get("requires_drawing")],
        "cards_refused": {p["key"]: p["card_refused"] for p in results if p.get("card_refused")},
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
    parser.add_argument("--set", help=f"one of {sorted(SETS)}, or the name a --brief registers")
    parser.add_argument("--brief", type=Path, action="append", default=[],
                        help="a real job's brief as JSON (see load_brief); repeatable")
    parser.add_argument("--only", nargs="*", type=int)
    parser.add_argument("--cap", type=float, default=2.5)
    parser.add_argument("--png-dir", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    briefs = [load_brief(b) for b in args.brief]
    if args.set and args.set not in SETS:
        parser.error(f"unknown set {args.set!r}")
    ledger, total = ledger_from_env()
    prev = os.environ.get("HARNESS_CASSETTE_DIR")
    os.environ["HARNESS_CASSETTE_DIR"] = str(CASSETTE_DIR)
    try:
        with spending_cap(f"generation-{args.set or 'all'}", cap_usd=args.cap, ledger=ledger,
                          total_usd=total) as spend:
            if args.set:
                results = asyncio.run(run_set(args.set, args.only))
            else:
                results = asyncio.run(run_all(briefs or None))
        if finished_recording(os.environ.get("HARNESS_LLM_MODE"), args.only, spend.stopped):
            mark_recorded([args.set] if args.set else (briefs or list(SETS)))
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
