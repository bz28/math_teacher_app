"""The fact-card checker on the AI's own recorded drawings ($0, no AI call).

PR #998's generation eval recorded the AI drawing 8 figures for 8 problems,
each checked then against two AI readings of the problem's words and each
looked at by eye ("right"). Here each problem is written as a fact card BY
HAND, from the problem as the AI worded it (an independent expected value:
nobody's reading code wrote these), and the same recorded drawing is checked
against the card alone, with the words code writes from the card:

  - every recorded drawing that was right must pass against its card
    (otherwise the card path loses figures the reading path kept);
  - every known-wrong version (#998's NEGATIVES, a point moved) must be
    rejected against the card (otherwise the card path checks less);
  - a version with a part of the card left out (a segment, a mark) or a
    student-constructed part drawn must be rejected too.

The four "should have a figure" problems the AI wrote as stories (set1-p3,
p6, p8, set2-p8: no figure in #998) are written here as cards with a
context sentence, to show their words; they have no recorded drawing, so
the live eval (generation_figures.py, cards mode) measures them.

Run: python -m tests.harness.probes.fact_card_recorded
"""

from __future__ import annotations

import json
from typing import Any


def F(kind: str, items: list[str], **kw: Any) -> dict[str, Any]:  # noqa: N802 - a fact
    return {"kind": kind, "items": items, **kw}


