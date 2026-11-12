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
  - the by-eye verdict for each case (EXPECTED below), and for each figure
    the run drew (BY_EYE, keyed by the figure's fingerprint, so a figure
    that changes must be looked at again): a figure judged wrong that the
    checker passed fails the run;
  - a known-wrong figure per case (NEGATIVES) that the checker must reject,
    so the eval measures the checker rather than trusting it: with the
    checker switched off, most cases fail
    (tests/test_construction_figure_eval.py).

The figure is checked against the problem's agreed reading (two AI
readings checked by code, api/core/geometry/facts.py); each case records
how its reading went (agreed, or why not) for the eval table.

Record one set at a time (SETS below), each under a hard $5 spending cap
(tests/harness/budget.py), and render every figure to PNG:
    HARNESS_LLM_MODE=auto python -m tests.harness.probes.construction_figures --set unit5 --png-dir /tmp/figs
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

# The cases in recording sets, each run under its own spending cap. From
# prod (question_bank_items → units / assignments, read 2026-11-12): one
# geometry teacher's Unit 5 congruent-triangle proofs, her other homework
# (Units 1–3), another teacher's Pythagorean problems, and the two cases
# that also ask for step figures.
SETS: dict[str, list[str]] = {
    "unit5": ["d9f94a62", "589e4a97", "ee6a495e", "dd7ab4c1", "7d8e403c", "f4ac1109"],
    "other_hw": ["985bff41", "05b4947e", "2d01d709", "77195d48", "12c77989", "e87bd653", "49c9fee5",
                 "b1768f86", "099d8962", "29be9c15", "6d780084", "7ef5c01b", "7450aa6e", "2f44f46d"],
    "rest": ["31f9bf18", "d5a862d3"],
    "steps": ["dd7ab4c1-step", "7ef5c01b-step"],
}

# By-eye verdict per case, after looking at every rendered figure:
#   "figure"  — a correct figure must be drawn;
#   "decline" — no faithful figure exists (the problem itself is broken or
#               carries no numbers), so an honest "couldn't draw" is right.
# A "figure" case that isn't drawn is a miss against the 80% bar; its
# reply must not claim a figure.
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
    # ∠NKL is a quarter of ∠JKL, so 2x + 13 = (10x − 4)/4 gives x = 28 and
    # ∠JKL = 276°: the problem's own numbers have no figure.
    "05b4947e": "decline",
}

# The by-eye verdict on every figure the recorded run drew, keyed by case
# (or "<case>-step<n>") and the figure's fingerprint (`fingerprint`):
# "right", or "wrong: <why>". A drawn figure with no verdict for its exact
# fingerprint fails the run until someone looks at it; one judged wrong
# that the checker passed is counted in `wrong_but_passed` and fails it.
BY_EYE: dict[str, tuple[str, str]] = {
    # Looked at 2026-11-12 after the problem-reading redesign (two AI
    # readings checked by code; angle algebra solved from the facts).
    "985bff41": ("6f29d0281571", "right"),  # ∠AOB 61°, ∠BOC 36°, ∠COD 83°; OA, OD opposite
    "2d01d709": ("e27ae6ebc4cb", "right"),  # vertical angles 1 and 3, both 41°
    "d9f94a62": ("edb221230af9", "right"),  # BD bisects ∠ABC and is ⊥ AC
    "589e4a97": ("cc949543b72e", "right"),  # two angle pairs marked; QT, ST unmarked
    "dd7ab4c1": ("2650050a4e9b", "right"),  # BC ≅ DA, BC ∥ AD, diagonal AC
    "7d8e403c": ("9ad64e58b44d", "right"),  # right angles at X, Y; M midpoint; WX ≅ ZY
    "f4ac1109": ("da20aa19f6f6", "right"),  # AB ∥ CD, BC ≅ DA, diagonal AC
    "31f9bf18": ("1299374d877d", "right"),  # 24 × 7 rectangle, diagonal d
    "6d780084": ("07973af286a5", "right"),  # shared hypotenuse BC, right angles A and D, AB = DB
    "7ef5c01b": ("72425e15988b", "right"),  # AB ∥ CD, M midpoint of BC
    "7450aa6e": ("9e89b9643c34", "right"),  # three pairs of equal sides
    "77195d48-step1": ("f841c5afaf9d", "wrong: the side labelled 'bisector' makes the whole 74° with line m"),
    "77195d48-step2": ("8cd2cf284ab5", "right"),  # the bisector at 37° to line m
    "12c77989": ("d2dbbf2d9bbf", "right"),  # similar triangles drawn apart, AB 12, BC 9, DE 8; EF unlabelled
    "099d8962": ("eff508f3d677", "right"),  # WX ≅ YZ, ∠W ≅ ∠Y, ∠X ≅ ∠Z, meeting at V
    "d5a862d3": ("2d5194fc59d7", "right"),  # legs 5 and 12 to scale, hypotenuse 13, b unlabelled
    "dd7ab4c1-step": ("cf16febd6d13", "right"),  # BC ≅ DA, BC ∥ AD, diagonal AC
    "dd7ab4c1-step-step3": ("5fb1cb8338ce", "right"),  # alternate interior angles at A and C
    "e87bd653": ("6d4e00ff5e1d", "right"),  # SAS marks
    "7ef5c01b-step": ("b6ec68ce21d7", "right"),
    "7ef5c01b-step-step4": ("ed6d9dc38966", "right"),  # vertical angles at M
}

