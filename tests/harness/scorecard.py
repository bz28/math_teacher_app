"""Scorecard: every AI-feature eval that replays at $0 offline, in one table.

`python -m tests.harness scorecard` runs each probe that can replay from its
committed cassettes without an app server, and prints one row per
(feature, probe) with two numbers:

  - NEVER: a count of things that must never happen (a wrong figure passed,
    full credit on broken work, a drawn feature credited that isn't there...). Any value
    above 0 fails the scorecard.
  - HOW GOOD: a share in [0, 1] (figures drawn, cases graded as labelled...).
    Falling below the committed baseline (scorecard_baseline.json) fails.

A probe that can't run here is listed as "skipped: needs <x>", never dropped.
A probe that errors (a cassette miss, a crash) fails. Replay only: the CLI
forces HARNESS_LLM_MODE=replay and a fake API key, so a call without a
recording raises instead of spending. What each probe measures, and the gaps,
are in tests/harness/SCORECARD.md.

Replay returns the RECORDED model output, so these numbers move only when our
own code around the model changes (a checker, a parser, a prompt that re-keys
a cassette and so misses). A change to the model's judgment needs a paid
re-record, which this command never does.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import re
import sys
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

BASELINE_PATH = Path(__file__).parent / "scorecard_baseline.json"

FEATURES = [
    "problem generation",
    "homework diagrams",
    "chat diagrams",
    "step diagrams",
    "reading student work",
    "grading",
]

# The handwriting face the synthetic student pages were drawn with when their
# vision cassettes were recorded. A host without it draws different pixels,
# so every vision call misses its cassette: those probes are skipped there.
_RECORDED_FONT = "/System/Library/Fonts/Supplemental/Bradley Hand Bold.ttf"
# Env vars that narrow a probe to some of its cases; cleared so the scorecard
# always runs the whole suite.
_CASE_FILTERS = ("DRAWING_EVAL_CASES", "GRAPH_CHECK_CASES", "DRAWING_EVAL_OUT")
# Where the CLI points the app's DB: a port nothing listens on, so nothing
# can be written anywhere (no probe on the scorecard needs a database).
_OFFLINE_DB = "postgresql+asyncpg://scorecard:offline@127.0.0.1:9/offline"


@dataclass
class Row:
    """One (feature, probe) line of the scorecard."""

    feature: str
    probe: str
    never_what: str  # what NEVER counts, in plain words
    how_good_what: str  # what HOW GOOD is a share of ("" when there is none)
    never: int | None = None
    never_parts: dict[str, int] = field(default_factory=dict)
    how_good: float | None = None
    cases: int = 0
    skipped: str = ""  # "needs <x>" when it can't run here
    error: str = ""
    # Replay misses the app swallowed (see collect), as "<fn> <key> (<mode>)".
    cassette_misses: list[str] = field(default_factory=list)
    failures: list[str] = field(default_factory=list)  # filled by judge()
    notes: list[str] = field(default_factory=list)

    @property
    def key(self) -> str:
        return f"{self.feature} / {self.probe}"

    @property
    def status(self) -> str:
        if self.skipped:
            return "SKIP"
        return "FAIL" if self.failures else "PASS"


@dataclass
class Env:
    """What this host can offer the probes."""

    has_recorded_font: bool


def _share(num: int, den: int) -> float | None:
    return round(num / den, 4) if den else None


# Every never part each row counts, with the plain words that name it. A
# row's never_what is built from these, SCORECARD.md's never column quotes
# them (tests/harness/test_scorecard.py checks), and _parts refuses a set of
# counts that doesn't match, so the code, the row text and the doc can't drift.
NEVER: dict[str, dict[str, str]] = {
    "problem generation / generation-figures (sets)": {
        "short_unexplained": "a set short of the count asked with no note to the teacher saying so",
        "repeated_problem": "a problem repeated in its set",
    },
    "homework diagrams / generation-figures": {
        "wrong_figure": "a figure (or its problem) judged wrong by eye, not on the probe's known-wrong list",
        "known_wrong_now_right": "a listed known-wrong item that is no longer wrong (the list is stale)",
        "unwanted_figure": "a figure on a problem that should have none",
        "refers_to_missing_figure": "a problem that says 'the figure' and has none",
        "drafted_figure_shipped_unchecked": "a drafted figure shipped without a checked figure",
        "known_wrong_passed": "a known-wrong figure the checker passed",
        "known_wrong_missing": "a drawn figure with no known-wrong version to test the checker",
        "not_looked_at": "a figure nobody looked at",
        "no_verdict_for_problem": "a problem with no figure/none verdict by Ben's rule",
    },
    "step diagrams / generation-figures (steps)": {
        "wrong_step_figure": "a shown step figure judged wrong by eye",
        "unwanted_step_figure": "a shown step figure judged unwanted by eye",
        "step_inconsistent": "a shown step figure that moves the problem's points or drops its parts",
        "known_wrong_passed": "a known-wrong step figure the checker passed",
        "not_looked_at": "a shown step figure nobody looked at",
        "dropped_without_reason": "a step figure dropped with no reason given",
    },
    "chat diagrams / construction-figures": {
        "crashed": "a case that crashed",
        "claims_undrawn_figure": "a reply claiming a figure that wasn't drawn",
        "figure_case_claims_undrawn": "a 'figure' case that drew none and whose reply claims one",
        "decline_case_drawn": "a 'decline' case that drew a figure",
        "not_looked_at": "a figure nobody looked at",
        "wrong_figure_passed": "a figure judged wrong by eye that passed the checker",
        "known_wrong_passed": "a known-wrong figure the checker passed",
        "known_wrong_missing": "a drawn figure with no known-wrong version to test the checker",
        "names_undrawn_point": "a reply naming a point that isn't drawn",
    },
    "step diagrams / construction-figures (steps)": {
        "step_moved_a_point": "a step figure that moves a point of the question's figure",
    },
    "chat diagrams / construction-adversarial": {
        "wrong_figure_passed": "a reviewer's known-wrong figure the checker passed",
        "wrong_caught_only_as_unmarked": "a wrong figure caught only because a given isn't marked",
        "crashed": "a case that crashed",
        "expected_decline_drawn": "a wording that can't be checked that was drawn anyway",
    },
    "reading student work / drawing-eval": {
        "drawing_lost": "a student's drawing lost before the grader",
        "false_unconfirmed": "a false \"couldn't confirm\" on a real drawing",
        "wrong_line_count": "a wrong line count after the second look",
        "answer_lost": "an answer marked on the drawing lost before final answers",
    },
    "reading student work / drawing-flag": {
        "stored_flag_wrong": "a stored requires-drawing flag (AI or regex) that is wrong",
        "ai_miss_not_on_known_list": "an AI-alone miss not on the known-miss list",
        "known_miss_now_right": "a listed known miss the AI now gets right (the list is stale)",
        "ai_call_failed": "an AI classification call that returned no answer",
    },
    "grading / graph-check": {
        "yes_for_undrawn_feature": "'yes' for a graph feature that isn't drawn",
        "no_for_drawn_feature": "'no' for a graph feature that is drawn",
        "verdict_with_no_graph": "a verdict on a page with no graph",
        "wrong_number_of_verdicts": "a number of verdicts that isn't one per checklist item",
    },
    "grading / grading": {
        "full_credit_not_earned": "full credit on work the label says isn't full",
        "ledger_does_not_add_up": "a deduction ledger that doesn't add up to the score",
        "step_ref_out_of_range": "a step reference that points to no step",
        "rule_id_shown": "a class-rule id shown to the teacher",
    },
}

# Rows whose never parts are the probe's own failed checks: each check's name
# (its start) → the part it counts as. A check not listed here fails the row,
# so a new probe check must be named before the scorecard counts it.
_CHECK_PARTS: dict[str, dict[str, str]] = {
    "chat diagrams / construction-figures": {
        "the case ran": "crashed",
        "no reply claims a figure that wasn't drawn": "claims_undrawn_figure",
        "by-eye verdict holds (figure)": "figure_case_claims_undrawn",
        "by-eye verdict holds (decline)": "decline_case_drawn",
        "every drawn figure was looked at": "not_looked_at",
        "no figure judged wrong by eye passed the checker": "wrong_figure_passed",
        "the checker rejects the case's known-wrong figure": "known_wrong_passed",
        # Renamed by _construction_figures when the case lists no negative.
        "no known-wrong figure listed for the case": "known_wrong_missing",
        "the reply names only drawn points": "names_undrawn_point",
    },
    "reading student work / drawing-eval": {
        "the drawing reaches the grader as present": "drawing_lost",
        "no false \"couldn't confirm\" on a real drawing": "false_unconfirmed",
        "final inventory has": "wrong_line_count",
        "the answer on the drawing reaches final_answers": "answer_lost",
    },
}


def _parts(key: str, **counts: int) -> tuple[int, dict[str, int]]:
    """(never, its non-zero parts) for row `key`. The parts counted must be
    exactly the ones NEVER names for that row."""
    if set(counts) != set(NEVER[key]):
        raise ValueError(f"{key}: counted {sorted(counts)}, NEVER names {sorted(NEVER[key])}")
    nonzero = {k: v for k, v in counts.items() if v}
    return sum(counts.values()), nonzero


def _check_parts(key: str, failed_names: list[str]) -> tuple[int, dict[str, int]]:
    """Count failed probe checks as the row's never parts (see _CHECK_PARTS)."""
    counts = dict.fromkeys(NEVER[key], 0)
    for name in failed_names:
        part = next((p for start, p in _CHECK_PARTS[key].items() if name.startswith(start)), None)
        if part is None:
            raise ValueError(f"{key}: probe check {name!r} has no never part; name it in NEVER/_CHECK_PARTS")
        counts[part] += 1
    return _parts(key, **counts)


