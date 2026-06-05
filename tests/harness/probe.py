"""The Probe seam — one AI feature to test, end to end.

A probe knows four things about its feature, and nothing about how the
harness boots the app, drives the browser, caches LLM calls, or reports.
That keeps every other layer feature-agnostic: geometry is the first probe;
grading / step-decomposition / chat become probes later by implementing this
same interface.

  1. generate()            — trigger real generation, return the items
  2. deterministic_checks() — free, objective pass/fail for one item
  3. capture_cards()       — drive the browser to screenshot the rendered cards
  4. judge_rubric()        — how the sampled LLM judge should score the card
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from tests.harness.browser import HarnessBrowser
from tests.harness.types import (
    CardCapture,
    CheckResult,
    GeneratedItem,
    HarnessContext,
    JudgeRubric,
    JudgeScore,
)


class Probe(ABC):
    """Base class for a testable AI feature."""

    #: short, filesystem-safe name used in CLI + report (e.g. "geometry")
    name: str

    #: the default natural-language steer passed to generation when no
    #: per-scenario constraint overrides it. Recorded on the run summary so
    #: the admin dashboard shows exactly what prompt a run tested.
    default_constraint: str = ""

    #: whether this probe needs a browser. Figure probes screenshot rendered
    #: cards (True); a text-only probe that judges problem correctness has no
    #: page to shoot (False) and the runner skips booting Chromium for it.
    needs_browser: bool = True

    @abstractmethod
    def relevant_paths(self) -> list[str]:
        """Path substrings whose change means this probe should run. The
        `for-diff` command uses these to pick which probe(s) to run for a
        given changeset, so review/autopilot test exactly what was built."""

    @abstractmethod
    def capability_spec(self) -> str:
        """A prose description of the feature's full surface — the shapes,
        scales, options, and edge cases the generator can be steered toward.
        The autonomous explorer reads this to invent diverse + adversarial
        test scenarios, so a new probe needs only describe its surface, not
        hand-author a scenario matrix."""

    @abstractmethod
    async def generate(
        self, ctx: HarnessContext, constraint: str | None = None,
    ) -> list[GeneratedItem]:
        """Drive the real generation path (HTTP against ctx.api_base) and
        return the produced items once they're ready to view. `constraint`
        overrides the probe's default steer (the explorer passes a per-scenario
        constraint). Implementations own their own polling."""

    @abstractmethod
    def deterministic_checks(self, item: GeneratedItem) -> list[CheckResult]:
        """Free, objective checks for one item (renders, consistent,
        present, well-formed). No network, no LLM."""

    async def capture_cards(
        self,
        ctx: HarnessContext,
        browser: HarnessBrowser,
        items: list[GeneratedItem],
    ) -> list[CardCapture]:
        """Drive the running app in the browser to screenshot the rendered
        question cards for these items, from the view this probe verifies.
        Owns the feature-specific UI navigation (e.g. opening a review
        modal). Returns one capture per card it could shoot. Default: no
        captures (a text-only probe with needs_browser=False)."""
        return []

    def judge_rubric(self) -> JudgeRubric:
        """The scoring rubric for the sampled vision judge. Default: empty
        (a probe that captures no cards never invokes the vision judge)."""
        return JudgeRubric(dimensions=[], instructions="")

    async def judge_items(self, items: list[GeneratedItem]) -> list[JudgeScore | None]:
        """Optional per-item LLM judging that doesn't depend on a screenshot —
        e.g. a text judge that re-solves each problem to score correctness.
        Returns one JudgeScore (or None) per item, aligned by index. Default:
        no item-level judging."""
        return []
