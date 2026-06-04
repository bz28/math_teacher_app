"""Shared dataclasses for the harness — the vocabulary every layer speaks.

Kept dependency-free (no app/browser imports) so the runner, probes, eval,
and reporter can all import these without cycles.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class HarnessContext:
    """Everything a probe needs to drive the running app: base URLs and the
    seeded teacher/student identities. Built by the runner after boot+seed."""

    api_base: str  # e.g. http://localhost:8000/v1
    web_base: str  # e.g. http://localhost:3000
    teacher_token: str
    student_token: str
    teacher_refresh: str
    student_refresh: str
    teacher_id: str
    student_id: str
    course_id: str
    unit_id: str  # top-level unit generated items save under
    assignment_id: str
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class GeneratedItem:
    """One AI-generated artifact to evaluate (e.g. a geometry question)."""

    id: str  # stable identifier (bank item id)
    label: str  # short human label for the report
    problem_text: str  # the question text — context for the judge
    figure_svg: str | None
    figure_spec: dict[str, Any] | None
    raw: dict[str, Any] = field(default_factory=dict)  # full payload for probe checks


@dataclass
class CheckResult:
    """One deterministic check's outcome."""

    name: str
    passed: bool
    detail: str = ""


@dataclass
class CardCapture:
    """A screenshot of one rendered card + its page context. `item_index` +
    `kind` let the report group a question and its solution together (and give
    the judge a stable cassette key independent of pixel jitter)."""

    label: str  # human label for the report (e.g. "Question 2")
    role: str  # "teacher" | "student"
    png: bytes | None
    item_index: int = 0  # which generated question this belongs to
    kind: str = "question"  # "question" | "solution"
    console_errors: list[str] = field(default_factory=list)
    overflow: bool = False
    problem_text: str = ""  # text shown on the card, for the judge prompt


@dataclass
class JudgeRubric:
    """How the LLM judge should score a rendered card."""

    dimensions: list[str]  # e.g. ["accuracy", "labeling", "legibility", "fit", "polish"]
    instructions: str  # rubric prose handed to the judge
