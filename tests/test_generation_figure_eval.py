"""The generation figure eval in fact-card mode, replayed at $0 once recorded.

Four sets (tests/harness/probes/generation_figures.py) go through the real
generation path: the AI writes each figure problem as a fact card, code
writes its words, the figure is checked against the card (one redraw, one
fresh drawing), a slot that still has no checked figure is replaced once,
else left out; then solved. #998's recordings (the reading mode) no longer
apply (the schema and prompt changed); its 8 drawings are checked against
hand cards at $0 in tests/test_fact_card_eval.py.

NOT RECORDED YET (the PR's budget is spent): this test skips until
tests/harness/_cassettes/generation_figures_cards/ holds the recording. The
bars below were written before recording; the record command is in the
probe's docstring and the PR. After recording, look at every PNG and fill
BY_EYE, EXPECTED and NEGATIVES, or the not_looked_at / not_expected bars fail.
"""

from __future__ import annotations

from typing import Any

import pytest

from tests.harness.probes import generation_figures as gf

RECORDED = gf.recorded()
recorded = pytest.mark.skipif(not RECORDED, reason="fact-card generation eval not recorded yet (see the probe)")

# #998's reading mode: 4 of its 10 "should have a figure" problems in sets 1
# and 2 had none (each written as a story). Fact cards must do no worse; the
# target is lower (a story keeps its setting as the card's context).
MISSING_CEILING = 4


@recorded
@pytest.mark.asyncio
async def test_generation_figure_eval_meets_the_bar(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HARNESS_LLM_MODE", "replay")
    results = await gf.run_all()
    s = gf.summarize(results)
    assert s["wrong"] == [] and s["unwanted"] == [], s
    assert s["not_looked_at"] == [] and s["not_expected"] == [], s
    assert s["negatives_passed"] == [] and s["negatives_missing"] == [], s
    assert s["negatives_rejected"] == s["question_figures"] + s["step_figures"], s
    assert s["missing_reference"] == [] and s["rule_broken"] == [], s
    assert s["steps_inconsistent"] == [], s
    assert s["missing_total"] <= MISSING_CEILING, s
    assert s["distinct_problems"] == s["problems"], s
    # Fact cards: no question read back from its words, every stored card the
    # author's, no figure drawing the student's construction, and the
    # student's construction flagged for grading.
    assert s["question_readings"] == 0, s
    assert s["not_author_cards"] == [] and s["constructed_drawn"] == [], s
    assert s["constructs_without_drawing_flag"] == [], s
    # Ben's NO-figure cases and the who-draws-it cases are in the eval.
    assert sum(1 for p in results if gf.EXPECTED.get(gf.fingerprint(p["text"])) == "none") >= 1
    assert any(p["set"] == "set4" and (p.get("figure_facts") or {}).get("constructs") for p in results), s
    # Step figures are counted with a reason each (their explanation text is
    # still read: step diagrams from the card are a follow-up).
    assert "no reason given" not in " ".join(s["step_figures_dropped"].values()), s


@recorded
@pytest.mark.asyncio
async def test_the_eval_fails_without_the_checker(monkeypatch: pytest.MonkeyPatch) -> None:
    """With the checker switched off every known-wrong figure passes."""
    import api.core.question_bank_generation as qbg

    monkeypatch.setenv("HARNESS_LLM_MODE", "replay")
    results = await gf.run_all()
    monkeypatch.setattr(qbg, "check_construction", lambda *a, **k: [])
    monkeypatch.setattr(qbg, "unbacked_marks", lambda *a, **k: {})
    s = gf.summarize(results)
    assert len(s["negatives_passed"]) == s["question_figures"], s


def test_the_construction_bar_reads_the_spec_and_the_card() -> None:
    """The probe's own check (no recording needed): a figure that draws D,
    which only the student's construction makes, is caught."""
    card = {"points": ["A", "B", "C"], "constructs": [{"kind": "on_segment", "items": ["BC"], "point": "D"}]}
    p = {"figure_facts": card, "figure_spec": {"points": {"A": [0, 0], "B": [1, 0], "C": [0, 1], "D": [0.5, 0.5]}}}
    assert gf.constructed_drawn(p) == ["D"]
    p["figure_spec"]["points"].pop("D")
    assert gf.constructed_drawn(p) == []


@pytest.mark.asyncio
async def test_a_real_jobs_brief_runs_as_a_set(tmp_path: Any) -> None:
    """Eval 1 re-runs prod jobs: a job's course, unit, constraint and source
    docs (exported to JSON) become the set's generation request."""
    import base64
    import json
    from unittest.mock import AsyncMock, patch

    import api.core.question_bank_generation as qbg

    (tmp_path / "ws.png").write_bytes(b"\x89PNG fake")
    brief = tmp_path / "job.json"
    brief.write_text(json.dumps({
        "name": "job-test", "course_name": "Geometry Honors", "unit_name": "Unit 5", "assignment_title": "HW 5.2",
        "constraint": "Isosceles triangle proofs", "count": 8,
        "source_docs": [{"filename": "ws.png", "media_type": "image/png", "path": "ws.png"}],
    }))
    name = gf.load_brief(brief)
    try:
        gen = AsyncMock(return_value=[])
        with (patch.object(qbg, "generate_checked_problems", gen),
              patch.object(qbg, "solve_checked_problems", AsyncMock(return_value=([], [])))):
            out = await gf.run_set(name)
        request = gen.await_args.args[0]
        assert (request.course_name, request.unit_name, request.assignment_title) == (
            "Geometry Honors", "Unit 5", "HW 5.2")
        assert request.constraint_text == "Isosceles triangle proofs" and gen.await_args.kwargs["count"] == 8
        assert request.images == [{"filename": "ws.png", "media_type": "image/png",
                                   "base64": base64.b64encode(b"\x89PNG fake").decode()}]
        assert out == []
    finally:
        gf.SETS.pop(name, None)



@pytest.mark.asyncio
async def test_an_unrecorded_eval_says_so_and_never_passes(
        monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> None:
    """The scorecard (#1002) replays this probe: with no recording it gets
    NotRecordedError (shown "not recorded"), not a cassette miss mid-run and not
    an empty run that reads as PASS."""
    monkeypatch.setattr(gf, "CASSETTE_DIR", tmp_path)
    monkeypatch.setenv("HARNESS_LLM_MODE", "replay")
    assert not gf.recorded()
    with pytest.raises(gf.NotRecordedError, match="not recorded"):
        await gf.run_all()