def _new(feature: str, probe: str, how_good_what: str) -> Row:
    """A row whose never_what is its NEVER phrases."""
    return Row(feature, probe, "; ".join(NEVER[f"{feature} / {probe}"].values()), how_good_what)


def _failed_check_names(probe: Any, items: list[Any]) -> list[tuple[Any, list[str]]]:
    """(item, names of its failed deterministic checks) per item."""
    return [(it, [c.name for c in probe.deterministic_checks(it) if not c.passed]) for it in items]


def _ctx() -> Any:
    from tests.harness.types import HarnessContext

    # The offline probes ignore ctx: they call the AI path directly.
    return HarnessContext(api_base="", web_base="", teacher_token="", student_token="",
                          teacher_refresh="", student_refresh="", teacher_id="", student_id="",
                          course_id="", unit_id="", assignment_id="")


# ── sources: each runs one probe once and returns its row(s) ─────────────


_GF_ROWS = [("problem generation", "generation-figures (sets)"), ("homework diagrams", "generation-figures"),
            ("step diagrams", "generation-figures (steps)")]


def _not_recorded(why: str) -> list[Row]:
    """The generation-figures rows when the probe has no recording to replay:
    each FAILs with that plain reason (never PASS, never a crash)."""
    return [Row(f, p, "; ".join(NEVER[f"{f} / {p}"].values()), "",
                error=f"not recorded: {why} (record it with the command in the probe's docstring)")
            for f, p in _GF_ROWS]


