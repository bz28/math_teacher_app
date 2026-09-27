"""`requires_drawing(question)` — the flag that gates the drawings channel.

Every false case below is a real trap from the prod bank (Sep 2026): the
wording mentions drawings, graphs, figures or tables, but the student is
not being asked to produce one.
"""

from __future__ import annotations

import pytest

from api.core.drawing_requirement import requires_drawing


@pytest.mark.parametrize("question", [
    "Solve the system by graphing. Identify the solution as an ordered pair. $$y = 2x - 1$$",
    "Graph $y = 3x - 2$ and label the y-intercept.",
    "Sketch the graph of $f(x) = x^2 - 4$.",
    "Plot the points $A(1, 2)$ and $B(3, -1)$ on a coordinate plane.",
    "Solve $2x - 3 > 5$ and graph the solution on a number line.",
    "Shade the region that satisfies $y \\le 2x + 1$.",
    "Draw a triangle with sides 3, 4 and 5 and label each vertex.",
    "(a) Find the slope. (b) Graph the line.",
    "a) Solve for $x$. b) Plot your answer on the number line.",
    "Make a table of values for $y = 2x + 1$, then graph it.",
    "Complete a table of values for $x = -2, \\dots, 2$.",
    "Construct the perpendicular bisector of $\\overline{AB}$.",
    "Solve $x^2 = 9$. Then sketch the parabola.",
    "Include a sketch of the situation.",
])
def test_flags_real_drawing_requests(question: str) -> None:
    assert requires_drawing(question) is True


@pytest.mark.parametrize("question", [
    # a printed figure, not a request
    "Using the graph shown, find $f(2)$ and the y-intercept.",
    "Use the graph below to estimate the solution of the system.",
    "In the figure below, rays $OA$ and $OB$ share endpoint $O$. Find $x$.",
    "In the right triangle below, the hypotenuse has length 13. Find the missing leg.",
    # a two-column proof's printed table
    "Complete the two-column proof. Copy and complete the table below, supplying the "
    "missing statements and reasons. | Statements | Reasons |",
    "Write a two-column proof.",
    # a proof's auxiliary construction, part of the given
    "Let $D$ be the midpoint of $\\overline{BC}$, and draw $\\overline{AD}$. Prove: "
    "$\\angle ABC \\cong \\angle ACB$.",
    # past participle / noun uses
    "A diagonal is drawn from one corner to the opposite corner. Find its length.",
    "If a figure is a square, then it has four congruent sides. Write the converse.",
    "Use the Law of Detachment to draw a conclusion, or explain why none can be drawn.",
    "If $P = -7$ and $Q = 15$ on a number line, find the coordinate of $M$.",
    "Label your answer with units.",
    "Construct a two-column proof that vertical angles are congruent.",
    "Solve the system using the elimination method.",
    "",
])
def test_does_not_flag_non_requests(question: str) -> None:
    assert requires_drawing(question) is False


def test_none_is_false() -> None:
    assert requires_drawing(None) is False
