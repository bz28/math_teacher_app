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
_TWO_ISO_50 = {"B": [0, 0], "C": [4, 0], "A": [2, 2.384], "E": [6, 0], "F": [10, 0], "D": [8, 2.384]}
_TWO_ISO_70 = {**_TWO_ISO_50, "D": [8, 5.495]}  # DEF's base angles 70°
_EF_LINES = [{"through": ["A", "B"]}, {"through": ["C", "D"]}, {"through": ["E", "F"]}]
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
     "good": _fig({"A": [0, 0], "B": [6, 0], "C": [7, 3], "D": [1, 3]}, segments=_SIDES,
                  parallel_groups=[["AB", "CD"], ["BC", "DA"]]),
     "bad": _fig(_TRAP, segments=_SIDES,
                 parallel_groups=[["AB", "CD"], ["BC", "DA"]]), "why": "a trapezoid, not a parallelogram"},
    {"id": "pgram-latex", "text": r"Given: Parallelogram $ABCD$. Find $m\angle B$ if $m\angle A = 70^\circ$.",
     "answer": r"$110^\circ$",
     "good": _fig({"A": [0, 0], "B": [6, 0], "C": [7.026, 2.819], "D": [1.026, 2.819]}, segments=_SIDES,
                  parallel_groups=[["AB", "CD"], ["BC", "DA"]], angle_labels={"DAB": "70°"}),
     "bad": _fig(_TRAP, segments=_SIDES, parallel_groups=[["AB", "CD"], ["BC", "DA"]],
                 angle_labels={"DAB": "70°"}), "why": "a trapezoid, and ∠A is not 70°"},
    {"id": "square", "text": r"Square $ABCD$ has side 6. Find the diagonal $\overline{AC}$.",
     "answer": r"$6\sqrt{2}$",
     "good": _fig({"A": [0, 0], "B": [6, 0], "C": [6, 6], "D": [0, 6]}, segments=[*_SIDES, "AC"],
                  parallel_groups=[["AB", "CD"], ["BC", "DA"]], tick_groups=[["AB", "BC", "CD", "DA"]],
                  right_angles=["DAB", "ABC", "BCD", "CDA"]),
     "bad": _fig(_TRAP, segments=[*_SIDES, "AC"], parallel_groups=[["AB", "CD"], ["BC", "DA"]],
                 tick_groups=[["AB", "BC", "CD", "DA"]],
                 right_angles=["DAB", "ABC", "BCD", "CDA"]), "why": "not a square"},
    {"id": "similar", "text": r"Given: $\triangle ABC \sim \triangle DEF$. Find $EF$.",
     "good": _fig({"A": [0, 0], "B": [4, 0], "C": [1, 3], "D": [6, 0], "E": [14, 0], "F": [8, 6]},
                  segments=[*_TRI, "DE", "EF", "FD"], arc_groups=[["BAC", "EDF"], ["ABC", "DEF"], ["ACB", "DFE"]]),
     "bad": _fig({"A": [0, 0], "B": [4, 0], "C": [1, 3], "D": [6, 0], "E": [14, 0], "F": [9, 2]},
                 segments=[*_TRI, "DE", "EF", "FD"], arc_groups=[["BAC", "EDF"], ["ABC", "DEF"], ["ACB", "DFE"]]),
     "why": "the triangles' angles differ"},
    {"id": "equilateral", "text": r"Equilateral $\triangle ABC$ has side length 6.",
     "good": _fig({"A": [0, 0], "B": [6, 0], "C": [3, 3 * _S3]}, segments=_TRI, tick_groups=[["AB", "BC", "CA"]]),
     "bad": _fig({"A": [0, 0], "B": [6, 0], "C": [1, 3]}, segments=_TRI,
                 tick_groups=[["AB", "BC", "CA"]]), "why": "sides unequal"},
    {"id": "perp-words", "text": r"In $\triangle ABC$, $\overline{AD}$ is perpendicular to $\overline{BC}$ at $D$.",
     "good": _fig({"A": [3, 3], "B": [0, 0], "C": [6, 0], "D": [3, 0]}, segments=["AB", "AC", "BC", "AD"],
                  right_angles=["ADC"]),
     "bad": _fig({"A": [1, 3], "B": [0, 0], "C": [6, 0], "D": [3, 0]}, segments=["AB", "AC", "BC", "AD"],
                 right_angles=["ADC"]),
     "why": "AD not ⊥ BC"},
    {"id": "right-angle-is", "text": r"In $\triangle ABC$, $\angle C$ is a right angle. Find $AB$.",
     "good": _fig({"A": [0, 3], "B": [4, 0], "C": [0, 0]}, segments=_TRI, right_angles=["ACB"]),
     "bad": _fig({"A": [0, 3], "B": [5, 0], "C": [1, 0]}, segments=_TRI, right_angles=["ACB"]), "why": "∠C is not 90°"},
    {"id": "right-triangle", "text": r"$\triangle ABC$ is a right triangle with right angle $C$.",
     "good": _fig({"A": [0, 3], "B": [4, 0], "C": [0, 0]}, segments=_TRI, right_angles=["ACB"]),
     "bad": _fig({"A": [0, 3], "B": [5, 0], "C": [1, 0]}, segments=_TRI, right_angles=["ACB"]), "why": "∠C is not 90°"},
    {"id": "bare-bisects", "text": r"In $\triangle ABC$, BD bisects $\angle ABC$ and D lies on AC.",
     "good": _fig({"A": [0, 4], "B": [0, 0], "C": [6, 0], "D": [2.4, 2.4]}, segments=[*_TRI, "BD"],
                  arc_groups=[["ABD", "DBC"]]),
     "bad": _fig({"A": [0, 4], "B": [0, 0], "C": [6, 0], "D": [4, 1.333]}, segments=[*_TRI, "BD"],
                 arc_groups=[["ABD", "DBC"]]),
     "why": "BD doesn't bisect ∠ABC"},
    {"id": "segment-words", "text": r"Given: segment AB $\cong$ segment CD in quadrilateral ABCD.",
     "good": _fig({"A": [0, 0], "B": [4, 0], "C": [5, 3], "D": [1, 3]}, segments=_SIDES, tick_groups=[["AB", "CD"]]),
     "bad": _fig(_TRAP, segments=_SIDES, tick_groups=[["AB", "CD"]]), "why": "AB = 6, CD = 4"},
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
     "good": _fig(_RHOMBUS, segments=[*_SIDES, "AC", "BD"], tick_groups=[["AB", "BC", "CD", "DA"]]),
     "bad": _fig(_RHOMBUS, segments=[*_SIDES, "AC", "BD"], right_angles=["AEB"],
                 tick_groups=[["AB", "BC", "CD", "DA"]]),
     "why": "the statement to prove is marked"},
    {"id": "prove-right-marked",
     "text": r"Given: $\overline{AB} \cong \overline{AD}$, $\overline{CB}\cong\overline{CD}$, E on AC. "
             r"Prove: $m\angle AEB = 90^\circ$.",
     "good": _fig(_RHOMBUS, segments=[*_SIDES, "AC", "BE"], tick_groups=[["AB", "AD"], ["CB", "CD"]]),
     "bad": _fig(_RHOMBUS, segments=[*_SIDES, "AC", "BE"], right_angles=["AEB"],
                 tick_groups=[["AB", "AD"], ["CB", "CD"]]),
     "why": "the statement to prove is marked"},
    {"id": "pgram-sides", "text": "ABCD is a parallelogram with AB = 8 and BC = 5. Find its perimeter.",
     "answer": "26",
     "good": _fig({"A": [0, 0], "B": [8, 0], "C": [10.5, 4.330], "D": [2.5, 4.330]}, segments=_SIDES,
                  parallel_groups=[["AB", "CD"], ["BC", "DA"]]),
     "bad": _fig(_TRAP, segments=_SIDES, parallel_groups=[["AB", "CD"], ["BC", "DA"]]), "why": "a trapezoid"},
    {"id": "rect-diagonal", "text": "Rectangle ABCD has AB = 6 and BC = 3. Find AC.", "answer": r"$3\sqrt{5}$",
     "good": _fig({"A": [0, 0], "B": [6, 0], "C": [6, 3], "D": [0, 3]}, segments=[*_SIDES, "AC"],
                  parallel_groups=[["AB", "CD"], ["BC", "DA"]], right_angles=["DAB", "ABC", "BCD", "CDA"]),
     "bad": _fig(_TRAP, segments=[*_SIDES, "AC"], parallel_groups=[["AB", "CD"], ["BC", "DA"]],
                 right_angles=["DAB", "ABC", "BCD", "CDA"]), "why": "not a rectangle"},
    {"id": "par-and-equal", "text": "In quadrilateral ABCD, AB ∥ CD and AD = BC. Prove ABCD is isosceles.",
     "good": _fig(_TRAP, segments=_SIDES, parallel_groups=[["AB", "CD"]], tick_groups=[["AD", "BC"]]),
     "bad": _fig({"A": [0, 0], "B": [6, 0], "C": [5, 3], "D": [1, 4]}, segments=_SIDES, parallel_groups=[["AB", "CD"]],
                 tick_groups=[["AD", "BC"]]), "why": "AB ∦ CD"},
    {"id": "answer-leak",
     "text": r"In $\triangle ABC$, $\overline{AB} \cong \overline{AC}$ and $m\angle B = 65^\circ$. "
             r"Find $m\angle C$.",
     "answer": r"$65^\circ$",
     "good": _fig({"A": [3, 6.4335], "B": [0, 0], "C": [6, 0]}, segments=_TRI, angle_labels={"ABC": "65°"},
                  tick_groups=[["AB", "AC"]]),
     "bad": _fig({"A": [3, 6.4335], "B": [0, 0], "C": [6, 0]}, segments=_TRI,
                 angle_labels={"ABC": "65°", "BCA": "65°"}, tick_groups=[["AB", "AC"]]),
     "why": "∠C's label prints the answer"},
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
     "good": _fig({"A": [0, 0], "B": [6, 0], "M": [3, 0], "C": [3, 4]}, segments=["AB", "CM", "CA", "CB"],
                  right_angles=["CMB"], tick_groups=[["CA", "CB"]]),
     "bad": _fig({"A": [0, 0], "B": [6, 0], "M": [3, 0], "C": [3, 4]}, segments=["AB", "CM", "CA", "CB"],
                 tick_groups=[["AM", "MB"], ["CA", "CB"]], right_angles=["CMB"]),
     "why": "the statement to prove is marked"},
    {"id": "asked-diagonal", "text": "Rectangle $ABCD$ has $AB = 6$ and $BC = 4$. Find $BD$.",
     "answer": r"$2\sqrt{13}$", "request": "Please connect B and D and draw the diagonal from B to D.",
     "good": _fig({"A": [0, 0], "B": [6, 0], "C": [6, 4], "D": [0, 4]}, segments=[*_SIDES, "BD"],
                  parallel_groups=[["AB", "CD"], ["BC", "DA"]], right_angles=["DAB", "ABC", "BCD", "CDA"]),
     "bad": _fig({"A": [0, 0], "B": [6, 0], "C": [6, 4], "D": [0, 4]}, segments=_SIDES,
                 parallel_groups=[["AB", "CD"], ["BC", "DA"]], right_angles=["DAB", "ABC", "BCD", "CDA"]),
     "why": "the diagonal the teacher asked for is missing"},
    # Where two angles sit around a transversal. AB (y = 0) ∥ CD (y = 4), cut by EF at G and H; each
    # wrong figure puts ∠2 where the problem doesn't (most at the same size, so only its place is wrong).
    {"id": "pair-same-side",
     "text": r"Lines $AB$ and $CD$ are parallel, cut by transversal $EF$ at $G$ and $H$. $\angle 1$ and "
             r"$\angle 2$ are same-side interior angles, with $m\angle 1 = 63^\circ$ and $m\angle 2 = (2x + 3)^\circ$. "
             r"Find $x$.",
     "good": _fig(_TR, lines=_TR_LINES, angle_labels={"BGH": "1", "DHG": "2"}, parallel_groups=[["AB", "CD"]]),
     "bad": _fig(_TR, lines=_TR_LINES, angle_labels={"BGH": "1", "CHG": "2"}, parallel_groups=[["AB", "CD"]]),
     "why": "∠2 is alternate interior to ∠1 (drawn 63°; the problem makes it 117°)"},
    {"id": "pair-alt-interior",
     "text": r"Lines $AB$ and $CD$ are parallel, cut by transversal $EF$ at $G$ and $H$. $\angle 1$ and "
             r"$\angle 2$ are alternate interior angles, and $m\angle 1 = 63^\circ$. Find $m\angle 2$.",
     "good": _fig(_TR, lines=_TR_LINES, angle_labels={"BGH": "1", "CHG": "2"}, parallel_groups=[["AB", "CD"]]),
     "bad": _fig(_TR, lines=_TR_LINES, angle_labels={"BGH": "1", "DHF": "2"}, parallel_groups=[["AB", "CD"]]),
     "why": "∠2 is corresponding to ∠1, not alternate interior (both 63°)"},
    {"id": "pair-alt-exterior",
     "text": r"Lines $AB$ and $CD$ are parallel, cut by transversal $EF$ at $G$ and $H$. $\angle 1$ and "
             r"$\angle 2$ are alternate exterior angles. Prove $\angle 1 \cong \angle 2$.",
     "good": _fig(_TR, lines=_TR_LINES, angle_labels={"BGE": "1", "CHF": "2"}, parallel_groups=[["AB", "CD"]]),
     "bad": _fig(_TR, lines=_TR_LINES, angle_labels={"BGE": "1", "DHG": "2"}, parallel_groups=[["AB", "CD"]]),
     "why": "∠2 is corresponding to ∠1, not alternate exterior (both 117°)"},
    {"id": "pair-corresponding",
     "text": r"Lines $AB$ and $CD$ are parallel, cut by transversal $EF$ at $G$ and $H$. $\angle 1$ and "
             r"$\angle 2$ are corresponding angles, and $m\angle 1 = 63^\circ$. Find $m\angle 2$.",
     "good": _fig(_TR, lines=_TR_LINES, angle_labels={"BGH": "1", "DHF": "2"}, parallel_groups=[["AB", "CD"]]),
     "bad": _fig(_TR, lines=_TR_LINES, angle_labels={"BGH": "1", "CHG": "2"}, parallel_groups=[["AB", "CD"]]),
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
    # Review round 2: figures that collapse, algebra, labels, coverage,
    # whole words.
    {"id": "r2-flat-pgram", "text": r"Given: ABCD is a parallelogram. Prove: $\overline{AB} \cong \overline{CD}$.",
     "good": _fig({"A": [0, 0], "B": [4, 0], "C": [5, 3], "D": [1, 3]}, segments=_SIDES,
                  parallel_groups=[["AB", "CD"], ["BC", "DA"]]),
     "bad": _fig({"A": [0, 0], "B": [2, 0], "C": [5, 0], "D": [3, 0]}, segments=_SIDES,
                 parallel_groups=[["AB", "CD"], ["BC", "DA"]]),
     "why": "all four points on one line"},
    {"id": "r2-flat-triangle",
     "text": r"In $\triangle ABC$, $\overline{AB} \cong \overline{AC}$. Prove: $\angle B \cong \angle C$.",
     "good": _fig({"A": [3, 4], "B": [0, 0], "C": [6, 0]}, segments=_TRI, tick_groups=[["AB", "AC"]]),
     "bad": _fig({"A": [3, 0], "B": [0, 0], "C": [6, 0]}, segments=_TRI,
                 tick_groups=[["AB", "AC"]]), "why": "A, B, C on one line"},
    {"id": "r2-same-line", "text": r"Lines $m$ and $n$ are parallel.",
     "good": _fig({"_a": [0, 0], "_b": [4, 0], "_c": [0, 3], "_d": [4, 3]},
                  lines=[{"name": "m", "through": ["_a", "_b"]}, {"name": "n", "through": ["_c", "_d"]}],
                  parallel_groups=[["m", "n"]]),
     "bad": _fig({"_a": [0, 0], "_b": [4, 0], "_c": [6, 0], "_d": [9, 0]},
                 lines=[{"name": "m", "through": ["_a", "_b"]}, {"name": "n", "through": ["_c", "_d"]}],
                 parallel_groups=[["m", "n"]]),
     "why": "m and n drawn as one line"},
    {"id": "r2-same-line-segments", "text": r"Given $\overline{AB} \parallel \overline{CD}$.",
     "good": _fig({"A": [0, 0], "B": [3, 0], "C": [0, 2], "D": [3, 2]}, segments=["AB", "CD"],
                  parallel_groups=[["AB", "CD"]]),
     "bad": _fig({"A": [0, 0], "B": [2, 0], "C": [4, 0], "D": [7, 0]}, segments=["AB", "CD"],
                 parallel_groups=[["AB", "CD"]]),
     "why": "AB and CD on one line"},
    {"id": "r2-coincident",
     "text": r"In $\triangle ABC$, $D$ lies on $\overline{BC}$. Draw $\overline{AD}$.",
     "good": _fig({"A": [1, 3], "B": [0, 0], "C": [5, 0], "D": [2, 0]}, segments=[*_TRI, "AD"]),
     "bad": _fig({"A": [1, 3], "B": [0, 0], "C": [5, 0], "D": [0, 0]}, segments=[*_TRI, "AD"]),
     "why": "D drawn on top of B"},
    {"id": "r2-algebra-angles",
     "text": r"In $\triangle ABC$, $m\angle A = x^\circ$ and $m\angle B = (2x)^\circ$.",
     "good": _fig({"A": [0, 0], "B": [3, 0], "C": [2.25, 1.299]}, segments=_TRI),
     "bad": _fig({"A": [0, 0], "B": [4, 0], "C": [2, 2]}, segments=_TRI), "why": "∠B is not twice ∠A"},
    {"id": "r2-algebra-lengths", "text": r"In $\triangle ABC$, $AB = 2x$ and $AC = 2x$.",
     "good": _fig({"A": [0, 0], "B": [4, 0], "C": [1, 3.873]}, segments=_TRI),
     "bad": _fig({"A": [0, 0], "B": [6, 0], "C": [1, 2]}, segments=_TRI), "why": "AB and AC differ"},
    {"id": "r2-leak-measure",
     "text": r"In $\triangle ABC$, $\angle A \cong \angle C$ and $m\angle A = 50^\circ$. Find $m\angle C$.",
     "answer": r"$50^\circ$",
     "good": _fig({"A": [0, 0], "B": [3, 3.575], "C": [6, 0]}, segments=_TRI, angle_labels={"BAC": "50°"},
                  arc_groups=[["BAC", "ACB"]]),
     "bad": _fig({"A": [0, 0], "B": [3, 3.575], "C": [6, 0]}, segments=_TRI,
                 angle_labels={"BAC": "50°", "ACB": "m∠C = 50°"}, arc_groups=[["BAC", "ACB"]]),
     "why": "prints the answer as m∠C = 50°"},
    {"id": "r2-leak-length", "text": r"$AB = 5$ and $\overline{AB} \cong \overline{CD}$. Find $CD$.",
     "answer": "$5$",
     "good": _fig({"A": [0, 0], "B": [5, 0], "C": [0, 2], "D": [5, 2]}, segments=["AB", "CD"],
                  side_labels={"AB": "5"}, tick_groups=[["AB", "CD"]]),
     "bad": _fig({"A": [0, 0], "B": [5, 0], "C": [0, 2], "D": [5, 2]}, segments=["AB", "CD"],
                 side_labels={"AB": "5", "CD": "CD = 5"}, tick_groups=[["AB", "CD"]]),
     "why": "prints the answer as CD = 5"},
    {"id": "r2-derived-label",
     "text": r"In $\triangle ABC$, $\overline{AB} \cong \overline{AC}$ and $m\angle B = 50^\circ$. "
             r"Find $m\angle A$.",
     "answer": r"$80^\circ$",
     "good": _fig({"A": [3, 3.575], "B": [0, 0], "C": [6, 0]}, segments=_TRI, angle_labels={"ABC": "50°"},
                  tick_groups=[["AB", "AC"]]),
     "bad": _fig({"A": [3, 3.575], "B": [0, 0], "C": [6, 0]}, segments=_TRI,
                 angle_labels={"ABC": "50°", "ACB": "50°"}, tick_groups=[["AB", "AC"]]),
     "why": "prints the derived step ∠C = 50°"},
    {"id": "r2-label-launders",
     "text": r"In $\triangle ABC$, $\overline{AB} \cong \overline{AC}$. Prove: $\angle B \cong \angle C$.",
     "good": _fig({"A": [2, 4], "B": [0, 0], "C": [4, 0]}, segments=_TRI, tick_groups=[["AB", "AC"]]),
     "bad": _fig({"A": [2, 4], "B": [0, 0], "C": [4, 0], "_m": [2, 0]}, segments=[*_TRI, "A_m"],
                 angle_labels={"BA_m": "y"}, tick_groups=[["AB", "AC"]]),
     "why": "an extra segment hidden behind a label"},
    {"id": "r2-point-on",
     "text": r"In $\triangle ABC$, $D$ is a point on $\overline{BC}$ and $\overline{AD} \perp \overline{BC}$.",
     "good": _fig({"A": [2, 3], "B": [0, 0], "C": [4, 0], "D": [2, 0]}, segments=[*_TRI, "AD"], right_angles=["ADC"]),
     "bad": _fig({"A": [2, 3], "B": [0, 0], "C": [4, 0], "D": [2, -1]}, segments=[*_TRI, "AD"], right_angles=["ADC"]),
     "why": "D is below BC, not on it"},
    {"id": "r2-measure",
     "text": r"In $\triangle ABC$, $m\angle A = 40^\circ$ and $\overline{AB} \cong \overline{AC}$.",
     "good": _fig({"A": [0, 0], "B": [4, 0], "C": [3.064, 2.571]}, segments=_TRI, tick_groups=[["AB", "AC"]],
                  angle_labels={"BAC": "40°"}),
     "bad": _fig({"A": [0, 0], "B": [3, 0], "C": [0, 3]}, segments=_TRI, tick_groups=[["AB", "AC"]],
                 angle_labels={"BAC": "40°"}), "why": "∠A drawn 90°"},
    {"id": "r2-two-parallels",
     "text": r"Given $\overline{AB} \parallel \overline{CD}$ and $\overline{EF} \parallel \overline{GH}$.",
     "good": _fig({"A": [0, 0], "B": [3, 0], "C": [0, 2], "D": [3, 2], "E": [5, 0], "F": [8, 0], "G": [5, 2],
                   "H": [8, 2]}, segments=["AB", "CD", "EF", "GH"], parallel_groups=[["AB", "CD"], ["EF", "GH"]]),
     "bad": _fig({"A": [0, 0], "B": [3, 0], "C": [0, 2], "D": [3, 2], "E": [5, 0], "F": [8, 0], "G": [5, 2],
                  "H": [8, 4]}, segments=["AB", "CD", "EF", "GH"], parallel_groups=[["AB", "CD"], ["EF", "GH"]]),
     "why": "EF is not parallel to GH"},
    {"id": "r2-between",
     "text": r"$D$ is between $A$ and $B$, and $\overline{CD} \perp \overline{AB}$.",
     "good": _fig({"A": [0, 0], "B": [4, 0], "C": [1, 2], "D": [1, 0]}, segments=["AB", "CD"], right_angles=["CDB"]),
     "bad": _fig({"A": [0, 0], "B": [4, 0], "C": [6, 2], "D": [6, 0]}, segments=["AB", "CD"], right_angles=["CDB"]),
     "why": "D lies past B, not between A and B"},
    {"id": "r2-intersection",
     "text": r"$E$ is the intersection of $\overline{AC}$ and $\overline{BD}$, and "
             r"$\overline{AB} \parallel \overline{CD}$.",
     "good": _fig({"A": [0, 0], "B": [6, 0], "C": [4, 3], "D": [1, 3], "E": [2.667, 2]},
                  segments=["AC", "BD", "AB", "CD"], parallel_groups=[["AB", "CD"]]),
     "bad": _fig({"A": [0, 0], "B": [6, 0], "C": [4, 3], "D": [1, 3], "E": [2.667, 1]},
                 segments=["AC", "BD", "AB", "CD"], parallel_groups=[["AB", "CD"]]),
     "why": "E is not where AC and BD cross"},
    {"id": "r2-bisector-sector",
     "text": r"$\overrightarrow{BD}$ is the bisector of $\angle ABC$.",
     "good": _fig({"A": [4, 0], "B": [0, 0], "C": [0.695, 3.939], "D": [3.064, 2.571]}, rays=["BA", "BC", "BD"],
                  arc_groups=[["ABD", "DBC"]]),
     "bad": _fig({"A": [4, 0], "B": [0, 0], "C": [0.695, 3.939], "D": [3.064, 2.571]}, rays=["BA", "BC", "BD"],
                 sectors=[{"center": "B", "endpoints": ["A", "D"]}], shaded=[{"polygon": ["A", "B", "D"]}],
                 arc_groups=[["ABD", "DBC"]]),
     "why": "a sector and shading the problem never mentions"},
    # Review round 3 and the breadth batch: each new fact kind and each
    # reviewer scenario, a correct and a wrong figure.
    {"id": "r3-coordinates",
     "text": r"Triangle $ABC$ has vertices $A(0, 0)$, $B(4, 0)$, and $C(0, 3)$. Find $BC$.",
     "good": _fig({"A": [0, 0], "B": [4, 0], "C": [0, 3]}, segments=["AB", "BC", "CA"]),
     "bad": _fig({"A": [0, 0], "B": [4, 0], "C": [2, 3]}, segments=["AB", "BC", "CA"]),
     "why": "C is not at (0, 3)"},
    {"id": "r3-interior-ray",
     "text": r"Ray $BD$ lies in the interior of $\angle ABC$. If $m\angle ABD = 30^\circ$ and "
             r"$m\angle ABC = 80^\circ$, find $m\angle DBC$.",
     "good": _fig({"B": [0, 0], "A": [5, 0], "D": [4.33, 2.5], "C": [0.868, 4.924]}, rays=["BA", "BD", "BC"],
                  angle_labels={"ABD": "30°", "ABC": "80°"}),
     "bad": _fig({"B": [0, 0], "A": [5, 0], "D": [-2.5, 4.33], "C": [0.868, 4.924]}, rays=["BA", "BD", "BC"],
                 angle_labels={"ABD": "30°", "ABC": "80°"}),
     "why": "ray BD is outside ∠ABC"},
    {"id": "r3-extension",
     "text": r"In $\triangle ABC$, side $\overline{BC}$ is extended to point $D$. "
             r"Find the exterior angle $\angle ACD$.",
     "good": _fig({"A": [2, 4], "B": [0, 0], "C": [5, 0], "D": [8, 0]}, segments=["AB", "BC", "CA", "CD"]),
     "bad": _fig({"A": [2, 4], "B": [0, 0], "C": [5, 0], "D": [-3, 0]}, segments=["AB", "BC", "CA", "BD"]),
     "why": "D is behind B, not past C"},
    {"id": "r3-bowtie",
     "text": r"$ABCD$ is an isosceles trapezoid with $\overline{AB} \parallel \overline{CD}$. Find $m\angle A$.",
     "good": _fig({"A": [0, 0], "B": [4, 0], "C": [3, 2], "D": [1, 2]}, segments=["AB", "BC", "CD", "DA"],
                  parallel_groups=[["AB", "CD"]]),
     "bad": _fig({"A": [0, 0], "B": [4, 0], "C": [1, 2], "D": [3, 2]}, segments=["AB", "BC", "CD", "DA"],
                 parallel_groups=[["AB", "CD"]]),
     "why": "sides BC and DA cross: a bowtie"},
    {"id": "r3-extra-circle",
     "text": r"Points $A$ and $B$ lie on circle $O$. Find $m\angle AOB$.",
     "good": _fig({"O": [0, 0], "A": [3, 0], "B": [0, 3]}, segments=["OA", "OB"],
                  circles=[{"center": "O", "through": "A"}]),
     "bad": _fig({"O": [0, 0], "A": [3, 0], "B": [0, 3]}, segments=["OA", "OB"],
                 circles=[{"center": "O", "through": "A"}, {"center": "O", "radius": 1}],
                 sectors=[{"center": "O", "endpoints": ["A", "B"]}]),
     "why": "a second circle and a sector the problem never mentions"},
    {"id": "r3-arc-centre",
     "text": r"Points $A$ and $B$ lie on circle $O$. Find the length of arc $AB$ if $m\angle AOB = 90^\circ$.",
     "good": _fig({"O": [0, 0], "A": [3, 0], "B": [0, 3]}, segments=["OA", "OB"],
                  circles=[{"center": "O", "through": "A"}], arcs=[{"center": "O", "endpoints": ["A", "B"]}],
                  right_angles=["AOB"]),
     "bad": _fig({"O": [0, 0], "A": [3, 0], "B": [0, 3], "_c": [3, 3]}, segments=["OA", "OB"],
                 circles=[{"center": "O", "through": "A"}], arcs=[{"center": "_c", "endpoints": ["A", "B"]}],
                 right_angles=["AOB"]),
     "why": "arc AB is drawn around another centre, off the circle"},
    {"id": "r3-shading",
     "text": r"$\triangle ABC$ and $\triangle ABD$ share side $\overline{AB}$, and $\triangle ABD$ is shaded. "
             r"Find the area of the shaded region.",
     "good": _fig({"A": [0, 0], "B": [6, 0], "C": [3, 5], "D": [3, 2]}, segments=["AB", "BC", "CA", "AD", "BD"],
                  shaded=[{"polygon": ["A", "B", "D"]}]),
     "bad": _fig({"A": [0, 0], "B": [6, 0], "C": [3, 5], "D": [3, 2]}, segments=["AB", "BC", "CA", "AD", "BD"],
                 shaded=[{"polygon": ["A", "D", "C"]}]),
     "why": "the shading is on another region"},
    {"id": "r3-algebra-bracket",
     "text": r"$m\angle ABD = 2(x + 5)^\circ$ and $m\angle DBC = (x + 20)^\circ$, and "
             r"$\angle ABD \cong \angle DBC$. Find $x$.",
     "good": _fig({"B": [0, 0], "A": [5, 0], "D": [4.33, 2.5], "C": [2.5, 4.33]}, rays=["BA", "BD", "BC"],
                  arc_groups=[["ABD", "DBC"]]),
     "bad": _fig({"B": [0, 0], "A": [5, 0], "D": [4.096, 2.868], "C": [1.71, 4.698]}, rays=["BA", "BD", "BC"],
                 arc_groups=[["ABD", "DBC"]]),
     "why": "35° each, where x = 10 makes them 30°"},
    {"id": "r3-far-helper",
     "text": r"In $\triangle ABC$, $D$ lies on $\overline{BC}$ and $\overline{AB} \cong \overline{AC}$. "
             r"Find $m\angle BAD$.",
     "good": _fig({"A": [5, 9], "B": [0, 0], "C": [10, 0], "D": [5, 0]}, segments=["AB", "BC", "CA", "AD"],
                  tick_groups=[["AB", "AC"]]),
     "bad": _fig({"A": [5, 9], "B": [0, 0], "C": [10, 0], "D": [5, 0.38], "_z": [100, 0]},
                 segments=["AB", "BC", "CA", "AD"], tick_groups=[["AB", "AC"]]),
     "why": "D off BC, hidden behind a far helper point that loosens the tolerance"},
    {"id": "r3-equal-words",
     "text": r"In $\triangle ABC$, $\angle A$ and $\angle B$ are equal, and $AB = 6$. Find $m\angle C$.",
     "good": _fig({"A": [0, 0], "B": [6, 0], "C": [3, 4]}, segments=["AB", "BC", "CA"], arc_groups=[["BAC", "ABC"]]),
     "bad": _fig({"A": [0, 0], "B": [6, 0], "C": [1, 4]}, segments=["AB", "BC", "CA"], arc_groups=[["BAC", "ABC"]]),
     "why": "∠A and ∠B are not equal"},
    {"id": "r3-two-equal-sides",
     "text": r"In $\triangle ADC$, $DA = DC$ and $m\angle A = 50^\circ$. Find $m\angle D$.",
     "good": _fig({"A": [0, 0], "D": [3, 3.575], "C": [6, 0]}, segments=["AD", "DC", "CA"], tick_groups=[["DA", "DC"]],
                  angle_labels={"DAC": "50°"}),
     "bad": _fig({"A": [0, 0], "D": [2, 2.384], "C": [6, 0]}, segments=["AD", "DC", "CA"], tick_groups=[["DA", "DC"]],
                 angle_labels={"DAC": "50°"}),
     "why": "DA ≠ DC"},
    {"id": "r3-step-altitude",
     "text": r"In $\triangle ABC$, $AB = 5$, $AC = 5$, and $BC = 6$. Find the area of $\triangle ABC$.",
     "base": _fig({"A": [3, 4], "B": [0, 0], "C": [6, 0]}, segments=["AB", "BC", "CA"]),
     "step": r"Altitude: Draw altitude $\overline{AD} \perp \overline{BC}$ with $D$ the midpoint of "
             r"$\overline{BC}$. Then $BD = 3$ and $AD = 4$.",
     "good": _fig({"A": [3, 4], "B": [0, 0], "C": [6, 0], "D": [3, 0]}, segments=["AB", "BC", "CA", "AD"],
                  right_angles=["ADC"], tick_groups=[["BD", "DC"]]),
     "bad": _fig({"A": [3, 4], "B": [0, 0], "C": [6, 0], "D": [1.5, 0]}, segments=["AB", "BC", "CA", "AD"],
                 tick_groups=[["BD", "DC"]]),
     "why": "the step's D is not the midpoint and AD is not ⊥ BC"},
    # Review round 4: a shape word inside a question, a mixed number, a
    # decimal, and an unnamed right triangle's legs.
    {"id": "r4-obtuse-in-question",
     "text": r"Find $m\angle A$ in $\triangle ABC$, given $\angle B$ is obtuse.",
     "good": _fig({"A": [0, 0], "B": [4, 1], "C": [8, 0]}, segments=_TRI),
     "bad": _fig({"A": [0, 0], "B": [4, 6], "C": [8, 0]}, segments=_TRI), "why": "∠B is acute"},
    {"id": "r4-scalene", "text": r"In scalene $\triangle ABC$, name the longest side.",
     "good": _fig({"A": [0, 0], "B": [6, 0], "C": [1, 4]}, segments=_TRI),
     "bad": _fig({"A": [0, 0], "B": [6, 0], "C": [3, 4]}, segments=_TRI), "why": "CA = CB: isosceles"},
    {"id": "r4-mixed-number",
     "text": r"$m\angle ABD = \left(2\frac{1}{2}x\right)^\circ$, $m\angle DBC = x^\circ$, and "
             r"$m\angle ABC = 105^\circ$. Find $x$.",
     "good": _fig({"B": [0, 0], "A": [5.0, 0.0], "D": [1.294, 4.83], "C": [-1.294, 4.83]}, rays=["BA", "BD", "BC"],
                  angle_labels={"ABC": "105°"}),
     "bad": _fig({"B": [0, 0], "A": [5.0, 0.0], "D": [3.044, 3.967], "C": [-1.294, 4.83]}, rays=["BA", "BD", "BC"],
                 angle_labels={"ABC": "105°"}), "why": "52.5° each, where 2½x and x make 75° and 30°"},
    {"id": "r4-decimal",
     "text": r"In $\triangle ABC$, $AB = 2.5$, $AC = 2.5$, and $m\angle A = 40^\circ$. Find $BC$.",
     "good": _fig({"A": [0, 0], "B": [2.5, 0], "C": [1.915, 1.607]}, segments=_TRI,
                  side_labels={"AB": "2.5", "AC": "2.5"}, angle_labels={"BAC": "40°"}),
     "bad": _fig({"A": [0, 0], "B": [2.5, 0], "C": [2.681, 2.25]}, segments=_TRI,
                 side_labels={"AB": "2.5", "AC": "2.5"}, angle_labels={"BAC": "40°"}), "why": "AC drawn 3.5"},
    {"id": "r4-unnamed-right",
     "text": "A right triangle has legs of length 3 and 4. Find the length of its hypotenuse.", "answer": "5",
     "good": _fig({"_a": [0, 0], "_b": [6, 0], "_c": [0, 4.5]}, segments=["_a_b", "_b_c", "_c_a"],
                  right_angles=["_b_a_c"], side_labels={"_a_b": "4", "_c_a": "3"}),
     "bad": _fig({"_a": [0, 0], "_b": [3.969, 0], "_c": [0, 4.5]}, segments=["_a_b", "_b_c", "_c_a"],
                 right_angles=["_b_a_c"], side_labels={"_b_c": "4", "_c_a": "3"}),
     "why": "4 is on the hypotenuse, not a leg"},
    # Review round 5: only exact rules loosen coverage. "expect_declined":
    # the problem can't be checked as worded, so no figure may be drawn.
    {"id": "r5-rectangle-target", "text": r"Find the area of rectangle $ABCD$ if $AB = 5$ and $BC = 3$.",
     "good": _fig({"A": [0, 0], "B": [5, 0], "C": [5, 3], "D": [0, 3]}, segments=_SIDES,
                  side_labels={"AB": "5", "BC": "3"}, right_angles=["DAB", "ABC", "BCD", "CDA"],
                  parallel_groups=[["AB", "CD"], ["BC", "DA"]]),
     "bad": _fig({"A": [0, 0], "B": [5, 0], "C": [6.5, 2.598], "D": [1.5, 2.598]}, segments=_SIDES,
                 side_labels={"AB": "5", "BC": "3"}, right_angles=["DAB", "ABC", "BCD", "CDA"],
                 parallel_groups=[["AB", "CD"], ["BC", "DA"]]),
     "why": "a slanted parallelogram, not a rectangle"},
    {"id": "r5-which",
     "text": r"In $\triangle ABC$, $\angle B$, which is a right angle, is opposite side $AC = 10$. Find $AB$.",
     "good": _fig({"A": [6, 0], "B": [0, 0], "C": [0, 8]}, segments=_TRI, right_angles=["ABC"],
                  side_labels={"CA": "10"}),
     "bad": _fig({"A": [6, 0], "B": [0, 0], "C": [3, 9.539]}, segments=_TRI, right_angles=["ABC"],
                 side_labels={"CA": "10"}), "why": "∠B is about 72°"},
    {"id": "r5-draw-perp",
     "text": r"In $\triangle ABC$, $AB = 6$. Draw $\overline{AD} \perp \overline{BC}$ with $D$ on $\overline{BC}$. "
             r"Find $AD$.",
     "good": _fig({"A": [2, 5.657], "B": [0, 0], "C": [7, 0], "D": [2, 0]}, segments=[*_TRI, "AD"],
                  right_angles=["ADC"], side_labels={"AB": "6"}),
     "bad": _fig({"A": [2, 5.657], "B": [0, 0], "C": [7, 0], "D": [3.5, 0]}, segments=[*_TRI, "AD"],
                 right_angles=["ADC"], side_labels={"AB": "6"}), "why": "AD is slanted"},
    {"id": "r5-major-arc",
     "text": r"Points $A$, $B$, and $C$ lie on circle $O$, and $m\angle ACB = 50^\circ$. "
             r"Find the measure of major arc $ACB$.",
     "good": _fig({"O": [0, 0], "A": [5.0, 0.0], "B": [-0.868, 4.924], "C": [-3.214, -3.83]}, circles=_CIRCLE,
                  segments=["CA", "CB"],
                  arcs=[{"center": "O", "endpoints": ["A", "B"], "major": True}], angle_labels={"ACB": "50°"}),
     "bad": _fig({"O": [0, 0], "A": [5.0, 0.0], "B": [-0.868, 4.924], "C": [3.214, 3.83]}, circles=_CIRCLE,
                 segments=["CA", "CB"],
                 arcs=[{"center": "O", "endpoints": ["A", "B"], "major": True}], angle_labels={"ACB": "50°"}),
     "why": "C is on the minor arc AB (so ∠ACB is 130°), and the major arc doesn't pass through it"},
    {"id": "r5-two-right-angles",
     "text": r"Quadrilateral $ABCD$ has right angles at $A$ and $C$, $AB = 4$, and $AD = 3$. Find $BD$.",
     "good": _fig({"A": [0, 0], "B": [4, 0], "C": [4.165, 2.75], "D": [0, 3]}, segments=[*_SIDES, "BD"],
                  right_angles=["DAB", "BCD"], side_labels={"AB": "4", "DA": "3"}),
     "bad": _fig({"A": [0, 0], "B": [4, 0], "C": [4.5, 3.5], "D": [0, 3]}, segments=[*_SIDES, "BD"],
                 right_angles=["DAB", "BCD"], side_labels={"AB": "4", "DA": "3"}), "why": "∠C is not right"},
    {"id": "r5-acute-longest", "expect_declined": True,
     "text": r"Find $m\angle C$ in acute $\triangle ABC$ with $\overline{AB}$ the longest side and "
             r"$m\angle A = 70^\circ$.",
     "good": _fig({"A": [0, 0], "B": [5, 0], "C": [1.015, 2.79]}, segments=_TRI, angle_labels={"CAB": "70°"}),
     "bad": _fig({"A": [0, 0], "B": [4, 0], "C": [1.642, 4.511]}, segments=_TRI, angle_labels={"CAB": "70°"}),
     "why": "BC is the longest side"},
    {"id": "r5-complement-after", "expect_declined": True,
     "text": r"Triangle $ABC$ is shaded, except the middle third. Find the shaded area.",
     "good": _fig({"A": [0, 0], "B": [6, 0], "C": [2, 4]}, segments=_TRI),
     "bad": _fig({"A": [0, 0], "B": [6, 0], "C": [2, 4]}, segments=_TRI, shaded=[{"polygon": ["A", "B", "C"]}]),
     "why": "the whole triangle shaded, middle third included"},
    {"id": "r5-span-largest", "expect_declined": True,
     "text": r"In $\triangle ABC$, $m\angle ABC = 40^\circ$, and $\angle ABC$ is the largest angle. Find $m\angle C$.",
     "good": _fig({"A": [6, 0], "B": [0, 0], "C": [2.298, 1.928]}, segments=_TRI, angle_labels={"ABC": "40°"}),
     "bad": _fig({"A": [6, 0], "B": [0, 0], "C": [2.298, 1.928]}, segments=_TRI, angle_labels={"ABC": "40°"}),
     "why": "no triangle has a 40° largest angle; ∠C is about 112°"},
    # Review round 6: coverage is an allowlist. A word that says something
    # about the figure needs a fact that verifies it; a fact's quote must
    # name the part the fact is about.
    # Drawn by the exact "vertex angle" rule when the reading puts 40° on the
    # apex; the wrong figure puts it on a base angle.
    {"id": "r6-vertex-angle",
     "text": r"In isosceles $\triangle ABC$ with $AB = AC$, the vertex angle measures $40^\circ$. Find $m\angle B$.",
     "good": _fig({"A": [2, 5.495], "B": [0, 0], "C": [4, 0]}, segments=_TRI, tick_groups=[["AB", "CA"]],
                  angle_labels={"BAC": "40°"}),
     "bad": _fig({"A": [2, 1.678], "B": [0, 0], "C": [4, 0]}, segments=_TRI, tick_groups=[["AB", "CA"]],
                 angle_labels={"ABC": "40°"}),
     "why": "40° on a base angle; the vertex angle is at A"},
    {"id": "r6-opposite-side", "expect_declined": True,
     "text": r"In $\triangle ABC$, $AB = 5$ and $AC = 6$. Find $m\angle A$ opposite side $BC = 7$.",
     "good": _fig({"A": [0, 0], "B": [5, 0], "C": [1.2, 5.879]}, segments=_TRI,
                  side_labels={"AB": "5", "CA": "6", "BC": "7"}),
     "bad": _fig({"A": [0, 0], "B": [5, 0], "C": [4.5, 3.969]}, segments=_TRI, side_labels={"AB": "5", "CA": "6"}),
     "why": "BC is 4, not 7"},
    {"id": "r6-shade-save-for", "expect_declined": True,
     "text": r"Triangle $ABC$ is shaded, save for its middle third. Find the shaded area.",
     "good": _fig({"A": [0, 0], "B": [6, 0], "C": [2, 4]}, segments=_TRI),
     "bad": _fig({"A": [0, 0], "B": [6, 0], "C": [2, 4]}, segments=_TRI, shaded=[{"polygon": ["A", "B", "C"]}]),
     "why": "the whole triangle shaded, middle third included"},
    {"id": "r6-acute-with-longest", "expect_declined": True,
     "text": r"In acute $\triangle ABC$ with $AB$ the longest side, find $m\angle C$ if $m\angle A = 70^\circ$.",
     "good": _fig({"A": [0, 0], "B": [5, 0], "C": [1.015, 2.79]}, segments=_TRI, angle_labels={"CAB": "70°"}),
     "bad": _fig({"A": [0, 0], "B": [4, 0], "C": [1.642, 4.511]}, segments=_TRI, angle_labels={"CAB": "70°"}),
     "why": "BC is the longest side"},
    {"id": "r6-diameter-comma",
     "text": r"In circle $O$, find the length of the diameter, $\overline{AB}$, if $OA = 5$.",
     "good": _fig({"O": [0, 0], "A": [5, 0], "B": [-5, 0]}, circles=[{"center": "O", "through": "A"}],
                  segments=["AB"], side_labels={"OA": "5"}),
     "bad": _fig({"O": [0, 0], "A": [5, 0], "B": [-2.081, 4.546]}, circles=[{"center": "O", "through": "A"}],
                 segments=["AB", "OA"], side_labels={"OA": "5"}),
     "why": "AB is a chord that misses the centre"},
    {"id": "r6-hypotenuse-named",
     "text": r"Right $\triangle ABC$ has its right angle at $C$. The hypotenuse $AB = 13$ and $AC = 5$. Find $BC$.",
     "good": _fig({"C": [0, 0], "A": [5, 0], "B": [0, 12]}, segments=_TRI, right_angles=["ACB"],
                  side_labels={"AB": "13", "CA": "5"}),
     "bad": _fig({"C": [0, 0], "A": [5, 0], "B": [2.743, 12.802]}, segments=_TRI, right_angles=["ACB"],
                 side_labels={"AB": "13", "CA": "5"}),
     "why": "∠C is not right"},
    # "hypotenuse" says ∠C is right, but no fact the reading has states it.
    {"id": "r6-hypotenuse-implied", "expect_declined": True,
     "text": r"In $\triangle ABC$, the hypotenuse $AB = 10$ and the leg $BC = 6$. Find $AC$.",
     "good": _fig({"C": [0, 0], "B": [6, 0], "A": [0, 8]}, segments=_TRI, right_angles=["ACB"],
                  side_labels={"AB": "10", "BC": "6"}),
     "bad": _fig({"C": [0, 0], "B": [6, 0], "A": [1, 8.66]}, segments=_TRI, side_labels={"AB": "10", "BC": "6"}),
     "why": "no right angle at C, so AB is no hypotenuse"},
    # Decisions stage: the exact rules for words that need more than one fact.
    {"id": "r7-each-base",
     "text": r"In isosceles $\triangle ABC$ with $AB = AC$, each base angle measures $70^\circ$. Find $m\angle A$.",
     "good": _fig({"A": [2, 5.495], "B": [0, 0], "C": [4, 0]}, segments=_TRI, tick_groups=[["AB", "CA"]],
                  angle_labels={"ABC": "70°", "ACB": "70°"}),
     "bad": _fig({"A": [2, 1.453], "B": [0, 0], "C": [4, 0]}, segments=_TRI, tick_groups=[["AB", "CA"]],
                 angle_labels={"ABC": "70°", "ACB": "70°"}),
     "why": "the base angles are 36°, labelled 70°"},
    {"id": "r7-arc-target",
     "text": r"Points $A$ and $B$ lie on circle $O$, and $m\angle AOB = 90^\circ$. Find the length of arc $AB$.",
     "good": _fig({"O": [0, 0], "A": [3, 0], "B": [0, 3]}, segments=["OA", "OB"], circles=_CIRCLE,
                  angle_labels={"AOB": "90°"}),
     "bad": _fig({"O": [0, 0], "A": [3, 0], "B": [0, 2]}, segments=["OA", "OB"], circles=_CIRCLE,
                 angle_labels={"AOB": "90°"}),
     "why": "B is inside the circle, not on it"},
    {"id": "r7-intersects",
     "text": r"In $\triangle PQR$, ray $QS$ bisects $\angle PQR$ and intersects $\overline{PR}$ at point $S$.",
     "good": _fig({"Q": [0, 0], "R": [6, 0], "P": [0, 6], "S": [3, 3]}, segments=["PQ", "QR", "RP"], rays=["QS"],
                  arc_groups=[["PQS", "SQR"]]),
     "bad": _fig({"Q": [0, 0], "R": [6, 0], "P": [0, 6], "S": [2, 4]}, segments=["PQ", "QR", "RP"], rays=["QS"],
                 arc_groups=[["PQS", "SQR"]]),
     "why": "QS does not bisect ∠PQR (27° and 63°)"},
    {"id": "r7-share-endpoint",
     "text": r"$\overrightarrow{OA}$, $\overrightarrow{OB}$, and $\overrightarrow{OC}$ all share endpoint $O$, "
             r"$m\angle AOB = 40^\circ$, and $m\angle BOC = 50^\circ$. Find $m\angle AOC$.",
     "good": _fig({"O": [0, 0], "A": [5, 0], "B": [3.830, 3.214], "C": [0, 5]}, rays=["OA", "OB", "OC"],
                  angle_labels={"AOB": "40°", "BOC": "50°"}),
     "bad": _fig({"O": [0, 0], "A": [5, 0], "B": [3.830, 3.214], "C": [0, 5]}, rays=["AO", "OB", "OC"],
                 angle_labels={"AOB": "40°", "BOC": "50°"}),
     "why": "ray AO starts at A, not at O"},
    {"id": "r7-exterior-measure",
     "text": r"In $\triangle ABC$, side $\overline{BC}$ is extended to point $D$, and the exterior angle "
             r"$\angle ACD$ measures $120^\circ$. Find $m\angle ACB$.",
     "good": _fig({"A": [3, 3.464], "B": [0, 0], "C": [5, 0], "D": [8, 0]}, segments=["AB", "BC", "CA", "CD"],
                  angle_labels={"ACD": "120°"}),
     "bad": _fig({"A": [3, 3.464], "B": [0, 0], "C": [5, 0], "D": [-3, 0]}, segments=["AB", "BC", "CA", "BD"],
                 angle_labels={"ACD": "120°"}),
     "why": "D is behind B, so ∠ACD is 60°, not an exterior angle"},
    {"id": "r7-respectively",
     "text": r"$\overleftrightarrow{AB} \parallel \overleftrightarrow{CD}$, and transversal "
             r"$\overleftrightarrow{EF}$ cuts both lines at points $G$ and $H$ respectively. "
             r"If $m\angle BGF = 65^\circ$, find $m\angle DHF$.",
     "good": _fig({"A": [0, 0], "B": [6, 0], "C": [0, 3], "D": [6, 3], "E": [1.3, -1.5], "F": [4.1, 4.5],
                   "G": [2, 0], "H": [3.4, 3]}, lines=_EF_LINES,
                  parallel_groups=[["AB", "CD"]],
                  angle_labels={"BGF": "65°"}),
     "bad": _fig({"A": [0, 0], "B": [6, 0], "C": [0, 3], "D": [6, 3], "E": [1.3, -1.5], "F": [4.1, 4.5],
                  "G": [3.4, 3], "H": [2, 0]}, lines=_EF_LINES,
                  parallel_groups=[["AB", "CD"]],
                 angle_labels={"BGF": "65°"}),
     "why": "G is on CD and H on AB: the other way round"},
    # Review round 7: the reviewer's six wordings (code derives the facts).
    {"id": "r8-base-named-tri",
     "text": r"Isosceles $\triangle ABC$ has $AB = AC$ and isosceles $\triangle DEF$ has $DE = DF$. "
             r"Each base angle of $\triangle DEF$ measures $50^\circ$. Find $m\angle D$.",
     "good": _fig(_TWO_ISO_50, segments=["AB", "BC", "CA", "DE", "EF", "FD"],
                  tick_groups=[["AB", "AC"], ["DE", "DF"]], angle_labels={"DEF": "50°", "DFE": "50°"}),
     "bad": _fig(_TWO_ISO_70, segments=["AB", "BC", "CA", "DE", "EF", "FD"],
                 tick_groups=[["AB", "AC"], ["DE", "DF"]], angle_labels={"ABC": "50°", "ACB": "50°"}),
     "why": "DEF's base angles are 70°; the 50° marks are on ABC's"},
    {"id": "r8-base-two", "expect_declined": True,
     "text": r"Isosceles $\triangle ABC$ has $AB = AC$ and isosceles $\triangle DEF$ has $DE = DF$. "
             r"Each base angle measures $50^\circ$. Find $m\angle D$.",
     "good": _fig(_TWO_ISO_50, segments=["AB", "BC", "CA", "DE", "EF", "FD"],
                  tick_groups=[["AB", "AC"], ["DE", "DF"]],
                  angle_labels={"ABC": "50°", "ACB": "50°", "DEF": "50°", "DFE": "50°"}),
     "bad": _fig(_TWO_ISO_70, segments=["AB", "BC", "CA", "DE", "EF", "FD"],
                 tick_groups=[["AB", "AC"], ["DE", "DF"]], angle_labels={"ABC": "50°", "ACB": "50°"}),
     "why": "DEF's base angles are 70°"},
    {"id": "r8-respectively-order",
     "text": r"$\overleftrightarrow{AB} \parallel \overleftrightarrow{CD}$, with transversal "
             r"$\overleftrightarrow{EF}$ cutting both lines at points $G$ and $H$ respectively.",
     "good": _fig({"A": [0, 0], "B": [6, 0], "C": [0, 3], "D": [6, 3], "E": [1, -1], "F": [4, 4], "G": [1.6, 0],
                   "H": [3.4, 3]}, lines=_EF_LINES, parallel_groups=[["AB", "CD"]]),
     "bad": _fig({"A": [0, 0], "B": [6, 0], "C": [0, 3], "D": [6, 3], "E": [1, -1], "F": [4, 4], "G": [3.4, 3],
                  "H": [1.6, 0]}, lines=_EF_LINES, parallel_groups=[["AB", "CD"]]),
     "why": "G is on CD and H on AB"},
    {"id": "r8-intersects-subject",
     "text": r"In $\triangle PQR$, ray $QT$ bisects $\angle PQR$, with $QS = 5$, and intersects $\overline{PR}$ "
             r"at point $S$. Find $PS$.",
     "good": _fig({"Q": [0, 0], "P": [7.071, 0], "R": [0, 7.071], "S": [3.536, 3.536], "T": [2, 2]},
                  segments=["PQ", "QR", "RP", "QS"], rays=["QT"], arc_groups=[["PQT", "TQR"]], side_labels={"QS": "5"}),
     "bad": _fig({"Q": [0, 0], "P": [7.071, 0], "R": [0, 7.071], "S": [5, 2.071], "T": [2, 2]},
                 segments=["PQ", "QR", "RP", "QS"], rays=["QT"], arc_groups=[["PQT", "TQR"]], side_labels={"QS": "5"}),
     "why": "S is not on ray QT"},
    {"id": "r8-exterior-at-p",
     "text": r"In $\triangle PQR$, an exterior angle is formed at vertex $P$ by extending side $\overline{RP}$ "
             r"beyond $P$ to point $T$. The exterior angle at $P$ measures $110^\circ$. Find $m\angle Q$.",
     "good": _fig({"P": [0, 0], "R": [-5, 0], "T": [3, 0], "Q": [-1.368, 3.759]}, segments=["PQ", "QR", "RP", "PT"],
                  angle_labels={"QPT": "110°"}),
     "bad": _fig({"P": [0, 0], "R": [-5, 0], "T": [3, 0], "Q": [1.368, 3.759]}, segments=["PQ", "QR", "RP", "PT"],
                 angle_labels={"QPR": "110°"}),
     "why": "the interior angle at P is 110°, so the exterior angle is 70°"},
    {"id": "r8-props-parallel", "expect_declined": True,
     "text": r"$\overleftrightarrow{EF}$ intersects $\overleftrightarrow{AB}$ at $G$ and "
             r"$\overleftrightarrow{CD}$ at $H$, and $m\angle AGH = 70^\circ$. Using properties of parallel "
             r"lines, find $m\angle GHD$.",
     "good": _fig({"A": [3, 0], "B": [-3, 0], "C": [-2.316, 1.879], "D": [3.684, 1.879], "E": [-0.684, -1.879],
                   "F": [1.368, 3.759], "G": [0, 0], "H": [0.684, 1.879]}, lines=_EF_LINES,
                  angle_labels={"AGH": "70°"}),
     "bad": _fig({"A": [3, 0], "B": [-3, 0], "C": [-2.316, 0.679], "D": [3.684, 3.079], "E": [-0.684, -1.879],
                  "F": [1.368, 3.759], "G": [0, 0], "H": [0.684, 1.879]}, lines=_EF_LINES,
                 angle_labels={"AGH": "70°"}),
     "why": "AB and CD are not parallel"},
    # Review round 8: derived facts are checked, losslessly.
    {"id": "round8-subject-same-clause",
     "text": r"In $\triangle PQR$, $\overline{QT} \perp \overline{PR}$ and $\overline{EF} \parallel \overline{PQ}$ and "
             r"intersects $\overline{PR}$ at $S$. Find $PS$.",
     "good": _fig({"P": [0, 0], "R": [6, 0], "Q": [2, 4], "T": [2, 0], "S": [3, 0], "E": [2, -2], "F": [4, 2]},
                  segments=["PQ", "QR", "RP", "QT", "EF"], parallel_groups=[["EF", "PQ"]], right_angles=["QTP"]),
     "bad": _fig({"P": [0, 0], "R": [6, 0], "Q": [2, 4], "T": [2, -1], "S": [2, 0], "E": [4, 1], "F": [5, 3]},
                 segments=["PQ", "QR", "RP", "QT", "EF"], parallel_groups=[["EF", "PQ"]], right_angles=["QSP"]),
     "why": "S is QT's foot; EF does not pass through S"},
    {"id": "round8-on-the-segment",
     "text": r"In $\triangle PQR$, $\overline{EF} \parallel \overline{PQ}$ and intersects $\overline{PR}$ at $S$. "
             r"Find $PS$.",
     "good": _fig({"P": [0, 0], "R": [4, 0], "Q": [1, 3], "S": [2, 0], "E": [1.5, -1.5], "F": [3, 3]},
                  segments=["PQ", "QR", "RP", "EF"], parallel_groups=[["EF", "PQ"]]),
     "bad": _fig({"P": [0, 0], "R": [4, 0], "Q": [1, 3], "S": [6, 0], "E": [5, -3], "F": [7, 3]},
                 segments=["PQ", "QR", "RP", "EF"], parallel_groups=[["EF", "PQ"]]),
     "why": "S is on line PR past R, not on segment PR"},
    {"id": "round8-on-the-ray",
     "text": r"In $\triangle PQR$, ray $\overrightarrow{QT} \perp \overline{PQ}$ and intersects $\overline{PR}$ at "
             r"$S$. Find $PS$.",
     "good": _fig({"P": [0, 0], "R": [6, 0], "Q": [1, 1], "T": [1.5, 0.5], "S": [2, 0]},
                  segments=["PQ", "QR", "RP"], rays=["QT"], right_angles=["PQT"]),
     "bad": _fig({"P": [0, 0], "R": [6, 0], "Q": [1, 1], "T": [0, 2], "S": [2, 0]},
                 segments=["PQ", "QR", "RP"], rays=["QT"], right_angles=["PQT"]),
     "why": "S is behind Q, on line QT but not on ray QT"},
    {"id": "round8-corollary", "expect_declined": True,
     "text": r"In $\triangle ABC$, $m\angle B = 35^\circ$. Using the Corollary to the Triangle Sum Theorem, find "
             r"$m\angle A$.",
     "good": _fig({"A": [0, 0], "B": [4, 0], "C": [0, 2.801]}, segments=["AB", "BC", "CA"],
                  angle_labels={"ABC": "35°"}, right_angles=["BAC"]),
     "bad": _fig({"A": [3.27, 2.29], "B": [0, 0], "C": [4, 0]}, segments=["AB", "BC", "CA"],
                 angle_labels={"ABC": "35°"}),
     "why": "the corollary is about a right triangle; there is no right angle"},
    {"id": "round8-altitude-foot",
     "text": r"In $\triangle ABC$, altitude $\overline{CD}$ is perpendicular to $\overline{AB}$, $AB = 8$ and "
             r"$CD = 2$. Find the area of $\triangle ABC$.",
     "good": _fig({"A": [0, 0], "B": [8, 0], "C": [3, 2], "D": [3, 0]}, segments=["AB", "BC", "CA", "CD"],
                  side_labels={"AB": "8", "CD": "2"}, right_angles=["CDB"]),
     "bad": _fig({"A": [0, 0], "B": [8, 0], "C": [0, 5], "D": [0, 3]}, segments=["AB", "BC", "CA", "CD"],
                 side_labels={"AB": "8", "CD": "2"}, right_angles=["CAB"]),
     "why": "D is not on AB, so CD is not the altitude"},
    # Review round 9: "respectively" keeps each part's written kind.
    {"id": "round9-respectively-segment",
     "text": r"Given: $\overline{AB} \parallel \overline{CD}$, and $\overline{EF}$ cuts both lines at points $G$ and "
             r"$H$ respectively. Find $GH$.",
     "good": _fig({"A": [0, 0], "B": [6, 0], "C": [0, 4], "D": [6, 4], "E": [3, -1], "F": [3, 5], "G": [3, 0],
                   "H": [3, 4]}, segments=["AB", "CD", "EF"], parallel_groups=[["AB", "CD"]]),
     "bad": _fig({"A": [0, 0], "B": [6, 0], "C": [0, 4], "D": [6, 4], "E": [3, 5], "F": [3, 6], "G": [3, 0],
                  "H": [3, 4]}, segments=["AB", "CD", "EF"], parallel_groups=[["AB", "CD"]]),
     "why": "segment EF lies above both segments; G and H are only on its line"},
    # (Declined: both readings write EF as a line, which the ray "EF" is not.)
    {"id": "round9-respectively-ray", "expect_declined": True,
     "text": r"Given: $\overline{AB} \parallel \overline{CD}$, and $\overrightarrow{EF}$ cuts both lines at points "
             r"$G$ and $H$ respectively. Find $GH$.",
     "good": _fig({"A": [0, 0], "B": [6, 0], "C": [0, 4], "D": [6, 4], "E": [3, 5], "F": [3, 3], "G": [3, 0],
                   "H": [3, 4]}, segments=["AB", "CD"], rays=["EF"], parallel_groups=[["AB", "CD"]]),
     "bad": _fig({"A": [0, 0], "B": [6, 0], "C": [0, 4], "D": [6, 4], "E": [3, 5], "F": [3, 6], "G": [3, 0],
                  "H": [3, 4]}, segments=["AB", "CD"], rays=["EF"], parallel_groups=[["AB", "CD"]]),
     "why": "ray EF points away from both segments; G and H are behind E"},
]


