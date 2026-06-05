"""Pure-logic unit tests for the improver — no app, browser, DB, or LLM calls.

Covers the deterministic core: budget windows, proposal ranking/filtering/
dedupe, the durable queue, and execution-brief assembly. The live scan/judge/
ideation are exercised separately via `python -m tests.harness improve scan`.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from tests.harness.improver.budget import BudgetCaps, Ledger, check_execute, check_scan
from tests.harness.improver.execute import build_brief, where_to_look
from tests.harness.improver.proposals import Proposal, dedupe, merge, rank_filter
from tests.harness.improver.state import Queue

_NOW = datetime(2026, 6, 5, 12, 0, tzinfo=UTC)


def _p(title: str, *, surface: str = "web.app.home", size: str = "S",
       sev: str = "high", conf: float = 0.9, change: str = "x") -> Proposal:
    return Proposal(
        surface_key=surface, title=title, category="visual", severity=sev,
        rationale="r", change=change, est_size=size, confidence=conf,
    )


# --- proposals ------------------------------------------------------------

def test_id_stable_and_score_orders() -> None:
    assert _p("Fix nav").id == _p("fix   nav").id  # normalized
    high = _p("a", size="S", sev="high", conf=1.0)   # 1*3/1 = 3.0
    low = _p("b", size="L", sev="low", conf=1.0)     # 1*1/3 ≈ 0.33
    assert high.score > low.score


def test_rank_filter_drops_forbidden_and_oversized() -> None:
    ps = [
        _p("Fix nav overflow"),
        _p("Add billing toggle", change="touch stripe"),  # forbidden
        _p("Big refactor", size="L"),                       # oversized at default cap M
    ]
    kept = rank_filter(ps)
    titles = {p.title for p in kept}
    assert titles == {"Fix nav overflow"}


def test_forbidden_catches_inflected_auth_schema_terms() -> None:
    # Regression for the cold-review finding: \b boundaries missed these.
    for change in ("rework authentication", "add authorization checks",
                   "edit two schemas", "add a migration", "use OAuth",
                   "tweak the checkout", "subscription paywall copy"):
        assert _p("x", change=change).forbidden, change
    # And the surface itself is scanned, not just title/change.
    assert _p("Tidy the form", surface="web.public.login", change="spacing").forbidden
    assert not _p("Fix nav overflow", change="tighten the gap").forbidden


def test_dedupe_and_merge() -> None:
    a, b = _p("A"), _p("B")
    dup = _p("a")  # same id as A
    assert {p.title for p in dedupe([a, b, dup], set())} == {"A", "B"}
    assert dedupe([a], {a.id}) == []  # already seen
    merged = merge([[b], [a]])  # merge ranks the union
    assert {p.title for p in merged} == {"A", "B"}


# --- budget ---------------------------------------------------------------

def test_scan_cap_and_rolling_expiry(tmp_path) -> None:  # type: ignore[no-untyped-def]
    caps = BudgetCaps(max_scans_per_5h=2, max_usd_per_7d=100.0)
    lg = Ledger.load(tmp_path)
    assert check_scan(caps, lg, now=_NOW).ok
    lg.record("scan", now=_NOW)
    lg.record("scan", now=_NOW)
    assert not check_scan(caps, lg, now=_NOW).ok            # cap hit
    assert check_scan(caps, lg, now=_NOW + timedelta(hours=6)).ok  # window rolled off


def test_execute_cap_and_spend_ceiling(tmp_path) -> None:  # type: ignore[no-untyped-def]
    caps = BudgetCaps(max_executions_per_7d=2, max_usd_per_7d=5.0)
    lg = Ledger.load(tmp_path)
    lg.record("execute", cost_usd=1.0, now=_NOW)
    lg.record("execute", cost_usd=1.0, now=_NOW)
    assert not check_execute(caps, lg, now=_NOW).ok         # execution cap hit
    lg2 = Ledger.load(tmp_path / "b")
    lg2.record("scan", cost_usd=6.0, now=_NOW)
    assert not check_scan(caps, lg2, now=_NOW).ok           # spend ceiling


# --- queue ----------------------------------------------------------------

def test_queue_add_dedupes_and_status(tmp_path) -> None:  # type: ignore[no-untyped-def]
    q = Queue.load(tmp_path)
    added = q.add([_p("A"), _p("B"), _p("a")], now=_NOW)    # 'a' dupes 'A'
    assert {p.title for p in added} == {"A", "B"}
    assert q.add([_p("A")], now=_NOW) == []                 # already queued
    aid = _p("A").id
    assert q.set_status(aid, "approved", now=_NOW)
    assert [it.id for it in q.by_status("approved")] == [aid]
    reloaded = Queue.load(tmp_path).get(aid)  # persisted across reload
    assert reloaded is not None and reloaded.status == "approved"


def test_ledger_skips_corrupt_rows_without_resetting(tmp_path) -> None:  # type: ignore[no-untyped-def]
    # Regression: one bad row must not wipe the window (re-opening the budget).
    lg = Ledger.load(tmp_path)
    lg.record("scan", now=_NOW)
    (tmp_path / "ledger.json").write_text(
        '[{"ts": "' + _NOW.isoformat() + '", "kind": "scan"}, {"garbage": true}]'
    )
    reloaded = Ledger.load(tmp_path)
    assert reloaded.scans_in_5h(_NOW) == 1  # good row kept, bad row skipped


# --- execute brief --------------------------------------------------------

def test_where_to_look_and_brief() -> None:
    assert where_to_look("web.app.home") == ["web/src/"]
    assert where_to_look("generation:geometry")  # resolves to probe paths (non-empty)
    brief = build_brief({"id": "abc123", "title": "T", "surface_key": "web.app.home",
                         "change": "C", "rationale": "R", "category": "visual",
                         "severity": "high", "est_size": "S"}, branch="improver/abc123")
    assert "improver/abc123" in brief
    assert "abc123" in brief and "STOP" in brief and "schema, auth, or billing" in brief
