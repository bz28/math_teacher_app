"""DrawingFlagProbe — the requires-drawing classifier call vs the regex vs truth.

Founder decision (PR #907): a question's `requires_drawing` is set by AI
when the problem is created (and only again when its text changes and no
teacher has set it), OR'd with the regex classifier (also the frozen
migration backfill). This probe runs the real classification call
(`api.core.drawing_requirement._llm_requires_drawing`) on every labeled
phrasing collected across the reviews, gates the stored (combined) flag
against truth, and reports AI vs regex in each check's detail.

The labels are the same lists the regex unit tests use
(tests/test_drawing_requirement.py imports them from here), so the two
classifiers are judged on one corpus. Replays at $0 from its own
committed cassette dir.
"""

from __future__ import annotations

import os
from pathlib import Path

from api.core.drawing_requirement import (
    _llm_requires_drawing,
    combine_requires_drawing,
    requires_drawing,
)
from tests.harness.probe import Probe
from tests.harness.types import CheckResult, GeneratedItem, HarnessContext

_CASSETTE_DIR = Path(__file__).resolve().parent.parent / "_cassettes" / "drawing_flag"

# Asks the student to produce a drawing.
REQUIRES_DRAWING: list[str] = [
    # the prod bank's three
    "Solve the system by graphing. Identify the solution as an ordered pair. $$y = 2x - 1$$",
    # imperatives anywhere in the sentence
    "Graph $y = 3x - 2$ and label the y-intercept.",
    "On the coordinate plane, graph $y = 2x$.",
    "For each equation, graph the line.",
    "Given $f(x) = x^2$, graph $f$.",
    "Solve $x + 2 > 5$, graph the solution.",
    "Solve $2x - 3 > 5$ and graph the solution on a number line.",
    "You must graph both equations.",
    "The student should graph the parabola and mark its vertex.",
    "Sketch the graph of $f(x) = x^2 - 4$.",
    "Plot the points $A(1, 2)$ and $B(3, -1)$ on a coordinate plane.",
    "Shade the region that satisfies $y \\le 2x + 1$.",
    "Draw a triangle with sides 3, 4 and 5 and label each vertex.",
    "Draw $\\overline{AB}$ and $\\overline{CD}$ so that they intersect at $E$.",
    "Construct the perpendicular bisector of $\\overline{AB}$.",
    "(a) Find the slope. (b) Graph the line.",
    "a) Solve for $x$. b) Plot your answer on the number line.",
    "Solve $x^2 = 9$. Then sketch the parabola.",
    "Graphing: $y = 2x + 1$",
    # method-by-graph phrasings
    "Solve the system graphically.",
    "Use a graph to solve $x^2 - 4 = 0$.",
    "Solve using a graph.",
    "Model the problem with a graph.",
    # show / represent / illustrate on a visual
    "Represent $x > 3$ on a number line.",
    "Show your answer on a number line.",
    "Show the solution on the coordinate plane.",
    "Illustrate the solution on a number line.",
    "Illustrate the relationship with a diagram.",
    "Label the vertex on your graph.",
    # making a chart / table of values
    "Make a bar graph of the survey results.",
    "Create a scatter plot of the data.",
    "Create a histogram of the scores.",
    "Make a table of values for $y = 2x + 1$, then graph it.",
    "Complete a table of values for $x = -2, \\dots, 2$.",
    "Include a sketch of the situation.",
    "Draw a number line and shade the solution of $x > 2$.",
    "Solve algebraically, then graph both lines to check (required).",
]

