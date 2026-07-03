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


def test_digest_sections_by_app_and_escapes_tags() -> None:
    from tests.harness.improver.proposals import to_dict
    from tests.harness.improver.report import proposals_digest_md

    web = to_dict(_p("Wrap each <li> in a <ul>", surface="web.public.landing", change="fix the <ul>"))
    admin = to_dict(_p("Tidy the leads table", surface="admin.leads"))
    demo = to_dict(_p("Polish the demo hub", surface="demo.hub"))
    md = proposals_digest_md([demo, admin, web])  # deliberately out of app order
    # PRIMARY grouping is by app, in the fixed order Web → Admin → Demo → Mobile.
    assert md.index("## Web") < md.index("## Admin") < md.index("## Demo") < md.index("## Mobile")
    # Mobile is a standing placeholder (not scanned yet), never proposals.
    assert "Not yet scanned" in md
    # The census line counts each app bucket.
    assert "1 Web" in md and "1 Admin" in md and "1 Demo" in md
    # Literal tags are escaped so GitHub renders them as text, not real elements.
    assert "&lt;li&gt;" in md and "<li>" not in md


def test_digest_caps_per_app_but_never_caps_highs() -> None:
    """Each app section shows at most 5 full cards — EXCEPT Highs, which are
    never trimmed. Mediums beyond the cap collapse into a '+ N more' one-liner
    list so nothing is lost."""
    from tests.harness.improver.proposals import to_dict
    from tests.harness.improver.report import proposals_digest_md

    highs = [to_dict(_p(f"High fix {i}", surface="web.public.landing",
                        sev="high", conf=0.9 - i * 0.01)) for i in range(7)]
    meds = [to_dict(_p(f"Medium fix {i}", surface="web.public.landing",
                       sev="medium", conf=0.5)) for i in range(3)]
    md = proposals_digest_md(highs + meds)
    # All 7 Highs are shown as full cards (cap of 5 only trims Medium/Low).
    for p in highs:
        assert f"`{p['id']}`\n- **What:**" in md
    # The 3 Mediums (beyond the cap, since 7 Highs already exceed it) collapse.
    assert "_+ 3 more (Medium/Low):_" in md
    for p in meds:
        assert f"- `{p['id']}` **medium**" in md          # one-liner
        assert f"`{p['id']}`\n- **What:**" not in md       # not a full card


def test_digest_caps_mediums_when_highs_leave_slots() -> None:
    """With few Highs, Mediums fill the section up to the cap, then the rest
    collapse — 2 Highs + 8 Mediums, cap 5 → 2+3 cards shown, 5 collapsed."""
    from tests.harness.improver.proposals import to_dict
    from tests.harness.improver.report import proposals_digest_md

    highs = [to_dict(_p(f"H{i}", surface="admin.leads", sev="high", conf=0.9)) for i in range(2)]
    meds = [to_dict(_p(f"M{i}", surface="admin.leads", sev="medium", conf=0.9 - i * 0.01))
            for i in range(8)]
    md = proposals_digest_md(highs + meds)
    shown_cards = sum(1 for p in highs + meds if f"`{p['id']}`\n- **What:**" in md)
    assert shown_cards == 5                                # 2 High + 3 Medium
    assert "_+ 5 more (Medium/Low):_" in md


def test_digest_mobile_placeholder_even_with_no_proposals() -> None:
    from tests.harness.improver.proposals import to_dict
    from tests.harness.improver.report import proposals_digest_md

    md = proposals_digest_md([to_dict(_p("x", surface="web.public.landing"))])
    assert "## Mobile" in md and "🔴 Not yet scanned — Expo auth injection pending" in md


def test_digest_renders_mobile_proposals_when_present() -> None:
    """Regression: once mobile scanning lands, a mobile.* proposal must be
    rendered as a real, approvable card — not silently dropped behind the
    placeholder while still inflating the census/header counts."""
    from tests.harness.improver.proposals import to_dict
    from tests.harness.improver.report import proposals_digest_md

    web = to_dict(_p("Web thing", surface="web.public.landing"))
    mob = to_dict(_p("Fix the mobile solve tab", surface="mobile.solve", sev="high"))
    md = proposals_digest_md([web, mob])
    # The mobile proposal is a real, approvable full card, not hidden.
    assert f"`{mob['id']}`\n- **What:**" in md
    assert f"approve {mob['id']}" in md
    # The placeholder is gone once mobile has real proposals.
    assert "Not yet scanned" not in md
    # Census counts it — and now it's actually visible, so the count is honest.
    assert "1 Mobile" in md


def test_digest_embeds_screenshots_for_shown_cards_only() -> None:
    from tests.harness.improver.proposals import to_dict
    from tests.harness.improver.report import proposals_digest_md

    # 6 Highs (all shown as cards) + 1 Low (collapsed past the cap-5, since the
    # 6 Highs already exceed it). Only the shown cards embed their image.
    highs = [to_dict(_p(f"H{i}", surface="web.public.landing", sev="high")) for i in range(6)]
    low = to_dict(_p("L", surface="web.public.landing", sev="low"))
    props = highs + [low]
    ids = {p["id"] for p in props}
    base = "https://github.com/o/r/raw/improver/screenshots"
    md = proposals_digest_md(props, screenshot_ids=ids, screenshot_base_url=base)
    for p in highs:
        assert f"![]({base}/{p['id']}.png)" in md          # shown card → image
    assert f"{low['id']}.png" not in md                     # collapsed → no image
    # A proposal with no staged screenshot gets no image (no broken link).
    solo = to_dict(_p("no shot", surface="web.public.landing"))
    md2 = proposals_digest_md([solo], screenshot_ids=set(), screenshot_base_url=base)
    assert ".png" not in md2


