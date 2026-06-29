"""GradingProbe — tests AI grading QUALITY against a hand-labeled golden set.

The grader (`api/core/grading_ai.grade_submission_with_ai`) is deliberately NOT
given the worked solution. It sees only the question, the teacher's final answer
+ rubric, and the student's extracted work — then judges that work on its own
merits. That design avoids biasing the grade toward one canonical method, but it
makes a quality question unavoidable: does an evaluate-on-merits grader (a)
accept a *valid alternative method* without penalty, and (b) still catch
*broken/fabricated work* that happens to land on the right answer?

This probe answers both with a small set of UNAMBIGUOUS, hand-labeled cases. Each
case is a (problem, synthetic extraction, expected score_status) triple spanning
a five-way matrix:

  (a) clean correct, standard method          → "full"
  (b) correct via a DIFFERENT valid method    → "full"   (the bias test)
  (c) right answer but broken/circular work   → partial/zero (catch-wrong-work)
  (d) right method, one arithmetic slip        → "partial"
  (e) plainly wrong / blank                    → "zero"

The probe runs `grade_submission_with_ai` on each case and passes the case when
the returned `score_status` lands in that case's accepted set (a near-match
policy: (c) accepts {partial, zero} because either is a correct rejection of
bad work). Every call is cassette-cached, so the regression replay is $0.

No browser, no app endpoint: grading is a pure function of (extraction, problems,
rubric), so `generate()` calls the grader directly. `GOLDEN_CASES` + `grade_case`
are module-level so an out-of-band A/B + determinism measurement can reuse the
exact same labeled set (see the docstring on grade_case).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from api.core.grading_ai import grade_submission_with_ai
from tests.harness.probe import Probe
from tests.harness.types import CheckResult, GeneratedItem, HarnessContext


@dataclass
class GradingCase:
    """One hand-labeled grading scenario.

    `problems` and `extraction` are in the exact shapes the real pipeline
    passes to `grade_submission_with_ai`. `accepts` is the set of score_status
    values that count as a correct grade for this case (usually one; (c) and
    blank-style cases accept two because either rejection is correct).
    """

    name: str
    category: str  # "a".."e" — which matrix row this case exercises
    problems: list[dict[str, Any]]
    extraction: dict[str, Any]
    expected: str  # the headline label shown in the report
    accepts: set[str]  # score_status values that pass for this case
    rationale: str = ""
    extra: dict[str, Any] = field(default_factory=dict)


def _ext(steps: list[tuple[int, str]], final: str) -> dict[str, Any]:
    """Build an extraction dict (single problem at position 1) from terse
    (step_num, latex) pairs + a final-answer latex string. Mirrors the real
    extractor output: plain_english empty when the LaTeX is self-explanatory."""
    return {
        "steps": [
            {"step_num": n, "latex": tex, "plain_english": "", "problem_position": 1}
            for n, tex in steps
        ],
        "final_answers": (
            [{"problem_position": 1, "answer_latex": final, "answer_plain": ""}]
            if final
            else []
        ),
        "confidence": 0.9,
    }


def _prob(question: str, answer: str) -> list[dict[str, Any]]:
    return [{"position": 1, "question": question, "final_answer": answer}]


# ── The golden set ────────────────────────────────────────────────────────
# 12 cases, ≥2 per matrix row. Rubric is None throughout, so the grader applies
# the shipped DEFAULT rubric — i.e. exactly what a teacher who authors no rubric
# gets. Two cases are physics (a2, b3) per the "a couple physics" ask.

GOLDEN_CASES: list[GradingCase] = [
    # (a) clean correct, standard method → full ----------------------------
    GradingCase(
        name="a1-linear-clean",
        category="a",
        problems=_prob("Solve 2x + 3 = 11 for x.", "x = 4"),
        extraction=_ext(
            [(1, "2x + 3 = 11"), (2, "2x = 8"), (3, "x = 4")], "x = 4"
        ),
        expected="full",
        accepts={"full"},
        rationale="Textbook isolate-the-variable, every step valid, answer matches key.",
    ),
    GradingCase(
        name="a2-physics-distance-clean",
        category="a",
        problems=_prob(
            "A car travels at a constant 20 m/s for 5 s. How far does it go?",
            "100 m",
        ),
        extraction=_ext(
            [(1, "d = vt"), (2, "d = 20 \\times 5"), (3, "d = 100\\,\\text{m}")],
            "100 m",
        ),
        expected="full",
        accepts={"full"},
        rationale="Correct kinematics d=vt, clean substitution, answer matches key.",
    ),
    # (b) correct via a DIFFERENT valid method → full (the bias test) -------
    GradingCase(
        name="b1-quadratic-completing-square",
        category="b",
        problems=_prob(
            "Solve x^2 - 6x + 8 = 0.", "x = 2 or x = 4"
        ),
        extraction=_ext(
            [
                (1, "x^2 - 6x + 8 = 0"),
                (2, "x^2 - 6x = -8"),
                (3, "x^2 - 6x + 9 = 1"),
                (4, "(x - 3)^2 = 1"),
                (5, "x - 3 = \\pm 1"),
                (6, "x = 4 \\text{ or } x = 2"),
            ],
            "x = 2 or x = 4",
        ),
        expected="full",
        accepts={"full"},
        rationale=(
            "Completing the square instead of factoring — a valid alternative "
            "method. Grader must not penalize the non-canonical approach."
        ),
    ),
    GradingCase(
        name="b2-system-substitution",
        category="b",
        problems=_prob(
            "Solve the system: x + y = 10 and x - y = 4.", "x = 7, y = 3"
        ),
        extraction=_ext(
            [
                (1, "x + y = 10 \\Rightarrow x = 10 - y"),
                (2, "(10 - y) - y = 4"),
                (3, "10 - 2y = 4"),
                (4, "y = 3"),
                (5, "x = 10 - 3 = 7"),
            ],
            "x = 7, y = 3",
        ),
        expected="full",
        accepts={"full"},
        rationale=(
            "Solved by substitution where elimination is the 'obvious' method. "
            "Valid alternative — must earn full credit."
        ),
    ),
    GradingCase(
        name="b3-physics-energy-method",
        category="b",
        problems=_prob(
            "A ball is dropped from rest from a height of 5 m (g = 10 m/s^2). "
            "Find its speed just before it hits the ground.",
            "10 m/s",
        ),
        extraction=_ext(
            [
                (1, "mgh = \\tfrac{1}{2}mv^2"),
                (2, "v = \\sqrt{2gh}"),
                (3, "v = \\sqrt{2 \\times 10 \\times 5}"),
                (4, "v = \\sqrt{100} = 10\\,\\text{m/s}"),
            ],
            "10 m/s",
        ),
        expected="full",
        accepts={"full"},
        rationale=(
            "Energy conservation instead of the kinematic v^2 = 2gh route. "
            "Different valid physics method — must not be penalized."
        ),
    ),
    # (c) right final answer but broken/circular/fabricated work ------------
    GradingCase(
        name="c1-contradictory-work",
        category="c",
        problems=_prob("Solve 4x = 20 for x.", "x = 5"),
        extraction=_ext(
            # Blatantly invalid: subtracts instead of dividing (x = 20 - 4 = 16),
            # then — contradicting its own line — declares x = 5. The work
            # neither uses a valid method nor arithmetically yields the answer.
            [(1, "4x = 20"), (2, "x = 20 - 4"), (3, "x = 16"), (4, "x = 5")],
            "x = 5",
        ),
        expected="partial/zero",
        accepts={"partial", "zero"},
        rationale=(
            "Right final answer but the work is self-contradictory (derives "
            "x = 16, then asserts x = 5) via an invalid operation. No valid path "
            "supports the answer, so it must not earn full credit."
        ),
    ),
    GradingCase(
        name="c2-bare-answer-no-work",
        category="c",
        problems=_prob("Solve x^2 - 5x + 6 = 0.", "x = 2 or x = 3"),
        extraction=_ext(
            # Just restates the problem and asserts the answer — no factoring,
            # no reasoning. The default rubric says a bare answer isn't full.
            [(1, "x^2 - 5x + 6 = 0")],
            "x = 2 or x = 3",
        ),
        expected="partial/zero",
        accepts={"partial", "zero"},
        rationale=(
            "Correct answer with zero set-up (circular: answer restated). Default "
            "rubric explicitly disqualifies a bare answer from full credit."
        ),
    ),
    GradingCase(
        name="c3-fabricated-middle",
        category="c",
        problems=_prob(
            "Compute 1/2 + 1/3.", "5/6"
        ),
        extraction=_ext(
            # Adds numerators and denominators (2/5 — a real misconception),
            # then jumps to the correct 5/6 with no valid bridge. Fabricated.
            [
                (1, "\\frac{1}{2} + \\frac{1}{3} = \\frac{1+1}{2+3}"),
                (2, "= \\frac{2}{5}"),
                (3, "= \\frac{5}{6}"),
            ],
            "5/6",
        ),
        expected="partial/zero",
        accepts={"partial", "zero"},
        rationale=(
            "Right answer, but the middle step is mathematically invalid and "
            "doesn't connect to the answer. Not full credit."
        ),
    ),
    # (d) correct method, one arithmetic slip → wrong answer → partial ------
    GradingCase(
        name="d1-division-slip",
        category="d",
        problems=_prob("Solve 3x + 5 = 20 for x.", "x = 5"),
        extraction=_ext(
            # Method perfect through 3x = 15, then 15/3 mis-computed as 4.
            [(1, "3x + 5 = 20"), (2, "3x = 15"), (3, "x = 4")],
            "x = 4",
        ),
        expected="partial",
        accepts={"partial"},
        rationale=(
            "Correct approach, single arithmetic slip (15/3 = 4) → wrong answer. "
            "Default rubric anchors this near 95% partial."
        ),
    ),
    GradingCase(
        name="d2-sign-slip-factoring",
        category="d",
        problems=_prob("Solve x^2 - 5x + 6 = 0.", "x = 2 or x = 3"),
        extraction=_ext(
            # Correctly factors (x-2)(x-3) but reads off the roots with the
            # wrong sign — a classic execution error, not a method error.
            [
                (1, "x^2 - 5x + 6 = 0"),
                (2, "(x - 2)(x - 3) = 0"),
                (3, "x = -2 \\text{ or } x = -3"),
            ],
            "x = -2 or x = -3",
        ),
        expected="partial",
        accepts={"partial"},
        rationale=(
            "Right method (correct factoring), sign error extracting roots → "
            "wrong answer. Partial, not zero."
        ),
    ),
    # (e) plainly wrong (wrong method + wrong answer) / blank → zero --------
    GradingCase(
        name="e1-incoherent",
        category="e",
        problems=_prob("Solve 2x + 3 = 11 for x.", "x = 4"),
        extraction=_ext(
            # No sign of the right concept: multiplies, adds, and asserts 17.
            [(1, "2 \\times 3 = 6"), (2, "6 + 11 = 17"), (3, "x = 17")],
            "x = 17",
        ),
        expected="zero",
        accepts={"zero"},
        rationale=(
            "Incoherent work showing no understanding of solving a linear "
            "equation, wrong answer. Default rubric: incoherent → zero."
        ),
    ),
    GradingCase(
        name="e2-blank",
        category="e",
        problems=_prob("Solve x^2 - 5x + 6 = 0.", "x = 2 or x = 3"),
        extraction=_ext([], ""),  # nothing extracted — student skipped it
        expected="zero",
        accepts={"zero"},
        rationale="No work and no final answer (skipped). Must be zero.",
    ),
]


async def grade_case(
    case: GradingCase, *, reproducible: bool = True,
) -> tuple[str | None, dict[str, Any]]:
    """Grade one golden case and return (score_status, raw_result).

    Thin wrapper over `grade_submission_with_ai` so both the probe and the
    out-of-band A/B + determinism measurement grade the identical labeled set.
    `reproducible` toggles the grading config (temp-0 no-thinking vs the legacy
    temp-1 + thinking) — the measurement runs both; the probe uses the default
    (reproducible) config, which is what production ships.
    """
    result = await grade_submission_with_ai(
        case.extraction, case.problems, None, reproducible=reproducible,
    )
    grades = result.get("grades", [])
    status = grades[0].get("score_status") if grades else None
    return status, result


class GradingProbe(Probe):
    name = "grading"
    needs_browser = False
    default_constraint = (
        "Grading-quality golden set: 12 hand-labeled submissions spanning "
        "clean-correct, valid-alternative-method, broken-work-right-answer, "
        "arithmetic-slip, and plainly-wrong. Asserts the AI grader's "
        "score_status matches the label."
    )

    def relevant_paths(self) -> list[str]:
        return [
            "api/core/grading_ai.py",
            "api/core/llm_schemas.py",
            "api/services/bank.py",
        ]

    def capability_spec(self) -> str:
        return (
            "AI grading takes a student's extracted work (steps + final "
            "answers) plus the teacher's answer key and rubric, and assigns "
            "each problem a score_status of full / partial / zero (with a "
            "percent and confidence). The grader never sees a worked solution "
            "— it evaluates the student's work on its own merits, so it must "
            "(1) accept any valid method that reaches the right answer, (2) "
            "withhold full credit when the work is broken/circular even if the "
            "final answer is right, (3) give partial credit for a correct "
            "approach with an execution slip, and (4) give zero for incoherent "
            "or blank work. The surface spans algebra, arithmetic, systems, and "
            "physics across grade levels."
        )

    # ── generation = run the grader on each golden case ──────────────────

    async def generate(
        self, ctx: HarnessContext, constraint: str | None = None,
    ) -> list[GeneratedItem]:
        """Grade every golden case (default reproducible config) and return one
        GeneratedItem per case, tagged with the expected label + the grader's
        actual score_status so deterministic_checks can compare them. Ignores
        ctx: grading is a pure function, no app endpoint or browser needed."""
        out: list[GeneratedItem] = []
        for case in GOLDEN_CASES:
            status, result = await grade_case(case, reproducible=True)
            out.append(
                GeneratedItem(
                    id=case.name,
                    label=f"[{case.category}] {case.name}",
                    problem_text=case.problems[0]["question"],
                    figure_svg=None,
                    figure_spec=None,
                    raw={
                        "category": case.category,
                        "expected": case.expected,
                        "accepts": sorted(case.accepts),
                        "actual_status": status,
                        "rationale": case.rationale,
                        "grade": (result.get("grades") or [{}])[0],
                    },
                )
            )
        return out

    # ── deterministic check = does the grade match the label? ────────────

    # Tolerance (in percentage points) for the deduction-ledger reconcile
    # check. `points_off` is integer; `percent` can be fractional, so a
    # sub-point gap is rounding, not a real disagreement. Matches
    # grading_ai._LEDGER_TOLERANCE.
    _LEDGER_TOLERANCE = 1.0

    def deterministic_checks(self, item: GeneratedItem) -> list[CheckResult]:
        actual = item.raw.get("actual_status")
        accepts = set(item.raw.get("accepts") or [])
        expected = item.raw.get("expected")
        ok = actual in accepts
        checks = [
            CheckResult(
                f"score_status matches label (expected {expected}, got {actual})",
                ok,
                "" if ok else f"got {actual!r}, accept {sorted(accepts)}",
            )
        ]

        # Ledger reconciles to the score: 100 − sum(points_off) ≈ percent.
        # The deduction ledger must be a faithful receipt for the grade, not
        # a free-floating annotation — a partial grade of 60 must itemize 40
        # points of deductions. Empty ledger ⇒ full credit (percent 100).
        grade = item.raw.get("grade") or {}
        percent = grade.get("percent")
        deductions = grade.get("deductions")
        if isinstance(percent, (int, float)) and isinstance(deductions, list):
            total_off = sum(
                int(d.get("points_off", 0))
                for d in deductions
                if isinstance(d, dict)
                and isinstance(d.get("points_off"), (int, float))
                and not isinstance(d.get("points_off"), bool)
            )
            reconciled = 100.0 - total_off
            recon_ok = abs(reconciled - float(percent)) <= self._LEDGER_TOLERANCE
            checks.append(
                CheckResult(
                    "deduction ledger reconciles to percent "
                    f"(100 − {total_off} = {reconciled}, percent={percent})",
                    recon_ok,
                    "" if recon_ok
                    else f"ledger sums to {total_off} off, "
                    f"expected {round(100.0 - float(percent), 2)}",
                )
            )
        else:
            checks.append(
                CheckResult(
                    "deduction ledger present and reconcilable",
                    False,
                    f"missing/invalid: percent={percent!r}, "
                    f"deductions={type(deductions).__name__}",
                )
            )
        return checks
