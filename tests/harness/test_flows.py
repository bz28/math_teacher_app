"""Flow-arm unit tests — the parts that don't need a live browser: selection,
and the load-bearing invariant that an infra error never becomes a false
failure."""

from __future__ import annotations

import pytest

from tests.harness import flows
from tests.harness.flows import (
    FlowResult,
    run_flows,
)


async def test_run_flows_drops_infra_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    """A flow that raises (browser crash, API unreachable) is DROPPED — not
    turned into a failure. Only a flow that ran and reported issues
    counts."""
    async def boom(_b: object, _u: str, _a: str, _s: object) -> FlowResult:
        raise RuntimeError("playwright crashed")

    async def ok(_b: object, _u: str, _a: str, _s: object) -> FlowResult:
        return FlowResult("ok", "OK", True)

    monkeypatch.setattr(flows, "_FLOWS", (boom, ok))
    results = await run_flows(None, "http://x", "http://api", None)  # type: ignore[arg-type]

    assert [r.name for r in results] == ["ok"]  # boom dropped, no false flag


def test_flow_names_cover_all_journeys() -> None:
    """`flow_names()` exposes every registered journey's selector (CLI --only)."""
    names = flows.flow_names()
    assert {
        "login", "logout", "join_class", "submit_homework", "grade_publish",
        "workshop_steps", "student_insights", "confirm_reading", "retake_photos",
        "reopen_resubmit", "generation_survives_leaving",
    } <= set(names)
    assert len(names) == len(set(names))  # no dup selectors


async def test_run_flows_only_selects_subset(monkeypatch: pytest.MonkeyPatch) -> None:
    """`only=` runs just the named flows (matched by their selector name)."""
    async def login(_b: object, _u: str, _a: str, _s: object) -> FlowResult:
        return FlowResult("login", "Login", True)

    async def _join_class_flow(_b: object, _u: str, _a: str, _s: object) -> FlowResult:
        return FlowResult("join_class", "Join", True)

    monkeypatch.setattr(flows, "_FLOWS", (login, _join_class_flow))
    results = await run_flows(
        None, "http://x", "http://api", None, only={"join_class"},  # type: ignore[arg-type]
    )
    assert [r.name for r in results] == ["join_class"]