async def _generation_figures(env: Env) -> list[Row]:
    from tests.harness.probes import generation_figures as gf

    # A probe version that knows whether its cassette is recorded says so
    # (gf.recorded()), or raises NotRecordedError in replay; matched by name
    # so this file doesn't depend on that version.
    recorded = getattr(gf, "recorded", None)
    if callable(recorded) and not recorded():
        return _not_recorded("the generation-figures cassette has no recording")
    try:
        results = await gf.run_all()
    except Exception as e:
        if type(e).__name__ == "NotRecordedError":
            return _not_recorded(str(e)[:200] or "the generation-figures cassette has no recording")
        raise
    s = gf.summarize(results)
    neg = {k: v for p in results for k, v in gf.negatives(p).items()}
    q_neg = {k: v for k, v in neg.items() if "-step" not in k}
    s_neg = {k: v for k, v in neg.items() if "-step" in k}
    unseen = s["not_looked_at"]
    expected = {p["key"]: gf.EXPECTED.get(gf.fingerprint(p["text"])) for p in results}
    want = [p for p in results if expected[p["key"]] == "figure"]

    gen = _new("problem generation", "generation-figures (sets)", "")
    gen.never, gen.never_parts = _parts(gen.key,
        short_unexplained=sum(short_unexplained(gf.count_of(name), sum(1 for p in results if p["set"] == name))
                              for name in gf.SETS),
        repeated_problem=s["problems"] - s["distinct_problems"],
    )
    gen.cases = s["problems"]
    gen.notes.append("no $0 correctness measure: the correctness judge (generation probe) is live-only")

    hw = _new("homework diagrams", "generation-figures", "problems that should have a figure (Ben's rule) that got one")
    def is_step(entry: str) -> bool:  # "set1-p3-step2: wrong ..." / "set1-p3: unwanted ..."
        return "-step" in entry.split(":")[0]

    # Known wrong items with their fix still to build (gf.KNOWN_WRONG) are
    # shown by name, not counted; any other wrong item, or a stale entry, is.
    known = dict(getattr(gf, "KNOWN_WRONG", {}))
    wrong_ids = [w.split(":")[0].strip() for w in s["wrong"] if not is_step(w)]
    hw.never, hw.never_parts = _parts(hw.key,
        wrong_figure=len([k for k in wrong_ids if k not in known]),
        known_wrong_now_right=len([k for k in known if k not in wrong_ids]),
        unwanted_figure=len([u for u in s["unwanted"] if not is_step(u)]),
        refers_to_missing_figure=len(s["missing_reference"]),
        drafted_figure_shipped_unchecked=len(s["rule_broken"]),
        known_wrong_passed=sum(1 for v in q_neg.values() if v is False),
        known_wrong_missing=sum(1 for v in q_neg.values() if v is None),
        not_looked_at=len([k for k in unseen if "-step" not in k]),
        no_verdict_for_problem=len(s["not_expected"]),
    )
    hw.how_good = _share(sum(1 for p in want if p["figure_svg"]), len(want))
    hw.cases = s["problems"]
    hw.notes.append(f"{s['question_figures']} figures drawn; missing: {', '.join(s['missing_figures']) or 'none'}")
    for k in sorted(set(known) & set(wrong_ids)):
        hw.notes.append(f"known wrong: {k}: {known[k]}")

    st = _new("step diagrams", "generation-figures (steps)", "step figures the solver drew that are shown")
    st.never, st.never_parts = _parts(st.key,
        wrong_step_figure=len([w for w in s["wrong"] if is_step(w)]),
        unwanted_step_figure=len([u for u in s["unwanted"] if is_step(u)]),
        step_inconsistent=len(s["steps_inconsistent"]),
        known_wrong_passed=sum(1 for v in s_neg.values() if v is False),
        not_looked_at=len([k for k in unseen if "-step" in k]),
        dropped_without_reason=sum(1 for v in s["step_figures_dropped"].values() if v == "no reason given"),
    )
    st.how_good = _share(s["step_figures"], s["step_figures_emitted"])
    st.cases = s["step_figures_emitted"]
    if not s["step_figures"]:
        st.notes.append("0 step figures shown, so the consistency bar cannot fail yet (gap)")
    return [gen, hw, st]