# A known-wrong version of each case's figure (a point moved so a given is
# false, a named part removed, the answer printed): the checker must reject
# it. Keys are case ids; the mutation applies to the figure the run drew.
NEGATIVES: dict[str, dict[str, Any]] = {
    "985bff41": {"move": {"D": [4, 3]}},  # OA, OD no longer opposite rays
    "05b4947e": {"move": {"M": [5, 5]}},  # KM no longer bisects ∠JKL
    "2d01d709": {"move": {"D": [3, 4]}},  # ∠1, ∠3 no longer vertical angles
    "29be9c15": {"move": {"D": [9, 3]}},  # p no longer ∥ q
    "d9f94a62": {"move": {"D": [3, 0]}},  # BD neither bisects ∠ABC nor is ⊥ AC
    "589e4a97": {"move": {"S": [6, 1]}},  # ∠QRT ≇ ∠SRT
    "dd7ab4c1": {"move": {"D": [4.5, 0]}},  # BC ≇ DA
    "7d8e403c": {"move": {"M": [3, 0]}},  # M not the midpoint of XY
    "f4ac1109": {"move": {"D": [1.5, 3]}},  # BC ≇ DA
    "31f9bf18": {"side_label": {"AC": "d = 25"}},  # prints the answer
    "d5a862d3": {"side_label": {"BC": "b = 12"}},  # prints the answer
    "6d780084": {"move": {"D": [2, -5]}},  # no right angle at D, AB ≠ DB
    "7ef5c01b": {"move": {"M": [4.5, 1]}},  # M not the midpoint of BC
    "7450aa6e": {"move": {"F": [6.5, 3.5]}},  # AC ≠ DF
    "2f44f46d": {"move": {"E": [5.303, 5]}},  # DE ∦ BC
    "12c77989": {"move": {"F": [5.4, 4]}},  # ∠D ≠ ∠A
    "e87bd653": {"move": {"F": [8.5, 0]}},  # BC ≠ EF
    "099d8962": {"move": {"Z": [0.553, 5]}},  # ∠X ≇ ∠Z
    "dd7ab4c1-step": {"move": {"D": [7, 0]}},  # BC ≇ DA
    "7ef5c01b-step": {"move": {"M": [5, 1.5]}},  # M not the midpoint of BC
}

# A sentence claiming a figure exists, or that a part was drawn.
_CLAIM = re.compile(
    r"\bI've (?:added|updated) (?:a|the) diagram\b"
    r"|\b(?:added|drew|drawn|included|attached)\b[^.]*\b(?:diagram|figure)\b"
    r"|\b(?:connect(?:ed|s)?|join(?:ed|s)?|drew|added|includ(?:ed|es)?|extended)\b[^.]*"
    r"(?:\b[A-Z][0-9]*'*\s+(?:and|to|with)\s+[A-Z][0-9]*'*\b|\b(?:[A-Z][0-9]*'*){2,3}\b|\bdiagonals?\b)"
    r"|\bdiagonals?\s+(?:[A-Z][0-9]*'*){2}\b[^.]*\b(?:appears?|drawn|shown|added|included)\b",
)


def fingerprint(spec: dict[str, Any] | None) -> str:
    """Twelve hex digits that change whenever the figure does."""
    import hashlib

    return hashlib.sha256(json.dumps(spec, sort_keys=True).encode()).hexdigest()[:12]