# key: (the card, the drawing recorded in #998 (by eye: right), its final answer)
RECORDED: dict[str, tuple[dict[str, Any], dict[str, Any], str]] = {
    "set1-p1": (
        {"points": list("ABCDM"), "triangles": ["AMB", "CMD"],
         "givens": [F("midpoint", ["AC"], point="M"), F("midpoint", ["BD"], point="M")],
         "prove": [F("congruent_triangles", ["AMB", "CMD"])]},
        {"arc_groups": [], "points": {"A": [0, 2], "B": [4, 4], "C": [6, 2], "D": [2, 0], "M": [3, 2]},
         "segments": ["AM", "MC", "BM", "MD", "AB", "CD"], "shape": "construction",
         "tick_groups": [["AM", "MC"], ["BM", "MD"]], "type": "geometry"},
        r"$\triangle AMB \cong \triangle CMD$ by SAS",
    ),
    "set1-p2": (
        {"points": list("OPQR"), "circles": ["O"], "segments": ["PQ", "PR"],
         "givens": [F("on_circle", ["P", "Q", "R"], circle="O"), F("angle_measure", ["QPR"], value=37)],
         "find": [{"kind": "angle", "item": "QOR"}]},
        {"angle_labels": {"QPR": "37°"}, "circles": [{"center": "O", "through": "P"}],
         "points": {"O": [4.0, 4.0], "P": [4.0, 0.0], "Q": [1.593, 7.195], "R": [6.407, 7.195]},
         "segments": ["PQ", "PR", "OQ", "OR"], "shape": "construction", "type": "geometry"},
        r"$m\angle QOR = 74°$",
    ),
    "set1-p5": (
        {"points": list("ABCDE"), "lines": ["AB", "CD"], "triangles": ["ABE", "DCE"],
         "givens": [F("parallel", ["AB", "CD"]), F("midpoint", ["BC"], point="E")],
         "prove": [F("congruent_triangles", ["ABE", "DCE"])]},
        {"lines": [{"through": ["A", "B"]}, {"through": ["C", "D"]}], "parallel_groups": [["AB", "CD"]],
         "points": {"A": [0.0, 3.0], "B": [3.0, 3.0], "C": [6.0, 0.0], "D": [9.0, 0.0], "E": [4.5, 1.5]},
         "segments": ["AB", "BE", "CE", "CD", "AE", "DE"], "shape": "construction",
         "tick_groups": [["BE", "CE"]], "type": "geometry"},
        r"$\triangle ABE \cong \triangle DCE$ by ASA",
    ),
    "set2-p1": (
        {"points": list("ABCDEFG"), "lines": ["AB", "CD", "EF"],
         "givens": [F("parallel", ["AB", "CD"]), F("transversal", ["EF", "AB", "CD"]),
                    F("on_line", ["AB"], point="E"), F("on_line", ["CD"], point="F"), F("on_line", ["EF"], point="G"),
                    F("angle_measure", ["AEG"], value=112)],
         "find": [{"kind": "angle", "item": "CFG"}]},
        {"angle_labels": {"AEG": "112°"},
         "lines": [{"through": ["A", "B"]}, {"through": ["C", "D"]}, {"through": ["E", "F"]}],
         "parallel_groups": [["AB", "CD"]],
         "points": {"A": [0, 4], "B": [8, 4], "C": [0, 0], "D": [8, 0], "E": [2, 4], "F": [3.616, 0],
                    "G": [4.248, -1.563]},
         "segments": [], "shape": "construction", "type": "geometry"},
        r"$m\angle CFG = 112°$",
    ),
    "set2-p3": (
        {"points": list("ABC"), "triangles": ["ABC"],
         "givens": [F("right_triangle", ["ABC"], point="C"), F("equal_length", ["AB"], value=17),
                    F("equal_length", ["AC"], value=8)],
         "find": [{"kind": "segment", "item": "BC"}]},
        {"points": {"A": [8, 0], "B": [0, 15], "C": [0, 0]}, "right_angles": ["ACB"],
         "segments": ["AB", "AC", "BC"], "shape": "construction", "side_labels": {"AB": "17", "AC": "8"},
         "type": "geometry"},
        "$BC = 15$",
    ),
    "set2-p4": (
        {"points": list("ABCDEFPQ"), "lines": ["AB", "CD", "PQ"],
         "givens": [F("parallel", ["AB", "CD"]), F("transversal", ["PQ", "AB", "CD"]),
                    F("intersect", ["AB", "PQ"], point="E"), F("intersect", ["CD", "PQ"], point="F"),
                    F("angle_measure", ["BEF"], expr="3x + 14"), F("angle_measure", ["DFE"], expr="5x - 10")],
         "find": [{"kind": "other", "item": "x"}]},
        {"angle_labels": {"BEF": "$(3x+14)°$", "DFE": "$(5x-10)°$"}, "arc_groups": [],
         "lines": [{"through": ["A", "B"]}, {"through": ["C", "D"]}, {"through": ["P", "Q"]}],
         "parallel_groups": [["AB", "CD"]],
         "points": {"A": [0, 6], "B": [8, 6], "C": [8, 2], "D": [0, 2], "E": [3, 6], "F": [6.357, 2],
                    "P": [0.482, 9], "Q": [8.875, -1]},
         "segments": [], "shape": "construction", "type": "geometry"},
        "$x = 12$",
    ),
    "set2-p5": (
        {"points": list("GHJKLMNP"), "lines": ["JK", "LM", "NP"],
         "givens": [F("parallel", ["JK", "LM"]), F("transversal", ["NP", "JK", "LM"]),
                    F("intersect", ["JK", "NP"], point="G"), F("intersect", ["LM", "NP"], point="H"),
                    F("angle_measure", ["KGN"], value=67)],
         "find": [{"kind": "angle", "item": "LHN"}]},
        {"angle_labels": {"KGN": "67°"},
         "lines": [{"name": "JK", "through": ["J", "K"]}, {"name": "LM", "through": ["L", "M"]},
                   {"name": "NP", "through": ["N", "P"]}],
         "parallel_groups": [["JK", "LM"]],
         "points": {"G": [4, 6], "H": [2.302, 2], "J": [0, 6], "K": [8, 6], "L": [0, 2], "M": [8, 2],
                    "N": [5.172, 8.762], "P": [1.521, 0.159]},
         "segments": [], "shape": "construction", "type": "geometry"},
        r"$m\angle LHN = 113°$",
    ),
    "set2-p7": (
        {"points": list("ABC"), "triangles": ["ABC"],
         "givens": [F("right_triangle", ["ABC"], point="C"), F("equal_length", ["AB"], value=20),
                    F("equal_length", ["BC"], value=12)],
         "find": [{"kind": "segment", "item": "AC"}]},
        {"points": {"A": [0, 16], "B": [12, 0], "C": [0, 0]}, "right_angles": ["BCA"],
         "segments": ["AB", "BC", "AC"], "shape": "construction", "side_labels": {"AB": "20", "BC": "12"},
         "type": "geometry"},
        "$AC = 16$",
    ),
}

