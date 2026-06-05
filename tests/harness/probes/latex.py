"""LatexProbe — generation focused on LaTeX integrity.

Reuses GenerationProbe's machinery (real generation, polling, collection) over
LaTeX-heavy topics, and checks every generated question + final answer for the
control-char corruption signature (tests/harness/latex_checks). This is the
end-to-end regression guard for the _normalize_arrays / escaping bug class: if
LaTeX gets mangled before rendering, real generated text shows it and the run
FAILs — no browser needed (the corruption is in the text, not the pixels).

LIVE probe (like generation): run with --mode record/auto. The corruption check
itself is $0/deterministic, but this inherits GenerationProbe.judge_items, so a
cheap Haiku correctness judge also runs per item — so cost is generation + judge,
not zero.
"""

from __future__ import annotations

from tests.harness.latex_checks import latex_leak_check
from tests.harness.probes.generation import GenerationProbe, _Scenario
from tests.harness.types import CheckResult, GeneratedItem

# LaTeX-heavy topics whose questions + answers exercise \frac, \neq,
# \begin{pmatrix}, Greek, etc. Pure algebra, so no figure is expected.
_LATEX_SCENARIOS = [
    _Scenario("fractions",
              "Adding and simplifying fractions with unlike denominators, grade 6.",
              expect_figure=False),
    _Scenario("matrices",
              "2x2 matrix addition and multiplication, showing the matrices, grade 11.",
              expect_figure=False),
    _Scenario("inequalities",
              "Solving linear inequalities and stating the solution set with the "
              "appropriate symbols (≠, ≤, ≥), grade 8.",
              expect_figure=False),
    _Scenario("systems",
              "Solving systems of two linear equations whose solution involves "
              "fractions, grade 9.",
              expect_figure=False),
]


class LatexProbe(GenerationProbe):
    name = "latex"
    default_constraint = "LaTeX-heavy topics: fractions, matrices, inequalities, systems"

    def __init__(self, count: int = 2) -> None:
        super().__init__(count=count)
        self.scenarios = _LATEX_SCENARIOS

    def relevant_paths(self) -> list[str]:
        return [
            "api/core/llm_client.py",  # _normalize_arrays — the corruption source
            "api/core/step_decomposition.py",  # _normalize_latex, solution LaTeX
            "api/core/image_extract.py",
            "web/src/components/shared/math-text.tsx",
            "mobile/src/components/MathText.tsx",
        ]

    def capability_spec(self) -> str:
        return (
            "Generated math content carries LaTeX (fractions \\frac, matrices "
            "\\begin{pmatrix}, operators \\times \\neq, Greek \\beta) in the "
            "question, final answer, and worked solution. The failure mode this "
            "probe guards: LaTeX backslashes corrupted into control characters "
            "when Claude stringifies an array field, so \\frac renders as raw "
            "text. A correct generation keeps every LaTeX command intact."
        )

    def deterministic_checks(self, item: GeneratedItem) -> list[CheckResult]:
        return [
            CheckResult("question present", bool((item.problem_text or "").strip())),
            latex_leak_check("question", item.problem_text),
            latex_leak_check("final answer", str(item.raw.get("final_answer") or "")),
        ]
