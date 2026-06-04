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
)


class Probe(ABC):
    """Base class for a testable AI feature."""

    #: short, filesystem-safe name used in CLI + report (e.g. "geometry")
    name: str

    @abstractmethod
    async def generate(self, ctx: HarnessContext) -> list[GeneratedItem]:
        """Drive the real generation path (HTTP against ctx.api_base) and
        return the produced items once they're ready to view. Implementations
        own their own polling for fire-and-forget generation."""

    @abstractmethod
    def deterministic_checks(self, item: GeneratedItem) -> list[CheckResult]:
        """Free, objective checks for one item (renders, consistent,
        present, well-formed). No network, no LLM."""

    @abstractmethod
    async def capture_cards(
        self,
        ctx: HarnessContext,
        browser: HarnessBrowser,
        items: list[GeneratedItem],
    ) -> list[CardCapture]:
        """Drive the running app in the browser to screenshot the rendered
        question cards for these items, from the view this probe verifies.
        Owns the feature-specific UI navigation (e.g. opening a review
        modal). Returns one capture per card it could shoot."""

    @abstractmethod
    def judge_rubric(self) -> JudgeRubric:
        """The scoring rubric for the sampled LLM judge."""