def _construction_failed_checks(cf: Any, results: list[dict[str, Any]]) -> list[str]:
    """Failed check names per case. The negative check fails both when the
    checker passed the known-wrong figure and when the case has none to
    test; the second is renamed so it counts as its own part."""
    out = []
    for r in results:
        for c in cf.checks(r):
            if c.passed:
                continue
            if c.name.startswith("the checker rejects the case's known-wrong figure") and \
                    cf.negative_rejected(r) is None:
                out.append("no known-wrong figure listed for the case")
            else:
                out.append(c.name)
    return out


async def _construction_figures(env: Env) -> list[Row]:
    from tests.harness.probes import construction_figures as cf

    results, redraws = await cf.run_all()
    s = cf.summarize(results, redraws)
    chat = _new("chat diagrams", "construction-figures",
                "problems that should get a figure that got one (drawn and checked)")
    chat.never, chat.never_parts = _check_parts(chat.key, _construction_failed_checks(cf, results))
    chat.how_good = _share(s["drawn"], s["expect_figure"])
    chat.cases = s["cases"]
    chat.notes.append(f"readings agreed {s['readings_agreed']}/{s['readings']}")

    st = _new("step diagrams", "construction-figures (steps)", "")
    st.never, st.never_parts = _parts(st.key, step_moved_a_point=len(s["step_figures_moved"]))
    st.cases = s["step_figures"]
    if not s["step_figures"]:
        st.notes.append("0 step figures drawn on this corpus, so this bar cannot fail yet (gap)")
    return [chat, st]


