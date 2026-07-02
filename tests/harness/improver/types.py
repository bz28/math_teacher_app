"""Improver vocabulary — the dataclasses every improver layer speaks.

Kept dependency-free (no app/browser imports) like tests/harness/types.py so
the scanner, detectors, judge, proposer and reporter can all import these
without cycles.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

Role = Literal["public", "teacher", "student", "admin"]
App = Literal["web", "admin", "demo", "mobile_web"]


class _SafeIds(dict[str, str]):
    """`str.format_map` helper: leave an unknown ``{placeholder}`` untouched
    instead of raising, so a surface referencing an id we didn't seed still
    yields a usable (if unresolved) URL rather than crashing the whole scan."""

    def __missing__(self, key: str) -> str:
        return "{" + key + "}"


@dataclass
class Surface:
    """One page/screen to scan. `path` may contain ``{course_id}`` style
    placeholders filled from the seeded world at scan time."""

    key: str  # stable id, e.g. "web.student.practice"
    app: App
    path: str
    role: Role
    title: str  # human label for the report + proposals
    ready_selector: str | None = None  # wait for this before screenshotting

    def resolve(self, ids: dict[str, str]) -> str:
        """Fill `{id}` placeholders from the seeded world's ids."""
        return self.path.format_map(_SafeIds(ids))


@dataclass
class DetectorHit:
    """One objective, deterministically-found issue on a page — $0 to find and
    high-confidence (a console error or an axe violation is a fact, not taste).
    The UX judge emits these too, flagged `source="judge"` and lower-confidence."""

    detector: str  # "console_error" | "overflow" | "broken_image" | "a11y" | "slow_load" | "ux"
    severity: Literal["high", "medium", "low"]
    detail: str
    evidence: str = ""  # selector, url, message, timing — whatever locates it
    source: Literal["detector", "judge"] = "detector"


@dataclass
class PageObservation:
    """Everything one scan captured about one surface."""

    surface_key: str
    url: str
    role: str
    ok: bool  # did the page load + screenshot at all
    png: bytes | None = None
    load_ms: float | None = None
    console_errors: list[str] = field(default_factory=list)
    hits: list[DetectorHit] = field(default_factory=list)
    error: str | None = None  # scan-level failure (timeout, nav error)

    @property
    def high_signal(self) -> bool:
        """True if anything worth a proposal turned up here."""
        return bool(self.hits) or bool(self.console_errors) or not self.ok
