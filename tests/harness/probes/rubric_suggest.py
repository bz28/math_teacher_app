"""RubricSuggestProbe — is a teacher's comment a standing rule, and is it new?

When a teacher lowers an AI grade and writes why, one small AI call
(`api.core.rubric_suggestions._classify`) decides whether the reason is a
rule they'd hold any student to (offer to add it to the class rubric) or a
one-off about this student's work (offer nothing), and whether it matches
a rule the class already has or was offered. A wrong "rule" pesters the
teacher with an offer; a missed match re-asks something they declined.

The comments are modeled on real teacher reports (Oct 2026), reworded; no
student work. Replays at $0 from its own committed cassette dir.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from api.core.rubric_suggestions import _classify
from tests.harness.probe import Probe
from tests.harness.types import CheckResult, GeneratedItem, HarnessContext

_CASSETTE_DIR = Path(__file__).resolve().parent.parent / "_cassettes" / "rubric_suggest"

_LADDER = (
    "A 16-foot ladder leans against a wall at an 80° angle with the ground. "
    "How high up the wall does it reach, in feet?",
    "15.76 ft",
    "h = 15.76",
)
_ANGLES = (
    "A right triangle has legs 5 and 12. Find both acute angles, in degrees.",
    "22.62°, 67.38°",
    "A = 22.62, B = 67.38",
)
_SINE = (
    "For y = -2cos[3(x - π/4)] + 1 state the sinusoidal axis, amplitude, period and phase shift, and graph one period.",
    "y = 1; 2; 2π/3; π/4 right",
    "SA = 1, A = 2",
)
_EXPONENT = ("Simplify (x^4)^2 · x^0.", "x^8", "x^6")


@dataclass
class SuggestCase:
    name: str
    problem: tuple[str, str, str]
    comment: str
    kind: str  # expected "rule" | "one_off"
    known: list[tuple[str, str]] = field(default_factory=list)
    same_as: str | None = None  # expected match id (rules only)
    ai_percent: float = 100
    teacher_percent: float = 95


CASES: list[SuggestCase] = [
    # ── standing rules, from this month's reports ──
    SuggestCase("units-feet", _LADDER, "Full credit was given but the final answer isn't in feet.", "rule"),
    SuggestCase(
        "units-degrees", _ANGLES, "Both answers should have been in degrees. The student did not mark them.", "rule"
    ),
    SuggestCase(
        "axis-equation",
        _SINE,
        "The sinusoidal axis was not written as y = 1.",
        "rule",
        ai_percent=100,
        teacher_percent=90,
    ),
    SuggestCase(
        "label-points",
        _SINE,
        "The key points on the graph weren't labeled.",
        "rule",
        ai_percent=100,
        teacher_percent=85,
    ),
    SuggestCase(
        "show-work",
        _LADDER,
        "No work shown, just the answer. I need to see the setup.",
        "rule",
        ai_percent=100,
        teacher_percent=60,
    ),
    # ── one-offs: this student's mistake ──
    SuggestCase(
        "misread-exponent",
        _EXPONENT,
        "The student wrote 6 as the exponent, it should be 8.",
        "one_off",
        teacher_percent=50,
    ),
    SuggestCase("wrong-function", _SINE, "He graphed a sine curve instead of cosine.", "one_off", teacher_percent=60),
    SuggestCase(
        "sign-slip", _ANGLES, "Subtraction error on B, should be 67.38 not 77.38.", "one_off", teacher_percent=90
    ),
    SuggestCase("shifted-graph", _SINE, "Graph is shifted left instead of right.", "one_off", teacher_percent=80),
    # ── matching what the class already has or was offered ──
    SuggestCase(
        "matches-existing-rule",
        _ANGLES,
        "degrees missing on the angles",
        "rule",
        known=[("r1", "Final answers need units (ft, °, rad/min)."), ("r2", "Show work for full credit.")],
        same_as="r1",
    ),
    SuggestCase(
        "matches-declined-offer",
        _SINE,
        "needs y = in front of the axis value",
        "rule",
        known=[("s1a2b3c4", "Write the sinusoidal axis as an equation (y = 1, not just 1).")],
        same_as="s1a2b3c4",
        teacher_percent=90,
    ),
    SuggestCase(
        "new-despite-other-rules",
        _LADDER,
        "No unit on the answer.",
        "rule",
        known=[("r2", "Show work for full credit."), ("r3", "Label every key point on graphs.")],
        same_as=None,
    ),
]


class RubricSuggestProbe(Probe):
    name = "rubric-suggest"
    needs_browser = False
    default_constraint = (
        "Teacher grade-change comments: does the suggestion call tell standing "
        "rules from one-offs, and match a rule the class already has?"
    )

    def relevant_paths(self) -> list[str]:
        return [
            "api/core/rubric_suggestions.py",
            "api/core/llm_schemas.py",
            "tests/harness/probes/rubric_suggest.py",
        ]

    def capability_spec(self) -> str:
        return (
            "Reading a teacher's comment on a lowered grade and deciding whether it is a "
            "standing grading rule for the class or a one-off about one student's work, "
            "wording the rule, and recognizing a rule the class already has or was offered "
            "even when it is worded differently."
        )

    async def generate(self, ctx: HarnessContext, constraint: str | None = None) -> list[GeneratedItem]:
        prev = os.environ.get("HARNESS_CASSETTE_DIR")
        os.environ["HARNESS_CASSETTE_DIR"] = str(_CASSETTE_DIR)
        try:
            out = []
            for c in CASES:
                q, key, ans = c.problem
                res = await _classify(
                    question=q,
                    answer_key=key,
                    student_answer=ans,
                    ai_percent=c.ai_percent,
                    teacher_percent=c.teacher_percent,
                    comment=c.comment,
                    known=c.known,
                    user_id=None,
                )
                out.append(
                    GeneratedItem(
                        id=c.name,
                        label=f"[{c.kind}] {c.comment[:60]}",
                        problem_text=c.comment,
                        figure_svg=None,
                        figure_spec=None,
                        raw={
                            "expected_kind": c.kind,
                            "expected_same_as": c.same_as,
                            "known": [k for k, _ in c.known],
                            "result": res,
                        },
                    )
                )
            return out
        finally:
            if prev is None:
                os.environ.pop("HARNESS_CASSETTE_DIR", None)
            else:
                os.environ["HARNESS_CASSETTE_DIR"] = prev

    def deterministic_checks(self, item: GeneratedItem) -> list[CheckResult]:
        r = item.raw
        res = r["result"] or {}
        kind = res.get("kind")
        checks = [
            CheckResult(
                f"kind is {r['expected_kind']} (got {kind})",
                kind == r["expected_kind"],
                str(res),
            )
        ]
        if r["expected_kind"] == "rule":
            text = str(res.get("rule_text") or "")
            checks.append(CheckResult("a rule is worded", 0 < len(text) <= 160, text))
            if r["known"]:
                checks.append(
                    CheckResult(
                        f"matches {r['expected_same_as']!r} (got {res.get('same_as')!r})",
                        res.get("same_as") == r["expected_same_as"],
                        text,
                    )
                )
        return checks