async def _construction_adversarial(env: Env) -> list[Row]:
    from tests.harness.probes import construction_adversarial as ca

    s = ca.summarize(await ca.run_all())
    row = _new("chat diagrams", "construction-adversarial",
               "correct figures that pass (of those whose wording can be checked)")
    row.never, row.never_parts = _parts(row.key,
        wrong_figure_passed=len(s["wrong_passed"]),
        wrong_caught_only_as_unmarked=len(s["wrong_caught_only_as_unmarked"]),
        crashed=len(s["errors"]),
        expected_decline_drawn=len(set(s["expected_declines"]) - set(s["declined_as_expected"])),
    )
    row.how_good = _share(s["correct_passed"], s["cases"] - len(s["expected_declines"]))
    row.cases = s["cases"]
    return [row]


async def _drawing_eval(env: Env) -> list[Row]:
    from tests.harness.probes.drawing_eval import DrawingEvalProbe

    row = _new("reading student work", "drawing-eval", "pages read with every check right")
    if not env.has_recorded_font:
        row.skipped = f"needs the font the pages were recorded with ({Path(_RECORDED_FONT).name}, macOS)"
        return [row]
    p = DrawingEvalProbe()
    per = _failed_check_names(p, await p.generate(_ctx()))
    row.never, row.never_parts = _check_parts(row.key, [n for _, names in per for n in names])
    row.how_good = _share(sum(1 for _, names in per if not names), len(per))
    row.cases = len(per)
    return [row]


async def _drawing_flag(env: Env) -> list[Row]:
    from tests.harness.probes.drawing_flag import AI_KNOWN_MISSES, DrawingFlagProbe

    p = DrawingFlagProbe()
    items = await p.generate(_ctx())
    row = _new("reading student work", "drawing-flag", "questions the AI call alone labels right")
    # The AI is gated on its own too (the probe's rule): the regex was tuned
    # on this corpus, so the stored flag alone would hide a broken AI call.
    failed_call = [it.id for it in items if it.raw["llm"] is None]
    now_right = [it.id for it in items if it.raw["question"] in AI_KNOWN_MISSES
                 and it.raw["llm"] is it.raw["truth"]]
    new_misses = [it.id for it in items if it.raw["question"] not in AI_KNOWN_MISSES
                  and isinstance(it.raw["llm"], bool) and it.raw["llm"] is not it.raw["truth"]]
    row.never, row.never_parts = _parts(
        row.key,
        stored_flag_wrong=sum(1 for it in items if it.raw["stored"] != it.raw["truth"]),
        ai_miss_not_on_known_list=len(new_misses),
        known_miss_now_right=len(now_right),
        ai_call_failed=len(failed_call),
    )
    row.how_good = _share(sum(1 for it in items if it.raw["llm"] is it.raw["truth"]), len(items))
    row.cases = len(items)
    if new_misses:
        row.notes.append(f"AI misses not on the known list: {new_misses}")
    if now_right:
        row.notes.append(f"known misses the AI now gets right (delete them from AI_KNOWN_MISSES): {now_right}")
    if failed_call:
        row.notes.append(f"AI classification call returned no answer (the regex alone decided): {failed_call}")
    return [row]