def mutate(spec: dict[str, Any], change: dict[str, Any]) -> dict[str, Any]:
    """Apply a NEGATIVES entry: {"move": {"D": [x, y]}}, {"drop": ["BD"]}
    (segments, rays or line names), {"label": {"ABC": "47°"}}."""
    out = json.loads(json.dumps(spec))
    for name, xy in (change.get("move") or {}).items():
        out["points"][name] = xy
    for ref in change.get("drop") or []:
        for key in ("segments", "rays"):
            out[key] = [r for r in out.get(key) or [] if r != ref and r[::-1] != ref]
        out["lines"] = [ln for ln in out.get("lines") or [] if ln.get("name") != ref]
    if change.get("label"):
        out["angle_labels"] = {**(out.get("angle_labels") or {}), **change["label"]}
    if change.get("side_label"):
        out["side_labels"] = {**(out.get("side_labels") or {}), **change["side_label"]}
    return out


def load_cases() -> list[dict[str, Any]]:
    return list(json.loads(CORPUS.read_text())["cases"])


_CASE: contextvars.ContextVar[str] = contextvars.ContextVar("construction_case", default="")
# Per case, how each reading of its problem went: [] when agreed, else why not.
_READINGS: contextvars.ContextVar[dict[str, list[list[str]]]] = contextvars.ContextVar("construction_readings")


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
        "figure_facts": proposal.get("figure_facts"),
        "step_facts": proposal.get("step_facts"),
        "readings": _READINGS.get().get(case["id"], []),
        "id": case["id"],
        "request": case["request"],
        "final_answer": proposal.get("final_answer") or case["final_answer"] or "",
        "error": "",
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
    saved = (qbg.redraw_figure, qbc.fetch_source_documents, qbg.read_figure_facts)
    redraws: dict[str, int] = {}
    readings: dict[str, list[list[str]]] = {}
    _READINGS.set(readings)
    real_redraw, real_read = qbg.redraw_figure, qbg.read_figure_facts

    async def counted(*args: Any, **kwargs: Any) -> Any:
        redraws[_CASE.get()] = redraws.get(_CASE.get(), 0) + 1
        return await real_redraw(*args, **kwargs)

    import api.core.geometry.facts as facts_mod

    real_differ = facts_mod.disagreements

    def differ(a: Any, b: Any) -> list[str]:
        out = real_differ(a, b)
        detail.setdefault(_CASE.get(), []).append(out)
        return out

    detail: dict[str, list[list[str]]] = {}

    async def read(*args: Any, **kwargs: Any) -> Any:
        facts, why = await real_read(*args, **kwargs)
        # The teacher sees the plain reason; the eval keeps where they differ.
        where = (detail.get(_CASE.get()) or [[]])[-1]
        readings.setdefault(_CASE.get(), []).append(
            [*why, *(f"differ on {d}" for d in where[:4] if why)],
        )
        return facts, why

    facts_mod.disagreements = differ  # type: ignore[assignment]

    qbg.redraw_figure = counted  # type: ignore[assignment]
    qbg.read_figure_facts = read  # type: ignore[assignment]
    qbc.fetch_source_documents = AsyncMock(return_value=[])  # type: ignore[assignment]
    sem = asyncio.Semaphore(6)

    async def one(c: dict[str, Any]) -> dict[str, Any]:
        async with sem:
            try:
                return await run_case(c)
            except Exception as e:  # a case that can't run fails its checks, not the whole run
                return {
                    "figure_facts": None, "step_facts": None, "readings": readings.get(c["id"], []),
                    "id": c["id"], "request": c["request"], "final_answer": "", "error": repr(e)[:200],
                    "question": c["question"], "reply": "", "figure_spec": None, "figure_svg": None,
                    "step_figures": [],
                }

    try:
        results = await asyncio.gather(*(one(c) for c in cases))
    finally:
        qbg.redraw_figure, qbc.fetch_source_documents, qbg.read_figure_facts = saved  # type: ignore[assignment]
        facts_mod.disagreements = real_differ  # type: ignore[assignment]
        if prev is None:
            os.environ.pop("HARNESS_CASSETTE_DIR", None)
        else:
            os.environ["HARNESS_CASSETTE_DIR"] = prev
    return list(results), redraws


