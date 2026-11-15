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


@pytest.mark.asyncio
async def test_a_failed_ai_call_on_a_known_miss_is_not_now_right(monkeypatch: pytest.MonkeyPatch) -> None:
    """llm=None (the call returned nothing) on a listed known miss is a failed
    call, not "the AI now gets it right, delete it"."""
    from tests.harness.probes.drawing_flag import AI_KNOWN_MISSES, DrawingFlagProbe

    q = sorted(AI_KNOWN_MISSES)[0]

    async def gen(self: object, ctx: object, constraint: str | None = None) -> list[object]:
        return _items([{"question": q, "truth": True, "llm": None, "regex": True, "stored": True}])

    monkeypatch.setattr(DrawingFlagProbe, "generate", gen)
    (row,) = await sc._drawing_flag(sc.Env(has_recorded_font=False))
    assert row.never_parts == {"ai_call_failed": 1}


_DOC = Path(sc.__file__).with_name("SCORECARD.md").read_text().casefold()


def _doc_line(key: str) -> str:
    probe = key.split(" / ")[1].split(" (")[0].replace("-", "_")
    return next(line for line in _DOC.splitlines() if line.startswith(f"| `{probe}` |"))


@pytest.mark.parametrize("key", sorted(sc.NEVER))
def test_every_never_part_is_named_in_the_row_and_the_doc(key: str) -> None:
    """Each part the row counts, forced to 1, shows up in never_parts, and its
    plain words are in the row's never_what and in SCORECARD.md's line for
    the probe. _parts refuses counts that don't match NEVER, so a part can't
    be counted without its words."""
    feature, probe = key.split(" / ", 1)
    row = sc._new(feature, probe, "")
    never, parts = sc._parts(key, **dict.fromkeys(sc.NEVER[key], 1))
    assert never == len(parts) == len(sc.NEVER[key])
    for part, words in sc.NEVER[key].items():
        assert part in parts
        assert words in row.never_what
        assert words.casefold() in _doc_line(key), (key, words)


def test_a_part_without_words_or_words_without_a_part_is_refused() -> None:
    key = "grading / graph-check"
    counts = dict.fromkeys(sc.NEVER[key], 0)
    with pytest.raises(ValueError, match="NEVER names"):
        sc._parts(key, **counts, unnamed_part=1)
    counts.pop("no_for_drawn_feature")
    with pytest.raises(ValueError, match="NEVER names"):
        sc._parts(key, **counts)


@pytest.mark.parametrize("key", sorted(sc._CHECK_PARTS))
def test_check_counted_rows_name_every_probe_check(key: str) -> None:
    """Rows that count the probe's failed checks map each check to a named
    part, cover every part, and refuse a check nobody named."""
    assert set(sc._CHECK_PARTS[key].values()) == set(sc.NEVER[key])
    names = list(sc._CHECK_PARTS[key])
    never, parts = sc._check_parts(key, names)
    assert never == len(names) and set(parts) == set(sc.NEVER[key])
    with pytest.raises(ValueError, match="has no never part"):
        sc._check_parts(key, ["a check added to the probe later"])


def _part_of(key: str, name: str) -> str | None:
    return next((p for start, p in sc._CHECK_PARTS[key].items() if name.startswith(start)), None)


@pytest.mark.asyncio
async def test_every_construction_figures_check_has_a_part(monkeypatch: pytest.MonkeyPatch) -> None:
    """The real check names (passed or not) all map, so a renamed check
    can't slip past the prefix table on a day when nothing fails."""
    from tests.harness.probes import construction_figures as cf

    monkeypatch.setenv("HARNESS_LLM_MODE", "replay")
    results, _ = await cf.run_all()
    names = {c.name for r in results for c in cf.checks(r)}
    key = "chat diagrams / construction-figures"
    assert {n for n in names if _part_of(key, n) is None} == set()
    # Every part but the renamed "no negative listed" one comes from a real name.
    assert {_part_of(key, n) for n in names} == set(sc.NEVER[key]) - {"known_wrong_missing"}


_CF = "chat diagrams / construction-figures"


@pytest.mark.parametrize("rejected, part", [(False, "known_wrong_passed"), (None, "known_wrong_missing")])
def test_a_case_with_no_negative_is_not_a_passed_negative(rejected: bool | None, part: str) -> None:
    """The probe's negative check fails both when the checker passed the
    known-wrong figure (False) and when the case lists none (None)."""
    from types import SimpleNamespace

    from tests.harness.types import CheckResult

    cf = SimpleNamespace(
        checks=lambda r: [CheckResult("the checker rejects the case's known-wrong figure", False, "")],
        negative_rejected=lambda r: rejected,
    )
    assert sc._check_parts(_CF, sc._construction_failed_checks(cf, [{}]))[1] == {part: 1}


