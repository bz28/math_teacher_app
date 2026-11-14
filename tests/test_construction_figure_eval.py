"""The construction-figure eval, replayed at $0 from its recorded cassettes.

69 real prod geometry problems (tests/harness/_corpus/construction_figures.json)
go through the real workshop-chat path with the teacher's request; the
model's answers, including the two readings of each problem, were recorded
once (tests/harness/_cassettes/construction_figures/). Every figure was
rendered and looked at; the verdicts are in the probe's EXPECTED and BY_EYE
(keyed by each figure's fingerprint). The bar: no figure judged wrong passed
the checker, no reply claims a figure that wasn't drawn, and the share drawn
holds at the recorded run's (see DRAWN_FLOOR). Each case also carries a
known-wrong figure the checker must reject, so the eval fails when the
checker stops checking.

The reviewer's adversarial wordings (tests/harness/probes/
construction_adversarial.py) replay the same way: each wrong figure is
caught, each correct one passes unless its reading was untrusted.

A prompt, schema or checker change that alters a call misses its cassette
and fails here — re-record with the command in the probe's docstring.
"""

from __future__ import annotations

import pytest

from tests.harness.probes import construction_figures as cf

WRONG_PASSED = "no figure judged wrong by eye passed the checker"
# The figures judged wrong by eye that the checker still passes: the known
# gap below. Any other wrong figure fails the bar; catching one of these
# means removing it here. 77195d48-step1 is not a construction figure: the
# solver's old-shape triangle for a step of a rewritten problem, which no
# reading checks.
KNOWN_WRONG_PASSED = {"77195d48-step1"}
# Figures drawn (of the 21 that should exist) in the recorded run. The
# design doc's 80% was met before the redesign only by counting six wrong
# figures; checked against the agreed reading, 15 are drawn and right, and
# the rest are honest declines (the two readings disagreed, or the figure
# failed its check twice). A change that draws fewer fails here.
# 15 of the first 24 (21 should get one), 5 of the 25 breadth problems, 12 of the 20 in breadth set 2.
# Review round 5 (coverage loosened only by exact rules) declines three that
# were drawn right: df891226 (an exterior angle "formed … by extending side
# RP", more than the extension fact says), 9d6733ba ("meeting AB at point M"
# has no fact of its own) and 0511d648 ("… at points G and H respectively").
# Review round 6 (coverage is an allowlist: every word is accounted for by a
# verified fact, a target, or a short inert list) declines 36 more: most for
# instruction wording ("Write a complete two-column proof", "Leave answers in
# simplest radical form", "State the theorem you used", "Using the given
# information"), the rest for words no fact verifies ("each base angle",
# "arc BC", "them", "both"). Which wording words join the inert list is
# Ben's decision (PR description, "Review round 6").
DRAWN_FLOOR = 4


@pytest.mark.asyncio
async def test_construction_figure_eval_meets_the_bar(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HARNESS_LLM_MODE", "replay")
    results, redraws = await cf.run_all()
    summary = cf.summarize(results, redraws)

    # A figure judged wrong that passed is the known gap the xfail test
    # below holds (a decline case that drew one fails its verdict for the
    # same reason); everything else must pass.
    def known_gap(r: dict, name: str) -> bool:
        judged_wrong = any(cf.verdict(k, spec).startswith("wrong") for k, spec in cf.drawn_figures(r))
        return name == WRONG_PASSED or (judged_wrong and name.startswith("by-eye verdict holds"))

    failed = {r["id"]: [c.name for c in cf.checks(r) if not c.passed and not known_gap(r, c.name)] for r in results}
    assert {k: v for k, v in failed.items() if v} == {}
    assert summary["drawn"] >= DRAWN_FLOOR, summary
    # Every reading was either trusted or declined with its reason.
    assert summary["readings_agreed"] + summary["readings_disagreed"] + summary["coverage_gaps"] \
        + summary["unverifiable"] + summary["described_in_words"] + summary["impossible_numbers"] \
        >= summary["readings"], summary
    assert summary["not_looked_at"] == 0
    judged_wrong = {k for r in results for k, spec in cf.drawn_figures(r) if cf.verdict(k, spec).startswith("wrong")}
    assert judged_wrong == KNOWN_WRONG_PASSED, "a figure judged wrong passed the checker"
    assert summary["negatives_rejected"] == sum(1 for r in results if r["figure_svg"])
    assert summary["false_claims"] == 0
    assert summary["step_figures"] >= 2 and summary["step_figures_moved"] == []


@pytest.mark.xfail(
    strict=True,
    reason="Known gap: the solver's old-shape step figure for a rewritten problem (77195d48 step 1) "
    "is rendered unchecked; it is not a construction figure. Strict: this fails loudly once it's caught.",
)
@pytest.mark.asyncio
async def test_no_figure_judged_wrong_passed_the_checker(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HARNESS_LLM_MODE", "replay")
    results, redraws = await cf.run_all()
    assert cf.summarize(results, redraws)["wrong_but_passed"] == 0


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
    failing = {r["id"] for r in results if any(not c.passed for c in cf.checks(r))}
    # The cases that still pass drew nothing either way: their two readings
    # disagreed (no figure is drawn without a trusted reading), or the chat
    # drew none.
    untouched = {r["id"] for r in results if any(why for why in r["readings"]) or not r["readings"]}
    # Every case the checker decides fails without it.
    assert {r["id"] for r in results} - untouched <= failing, failing
    assert len(failing) >= DRAWN_FLOOR, failing


def test_the_claim_pattern_catches_claims_about_parts() -> None:
    """A reply saying it connected or included a part claims a figure."""
    for said in ("I connected B to D.", "I've included the diagonal BD.", "The diagonal BD now appears.",
                 "I've added a diagram."):
        assert cf._CLAIM.search(said), said
    assert not cf._CLAIM.search("I tightened the wording; the answer is 12.")
    # The problem's own words quoted back in a refusal are not a claim.
    refusal = ("I couldn't draw a correct diagram: the reading of the problem missed “drawn”, so the figure "
               "can't be checked.")
    assert cf._CLAIM.search(refusal) and not cf.claims_figure(refusal)
    assert cf.claims_figure("I drew the figure.")


@pytest.mark.asyncio
async def test_the_adversarial_wordings(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every wrong figure is caught (refused, or shown only with the
    statement-to-prove mark removed); every correct one passes."""
    from tests.harness.probes import construction_adversarial as ca

    monkeypatch.setenv("HARNESS_LLM_MODE", "replay")
    summary = ca.summarize(await ca.run_all())
    assert summary["errors"] == []
    assert summary["wrong_passed"] == []
    assert summary["wrong_caught_only_as_unmarked"] == [], summary
    assert summary["correct_refused"] == {}, summary
    assert summary["reading_failures"] == {}, summary
    # A problem that can't be checked as worded is declined (review round 5).
    assert summary["declined_as_expected"] == summary["expected_declines"], summary
    assert summary["correct_passed"] == summary["cases"] - len(summary["expected_declines"])


@pytest.mark.asyncio
async def test_the_adversarial_eval_fails_without_the_checker(monkeypatch: pytest.MonkeyPatch) -> None:
    import api.core.question_bank_generation as qbg
    from tests.harness.probes import construction_adversarial as ca

    monkeypatch.setenv("HARNESS_LLM_MODE", "replay")
    monkeypatch.setattr(qbg, "check_construction", lambda *a, **k: [])
    summary = ca.summarize(await ca.run_all())
    assert len(summary["wrong_passed"]) > 0.5 * summary["cases"], summary