# #998's known-wrong version of each recorded figure (generation_figures.NEGATIVES).
NEGATIVES: dict[str, dict[str, Any]] = {
    "set1-p1": {"move": {"M": [2.5, 2]}},
    "set1-p2": {"move": {"P": [4, 1]}},
    "set1-p5": {"move": {"E": [4.5, 2.5]}},
    "set2-p1": {"move": {"C": [0, 1]}},
    "set2-p3": {"move": {"B": [0, 10]}},
    "set2-p4": {"move": {"C": [8, 3]}},
    "set2-p5": {"move": {"M": [8, 3]}},
    "set2-p7": {"move": {"A": [0, 8]}},
}
# A part of the card left out of the drawing: the card must notice.
LEFT_OUT: dict[str, dict[str, Any]] = {
    "set1-p1": {"drop": ["AB"]},  # a side of △AMB
    "set1-p2": {"drop": ["PQ"]},  # a side of ∠QPR
    "set1-p5": {"drop": ["DE"]},  # a side of △DCE
    "set2-p3": {"drop": ["BC"]},
    "set2-p7": {"drop": ["AC"]},
}

# The four story problems of #998 (no figure there), as cards with a context.
STORIES: dict[str, tuple[dict[str, Any], str, str]] = {
    "set1-p3": ({"points": list("ABC"), "triangles": ["ABC"],
                 "givens": [F("right_triangle", ["ABC"], point="C"), F("equal_length", ["AB"], value=13),
                            F("equal_length", ["BC"], value=5)], "find": [{"kind": "segment", "item": "AC"}]},
                "A ladder leans against a wall.", ""),
    "set1-p6": ({"points": list("ABPO"), "circles": ["O"], "lines": ["PA"], "segments": ["AB"],
                 "givens": [F("chord", ["AB"], circle="O"), F("tangent", ["PA"], circle="O", point="A"),
                            F("angle_measure", ["PAB"], value=54)], "find": [{"kind": "angle", "item": "AOB"}]},
                "A garden has two paths that start at one spot on its edge.", ""),
    "set1-p8": ({"points": list("ABPCO"), "circles": ["O"], "lines": ["PA"], "segments": ["AB"],
                 "givens": [F("chord", ["AB"], circle="O"), F("tangent", ["PA"], circle="O", point="A"),
                            F("on_circle", ["C"], circle="O"), F("inscribed_angle", ["ACB"], circle="O", value=58)],
                 "find": [{"kind": "angle", "item": "PAB"}]},
                "", "Use the inscribed angle that opens onto the same arc."),
    "set2-p8": ({"points": list("ABCDE"), "polygons": ["ABCD"], "triangles": ["CDE"],
                 "givens": [F("rectangle", ["ABCD"]), F("right_angle", ["CDE"]), F("equal_length", ["AB"], value=14),
                            F("equal_length", ["BC"], value=9), F("equal_length", ["DE"], value=6)],
                 "find": [{"kind": "segment", "item": "CE"}]},
                "A floor plan has a room and a nook.", ""),
}


def _mutate(spec: dict[str, Any], change: dict[str, Any]) -> dict[str, Any]:
    from tests.harness.probes.construction_figures import mutate

    return mutate(spec, change)


def run() -> dict[str, Any]:
    import api.core.question_bank_generation as qbg
    from api.core.geometry.fact_card import card_text, clean_context, clean_hint, read_card

    out: dict[str, Any] = {"cases": {}, "passed": [], "failed": {}, "negatives_rejected": [],
                           "negatives_passed": [], "left_out_rejected": [], "left_out_passed": [], "stories": {}}
    for key, (raw, spec, answer) in RECORDED.items():
        card, why = read_card(raw)
        if card is None:
            out["failed"][key] = f"card refused: {why}"
            continue
        text = card_text(card)
        out["cases"][key] = text
        _s, svg, issues = qbg._check_figure(spec, text, final_answer=answer, facts=card)
        (out["passed"].append(key) if svg else out["failed"].__setitem__(key, "; ".join(issues)))
        for name, changes in (("negatives", NEGATIVES), ("left_out", LEFT_OUT)):
            if key in changes:
                _s, bad, _i = qbg._check_figure(_mutate(spec, changes[key]), text, final_answer=answer, facts=card)
                out[f"{name}_{'passed' if bad else 'rejected'}"].append(key)
    for key, (raw, context, hint) in STORIES.items():
        card, why = read_card(raw)
        kept = clean_context(context)[0], clean_hint(hint)[0]
        out["stories"][key] = card_text(card, context=kept[0], hint=kept[1]) if card else f"refused: {why}"
    return out


def main() -> None:
    print(json.dumps(run(), indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
