"""The scorecard: every $0 offline eval in one table (tests/harness/scorecard.py).

The first test runs the real command, replay only, as CI would; the rest pin
that it fails for each reason it should: a never-number above 0, a how-good
below the baseline, a case gone missing, a probe that can't run, a row that
vanished, and (end to end) the figure checker switched off.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from tests.harness import scorecard as sc

_ROOT = Path(__file__).resolve().parents[2]
# Probes whose replay doesn't depend on this host's fonts: they must run (not
# skip) everywhere, CI included.
_MUST_RUN = {
    "problem generation / generation-figures (sets)",
    "homework diagrams / generation-figures",
    "chat diagrams / construction-figures",
    "chat diagrams / construction-adversarial",
    "step diagrams / generation-figures (steps)",
    "step diagrams / construction-figures (steps)",
    "reading student work / drawing-flag",
    "grading / grading",
}
# Their synthetic pages are drawn with a macOS font; elsewhere they skip.
_FONT_BOUND = {"reading student work / drawing-eval", "grading / graph-check"}


def test_the_scorecard_replays_clean(tmp_path: Path) -> None:
    """`python -m tests.harness scorecard`, in its own process (no test-suite
    mocks, no database), passes, and every row that can run here did."""
    out = tmp_path / "rows.json"
    proc = subprocess.run(  # noqa: S603 — our own CLI
        [sys.executable, "-m", "tests.harness", "scorecard", "--json", str(out)],
        cwd=_ROOT, capture_output=True, text=True, timeout=300,
    )
    assert proc.returncode == 0, proc.stdout[-4000:] + proc.stderr[-4000:]
    rows = {r["feature"] + " / " + r["probe"]: r for r in json.loads(out.read_text())}
    assert {k for k in _MUST_RUN if rows[k]["status"] != "PASS"} == set(), proc.stdout
    has_font = Path(sc._RECORDED_FONT).exists()
    for k in _FONT_BOUND:
        assert rows[k]["status"] == ("PASS" if has_font else "SKIP"), rows[k]
    # Every feature has a row, and nothing that can't run is dropped silently.
    assert {r["feature"] for r in rows.values()} == set(sc.FEATURES)
    assert all(r["skipped"].startswith("needs ") for r in rows.values() if r["status"] == "SKIP")
    # The committed baseline is the one this run is judged against.
    assert set(json.loads(sc.BASELINE_PATH.read_text())) <= set(rows)


def _row(**kw: object) -> sc.Row:
    base: dict[str, object] = {"feature": "grading", "probe": "p", "never_what": "", "how_good_what": "",
                               "never": 0, "how_good": 0.9, "cases": 10}
    return sc.Row(**(base | kw))  # type: ignore[arg-type]


_BASE = {"grading / p": {"how_good": 0.9, "cases": 10, "cassette_misses": ["call_claude_json known (bank_chat)"]}}


def test_judge_passes_a_clean_row() -> None:
    rows = [_row()]
    assert sc.judge(rows, _BASE) and rows[0].status == "PASS"


@pytest.mark.parametrize("change, why", [
    ({"never": 1, "never_parts": {"x": 1}}, "never-number is 1"),
    ({"how_good": 0.8}, "below baseline"),
    ({"cases": 9}, "a case went missing"),
    ({"error": "CassetteMissError: no cassette"}, "could not run"),
    ({"cassette_misses": ["call_claude_json ab12 (decompose)"]}, "new swallowed cassette miss"),
    ({"how_good": None}, "how-good is gone"),
])
def test_judge_fails(change: dict[str, object], why: str) -> None:
    rows = [_row(**change)]
    assert not sc.judge(rows, _BASE)
    assert rows[0].status == "FAIL" and why in " ".join(rows[0].failures)


def test_a_skipped_row_is_listed_not_failed() -> None:
    rows = [_row(never=None, how_good=None, cases=0, skipped="needs a browser")]
    assert sc.judge(rows, _BASE) and rows[0].status == "SKIP"
    assert "skipped: needs a browser" in sc.render(rows)


def test_a_row_that_vanishes_fails() -> None:
    rows: list[sc.Row] = []
    assert not sc.judge(rows, _BASE)
    assert rows[0].failures == ["in the baseline but produced no row"]


@pytest.mark.asyncio
async def test_the_scorecard_fails_when_the_checker_is_off(monkeypatch: pytest.MonkeyPatch) -> None:
    """Revert check, end to end: with the figure checker switched off, the
    known-wrong figures pass, the chat-diagram never-numbers go above 0 and
    the scorecard fails; with it on, the same rows are clean."""
    import api.core.question_bank_generation as qbg

    monkeypatch.setenv("HARNESS_LLM_MODE", "replay")
    env = sc.Env(has_recorded_font=False)
    only = ["construction-adversarial", "construction-figures"]
    baseline = json.loads(sc.BASELINE_PATH.read_text())

    clean = await sc.collect(env, only)
    assert sc.judge(clean, baseline, only), sc.render(clean)

    monkeypatch.setattr(qbg, "check_construction", lambda *a, **k: [])
    monkeypatch.setattr(qbg, "unbacked_marks", lambda *a, **k: {})
    broken = await sc.collect(env, only)
    assert not sc.judge(broken, baseline, only)
    never = {r.probe: r.never for r in broken}
    assert never["construction-adversarial"] and never["construction-figures"], sc.render(broken)


def test_a_known_cassette_miss_passes_and_its_id_is_parsed() -> None:
    rows = [_row(cassette_misses=["call_claude_json known (bank_chat)"])]
    assert sc.judge(rows, _BASE), rows[0].failures
    msg = ("no cassette for call_claude_json key=54d7fb6b in replay mode (model=claude-sonnet-4-6, "
           "mode=decompose). Re-run with HARNESS_LLM_MODE=record or auto to record it.")
    assert sc._miss_id(msg) == "call_claude_json 54d7fb6b (decompose)"


def test_a_missing_baseline_file_is_an_error(tmp_path: Path) -> None:
    """A mistyped --baseline must not judge against nothing (every how-good
    and case check would pass)."""
    import argparse

    args = argparse.Namespace(baseline=tmp_path / "nope.json", write_baseline=False, only=None, json=None)
    with pytest.raises(SystemExit, match="no baseline"):
        sc.run_cli(args)


@pytest.mark.asyncio
async def test_a_wrong_or_unwanted_step_figure_counts_on_the_step_row(monkeypatch: pytest.MonkeyPatch) -> None:
    """A step figure judged wrong or unwanted by eye is a step-row never,
    not a homework-row one (it used to count on no row)."""
    from tests.harness.probes import generation_figures as gf

    monkeypatch.setenv("HARNESS_LLM_MODE", "replay")
    real = gf.summarize

    def with_bad_steps(results: list[dict[str, object]]) -> dict[str, object]:
        s = real(results)
        s["wrong"] = [*s["wrong"], "set1-p1-step2: wrong: B moved"]
        s["unwanted"] = [*s["unwanted"], "set1-p1-step1: unwanted: prints the answer"]
        return s

    monkeypatch.setattr(gf, "summarize", with_bad_steps)
    rows = {r.probe: r for r in await sc._generation_figures(sc.Env(has_recorded_font=False))}
    assert rows["generation-figures (steps)"].never_parts == {"wrong_step_figure": 1, "unwanted_step_figure": 1}
    assert rows["generation-figures"].never == 0


def _items(raws: list[dict[str, object]]) -> list[object]:
    from tests.harness.types import GeneratedItem

    return [GeneratedItem(id=f"i{n}", label="", problem_text="", figure_svg=None, figure_spec=None, raw=r)
            for n, r in enumerate(raws)]


@pytest.mark.asyncio
async def test_an_ai_drawing_flag_miss_not_on_the_known_list_is_a_never(monkeypatch: pytest.MonkeyPatch) -> None:
    """The stored flag is right (the regex saves it), but the AI call alone
    missed a question not on AI_KNOWN_MISSES: that fails, as in the probe."""
    from tests.harness.probes.drawing_flag import DrawingFlagProbe

    q = "Graph $y = 3x - 2$ and label the y-intercept."

    async def gen(self: object, ctx: object, constraint: str | None = None) -> list[object]:
        return _items([{"question": q, "truth": True, "llm": False, "regex": True, "stored": True}])

    monkeypatch.setattr(DrawingFlagProbe, "generate", gen)
    (row,) = await sc._drawing_flag(sc.Env(has_recorded_font=False))
    assert row.never_parts == {"ai_miss_not_on_known_list": 1}


@pytest.mark.asyncio
async def test_a_no_for_a_drawn_graph_feature_is_a_never(monkeypatch: pytest.MonkeyPatch) -> None:
    from tests.harness.probes.graph_check import GraphCheckProbe

    async def gen(self: object, ctx: object, constraint: str | None = None) -> list[object]:
        return _items([{"draw_graph": True, "truth": ["yes", "no"],
                        "items": [{"verdict": "no"}, {"verdict": "no"}]}])

    monkeypatch.setattr(GraphCheckProbe, "generate", gen)
    (row,) = await sc._graph_check(sc.Env(has_recorded_font=True))
    assert row.never_parts == {"no_for_drawn_feature": 1}


@pytest.mark.asyncio
async def test_a_known_miss_the_ai_now_gets_right_is_its_own_never(monkeypatch: pytest.MonkeyPatch) -> None:
    """A listed known miss the AI now labels right means AI_KNOWN_MISSES is
    stale: its own never part, not a new AI miss."""
    from tests.harness.probes.drawing_flag import AI_KNOWN_MISSES, DrawingFlagProbe

    q = sorted(AI_KNOWN_MISSES)[0]

    async def gen(self: object, ctx: object, constraint: str | None = None) -> list[object]:
        return _items([{"question": q, "truth": True, "llm": True, "regex": True, "stored": True}])

    monkeypatch.setattr(DrawingFlagProbe, "generate", gen)
    (row,) = await sc._drawing_flag(sc.Env(has_recorded_font=False))
    assert row.never_parts == {"known_miss_now_right": 1}
