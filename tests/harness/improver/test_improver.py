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


def _p(title: str, *, surface: str = "web.app.home", defect_key: str = "",
       size: str = "S", sev: str = "high", conf: float = 0.9,
       change: str = "x") -> Proposal:
    return Proposal(
        surface_key=surface, title=title, category="visual", severity=sev,
        rationale="r", change=change, est_size=size, confidence=conf,
        # Default the dedup key to the title so callers that don't care about
        # dedup get one id per distinct title (the old behaviour).
        defect_key=defect_key or title,
    )


# --- proposals ------------------------------------------------------------

def test_id_keys_on_defect_not_wording() -> None:
    # Same defect, reworded title → SAME id (the whole point of defect_key).
    a = _p("Fix invalid list markup", defect_key="a11y/list")
    b = _p("Repair broken <ul> nesting", defect_key="a11y/list")
    assert a.id == b.id
    # Same defect class, genuinely different surface → distinct ids.
    landing = _p("x", surface="web.public.landing", defect_key="a11y/list")
    admin = _p("x", surface="admin.quality", defect_key="a11y/list")
    assert landing.id != admin.id
    # The surface SET is order-independent (grouped multi-surface fixes).
    assert _p("x", surface="b,a", defect_key="k").id == _p("x", surface="a,b", defect_key="k").id


def test_score_orders() -> None:
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
                   "tweak the checkout", "subscription paywall copy",
                   # logout/session journeys: the flow-test arm surfaces these,
                   # so the secondary net must cover them too (not just login).
                   "fix the logout redirect", "Sign Out button broken",
                   "clear the user session"):
        assert _p("x", change=change).forbidden, change
    # And the surface itself is scanned, not just title/change.
    assert _p("Tidy the form", surface="web.public.login", change="spacing").forbidden
    assert not _p("Fix nav overflow", change="tighten the gap").forbidden


def test_dedupe_and_merge() -> None:
    a = _p("Fix the list", defect_key="a11y/list")
    b = _p("Underline links", defect_key="a11y/links")
    dup = _p("Repair list markup", defect_key="a11y/list")  # reworded a → same id
    assert {p.title for p in dedupe([a, b, dup], set())} == {"Fix the list", "Underline links"}
    assert dedupe([a], {a.id}) == []  # already seen
    merged = merge([[b], [a]])  # merge ranks the union
    assert {p.defect_key for p in merged} == {"a11y/list", "a11y/links"}


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
    # third entry reworded but same defect_key as the first → deduped on add.
    added = q.add([_p("A", defect_key="k1"), _p("B", defect_key="k2"),
                   _p("a", defect_key="k1")], now=_NOW)
    assert {p.title for p in added} == {"A", "B"}
    assert q.add([_p("A", defect_key="k1")], now=_NOW) == []  # already queued
    aid = _p("A", defect_key="k1").id
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


# --- evidence (Channel D: content-quality corpus into the plan path) ------

def test_save_evidence_folds_generation_failures_into_findings(tmp_path) -> None:  # type: ignore[no-untyped-def]
    """The re-verified corpus failures must reach findings.json so the
    plan-billed judge can propose generation fixes, and the JUDGE_PROMPT must
    tell it to."""
    import json

    from tests.harness.improver.evidence import JUDGE_PROMPT, save_evidence

    failures = [{"probe": "geometry", "scenario": "triangle", "constraint": "c",
                 "expected": ["triangle"], "rationale": "r", "fix_in": ["api/x.py"]}]
    out = save_evidence([], [], tmp_path, generation_failures=failures)
    findings = json.loads((out / "findings.json").read_text())
    assert findings["generation_failures"] == failures
    # default (no failures passed) still emits the key, empty — never KeyError
    out2 = save_evidence([], [], tmp_path / "empty")
    assert json.loads((out2 / "findings.json").read_text())["generation_failures"] == []
    assert "generation_failures" in JUDGE_PROMPT


def test_still_failing_drops_replay_cassette_gaps() -> None:
    """A replay-mode cassette gap (errored, didn't run) must not masquerade as a
    still-failing generation defect; in record/auto an error is a real failure."""
    from types import SimpleNamespace

    from tests.harness.improver.sources import _still_failing

    def r(name: str, passed: bool, error: str | None) -> SimpleNamespace:
        return SimpleNamespace(scenario=name, passed=passed, error=error)

    results = [r("ok", True, None), r("real_fail", False, None), r("cassette_gap", False, "miss")]
    assert _still_failing(results, "auto") == ["real_fail", "cassette_gap"]  # both kept
    assert _still_failing(results, "replay") == ["real_fail"]                # gap dropped


# --- admin scan (Channel B) -----------------------------------------------

def test_admin_role_routing_and_reachable_within_cap() -> None:
    """The admin role injects the admin token pair, and admin surfaces aren't
    crowded out of the scan's 17-surface cap by the web pages."""
    from types import SimpleNamespace

    from tests.harness.improver.scanner import _tokens_for
    from tests.harness.improver.surfaces import surfaces_for

    seed = SimpleNamespace(
        admin_token="at", admin_refresh="ar",
        student_token="st", student_refresh="sr",
        teacher_token="tt", teacher_refresh="tr",
    )
    assert _tokens_for("admin", seed) == ("at", "ar")    # type: ignore[arg-type]
    assert _tokens_for("public", seed) == ("", "")        # type: ignore[arg-type]
    # catalog order puts admin right after the public pages, so [:17] includes it
    within_cap = surfaces_for(("web", "admin"))[:17]
    assert any(s.app == "admin" for s in within_cap)