def test_digest_bounds_body_for_large_backlog() -> None:
    """Regression: a large carried-forward backlog rendered verbose blew past
    GitHub's 65,536-char issue-body limit, so the create/edit was silently
    rejected and no backlog issue ever appeared. max_chars must bound the body
    while keeping EVERY proposal listed and the high-value ones shown in full."""
    from tests.harness.improver.proposals import to_dict
    from tests.harness.improver.report import proposals_digest_md

    props = []
    for i in range(20):
        # Some titles are long (no hard cap on title length) — the reserve must
        # be computed from the real one-liner length, not a constant, or the
        # tail gets dropped by the final truncate guard.
        title = f"a11y fix {i} " + ("very long title token " * 10 if i % 3 == 0 else "")
        p = to_dict(_p(title.strip(), change="A" * 500, conf=0.5))
        p["category"] = "a11y"
        p["rationale"] = "why " * 80
        props.append(p)
    feature = to_dict(_p("Important product feature", change="F" * 500, conf=0.9))
    feature["category"] = "feature"
    feature["rationale"] = "why " * 80
    props.append(feature)

    full = proposals_digest_md(props)                       # unbounded
    bounded = proposals_digest_md(props, max_chars=12000)

    assert len(full) > 12000, "test setup: verbose render should overflow"
    assert len(bounded) <= 12000, "bounded body must fit the budget"
    # Every proposal is still listed (full card or one-liner) — nothing dropped.
    for p in props:
        assert f"`{p['id']}`" in bounded
    # The scarce feature proposal is shown in FULL (What/Why inline), not buried
    # under the a11y wall.
    assert f"`{feature['id']}`\n- **What:**" in bounded


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


# --- evidence + ideate arm (feature-gap ideation into the plan path) ------

def test_save_evidence_folds_product_context_into_findings(tmp_path) -> None:  # type: ignore[no-untyped-def]
    """The product overview must reach the evidence dir (PRODUCT_CONTEXT.md) and
    be flagged in findings.json so the plan-billed judge grounds its feature-gap
    ideation, and the JUDGE_PROMPT must tell it to."""
    import json

    from tests.harness.improver.evidence import JUDGE_PROMPT, save_evidence

    overview = "# Veradic\n\nFeature map: grading, integrity, generation."
    out = save_evidence([], [], tmp_path, product_context=overview)
    findings = json.loads((out / "findings.json").read_text())
    assert findings["product_context"] is True
    assert (out / "PRODUCT_CONTEXT.md").read_text() == overview
    # No product context passed → flag is False, no file written (never KeyError).
    out2 = save_evidence([], [], tmp_path / "empty")
    assert json.loads((out2 / "findings.json").read_text())["product_context"] is False
    assert not (out2 / "PRODUCT_CONTEXT.md").exists()
    # The judge is told to ground feature-gap ideation in PRODUCT_CONTEXT.md.
    assert "PRODUCT_CONTEXT.md" in JUDGE_PROMPT and "FEATURE-GAP" in JUDGE_PROMPT


def test_digest_product_ideas_section_renders_first() -> None:
    """Feature-gap ideas (surface_key 'product') route to their own 'Product
    ideas' section, which leads the digest — ahead of the bulk defect sections."""
    from tests.harness.improver.proposals import to_dict
    from tests.harness.improver.report import _app_of, proposals_digest_md

    # surface_key "product" maps to the product bucket.
    assert _app_of("product") == "product"

    idea = to_dict(_p("Add per-standard mastery view", surface="product",
                      change="new teacher analytics panel"))
    idea["category"] = "feature"
    web = to_dict(_p("Fix nav overflow", surface="web.public.landing"))
    admin = to_dict(_p("Tidy the leads table", surface="admin.leads"))
    md = proposals_digest_md([web, admin, idea])  # deliberately not product-first
    # "Product ideas" leads, ahead of every app defect section.
    assert md.index("## Product ideas") < md.index("## Web")
    assert md.index("## Product ideas") < md.index("## Admin")
    # The feature idea is a real, approvable card in that section.
    assert f"`{idea['id']}`\n- **What:**" in md
    assert f"approve {idea['id']}" in md
    # Census counts the product bucket.
    assert "1 Product ideas" in md


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


# --- demo scan (Channel: the standalone public showcase SPA) --------------

def test_demo_surfaces_in_catalog_and_scan_cap() -> None:
    """The demo app's routes are catalogued as public, zero-auth surfaces, and
    web+admin+demo all fit within the 23-surface scan cap."""
    from tests.harness.improver.surfaces import CATALOG, surfaces_for

    keys = {s.key for s in CATALOG}
    assert {
        "demo.hub", "demo.present", "demo.present_integrity",
        "demo.present_grading", "demo.present_generation", "demo.present_teacher_day",
    } <= keys
    demo = surfaces_for(("demo",))
    assert demo and all(s.app == "demo" and s.role == "public" for s in demo)
    # catalog order puts demo right after admin, so [:23] (public+admin+demo)
    # includes every demo surface before the authed web app crowds them out.
    within_cap = surfaces_for(("web", "admin", "demo"))[:23]
    assert sum(1 for s in within_cap if s.app == "demo") == len(demo)
