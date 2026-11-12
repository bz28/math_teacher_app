"""The construction-figure eval, replayed at $0 from its recorded cassettes.

24 real prod geometry problems (tests/harness/_corpus/construction_figures.json)
go through the real workshop-chat path with the teacher's request; the
model's answers were recorded once (tests/harness/_cassettes/
construction_figures/). Every figure was rendered and looked at; the
verdicts are in the probe's EXPECTED / WRONG_BUT_PASSED. This holds the bar
from the design doc: at least 80% of the figures that should exist are
drawn and pass the checker, no figure judged wrong passed it, and no reply
claims a figure that wasn't drawn.

A prompt, schema or checker change that alters a call misses its cassette
and fails here — re-record with the command in the probe's docstring.
"""

from __future__ import annotations

import pytest

from tests.harness.probes import construction_figures as cf


@pytest.mark.asyncio
async def test_construction_figure_eval_meets_the_bar(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HARNESS_LLM_MODE", "replay")
    results, redraws = await cf.run_all()
    summary = cf.summarize(results, redraws)

    failed = {r["id"]: [c.name for c in cf.checks(r) if not c.passed] for r in results}
    assert {k: v for k, v in failed.items() if v} == {}
    assert summary["drawn"] >= 0.8 * summary["expect_figure"], summary
    assert summary["wrong_but_passed"] == 0
    assert summary["false_claims"] == 0
    assert summary["step_figures"] >= 2 and summary["step_figures_moved"] == []