def drawn_figures(result: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    """(BY_EYE key, spec) for every figure the case drew."""
    out = [(result["id"], result["figure_spec"])] if result["figure_svg"] else []
    return out + [(f"{result['id']}-step{sf['step']}", sf["spec"]) for sf in result["step_figures"]]


def verdict(key: str, spec: dict[str, Any]) -> str:
    """The by-eye verdict for this exact figure; "" when nobody looked."""
    sha, said = BY_EYE.get(key, ("", ""))
    return said if sha == fingerprint(spec) else ""


def negative_rejected(result: dict[str, Any]) -> bool | None:
    """The checker rejects the case's known-wrong figure, checked against
    the same reading its figure passed (None: no negative)."""
    import api.core.question_bank_generation as qbg

    change = NEGATIVES.get(result["id"])
    if change is None or not result["figure_spec"] or not result["figure_facts"]:
        return None
    bad = mutate(result["figure_spec"], change)
    _spec, svg, _issues = qbg._check_figure(
        bad, result["question"], final_answer=result["final_answer"], request=result["request"],
        facts=result["figure_facts"],
    )
    return svg is None


def _outcome_ok(result: dict[str, Any], expected: str) -> bool:
    """The case ended the way the by-eye verdict says it should. A case that
    expects a figure may still miss (the bar allows 20% misses) as long as
    the reply doesn't claim one; a "decline" case
    must draw nothing."""
    drew = bool(result["figure_svg"])
    if expected == "figure":
        return drew or not _CLAIM.search(result["reply"])
    return not drew


def checks(result: dict[str, Any]) -> list[CheckResult]:
    """The bar, for one case."""
    drew = bool(result["figure_svg"]) or bool(result["step_figures"])
    expected = EXPECTED.get(result["id"], "figure")
    figures = drawn_figures(result)
    unseen = [k for k, spec in figures if not verdict(k, spec)]
    wrong = [f"{k}: {verdict(k, spec)}" for k, spec in figures if verdict(k, spec).startswith("wrong")]
    out = [
        CheckResult("the case ran", not result["error"], result["error"]),
        CheckResult(
            "no reply claims a figure that wasn't drawn",
            drew or not _CLAIM.search(result["reply"]),
            result["reply"][:160],
        ),
        CheckResult(f"by-eye verdict holds ({expected})", _outcome_ok(result, expected), result["reply"][:160]),
        CheckResult("every drawn figure was looked at", not unseen,
                    ", ".join(f"{k} {fingerprint(s)}" for k, s in figures if k in unseen)),
        CheckResult("no figure judged wrong by eye passed the checker", not wrong, "; ".join(wrong)),
    ]
    rejected = negative_rejected(result)
    if result["figure_svg"]:
        out.append(CheckResult("the checker rejects the case's known-wrong figure", rejected is True,
                               json.dumps(NEGATIVES.get(result["id"]))))
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
        "wrong_but_passed": sum(
            1 for r in results for k, spec in drawn_figures(r) if verdict(k, spec).startswith("wrong")
        ),
        "not_looked_at": sum(1 for r in results for k, spec in drawn_figures(r) if not verdict(k, spec)),
        "negatives_rejected": sum(1 for r in results if negative_rejected(r) is True),
        "false_claims": sum(
            1 for r in results if not (r["figure_svg"] or r["step_figures"]) and _CLAIM.search(r["reply"])
        ),
        "step_figures": sum(len(r["step_figures"]) for r in results),
        "step_figures_moved": moved,
        # The reading: how often the two AI readings were trusted, and why not.
        "readings": sum(len(r["readings"]) for r in results),
        "readings_agreed": sum(1 for r in results for why in r["readings"] if not why),
        "readings_disagreed": sum(
            1 for r in results for why in r["readings"] if any("disagree" in w for w in why)
        ),
        "coverage_gaps": sum(1 for r in results for why in r["readings"] if any("missed" in w for w in why)),
        "unverifiable": sum(
            1 for r in results for why in r["readings"] if any("can't verify" in w for w in why)
        ),
        "reading_failures": {r["id"]: why for r in results for why in r["readings"] if why},
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
    parser.add_argument("--set", choices=sorted(SETS), help="one recording set, under its spending cap")
    parser.add_argument("--cap", type=float, default=5.0, help="the set's spending cap in $")
    args = parser.parse_args()
    from tests.harness.budget import spending_cap

    cases = load_cases()
    if args.set:
        cases = [c for c in cases if c["id"] in SETS[args.set]]
    if args.only:
        cases = [c for c in cases if c["id"] in args.only]
    with spending_cap(args.set or "all", cap_usd=args.cap) as spend:
        results, redraws = asyncio.run(run_all(cases))
    cost = spend.row(problems=len(cases))
    print("COST", json.dumps(cost))
    if spend.stopped:
        print(spend.stopped)
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
            "fingerprints": {k: fingerprint(spec) for k, spec in drawn_figures(r)},
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
        (args.png_dir / "cost.json").write_text(json.dumps(cost, indent=1))


if __name__ == "__main__":
    main()
