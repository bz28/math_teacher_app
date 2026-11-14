"""The generation figure eval, replayed at $0 from its recorded cassette.

Two homework sets of 8 problems (tests/harness/probes/generation_figures.py)
go through the real generation path: generate, read each problem twice,
draw and check its figure, replace once the problems that need a figure
they don't have, then solve. The model's answers were recorded once
(tests/harness/_cassettes/generation_figures/). Every figure was rendered
and looked at (BY_EYE, keyed by each figure's fingerprint); each problem has
a "figure" / "none" verdict by Ben's rubric (EXPECTED); each drawn figure
has a known-wrong version the checker must reject (NEGATIVES), so the eval
fails when the checker stops checking.

A prompt, schema or checker change that alters a call misses its cassette
and fails here; re-record with the command in the probe's docstring.
"""

from __future__ import annotations

import pytest

from tests.harness.probes import generation_figures as gf

# Figures drawn in the recorded run (set 1: 5, set 2: 4). A change that
# draws fewer fails here.
DRAWN_FLOOR = 9
# Problems a teacher would sketch that got no figure, because they name no
# points (a figure whose points the problem doesn't name can't be checked):
# the "unnamed figures" to-do of PR #989. Shown as plain text problems.
KNOWN_MISSING = {"set1-p7", "set1-p8", "set2-p7", "set2-p8"}


@pytest.mark.asyncio
async def test_generation_figure_eval_meets_the_bar(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HARNESS_LLM_MODE", "replay")
    results = await gf.run_all()
    s = gf.summarize(results)
    assert s["wrong"] == [] and s["unwanted"] == [], s
    assert s["not_looked_at"] == [] and s["not_expected"] == [], s
    assert s["negatives_passed"] == [] and s["negatives_missing"] == [], s
    assert s["negatives_rejected"] == s["question_figures"] + s["step_figures"], s
    assert s["missing_reference"] == [] and s["rule_broken"] == [], s  # no "the figure" without one
    assert s["steps_inconsistent"] == [], s
    assert s["question_figures"] >= DRAWN_FLOOR, s
    assert set(s["missing_figures"]) <= KNOWN_MISSING, s
    # The teacher gets the count asked for: a slot whose figure can't be
    # checked gets a problem that needs none (review round 1 of #998).
    assert s["problems"] == len(gf.SETS) * gf.COUNT, s


@pytest.mark.asyncio
async def test_the_eval_fails_without_the_checker(monkeypatch: pytest.MonkeyPatch) -> None:
    """With the checker switched off every known-wrong figure passes."""
    import api.core.question_bank_generation as qbg

    monkeypatch.setenv("HARNESS_LLM_MODE", "replay")
    results = await gf.run_all()
    monkeypatch.setattr(qbg, "check_construction", lambda *a, **k: [])
    monkeypatch.setattr(qbg, "unbacked_marks", lambda *a, **k: {})
    s = gf.summarize(results)
    assert len(s["negatives_passed"]) == s["question_figures"] >= DRAWN_FLOOR, s