# Review round 6 (coverage is an allowlist): correct figures that are now
# declined, each for a word no fact the reading has verifies. Refusing is
# allowed; passing a wrong figure is not. Each is a candidate for a fact
# kind or an exact rule, not for the inert list.
ROUND6_DECLINED: dict[str, str] = {
    "square": "“has side 6” (no length word) and “diagonal”",
    "prove-prove": "“meets them at X and Y”: “them” and “meets” are no fact's",
    "prove-show": "“them”", "prove-explain": "“them”", "prove-lowercase": "“them”",
    "prove-perp-marked": "“diagonals”",
    "r4-scalene": "“longest” in the target",
    "r4-unnamed-right": "“right”, “legs”, “hypotenuse” name no part",
    "r5-which": "“which”, “opposite”",
    "r5-major-arc": "“major arc ACB” in the target",
    # After the readings were re-recorded with the round-6 prompt:
    "par-and-equal": "the two readings disagree on whether ABCD is a trapezoid",
    "r5-two-right-angles": "the reading quoted “right angles at C”, which isn't the problem's words",
}


async def run_case(case: dict[str, Any]) -> dict[str, Any]:
    import api.core.question_bank_generation as qbg
    from api.core.geometry.facts import FigureFacts

    answer, request = case.get("answer", ""), case.get("request", "")
    try:
        facts, why = await qbg.read_figure_facts(
            case["text"], final_answer=answer, request=request, mode="bank_chat", user_id=None,
        )
    except Exception as e:  # noqa: BLE001 - a case that can't run fails its own check
        return {"id": case["id"], "error": repr(e)[:200], "reading": [], "good": None, "bad": None,
                "bad_caught": False, "bad_fixed_by_removing_marks": False}

    step_text = case.get("step")
    if step_text is not None and facts is not None:
        # A step figure: the step is read too, and its figure checked
        # against the question's facts and the step's.
        step = {"title": step_text.split(": ", 1)[0], "description": step_text.split(": ", 1)[1],
                "figure_spec": case["good"]}
        step_why = await qbg.read_step_facts([step], question_text=case["text"], facts=facts, mode="bank_chat",
                                             user_id=None)
        why = [*why, *step_why.get(1, [])]
        facts = step.get("figure_facts")

    def check(spec: dict[str, Any]) -> tuple[list[str], dict[str, Any] | None]:
        shown, svg, issues = qbg._check_figure(
            spec, case["text"], final_answer=answer, request=request, facts=facts, step_text=step_text,
            base=case.get("base"),
        )
        return ([], shown) if svg else (issues, None)

    good, _ = check(case["good"])
    bad, shown = check(case["bad"])
    # A wrong figure is caught when it is refused, or when what would be
    # shown is the correct figure (a mark the problem doesn't give, such as
    # the statement to prove, is removed rather than refused).
    caught = bool(bad) or _same(shown, case["good"])
    if isinstance(facts, FigureFacts):
        facts = facts.model_dump()
    return {
        "id": case["id"], "error": "", "reading": why, "facts": facts,
        "expect_declined": bool(case.get("expect_declined")) or case["id"] in ROUND6_DECLINED,
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
        # A wrong figure must be caught for what is wrong with it, not only
        # because a given isn't marked.
        "wrong_caught_only_as_unmarked": [
            r["id"] for r in results if r["bad"] and all(x.startswith("not marked:") for x in r["bad"])],
        "correct_passed": sum(1 for r in results if r["good"] == []),
        "correct_refused": {r["id"]: r["good"] for r in results if r["good"] and not r.get("expect_declined")},
        "readings_agreed": sum(1 for r in results if not r["error"] and not r["reading"]),
        "reading_failures": {r["id"]: r["reading"] for r in results if r["reading"] and not r.get("expect_declined")},
        # A problem that can't be checked as worded draws nothing: declined.
        "expected_declines": [r["id"] for r in results if r.get("expect_declined")],
        "declined_as_expected": [r["id"] for r in results if r.get("expect_declined") and r["reading"]],
    }


def main() -> None:
    from tests.harness.budget import ledger_from_env, spending_cap

    parser = argparse.ArgumentParser()
    parser.add_argument("--only", nargs="*")
    parser.add_argument("--cap", type=float, default=5.0)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    cases = [c for c in CASES if not args.only or c["id"] in args.only]
    ledger, total = ledger_from_env()
    with spending_cap("adversarial", cap_usd=args.cap, ledger=ledger, total_usd=total) as spend:
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
