"""What a flow journey reports, shared by the flow modules (flows.py and
the review-page flows in flows_review.py)."""

from __future__ import annotations

from dataclasses import dataclass, field

# Generous, so slow CI is never mistaken for a failure.
FLOW_TIMEOUT_MS = 30000


@dataclass
class FlowResult:
    """One journey's outcome. `issues` is empty iff the journey completed."""

    name: str
    title: str  # human label for the proposal/report
    passed: bool
    issues: list[str] = field(default_factory=list)