@pytest.mark.parametrize("name, part", [
    ("by-eye verdict holds (figure)", "figure_case_claims_undrawn"),
    ("by-eye verdict holds (decline)", "decline_case_drawn"),
])
def test_the_by_eye_verdict_check_counts_by_its_kind(name: str, part: str) -> None:
    assert sc._check_parts(_CF, [name])[1] == {part: 1}


def test_every_drawing_eval_check_has_a_part() -> None:
    from tests.harness.probes.drawing_eval import DrawingEvalProbe

    item = _items([{"truth": {"guard_line_count": True, "lines": 1, "answer_on_drawing": "(2, 3)"},
                    "second_look": [{"present": True, "plotted": 1}], "final_answers": ["(2, 3)"]}])[0]
    names = [c.name for c in DrawingEvalProbe().deterministic_checks(item)]  # type: ignore[arg-type]
    key = "reading student work / drawing-eval"
    assert len(names) == 4 and {_part_of(key, n) for n in names} == set(sc.NEVER[key])


@pytest.mark.asyncio
async def test_an_unrecorded_generation_figures_probe_fails_its_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    """When the probe says its cassette isn't recorded (gf.recorded() False,
    as on #1003), its rows FAIL as "not recorded": not PASS, not a crash."""
    from tests.harness.probes import generation_figures as gf

    monkeypatch.setenv("HARNESS_LLM_MODE", "replay")
    monkeypatch.setattr(gf, "recorded", lambda: False, raising=False)
    rows = await sc.collect(sc.Env(has_recorded_font=False), ["generation-figures"])
    assert not sc.judge(rows, json.loads(sc.BASELINE_PATH.read_text()), ["generation-figures"])
    assert [r.key for r in rows] == [f"{f} / {p}" for f, p in sc._GF_ROWS]
    assert all(r.status == "FAIL" and "not recorded" in " ".join(r.failures) for r in rows), sc.render(rows)


@pytest.mark.asyncio
async def test_a_not_recorded_error_fails_the_rows_too(monkeypatch: pytest.MonkeyPatch) -> None:
    from tests.harness.probes import generation_figures as gf

    class NotRecordedError(RuntimeError):
        pass

    async def run_all(*a: object, **k: object) -> list[object]:
        raise NotRecordedError("no recording for set1")

    monkeypatch.setattr(gf, "run_all", run_all)
    rows = await sc.collect(sc.Env(has_recorded_font=False), ["generation-figures"])
    assert not sc.judge(rows, json.loads(sc.BASELINE_PATH.read_text()), ["generation-figures"])
    assert len(rows) == 3
    assert all("not recorded: no recording for set1" in " ".join(r.failures) for r in rows), sc.render(rows)


def test_only_a_shortfall_with_no_note_is_a_never(monkeypatch: pytest.MonkeyPatch) -> None:
    """#1002 review round 1: the note is the app's own (job_notice), so the
    bar fails when the note goes missing (the old sum of the probe's
    left_out could never be nonzero)."""
    import api.core.question_bank_generation as qbg

    assert sc.short_unexplained(12, 10) == 0  # Eval 1 set2: short, with the note
    assert sc.short_unexplained(12, 12) == 0
    monkeypatch.setattr(qbg, "job_notice", lambda job: None)
    assert sc.short_unexplained(12, 10) == 2


@pytest.mark.asyncio
async def test_the_sets_row_counts_a_short_set_whose_note_is_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    import api.core.question_bank_generation as qbg

    monkeypatch.setenv("HARNESS_LLM_MODE", "replay")
    rows = {r.probe: r for r in await sc._generation_figures(sc.Env(has_recorded_font=False))}
    assert rows["generation-figures (sets)"].never_parts.get("short_unexplained", 0) == 0
    monkeypatch.setattr(qbg, "job_notice", lambda job: None)
    rows = {r.probe: r for r in await sc._generation_figures(sc.Env(has_recorded_font=False))}
    assert rows["generation-figures (sets)"].never_parts["short_unexplained"] == 2  # set2: 12 asked, 10 kept


