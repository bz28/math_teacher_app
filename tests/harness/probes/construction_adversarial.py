"""The reviewer's adversarial wordings (PR #989, review round 1): each
problem is read by the real two-reading step (api/core/geometry/facts.py,
recorded once against the real model), then a CORRECT figure and a WRONG
one are checked against the agreed reading. The wrong one must never pass
(a reading that can't be trusted draws nothing, which also rejects it); the
correct one should pass, and each that doesn't is listed with its reason.

The wordings are the ones the review's scripts showed slipping past the
old text parser: shapes in words (parallelogram, square, rectangle),
similarity, equilateral, "perpendicular to ... at D", "∠C is a right
angle", a bare "BD bisects", "segment AB", primes, "Show that" / "Explain
why", a statement to prove marked on the figure, a printed answer, angle
algebra, tangents and points on a circle, a transversal with extra parts,
a reversed ray, and a diagonal the teacher asked for.

Record (under a hard $5 spending cap):
    HARNESS_LLM_MODE=auto python -m tests.harness.probes.construction_adversarial
Replay ($0): HARNESS_LLM_MODE=replay, as tests/test_construction_figure_eval.py does.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
from pathlib import Path
from typing import Any

_HERE = Path(__file__).resolve().parent.parent
CASSETTE_DIR = _HERE / "_cassettes" / "construction_adversarial"

_S3 = math.sqrt(3)
_TRAP = {"A": [0, 0], "B": [6, 0], "C": [5, 3], "D": [1, 3]}  # one pair of parallel sides
_SIDES = ["AB", "BC", "CD", "DA"]
_TRI = ["AB", "BC", "CA"]
_CIRCLE = [{"center": "O", "through": "A"}]
_P1 = {"A": [0, 0], "B": [8, 0], "C": [0, 3], "D": [8, 3], "E": [2, -1], "F": [6, 4], "X": [2.8, 0], "Y": [5.2, 3]}
_GIVEN_T = (r"Given: $\overline{AB} \parallel \overline{CD}$ and transversal $\overline{EF}$ meets them at "
            r"$X$ and $Y$. ")
_TR = {"A": [0, 0], "B": [8, 0], "C": [0, 4], "D": [8, 4], "E": [2, -2], "F": [6, 6], "G": [3, 0], "H": [5, 4]}
_TR_LINES = [{"through": ["A", "B"]}, {"through": ["C", "D"]}, {"through": ["E", "F"]}]
_X = {k: _TR[k] for k in "ABEFG"}
_X_LINES = [{"through": ["A", "B"]}, {"through": ["E", "F"]}]
_RHOMBUS = {"A": [0, 0], "B": [3, -2], "C": [6, 0], "D": [3, 2], "E": [3, 0]}


def _fig(points: dict[str, list[float]], **kw: Any) -> dict[str, Any]:
    return {"type": "geometry", "shape": "construction", "points": points, **kw}


# id, problem text, (final answer, teacher's request), a correct figure, a
# wrong one (and why it is wrong).
CASES: list[dict[str, Any]] = [
    {"id": "pgram-words", "text": r"Given: ABCD is a parallelogram. Prove: $\angle A \cong \angle C$.",
     "good": _fig({"A": [0, 0], "B": [6, 0], "C": [7, 3], "D": [1, 3]}, segments=_SIDES),
     "bad": _fig(_TRAP, segments=_SIDES), "why": "a trapezoid, not a parallelogram"},
    {"id": "pgram-latex", "text": r"Given: Parallelogram $ABCD$. Find $m\angle B$ if $m\angle A = 70^\circ$.",
     "answer": r"$110^\circ$",
     "good": _fig({"A": [0, 0], "B": [6, 0], "C": [7.026, 2.819], "D": [1.026, 2.819]}, segments=_SIDES),
     "bad": _fig(_TRAP, segments=_SIDES), "why": "a trapezoid, and ∠A is not 70°"},
    {"id": "square", "text": r"Square $ABCD$ has side 6. Find the diagonal $\overline{AC}$.",
     "answer": r"$6\sqrt{2}$",
     "good": _fig({"A": [0, 0], "B": [6, 0], "C": [6, 6], "D": [0, 6]}, segments=[*_SIDES, "AC"]),
     "bad": _fig(_TRAP, segments=[*_SIDES, "AC"]), "why": "not a square"},
    {"id": "similar", "text": r"Given: $\triangle ABC \sim \triangle DEF$. Find $EF$.",
     "good": _fig({"A": [0, 0], "B": [4, 0], "C": [1, 3], "D": [6, 0], "E": [14, 0], "F": [8, 6]},
                  segments=[*_TRI, "DE", "EF", "FD"]),
     "bad": _fig({"A": [0, 0], "B": [4, 0], "C": [1, 3], "D": [6, 0], "E": [14, 0], "F": [9, 2]},
                 segments=[*_TRI, "DE", "EF", "FD"]), "why": "the triangles' angles differ"},
    {"id": "equilateral", "text": r"Equilateral $\triangle ABC$ has side length 6.",
     "good": _fig({"A": [0, 0], "B": [6, 0], "C": [3, 3 * _S3]}, segments=_TRI),
     "bad": _fig({"A": [0, 0], "B": [6, 0], "C": [1, 3]}, segments=_TRI), "why": "sides unequal"},
    {"id": "perp-words", "text": r"In $\triangle ABC$, $\overline{AD}$ is perpendicular to $\overline{BC}$ at $D$.",
     "good": _fig({"A": [3, 3], "B": [0, 0], "C": [6, 0], "D": [3, 0]}, segments=["AB", "AC", "BC", "AD"]),
     "bad": _fig({"A": [1, 3], "B": [0, 0], "C": [6, 0], "D": [3, 0]}, segments=["AB", "AC", "BC", "AD"]),
     "why": "AD not ⊥ BC"},
    {"id": "right-angle-is", "text": r"In $\triangle ABC$, $\angle C$ is a right angle. Find $AB$.",
     "good": _fig({"A": [0, 3], "B": [4, 0], "C": [0, 0]}, segments=_TRI),
     "bad": _fig({"A": [0, 3], "B": [5, 0], "C": [1, 0]}, segments=_TRI), "why": "∠C is not 90°"},
    {"id": "right-triangle", "text": r"$\triangle ABC$ is a right triangle with right angle $C$.",
     "good": _fig({"A": [0, 3], "B": [4, 0], "C": [0, 0]}, segments=_TRI),
     "bad": _fig({"A": [0, 3], "B": [5, 0], "C": [1, 0]}, segments=_TRI), "why": "∠C is not 90°"},
    {"id": "bare-bisects", "text": r"In $\triangle ABC$, BD bisects $\angle ABC$ and D lies on AC.",
     "good": _fig({"A": [0, 4], "B": [0, 0], "C": [6, 0], "D": [2.4, 2.4]}, segments=[*_TRI, "BD"]),
     "bad": _fig({"A": [0, 4], "B": [0, 0], "C": [6, 0], "D": [4, 1.333]}, segments=[*_TRI, "BD"]),
     "why": "BD doesn't bisect ∠ABC"},
    {"id": "segment-words", "text": r"Given: segment AB $\cong$ segment CD in quadrilateral ABCD.",
     "good": _fig({"A": [0, 0], "B": [4, 0], "C": [5, 3], "D": [1, 3]}, segments=_SIDES),
     "bad": _fig(_TRAP, segments=_SIDES), "why": "AB = 6, CD = 4"},
    {"id": "primes", "text": r"Given: $\triangle ABC \cong \triangle A^{\prime}B^{\prime}C^{\prime}$.",
     "good": _fig({"A": [0, 0], "B": [4, 0], "C": [1, 3], "A'": [6, 0], "B'": [10, 0], "C'": [7, 3]},
                  segments=[*_TRI, "A'B'", "B'C'", "C'A'"]),
     "bad": _fig({"A": [0, 0], "B": [4, 0], "C": [1, 3], "A'": [6, 0], "B'": [9, 0], "C'": [7, 4]},
                 segments=[*_TRI, "A'B'", "B'C'", "C'A'"]), "why": "not congruent"},
    *[
        {"id": f"prove-{tag}", "text": _GIVEN_T + f"{verb} " + r"$\angle BXY \cong \angle CYX$.",
         "good": _fig(_P1, segments=["AB", "CD", "EF"], parallel_groups=[["AB", "CD"]]),
         "bad": _fig(_P1, segments=["AB", "CD", "EF"], parallel_groups=[["AB", "CD"]],
                     arc_groups=[["BXY", "CYX"]]),
         "why": "the statement to prove is marked"}
        for tag, verb in (("prove", "Prove:"), ("show", "Show that"), ("explain", "Explain why"),
                          ("lowercase", "prove that"))
    ],
    {"id": "prove-perp-marked",
     "text": r"Given: $\overline{AB} \cong \overline{BC} \cong \overline{CD} \cong \overline{DA}$, diagonals "
             r"meet at $E$. Prove: $\overline{AC} \perp \overline{BD}$.",
     "good": _fig(_RHOMBUS, segments=[*_SIDES, "AC", "BD"]),
     "bad": _fig(_RHOMBUS, segments=[*_SIDES, "AC", "BD"], right_angles=["AEB"]),
     "why": "the statement to prove is marked"},
    {"id": "prove-right-marked",
     "text": r"Given: $\overline{AB} \cong \overline{AD}$, $\overline{CB}\cong\overline{CD}$, E on AC. "
             r"Prove: $m\angle AEB = 90^\circ$.",
     "good": _fig(_RHOMBUS, segments=[*_SIDES, "AC", "BE"]),
     "bad": _fig(_RHOMBUS, segments=[*_SIDES, "AC", "BE"], right_angles=["AEB"]),
     "why": "the statement to prove is marked"},
    {"id": "pgram-sides", "text": "ABCD is a parallelogram with AB = 8 and BC = 5. Find its perimeter.",
     "answer": "26",
     "good": _fig({"A": [0, 0], "B": [8, 0], "C": [10.5, 4.330], "D": [2.5, 4.330]}, segments=_SIDES),
     "bad": _fig(_TRAP, segments=_SIDES), "why": "a trapezoid"},
    {"id": "rect-diagonal", "text": "Rectangle ABCD has AB = 6 and BC = 3. Find AC.", "answer": r"$3\sqrt{5}$",
     "good": _fig({"A": [0, 0], "B": [6, 0], "C": [6, 3], "D": [0, 3]}, segments=[*_SIDES, "AC"]),
     "bad": _fig(_TRAP, segments=[*_SIDES, "AC"]), "why": "not a rectangle"},
    {"id": "par-and-equal", "text": "In quadrilateral ABCD, AB ∥ CD and AD = BC. Prove ABCD is isosceles.",
     "good": _fig(_TRAP, segments=_SIDES),
     "bad": _fig({"A": [0, 0], "B": [6, 0], "C": [5, 3], "D": [1, 4]}, segments=_SIDES), "why": "AB ∦ CD"},
    {"id": "answer-leak",
     "text": r"In $\triangle ABC$, $\overline{AB} \cong \overline{AC}$ and $m\angle B = 65^\circ$. "
             r"Find $m\angle C$.",
     "answer": r"$65^\circ$",
     "good": _fig({"A": [3, 6.4335], "B": [0, 0], "C": [6, 0]}, segments=_TRI, angle_labels={"ABC": "65°"}),
     "bad": _fig({"A": [3, 6.4335], "B": [0, 0], "C": [6, 0]}, segments=_TRI,
                 angle_labels={"ABC": "65°", "BCA": "65°"}), "why": "∠C's label prints the answer"},
    {"id": "linear-pair-answer",
     "text": r"$\angle 1$ and $\angle AOC$ form a linear pair. $m\angle 1 = 65^\circ$. Find $m\angle AOC$.",
     "answer": r"$115^\circ$",
     "good": _fig({"A": [0, 0], "B": [6, 0], "O": [3, 0], "C": [4.2679, 2.7189]}, segments=["AB", "OC"],
                  angle_labels={"COB": "1"}),
     "bad": _fig({"A": [0, 0], "B": [6, 0], "O": [3, 0], "C": [4.2679, 2.7189]}, segments=["AB", "OC"],
                 angle_labels={"COB": "1", "AOC": "115"}), "why": "∠AOC's label prints the answer"},
    {"id": "linear-pair-algebra",
     "text": r"$\angle 1$ and $\angle 2$ are a linear pair and $m\angle 1 = 3x$, $m\angle 2 = 2x$.",
     "good": _fig({"A": [0, 0], "B": [6, 0], "O": [3, 0], "C": [2.0729, 2.8532]}, segments=["AB", "OC"],
                  angle_labels={"COB": "1", "AOC": "2"}),
     "bad": _fig({"A": [0, 0], "B": [6, 0], "O": [3, 0], "C": [5, 3]}, segments=["AB", "OC"],
                 angle_labels={"COB": "1", "AOC": "2"}), "why": "x = 36 makes ∠1 108°; drawn 56°"},
    {"id": "tangent-op",
     "text": r"$\overline{PA}$ is tangent to circle $O$ at $A$. Find $PA$ if radius $OA = 3$ and $OP = 5$.",
     "answer": "4",
     "good": _fig({"O": [0, 0], "A": [3, 0], "P": [3, 4]}, segments=["OA", "PA", "OP"], circles=_CIRCLE),
     "bad": _fig({"O": [0, 0], "A": [3, 0], "P": [4, 3]}, segments=["OA", "PA", "OP"], circles=_CIRCLE),
     "why": "PA isn't tangent at A"},
    {"id": "tangent", "text": r"$\overline{PA}$ is tangent to circle $O$ at $A$. Find $PA$ if $OA = 3$.",
     "good": _fig({"O": [0, 0], "A": [3, 0], "P": [3, 4]}, segments=["OA", "PA"], circles=_CIRCLE),
     "bad": _fig({"O": [0, 0], "A": [3, 0], "P": [4, 3]}, segments=["OA", "PA"], circles=_CIRCLE),
     "why": "PA isn't tangent at A"},
    {"id": "tangent-radius",
     "text": r"$\overline{PA}$ is tangent to circle $O$ at $A$, and radius $\overline{OA} = 3$. Find $PA$.",
     "good": _fig({"O": [0, 0], "A": [3, 0], "P": [3, 4]}, segments=["OA", "PA"], circles=_CIRCLE),
     "bad": _fig({"O": [0, 0], "A": [3, 0], "P": [4, 3]}, segments=["OA", "PA"], circles=_CIRCLE),
     "why": "PA isn't tangent at A"},
    {"id": "on-circle", "text": r"Points $A$, $B$, and $C$ lie on circle $O$. Find $m\angle ABC$.",
     "answer": r"$90^\circ$",
     "good": _fig({"O": [0, 0], "A": [3, 0], "B": [0, 3], "C": [-3, 0]}, segments=["AB", "BC"], circles=_CIRCLE),
     "bad": _fig({"O": [0, 0], "A": [3, 0], "B": [0, 2], "C": [-3, 0]}, segments=["AB", "BC"], circles=_CIRCLE),
     "why": "B is not on the circle"},
    {"id": "transversal-extras", "text": "Lines AB and CD are cut by a transversal EF.",
     "good": _fig({"A": [0, 0], "B": [6, 0], "C": [0, 3], "D": [6, 3], "E": [1, -1], "F": [5, 4]},
                  lines=[{"through": ["A", "B"]}, {"through": ["C", "D"]}, {"through": ["E", "F"]}]),
     "bad": _fig({"A": [0, 0], "B": [6, 0], "C": [0, 3], "D": [6, 3], "E": [1, -1], "F": [5, 4], "G": [2, 7]},
                 lines=[{"through": ["A", "B"]}, {"through": ["C", "D"]}, {"through": ["E", "F"]}],
                 segments=["AG"]), "why": "a point and segment the problem doesn't have"},
    {"id": "ray-reversed", "text": r"Draw $\overrightarrow{AB}$ and $\overrightarrow{AC}$.",
     "good": _fig({"A": [0, 0], "B": [4, 0], "C": [2, 3]}, rays=["AB", "AC"]),
     "bad": _fig({"A": [0, 0], "B": [4, 0], "C": [2, 3]}, rays=["BA", "AC"]), "why": "ray BA, not AB"},
    {"id": "prove-midpoint-ticked",
     "text": r"Given: $\overline{CA} \cong \overline{CB}$, $\overline{CM} \perp \overline{AB}$. Prove: $M$ is "
             r"the midpoint of $\overline{AB}$.",
     "good": _fig({"A": [0, 0], "B": [6, 0], "M": [3, 0], "C": [3, 4]}, segments=["AB", "CM", "CA", "CB"]),
     "bad": _fig({"A": [0, 0], "B": [6, 0], "M": [3, 0], "C": [3, 4]}, segments=["AB", "CM", "CA", "CB"],
                 tick_groups=[["AM", "MB"]]), "why": "the statement to prove is marked"},
    {"id": "asked-diagonal", "text": "Rectangle $ABCD$ has $AB = 6$ and $BC = 4$. Find $BD$.",
     "answer": r"$2\sqrt{13}$", "request": "Please connect B and D and draw the diagonal from B to D.",
     "good": _fig({"A": [0, 0], "B": [6, 0], "C": [6, 4], "D": [0, 4]}, segments=[*_SIDES, "BD"]),
     "bad": _fig({"A": [0, 0], "B": [6, 0], "C": [6, 4], "D": [0, 4]}, segments=_SIDES),
     "why": "the diagonal the teacher asked for is missing"},
    # Where two angles sit around a transversal. AB (y = 0) ∥ CD (y = 4), cut by EF at G and H; each
    # wrong figure puts ∠2 where the problem doesn't (most at the same size, so only its place is wrong).
    {"id": "pair-same-side",
     "text": r"Lines $AB$ and $CD$ are parallel, cut by transversal $EF$ at $G$ and $H$. $\angle 1$ and "
             r"$\angle 2$ are same-side interior angles, with $m\angle 1 = 63^\circ$ and $m\angle 2 = (2x + 3)^\circ$. "
             r"Find $x$.",
     "good": _fig(_TR, lines=_TR_LINES, angle_labels={"BGH": "1", "DHG": "2"}),
     "bad": _fig(_TR, lines=_TR_LINES, angle_labels={"BGH": "1", "CHG": "2"}),
     "why": "∠2 is alternate interior to ∠1 (drawn 63°; the problem makes it 117°)"},
    {"id": "pair-alt-interior",
     "text": r"Lines $AB$ and $CD$ are parallel, cut by transversal $EF$ at $G$ and $H$. $\angle 1$ and "
             r"$\angle 2$ are alternate interior angles, and $m\angle 1 = 63^\circ$. Find $m\angle 2$.",
     "good": _fig(_TR, lines=_TR_LINES, angle_labels={"BGH": "1", "CHG": "2"}),
     "bad": _fig(_TR, lines=_TR_LINES, angle_labels={"BGH": "1", "DHF": "2"}),
     "why": "∠2 is corresponding to ∠1, not alternate interior (both 63°)"},
    {"id": "pair-alt-exterior",
     "text": r"Lines $AB$ and $CD$ are parallel, cut by transversal $EF$ at $G$ and $H$. $\angle 1$ and "
             r"$\angle 2$ are alternate exterior angles. Prove $\angle 1 \cong \angle 2$.",
     "good": _fig(_TR, lines=_TR_LINES, angle_labels={"BGE": "1", "CHF": "2"}),
     "bad": _fig(_TR, lines=_TR_LINES, angle_labels={"BGE": "1", "DHG": "2"}),
     "why": "∠2 is corresponding to ∠1, not alternate exterior (both 117°)"},
    {"id": "pair-corresponding",
     "text": r"Lines $AB$ and $CD$ are parallel, cut by transversal $EF$ at $G$ and $H$. $\angle 1$ and "
             r"$\angle 2$ are corresponding angles, and $m\angle 1 = 63^\circ$. Find $m\angle 2$.",
     "good": _fig(_TR, lines=_TR_LINES, angle_labels={"BGH": "1", "DHF": "2"}),
     "bad": _fig(_TR, lines=_TR_LINES, angle_labels={"BGH": "1", "CHG": "2"}),
     "why": "∠2 is alternate interior to ∠1, not corresponding (both 63°)"},
    {"id": "pair-vertical",
     "text": r"Lines $AB$ and $EF$ intersect at $G$. $\angle 1$ and $\angle 2$ are vertical angles, and "
             r"$m\angle 1 = 63^\circ$. Find $m\angle 2$.",
     "good": _fig(_X, lines=_X_LINES, angle_labels={"BGF": "1", "AGE": "2"}),
     "bad": _fig(_X, lines=_X_LINES, angle_labels={"BGF": "1", "AGF": "2"}),
     "why": "∠2 is beside ∠1 (a linear pair), not opposite it"},
    {"id": "pair-linear",
     "text": r"Lines $AB$ and $EF$ intersect at $G$. $\angle 1$ and $\angle 2$ form a linear pair, and "
             r"$m\angle 1 = 63^\circ$. Find $m\angle 2$.",
     "good": _fig(_X, lines=_X_LINES, angle_labels={"BGF": "1", "AGF": "2"}),
     "bad": _fig(_X, lines=_X_LINES, angle_labels={"BGF": "1", "AGE": "2"}),
     "why": "∠2 is opposite ∠1 (vertical angles), not beside it"},
]


async def run_case(case: dict[str, Any]) -> dict[str, Any]:
    import api.core.question_bank_generation as qbg

    answer, request = case.get("answer", ""), case.get("request", "")
    try:
        facts, why = await qbg.read_figure_facts(
            case["text"], final_answer=answer, request=request, mode="bank_chat", user_id=None,
        )
    except Exception as e:  # noqa: BLE001 - a case that can't run fails its own check
        return {"id": case["id"], "error": repr(e)[:200], "reading": [], "good": None, "bad": None,
                "bad_caught": False, "bad_fixed_by_removing_marks": False}

    def check(spec: dict[str, Any]) -> tuple[list[str], dict[str, Any] | None]:
        shown, svg, issues = qbg._check_figure(
            spec, case["text"], final_answer=answer, request=request, facts=facts,
        )
        return ([], shown) if svg else (issues, None)

    good, _ = check(case["good"])
    bad, shown = check(case["bad"])
    # A wrong figure is caught when it is refused, or when what would be
    # shown is the correct figure (a mark the problem doesn't give, such as
    # the statement to prove, is removed rather than refused).
    caught = bool(bad) or _same(shown, case["good"])
    return {
        "id": case["id"], "error": "", "reading": why, "facts": facts.model_dump() if facts else None,
        "good": good, "bad": bad, "bad_caught": caught,
        "bad_fixed_by_removing_marks": not bad and caught,
    }


def _same(a: dict[str, Any] | None, b: dict[str, Any]) -> bool:
    """The same figure, ignoring empty fields."""
    def norm(x: dict[str, Any]) -> dict[str, Any]:
        return {k: v for k, v in x.items() if v not in ([], {}, None)}

    return a is not None and norm(a) == norm(b)


async def run_all(cases: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    prev = os.environ.get("HARNESS_CASSETTE_DIR")
    os.environ["HARNESS_CASSETTE_DIR"] = str(CASSETTE_DIR)
    sem = asyncio.Semaphore(4)

    async def one(c: dict[str, Any]) -> dict[str, Any]:
        async with sem:
            return await run_case(c)

    try:
        return list(await asyncio.gather(*(one(c) for c in cases or CASES)))
    finally:
        if prev is None:
            os.environ.pop("HARNESS_CASSETTE_DIR", None)
        else:
            os.environ["HARNESS_CASSETTE_DIR"] = prev


def summarize(results: list[dict[str, Any]]) -> dict[str, Any]:
    """Wrong figures passed (must be 0), correct figures passed, and how
    each reading went."""
    return {
        "cases": len(results),
        "errors": [r["id"] for r in results if r["error"]],
        "wrong_passed": [r["id"] for r in results if not r["bad_caught"]],
        "wrong_fixed_by_removing_marks": [r["id"] for r in results if r["bad_fixed_by_removing_marks"]],
        "correct_passed": sum(1 for r in results if r["good"] == []),
        "correct_refused": {r["id"]: r["good"] for r in results if r["good"]},
        "readings_agreed": sum(1 for r in results if not r["error"] and not r["reading"]),
        "reading_failures": {r["id"]: r["reading"] for r in results if r["reading"]},
    }


def main() -> None:
    from tests.harness.budget import spending_cap

    parser = argparse.ArgumentParser()
    parser.add_argument("--only", nargs="*")
    parser.add_argument("--cap", type=float, default=5.0)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    cases = [c for c in CASES if not args.only or c["id"] in args.only]
    with spending_cap("adversarial", cap_usd=args.cap) as spend:
        results = asyncio.run(run_all(cases))
    for r in results:
        print(f"{r['id']:<22} reading={'ok' if not r['reading'] else r['reading']} "
              f"good={'PASS' if r['good'] == [] else r['good']} "
              f"bad={'REJECTED' if r['bad'] else 'MARKS REMOVED' if r['bad_caught'] else 'PASSED'}")
    summary = summarize(results)
    cost = spend.row(problems=len(cases))
    print(json.dumps(summary, indent=1, ensure_ascii=False))
    print("COST", json.dumps(cost))
    if spend.stopped:
        print(spend.stopped)
    if args.out:
        args.out.write_text(json.dumps({"results": results, "summary": summary, "cost": cost}, indent=1,
                                       ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()