async def _graph_check(env: Env) -> list[Row]:
    from tests.harness.probes.graph_check import GraphCheckProbe

    row = _new("grading", "graph-check",
               "checklist verdicts that match the drawing exactly ('unclear' counts as a miss)")
    if not env.has_recorded_font:
        row.skipped = f"needs the font the pages were recorded with ({Path(_RECORDED_FONT).name}, macOS)"
        return [row]
    p = GraphCheckProbe()
    items = await p.generate(_ctx())
    false_yes = sum(1 for it in items if it.raw["draw_graph"]
                    for t, i in zip(it.raw["truth"], it.raw["items"], strict=False)
                    if t == "no" and i["verdict"] == "yes")
    no_graph = sum(1 for it in items if not it.raw["draw_graph"]
                   if any(i["verdict"] != "unclear" for i in it.raw["items"]))
    false_no = sum(1 for it in items if it.raw["draw_graph"]
                   for t, i in zip(it.raw["truth"], it.raw["items"], strict=False)
                   if t == "yes" and i["verdict"] == "no")
    wrong_count = sum(1 for it in items if len(it.raw["items"]) != len(it.raw["truth"]))
    row.never, row.never_parts = _parts(row.key, yes_for_undrawn_feature=false_yes, no_for_drawn_feature=false_no,
                                        verdict_with_no_graph=no_graph, wrong_number_of_verdicts=wrong_count)
    scored = [(t, i["verdict"]) for it in items for t, i in zip(it.raw["truth"], it.raw["items"], strict=False) if t]
    row.how_good = _share(sum(1 for t, v in scored if t == v), len(scored))
    row.cases = len(items)
    return [row]


async def _grading(env: Env) -> list[Row]:
    from tests.harness.probes.grading import GradingProbe

    p = GradingProbe()
    per = _failed_check_names(p, await p.generate(_ctx()))
    row = _new("grading", "grading", "hand-labelled cases graded as labelled, with every check right")
    row.never, row.never_parts = _parts(
        row.key,
        full_credit_not_earned=sum(
            1 for it, _ in per if it.raw["actual_status"] == "full" and "full" not in it.raw["accepts"]),
        ledger_does_not_add_up=sum(1 for _, ns in per for n in ns if n.startswith("deduction ledger")),
        step_ref_out_of_range=sum(1 for _, ns in per for n in ns if n.startswith("persisted deduction step_refs")),
        rule_id_shown=sum(1 for _, ns in per for n in ns if n.startswith("the rule id never shows")),
    )
    row.how_good = _share(sum(1 for _, ns in per if not ns), len(per))
    row.cases = len(per)
    label = sum(1 for it, _ in per if it.raw["actual_status"] in it.raw["accepts"])
    row.notes.append(f"score label right {label}/{len(per)}")
    return [row]


def _skipped(feature: str, probe: str, needs: str, never_what: str, how_good_what: str) -> Callable[[Env], Any]:
    async def run(env: Env) -> list[Row]:
        return [Row(feature, probe, never_what, how_good_what, skipped=needs)]
    return run


# Order is the print order within a feature. Each source is one probe run.
SOURCES: dict[str, Callable[[Env], Awaitable[list[Row]]]] = {
    "generation": _skipped(
        "problem generation", "generation",
        "needs a running API server + Postgres; live-only by design (no cassettes kept)",
        "a figure on an algebra topic or none on a geometry one", "problems the judge calls correct"),
    "latex": _skipped(
        "problem generation", "latex",
        "needs a running API server + Postgres; live-only by design (no cassettes kept)",
        "LaTeX corrupted into control characters", ""),
    "generation-figures": _generation_figures,
    "geometry": _skipped(
        "homework diagrams", "geometry",
        "needs a running API + web server, Postgres and a browser",
        "a stored figure that doesn't re-render or isn't well-formed", ""),
    "construction-figures": _construction_figures,
    "construction-adversarial": _construction_adversarial,
    "extraction-fidelity": _skipped(
        "reading student work", "extraction-fidelity",
        "needs its vision cassettes, which were never committed (recording is paid)",
        "a transcript that writes the answer the question implies", ""),
    "drawing-eval": _drawing_eval,
    "drawing-flag": _drawing_flag,
    "grading": _grading,
    "graph-check": _graph_check,
}


