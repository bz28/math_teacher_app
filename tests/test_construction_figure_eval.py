"""The construction-figure eval, replayed at $0 from its recorded cassettes.

24 real prod geometry problems (tests/harness/_corpus/construction_figures.json)
go through the real workshop-chat path with the teacher's request; the
model's answers were recorded once (tests/harness/_cassettes/
construction_figures/). Every figure was rendered and looked at; the
verdicts are in the probe's EXPECTED and BY_EYE (keyed by each figure's
fingerprint). This holds the bar from the design doc: at least 80% of the
figures that should exist are drawn and pass the checker, no figure judged
wrong passed it, and no reply claims a figure that wasn't drawn. Each case
also carries a known-wrong figure the checker must reject, so the eval
fails when the checker stops checking (the second test).

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
    assert summary["wrong_but_passed"] == 0 and summary["not_looked_at"] == 0
    assert summary["negatives_rejected"] == summary["drawn"]
    assert summary["false_claims"] == 0
    assert summary["step_figures"] >= 2 and summary["step_figures_moved"] == []


@pytest.mark.asyncio
async def test_the_eval_fails_without_the_checker(monkeypatch: pytest.MonkeyPatch) -> None:
    """The eval measures the checker rather than trusting it: with the
    checker switched off (every figure passes, no marks removed), most cases
    fail — their known-wrong figure passes, a figure nobody looked at is
    shown, or a figure that needed its retry goes out unchecked."""
    import api.core.question_bank_generation as qbg

    monkeypatch.setenv("HARNESS_LLM_MODE", "replay")
    monkeypatch.setattr(qbg, "check_construction", lambda *a, **k: [])
    monkeypatch.setattr(qbg, "unbacked_marks", lambda *a, **k: {})
    results, _ = await cf.run_all()
    failing = [r["id"] for r in results if any(not c.passed for c in cf.checks(r))]
    assert len(failing) > 0.8 * len(results), failing


def test_the_claim_pattern_catches_claims_about_parts() -> None:
    """A reply saying it connected or included a part claims a figure."""
    for said in ("I connected B to D.", "I've included the diagonal BD.", "The diagonal BD now appears.",
                 "I've added a diagram."):
        assert cf._CLAIM.search(said), said
    assert not cf._CLAIM.search("I tightened the wording; the answer is 12.")
