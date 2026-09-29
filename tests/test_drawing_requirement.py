"""`requires_drawing(question)` — the default for a question's flag.

Leans toward flagging on purpose: drawings are recorded on every problem,
so a false positive costs a teacher click, a false negative costs a grade.
The phrasings below include every one a cold review found the first
version missing, and every trap from the prod bank that must stay off.
"""

from __future__ import annotations

import pytest

from api.core.drawing_requirement import requires_drawing


@pytest.mark.parametrize("question", [
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
])
def test_flags_drawing_requests(question: str) -> None:
    assert requires_drawing(question) is True


@pytest.mark.parametrize("question", [
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
    "Label your answer with units.",
    "Solve the system using the elimination method.",
    "",
])
def test_does_not_flag_non_requests(question: str) -> None:
    assert requires_drawing(question) is False


def test_none_is_false() -> None:
    assert requires_drawing(None) is False