# Doesn't — every trap here was found in the prod bank or by a review.
NOT_A_DRAWING: list[str] = [
    # a printed figure
    "Using the graph shown, find $f(2)$ and the y-intercept.",
    "Use the graph below to estimate the solution of the system.",
    "In the figure below, rays $OA$ and $OB$ share endpoint $O$. Find $x$.",
    "In the right triangle below, the hypotenuse has length 13. Find the missing leg.",
    # a two-column proof's printed table, and proofs themselves
    "Complete the two-column proof. Copy and complete the table below, supplying the "
    "missing statements and reasons. | Statements | Reasons |",
    "Write a two-column proof.",
    "Construct a two-column proof that vertical angles are congruent.",
    "Sketch a proof that the base angles of an isosceles triangle are congruent.",
    # an auxiliary segment inside a proof
    "Let $D$ be the midpoint of $\\overline{BC}$, and draw $\\overline{AD}$. Prove: "
    "$\\angle ABC \\cong \\angle ACB$.",
    # participles, idioms, number line as a coordinate system
    "A diagonal is drawn from one corner to the opposite corner. Find its length.",
    "If a figure is a square, then it has four congruent sides. Write the converse.",
    "Use the Law of Detachment to draw a conclusion, or explain why none can be drawn.",
    "If $P = -7$ and $Q = 15$ on a number line, find the coordinate of $M$.",
    "On a number line, find the distance between $-3$ and $5$.",
    "Plot twist: solve $2x = 4$.",
    # multiple choice, probability, optional
    "Which graph shows the line $y = 2x + 1$? (A) … (B) … (C) … (D) …",
    "A bag holds 3 red and 2 blue marbles. Draw a marble at random. What is P(red)?",
    "You draw two cards from a standard deck without replacement. Find P(both aces).",
    "Solve $3x + 1 = 7$. Check your answer by graphing (optional).",
    # negated requests
    "Solve the system without graphing.",
    "Do not graph; solve algebraically.",
    "Don't use a graph — use substitution.",
    "Solve by substitution. Do not use a graph.",
    "Label your answer with units.",
    "Solve the system using the elimination method.",
    "",
]


class DrawingFlagProbe(Probe):
    name = "drawing-flag"
    needs_browser = False
    default_constraint = (
        "Labeled question phrasings: does the requires-drawing classification call "
        "agree with the truth (and with the regex fallback)?"
    )

    def relevant_paths(self) -> list[str]:
        return [
            "api/core/drawing_requirement.py",
            "api/core/llm_schemas.py",
            "tests/harness/probes/drawing_flag.py",
        ]

    def capability_spec(self) -> str:
        return (
            "Deciding from a homework question's text whether it asks the student to "
            "produce a drawing (graph, plot, sketch, number line, diagram, data "
            "display, construction) — as opposed to reading a printed figure, a "
            "multiple-choice 'which graph', a negated or optional drawing, or 'draw' "
            "in another sense."
        )

    async def generate(self, ctx: HarnessContext, constraint: str | None = None) -> list[GeneratedItem]:
        # Every labeled phrasing is recorded, so the replay covers the corpus.
        cases = [(q, True) for q in REQUIRES_DRAWING] + [(q, False) for q in NOT_A_DRAWING if q]
        prev_dir = os.environ.get("HARNESS_CASSETTE_DIR")
        os.environ["HARNESS_CASSETTE_DIR"] = str(_CASSETTE_DIR)
        try:
            out = []
            for i, (q, truth) in enumerate(cases, 1):
                llm = await _llm_requires_drawing(q)
                out.append(GeneratedItem(
                    id=f"flag-{i:03d}", label=f"[{'yes' if truth else 'no'}] {q[:60]}",
                    problem_text=q, figure_svg=None, figure_spec=None,
                    raw={"question": q, "truth": truth, "llm": llm, "regex": requires_drawing(q),
                         "stored": combine_requires_drawing(q, llm)},
                ))
            return out
        finally:
            if prev_dir is None:
                os.environ.pop("HARNESS_CASSETTE_DIR", None)
            else:
                os.environ["HARNESS_CASSETTE_DIR"] = prev_dir

    def deterministic_checks(self, item: GeneratedItem) -> list[CheckResult]:
        # What ships is the stored flag (AI OR regex). The AI alone is
        # reported in the detail, not gated: it isn't what grading reads.
        r = item.raw
        ok = r["stored"] == r["truth"]
        return [
            CheckResult(
                f"stored flag agrees with the label ({r['stored']} vs {r['truth']})",
                ok,
                f"AI {r['llm']}, regex {r['regex']}",
            ),
        ]