def test_write_baseline_is_refused_when_a_row_errored(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """#1002 review round 1: writing then would drop the errored rows' baseline."""
    import argparse

    async def collect(env: object, only: object) -> list[object]:
        return [sc.Row("homework diagrams", "generation-figures", "", "", error="not recorded: x")]

    monkeypatch.setattr(sc, "collect", collect)
    # run_cli sets HARNESS_LLM_MODE=replay etc. and silences logging for the
    # whole process; leaked, that broke later tests in CI (cassette misses).
    monkeypatch.setattr(sc, "_configure_env", lambda: None)
    monkeypatch.setattr(sc.logging, "disable", lambda level: None)
    base = tmp_path / "base.json"
    base.write_text('{"homework diagrams / generation-figures": {"how_good": 0.9, "cases": 22}}')
    args = argparse.Namespace(baseline=base, write_baseline=True, only=None, json=None)
    with pytest.raises(SystemExit, match="refused"):
        sc.run_cli(args)
    assert "generation-figures" in base.read_text()


@pytest.mark.asyncio
async def test_a_known_wrong_item_is_shown_and_a_new_or_stale_one_counts(monkeypatch: pytest.MonkeyPatch) -> None:
    """The probe's KNOWN_WRONG items (fix still to build) are named on the row,
    not counted; a wrong item not on the list, or a listed one that is no
    longer wrong, is a never."""
    from tests.harness.probes import generation_figures as gf

    monkeypatch.setenv("HARNESS_LLM_MODE", "replay")
    rows = {r.probe: r for r in await sc._generation_figures(sc.Env(has_recorded_font=False))}
    hw = rows["generation-figures"]
    note = next(n for n in hw.notes if n.startswith("known wrong: set1-p1"))
    assert hw.never == 0 and note.count("fix to build") == 1, hw.notes

    real = gf.summarize

    def with_new_wrong(results: list[dict[str, object]]) -> dict[str, object]:
        s = real(results)
        s["wrong"] = [*s["wrong"], "set2-p1: wrong: E off line"]
        return s

    monkeypatch.setattr(gf, "summarize", with_new_wrong)
    rows = {r.probe: r for r in await sc._generation_figures(sc.Env(has_recorded_font=False))}
    assert rows["generation-figures"].never_parts.get("wrong_figure") == 1
    monkeypatch.setattr(gf, "summarize", real)
    monkeypatch.setattr(gf, "KNOWN_WRONG", {**gf.KNOWN_WRONG, "set3-p2": "listed but right"})
    rows = {r.probe: r for r in await sc._generation_figures(sc.Env(has_recorded_font=False))}
    assert rows["generation-figures"].never_parts.get("known_wrong_now_right") == 1


def test_the_doc_sample_matches_the_baseline() -> None:
    """#1002 review round 2: the 'Today's scorecard' block in SCORECARD.md
    drifted from the recording; each row's how-good and cases must equal
    scorecard_baseline.json."""
    import re

    doc = (Path(sc.__file__).parent / "SCORECARD.md").read_text()
    block = doc.split("## Today's scorecard", 1)[1].split("```", 2)[1]
    base = json.loads(sc.BASELINE_PATH.read_text())
    feature, seen = "", set()
    for line in block.splitlines():
        if line and not line.startswith(" "):
            feature = line.strip()
            continue
        m = re.match(r"\s{2}(\S.*?)\s{2,}(\d+|-)\s+([\d.]+|-)\s+(\d+|-)\s+(PASS|FAIL)", line)
        if not m:
            continue
        key = f"{feature} / {m.group(1).strip()}"
        # A sample that reads like a false pass: a never above 0 beside PASS,
        # or any FAIL in the committed sample (#1002 review round 3).
        assert m.group(5) == "PASS" and m.group(2) == "0", (key, line)
        if key in base:
            want = base[key]
            # Compared the way render() prints them: '-' only for no share / no cases.
            good = "-" if want.get("how_good") is None else f"{want['how_good']:.3f}"
            assert m.group(3) == good, (key, line, good)
            assert m.group(4) == (str(want["cases"]) if want.get("cases") else "-"), (key, line)
            seen.add(key)
    assert seen == set(base), sorted(set(base) ^ seen)  # no baseline row may drop out of the sample


def test_a_row_that_ran_with_no_never_number_fails() -> None:
    """#1002 review round 4: never=None on a row that ran read PASS."""
    rows = [sc.Row("grading", "grading", "x", "")]
    assert not sc.judge(rows, {}) and rows[0].status == "FAIL", rows[0].failures
