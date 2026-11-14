"""The text auditor: one AI call that lists what a problem states about its
figure that the agreed facts don't capture, each with the problem's exact
words.

Two readings that agree can still both leave the same stated fact out, and
code never checks a fact that isn't there. The auditor is shown the problem
and the agreed facts, written by code in plain notation (never the
readings' own quotes, so a fact is judged by what it says), and asked to go
through the problem statement by statement. A statement it marks as not
captured is a gap: the problem gets no figure, with the statement's words
as the reason. It never sees a drawing; code still checks every fact
arithmetically. A finding whose quote is not the problem's own words is
still a gap (an auditor that can't quote fails closed).
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any

from api.core.geometry.facts import Fact, FigureFacts, _length_role, _norm_quote, describe, split_names

logger = logging.getLogger(__name__)

AUDIT_SYSTEM = """You check a geometry figure checker's fact list against the problem it came from.

Code will draw a figure for the problem and verify, by arithmetic, ONLY the facts in the list. If
the problem states something about its figure that the list leaves out, a drawing could get that
wrong and still pass. Your job is to find every such statement, with evidence.

Go through the problem one statement at a time, in order: each clause that says something about
the figure, the question, any hint, and each statement to prove. For each one, copy its exact words
from the problem (character for character, LaTeX included) and give the numbers of the listed facts
that capture it. Then try to break it: is there a figure that satisfies EVERY listed fact (and the
parts and names listed) in which this statement is false? If so, describe that figure in one short
sentence as the counterexample. If not, the counterexample is "".

What a statement can say about the figure: which points lie where (on, between, inside, beyond,
extended), which parts are parallel, perpendicular, equal or congruent, every measure and length and
the part it belongs to, shapes ("isosceles", "rhombus", "right", "acute", "altitude", "median",
"diameter"), comparisons ("longest", "largest", "greater than", ratios), and the subject of each
verb (WHICH line "intersects PR at S"). "each", "both", "respectively" and lists state one thing per
part, and every part must hold.

Not counterexamples:
- A figure the listed facts already rule out. Consequences count: a square's sides are equal, a
  midpoint is on its segment, two angles of 41° are equal, a hypotenuse is the longest side.
- What names already say: one name is one point everywhere; "EF and AB meet at G" puts G on both
  EF and AB; ray OA starts at O, ∠AOB has its vertex at O, △ABC has sides AB, BC, CA,
  quadrilateral ABCD has diagonals AC and BD, the parts listed are drawn.
- Questions and instructions: what is asked ("Find m∠B", "name the longest side") when the asked list
  has it; the form of an answer ("write a two-column proof", "state the theorem"); a method named
  only as a method ("by SAS", "CPCTC", "the Reflexive Property"). But words that tell you something
  about THIS figure are statements wherever they are: "find the longest side, AB" says AB is the
  longest; "use the Vertical Angles Theorem" says the angles are vertical angles; "since M is the
  midpoint of BC" says M is.
- Story objects: a wall, the ground or a flagpole is not drawn. What the story says about the shape
  counts (a vertical wall on level ground makes a right angle where they meet; "directly above"
  is perpendicular to the ground); which object a point touches does not.
- What the problem doesn't say: never require more than its words state."""

AUDIT_TOOL: dict[str, Any] = {
    "name": "audit_facts",
    "description": "Each statement of the problem, the listed facts that capture it, and a counterexample if any.",
    "input_schema": {
        "type": "object",
        "properties": {
            "statements": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "quote": {"type": "string", "description": "The statement's exact words from the problem."},
                        "facts": {"type": "array", "items": {"type": "integer"},
                                  "description": "Numbers of the listed facts that capture it."},
                        "counterexample": {
                            "type": "string",
                            "description": ("A figure meeting every listed fact in which the statement is false; "
                                            "\"\" if none.")},
                    },
                    "required": ["quote", "facts", "counterexample"],
                },
            },
        },
        "required": ["statements"],
    },
}


@dataclass(frozen=True)
class Finding:
    quote: str  # the problem's words, as the auditor copied them
    missing: str  # the auditor's counterexample: a figure meeting every fact where the statement is false
    quoted: bool  # the quote is the problem's own words (after normalizing notation)


