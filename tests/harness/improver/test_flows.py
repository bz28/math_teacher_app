"""Flow-arm unit tests — the parts that don't need a live browser: evidence
shaping, and the load-bearing invariant that an infra error never becomes a
false-positive proposal."""

from __future__ import annotations

import pytest

from tests.harness.improver import flows
from tests.harness.improver.flows import (
    FlowResult,
    flow_alert_md,
    flow_failures,
    run_flows,
)


def test_flow_failures_keeps_only_failures() -> None:
    rs = [FlowResult("login", "Student login", True), FlowResult("b", "B", False, ["broke"])]
    assert flow_failures(rs) == [{"flow": "b", "title": "B", "issues": ["broke"]}]


def test_flow_alert_md_empty_when_nothing_broke() -> None:
    assert flow_alert_md([]) == ""


def test_flow_alert_md_renders_failures() -> None:
    md = flow_alert_md([{"flow": "login", "title": "Student login", "issues": ["broke"]}])
    assert "Student login" in md and "broke" in md
    assert "not auto-fixable" in md.lower()  # signals it pages a human, not the fix queue


async def test_run_flows_drops_infra_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    """A flow that raises (browser crash, API unreachable) is DROPPED — not
    turned into a failure → proposal. Only a flow that ran and reported issues
    counts."""
    async def boom(_b: object, _u: str, _a: str, _s: object) -> FlowResult:
        raise RuntimeError("playwright crashed")

    async def ok(_b: object, _u: str, _a: str, _s: object) -> FlowResult:
        return FlowResult("ok", "OK", True)

    monkeypatch.setattr(flows, "_FLOWS", (boom, ok))
    results = await run_flows(None, "http://x", "http://api", None)  # type: ignore[arg-type]

    assert [r.name for r in results] == ["ok"]  # boom dropped, no false flag
    assert flow_failures(results) == []


def test_flow_names_cover_all_journeys() -> None:
    """`flow_names()` exposes every registered journey's selector (CLI --only)."""
    names = flows.flow_names()
    assert {"login", "logout", "join_class", "submit_homework", "grade_publish"} <= set(names)
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