async def collect(env: Env, only: list[str] | None = None) -> list[Row]:
    """Run every source (or `only` those) and return the rows. A source that
    raises becomes FAIL rows, never a missing one."""
    from tests.harness.cassette import CassetteMissError

    rows: list[Row] = []
    misses: list[str] = []
    real_init = CassetteMissError.__init__

    def counting_init(self: CassetteMissError, *args: Any) -> None:
        misses.append(_miss_id(str(args[0]) if args else ""))
        real_init(self, *args)

    CassetteMissError.__init__ = counting_init  # type: ignore[method-assign,assignment]
    try:
        for name, run in SOURCES.items():
            if only and name not in only:
                continue
            misses.clear()
            try:
                got = await run(env)
            except Exception as e:  # noqa: BLE001 — an eval that can't run fails its row
                got = [Row(_feature_of(name), name, "", "", error=f"{type(e).__name__}: {str(e)[:300]}")]
            # A miss the app's own error handling swallowed (a failed redraw,
            # a failed solve) means replay took a different path than the
            # recording did. Counted on the source's first row.
            got[0].cassette_misses = sorted(misses)
            if misses:
                listed = ", ".join(sorted(misses))
                got[0].notes.append(f"{len(misses)} cassette miss(es) swallowed by the app: {listed}")
            rows += got
    finally:
        CassetteMissError.__init__ = real_init  # type: ignore[method-assign]
    return rows


def _miss_id(message: str) -> str:
    """'no cassette for call_claude_json key=ab12 in replay mode (model=m, mode=x). ...'
    → 'call_claude_json ab12 (x)': which recording is missing, stable across runs."""
    m = re.search(r"no cassette for (\S+) key=(\S+) .*?mode=([^)]*)\)", message)
    return f"{m.group(1)} {m.group(2)} ({m.group(3)})" if m else message[:120]


def _feature_of(source: str) -> str:
    return {
        "generation-figures": "homework diagrams", "construction-figures": "chat diagrams",
        "construction-adversarial": "chat diagrams", "drawing-eval": "reading student work",
        "drawing-flag": "reading student work", "grading": "grading", "graph-check": "grading",
    }.get(source, "problem generation")


def short_unexplained(asked: int, produced: int) -> int:
    """Slots a set is short with no note to the teacher. A set left short (no
    checked figure, or an answer its figure contradicts) is the agreed
    fallback only when the finished job's note says so: the note is the one
    the app shows (`job_notice` on that job), so a shortfall it doesn't
    explain is a never (#1002 review: the old sum of the probe's own
    left_out could never be nonzero). Left-out slots don't lower the
    homework how-good share; they show as lost cases."""
    from types import SimpleNamespace

    from api.core.question_bank_generation import job_notice

    if produced >= asked:
        return 0
    job = SimpleNamespace(status="done", mode="generate", requested_count=asked, produced_count=produced)
    return 0 if job_notice(job) else asked - produced


def judge(rows: list[Row], baseline: dict[str, Any], only: list[str] | None = None) -> bool:
    """Fill each row's failures; True when the scorecard passes."""
    seen = set()
    for r in rows:
        seen.add(r.key)
        if r.skipped:
            continue
        if r.error:
            r.failures.append(f"could not run: {r.error}")
            continue
        if r.never is None:
            # Missing data never reads as PASS (#1002 review round 4).
            r.failures.append("no never-number was measured")
        elif r.never:
            r.failures.append(f"never-number is {r.never}: {r.never_parts}")
        base = baseline.get(r.key)
        if base is None:
            r.notes.append("no baseline yet")
            continue
        if base.get("how_good") is not None:
            if r.how_good is None:
                r.failures.append(f"how-good is gone (nothing to measure), baseline {base['how_good']}")
            elif r.how_good < base["how_good"] - 1e-9:
                r.failures.append(f"how-good {r.how_good} below baseline {base['how_good']}")
        if r.cases < base.get("cases", 0):
            r.failures.append(f"{r.cases} cases, baseline has {base['cases']} (a case went missing)")
        new = sorted(set(r.cassette_misses) - set(base.get("cassette_misses", [])))
        if new:
            r.failures.append(f"new swallowed cassette miss(es) {new}: replay no longer follows the recording")
    if not only:
        for key in baseline:
            if key not in seen:
                feature, probe = key.split(" / ", 1)
                rows.append(Row(feature, probe, "", "", failures=["in the baseline but produced no row"]))
    return not any(r.failures for r in rows)


