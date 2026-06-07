"""Flow-arm unit tests — the parts that don't need a live browser: evidence
shaping, and the load-bearing invariant that an infra error never becomes a
false-positive proposal."""

from __future__ import annotations

import pytest

from tests.harness.improver import flows
from tests.harness.improver.flows import FlowResult, flow_failures, run_flows


def test_flow_failures_keeps_only_failures() -> None:
    rs = [FlowResult("login", "Student login", True), FlowResult("b", "B", False, ["broke"])]
    assert flow_failures(rs) == [{"flow": "b", "title": "B", "issues": ["broke"]}]


async def test_run_flows_drops_infra_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    """A flow that raises (browser crash, infra hiccup) is DROPPED — not turned
    into a failure → proposal. Only a flow that ran and reported issues counts."""
    async def boom(_b: object, _u: str, _s: object) -> FlowResult:
        raise RuntimeError("playwright crashed")

    async def ok(_b: object, _u: str, _s: object) -> FlowResult:
        return FlowResult("ok", "OK", True)

    monkeypatch.setattr(flows, "_FLOWS", (boom, ok))
    results = await run_flows(None, "http://x", None)  # type: ignore[arg-type]

    assert [r.name for r in results] == ["ok"]  # boom dropped, no false flag
    assert flow_failures(results) == []
