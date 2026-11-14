"""The generation figure eval, replayed at $0 from its recorded cassette.

Two homework sets of 8 problems and one of 4 of Ben's NO-figure cases
(tests/harness/probes/generation_figures.py)
go through the real generation path: generate, read each problem twice,
draw and check its figure, replace once the problems that need a figure
they don't have, then solve. The model's answers were recorded once
(tests/harness/_cassettes/generation_figures/). Every figure was rendered
and looked at (BY_EYE, keyed by each figure's fingerprint); each problem has
a "figure" / "optional" / "none" verdict by Ben's rule (EXPECTED); each drawn figure
has a known-wrong version the checker must reject (NEGATIVES), so the eval
fails when the checker stops checking.

A prompt, schema or checker change that alters a call misses its cassette
and fails here; re-record with the command in the probe's docstring.
"""

from __future__ import annotations

import pytest

from tests.harness.probes import generation_figures as gf

# Figures drawn in the recorded run (set 1: 2, set 2: 3, set 3: 0). A
# change that draws fewer fails here.
DRAWN_FLOOR = 5
# Problems that should have a figure by Ben's rule but got none: each is
# written as a story or names no points, so its figure can't be checked.
# A target to bring down (a text auditor PR may let story layouts keep
# their words); a change that misses more fails here.
KNOWN_MISSING = {"set1-p3", "set1-p4", "set1-p5", "set1-p6", "set1-p8", "set2-p6", "set2-p8"}
# Step figures: the solver emitted 15 (counted from its own output) and
# none is shown yet. Each fails its reading: the step's words are an
# explanation ("We use the Midpoint Theorem…"), so the reading misses
# words, or the two readings disagree. Pinned so a change that emits fewer,
# or drops one without a reason, fails here; a step figure shown must then
# pass the step bars (by eye, consistent, its negative rejected).
STEP_FIGURES_EMITTED = 15
KNOWN_STEP_DROPS = {
    "set1-p1-step1", "set1-p1-step2", "set1-p1-step3", "set1-p1-step4", "set1-p1-step5",
    "set1-p2-step1", "set1-p2-step2", "set2-p1-step1", "set2-p1-step2", "set2-p3-step1", "set2-p3-step2",
    "set2-p3-step3", "set2-p5-step1", "set2-p5-step2", "set2-p5-step3",
}


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
    assert s["problems"] == sum(map(gf.count_of, gf.SETS)), s
    # No problem twice in a set (review round 2 of #998: v4 set1-p4 = p1).
    assert s["distinct_problems"] == s["problems"], s
    # Ben's NO-figure cases are in the eval, so "unwanted" can fail.
    assert sum(1 for p in results if gf.EXPECTED.get(gf.fingerprint(p["text"])) == "none") >= 1
    # Step figures, counted before any is dropped (review round 2 of #998).
    assert s["step_figures_emitted"] == STEP_FIGURES_EMITTED, s
    assert set(s["step_figures_dropped"]) <= KNOWN_STEP_DROPS, s
    assert "no reason given" not in " ".join(s["step_figures_dropped"].values()), s


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