def baseline_of(rows: list[Row]) -> dict[str, Any]:
    return {r.key: {"how_good": r.how_good, "cases": r.cases, "cassette_misses": r.cassette_misses}
            for r in rows if not r.skipped and not r.error}


def render(rows: list[Row]) -> str:
    def fmt(v: float | None) -> str:
        return "-" if v is None else f"{v:.3f}"

    w = max(len(r.probe) for r in rows) + 2
    out = ["AI-feature scorecard (replay, $0)", "",
           f"  {'probe':<{w}} {'never':>5}  {'how good':>8}  {'cases':>5}  result"]
    for feature in FEATURES:
        out.append(feature)
        for r in (r for r in rows if r.feature == feature):
            never = "-" if r.never is None else str(r.never)
            result = r.status if not r.skipped else f"skipped: {r.skipped}"
            out.append(f"  {r.probe:<{w}} {never:>5}  {fmt(r.how_good):>8}  {r.cases or '-':>5}  {result}")
            for f in r.failures:
                out.append(f"  {'':<{w}}   ! {f}")
            for n in r.notes:
                out.append(f"  {'':<{w}}   - {n}")
    ran = [r for r in rows if not r.skipped]
    failed = [r for r in rows if r.failures]
    out += ["", f"{len(ran)} rows ran, {len(rows) - len(ran)} skipped, {len(failed)} failed: "
            + ("FAIL" if failed else "PASS")]
    return "\n".join(out)


def _configure_env() -> None:
    """Replay only, a key that can't spend, and no database. Must run before
    any api.* import."""
    os.environ["HARNESS_LLM_MODE"] = "replay"
    os.environ["CLAUDE_API_KEY"] = "scorecard-replay-only-no-key"
    os.environ.pop("ANTHROPIC_API_KEY", None)
    os.environ.pop("HARNESS_CASSETTE_DIR", None)
    os.environ["DATABASE_URL"] = _OFFLINE_DB
    os.environ.setdefault("JWT_SECRET", "scorecard")
    os.environ.setdefault("APP_ENV", "test")
    os.environ.setdefault("SENTRY_DSN", "")
    for var in _CASE_FILTERS:
        os.environ.pop(var, None)


def add_parser(sub: Any) -> None:
    sc = sub.add_parser("scorecard", help="run every $0 offline eval and print one scorecard")
    sc.add_argument("--only", nargs="*", choices=list(SOURCES), help="run only these probes")
    sc.add_argument("--baseline", type=Path, default=BASELINE_PATH)
    sc.add_argument("--write-baseline", action="store_true",
                    help="write this run's how-good numbers and case counts as the new baseline")
    sc.add_argument("--json", type=Path, help="also write the rows as JSON here")


def run_cli(args: argparse.Namespace) -> int:
    # Checked before anything else: a mistyped path must not judge against an
    # empty baseline (every how-good and case check would silently pass).
    if not args.baseline.exists() and not args.write_baseline:
        raise SystemExit(f"no baseline at {args.baseline} (pass --write-baseline to create one)")
    _configure_env()
    logging.disable(logging.WARNING)  # the checkers log every dropped figure
    env = Env(has_recorded_font=Path(_RECORDED_FONT).exists())
    rows = asyncio.run(collect(env, args.only))
    baseline = json.loads(args.baseline.read_text()) if args.baseline.exists() else {}
    if args.write_baseline:
        if args.only:
            raise SystemExit("--write-baseline needs the full run (no --only)")
        # A row that errored (a probe not recorded) has no numbers to keep: writing
        # would drop its baseline, and its later drops would pass unchecked.
        broken = [r.key for r in rows if r.error]
        if broken:
            raise SystemExit(f"--write-baseline refused: {', '.join(broken)} errored; fix them first")
        baseline = baseline_of(rows) | {k: v for k, v in baseline.items()
                                        if any(r.key == k and r.skipped for r in rows)}
        args.baseline.write_text(json.dumps(baseline, indent=2, sort_keys=True) + "\n")
    ok = judge(rows, baseline, args.only)
    print(render(rows))  # noqa: T201
    if args.json:
        args.json.write_text(json.dumps([asdict(r) | {"status": r.status} for r in rows], indent=2))
    sys.stdout.flush()
    return 0 if ok else 1