def _fact_line(f: Fact) -> str:
    said = describe(f)
    p = f.point or ""
    if p and not re.search(rf"(?<![A-Z]){re.escape(p)}(?![0-9']*[a-z0-9'])", said.split("(")[0]):
        # The point a fact carries that its plain words leave out.
        said += {"right_triangle": f" with the right angle at {p}", "isosceles": f" with apex {p}",
                 "perpendicular": f", meeting at {p}"}.get(f.kind, f" (at {p})")
    # A length with no named part keeps the role its words give it
    # ("the hypotenuse is 10"), which the checker places by.
    if f.kind == "equal_length" and not any(split_names(x) for x in f.items):
        role = _length_role(f.quote)
        if role and role != "unplaced":
            said = f"a {role} of length {said.rsplit(' ', 1)[-1]}"
    return said


def render_facts(facts: FigureFacts, problem_text: str = "") -> str:
    """The agreed reading in plain notation, written by code, numbered,
    with what code itself reads from the problem's words (coordinates,
    shaded regions), which the drawing is checked against too."""
    from api.core.geometry.facts import _ANGLE_SUM, _angle_sum_of_triangle
    from api.core.geometry.figure_check import _clean, _plain, coordinates, shaded_regions

    lines: list[str] = []
    parts = [("Points", facts.points), ("Segments", facts.segments), ("Rays", facts.rays),
             ("Lines", [*facts.lines, *facts.named_lines]), ("Triangles", [f"△{t}" for t in facts.triangles]),
             ("Polygons", facts.polygons), ("Circles", [f"circle {c}" if c else "a circle" for c in facts.circles])]
    for name, items in parts:
        if items:
            lines.append(f"{name}: {', '.join(items)}")
    n = 0
    for title, section in (("Given (checked on the drawing)", facts.givens),
                           ("To prove (must be true in the drawing)", facts.prove)):
        if section:
            lines.append(f"{title}:")
            for f in section:
                n += 1
                lines.append(f"  {n}. {_fact_line(f)}")
    if not facts.givens and not facts.prove:
        lines.append("Given: (none)")
    t = _clean(problem_text)
    at = coordinates(t)
    if len(at) >= 2:
        n += 1
        lines.append(f"  {n}. the points are at " + ", ".join(f"{p}({x:g}, {y:g})" for p, (x, y) in sorted(at.items())))
    for m in _ANGLE_SUM.finditer(t):
        if _angle_sum_of_triangle(m.group(0), facts):
            n += 1
            lines.append(f"  {n}. {_plain(m.group(0))} (true in every triangle)")
    for region in shaded_regions(t):
        n += 1
        if region[0] == "sector":
            _, center, ends, major = region
            a, b = sorted(ends)
            lines.append(f"  {n}. the {'major ' if major else ''}sector {a}{center}{b} is shaded")
        else:
            lines.append(f"  {n}. the region {''.join(region[1])} is shaded")
    if facts.find:
        lines.append("Asked: " + ", ".join(
            (f"∠{t.item.lstrip('∠')}" if t.kind == "angle" else t.item) for t in facts.find))
    if facts.requested:
        lines.append("The teacher asked to draw: " + ", ".join(p.item for p in facts.requested))
    return "\n".join(lines)


def audit_message(problem_text: str, facts: FigureFacts, request: str = "") -> str:
    msg = f"Problem:\n{problem_text}\n\nThe fact list:\n{render_facts(facts, problem_text)}"
    if request:
        msg += f"\n\nThe teacher's message (what to draw; not part of the problem):\n{request}"
    return msg


def _squash(s: str) -> str:
    return re.sub(r"\s+", "", _norm_quote(s))


def findings(problem_text: str, result: dict[str, Any]) -> list[Finding]:
    """The statements the auditor says are not fully captured."""
    out: list[Finding] = []
    text = _squash(problem_text)
    for s in result.get("statements") or []:
        if not isinstance(s, dict):
            continue
        missing = str(s.get("counterexample") or "").strip()
        if not missing:
            continue
        quote = str(s.get("quote") or "").strip()
        out.append(Finding(quote=quote, missing=missing, quoted=bool(quote) and _squash(quote) in text))
    return out


async def audit_reading(problem_text: str, facts: FigureFacts, *, request: str = "", mode: str,
                        user_id: str | None, generation_job_id: str | None = None) -> list[Finding]:
    """Ask the auditor what the problem states that `facts` doesn't capture."""
    from api.core.llm_client import MODEL_REASON, call_claude_json

    result = await call_claude_json(
        AUDIT_SYSTEM, audit_message(problem_text, facts, request), mode=mode, tool_schema=AUDIT_TOOL,
        user_id=user_id, model=MODEL_REASON, max_tokens=3000, temperature=0.0,
        generation_job_id=generation_job_id,
    )
    return findings(problem_text, result)
