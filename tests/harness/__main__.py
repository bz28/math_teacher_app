"""CLI: python -m tests.harness run --probe geometry --mode replay

Connects to an already-running app (API + web), runs a probe end to end, and
writes an HTML report. Env that must be set BEFORE importing app modules
(LLM cassette mode, DB) is applied here at the top.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any

_DEFAULT_API = "http://localhost:8000/v1"
_DEFAULT_WEB = "http://localhost:3000"
_DEFAULT_DB = "postgresql+asyncpg://mathapp:mathapp@localhost:5432/mathapp_harness"
# Run summaries land in the MAIN app DB (what the admin dashboard reads),
# separate from the harness test DB above.
_DEFAULT_SUMMARY_DB = "postgresql+asyncpg://mathapp:mathapp@localhost:5432/mathapp"


def _parse(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="python -m tests.harness")
    sub = p.add_subparsers(dest="cmd", required=True)
    run = sub.add_parser("run", help="run a probe against a running app")
    run.add_argument("--probe", default="geometry")
    run.add_argument("--mode", default="replay", choices=["replay", "record", "auto"])
    run.add_argument("--api-base", default=os.environ.get("HARNESS_API_BASE", _DEFAULT_API))
    run.add_argument("--web-base", default=os.environ.get("HARNESS_WEB_BASE", _DEFAULT_WEB))
    run.add_argument("--db", default=os.environ.get("HARNESS_DATABASE_URL", _DEFAULT_DB))
    run.add_argument("--count", type=int, default=6)
    run.add_argument("--judge-sample", type=int, default=3)
    run.add_argument("--out", default="tests/harness/_reports/report.html")
    run.add_argument(
        "--summary-db",
        default=os.environ.get("HARNESS_SUMMARY_DB", _DEFAULT_SUMMARY_DB),
    )

    exp = sub.add_parser(
        "explore",
        help="autonomously generate + run test scenarios; promote failures",
    )
    exp.add_argument("--probe", default="geometry")
    exp.add_argument("--mode", default="auto", choices=["replay", "record", "auto"])
    exp.add_argument("--scenarios", type=int, default=8)
    exp.add_argument(
        "--from-corpus", action="store_true",
        help="re-run the promoted regression corpus instead of generating new scenarios",
    )
    exp.add_argument("--api-base", default=os.environ.get("HARNESS_API_BASE", _DEFAULT_API))
    exp.add_argument("--web-base", default=os.environ.get("HARNESS_WEB_BASE", _DEFAULT_WEB))
    exp.add_argument("--db", default=os.environ.get("HARNESS_DATABASE_URL", _DEFAULT_DB))
    exp.add_argument("--count", type=int, default=3)
    exp.add_argument("--out", default="tests/harness/_reports/explore.html")
    exp.add_argument(
        "--summary-db",
        default=os.environ.get("HARNESS_SUMMARY_DB", _DEFAULT_SUMMARY_DB),
    )

    fd = sub.add_parser(
        "for-diff",
        help="run the probe(s) whose feature the current changeset touches",
    )
    fd.add_argument("--base", default="main", help="diff base (default: main)")
    fd.add_argument("--mode", default="replay", choices=["replay", "record", "auto"])
    fd.add_argument("--count", type=int, default=4)
    fd.add_argument("--judge-sample", type=int, default=0)
    fd.add_argument("--api-base", default=os.environ.get("HARNESS_API_BASE", _DEFAULT_API))
    fd.add_argument("--web-base", default=os.environ.get("HARNESS_WEB_BASE", _DEFAULT_WEB))
    fd.add_argument("--db", default=os.environ.get("HARNESS_DATABASE_URL", _DEFAULT_DB))
    fd.add_argument("--out", default="tests/harness/_reports/for-diff.html")
    fd.add_argument(
        "--summary-db",
        default=os.environ.get("HARNESS_SUMMARY_DB", _DEFAULT_SUMMARY_DB),
    )

    imp = sub.add_parser("improve", help="autonomous improver: scan real pages -> proposals")
    imp_sub = imp.add_subparsers(dest="improve_cmd", required=True)
    scan = imp_sub.add_parser("scan", help="scan surfaces, detect + judge, propose improvements")
    # Default to `auto`: first run records the judge/proposal cassettes, later
    # runs replay them for $0.
    scan.add_argument("--mode", default="auto", choices=["replay", "record", "auto"])
    scan.add_argument("--db", default=os.environ.get("HARNESS_DATABASE_URL", _DEFAULT_DB))
    scan.add_argument("--apps", default="web", help="comma list: web,admin,mobile_web")
    scan.add_argument("--web-base", default=os.environ.get("HARNESS_WEB_BASE", _DEFAULT_WEB))
    scan.add_argument("--admin-base", default=os.environ.get("HARNESS_ADMIN_BASE", ""))
    scan.add_argument("--mobile-base", default=os.environ.get("HARNESS_MOBILE_BASE", ""))
    scan.add_argument("--max-surfaces", type=int, default=0, help="cap surfaces (0 = all)")
    scan.add_argument("--max-size", default="M", choices=["S", "M", "L"], help="drop bigger proposals")
    scan.add_argument("--no-judge", action="store_true", help="skip the UX vision judge ($)")
    scan.add_argument("--no-propose", action="store_true", help="scan only; skip all ideation ($)")
    scan.add_argument("--no-content", action="store_true", help="skip the AI-output quality source")
    scan.add_argument("--no-features", action="store_true", help="skip the feature-ideation source")
    scan.add_argument("--ignore-budget", action="store_true", help="bypass the budget gate (manual runs)")
    scan.add_argument("--out", default="tests/harness/_reports/improve.html")

    imp_sub.add_parser("budget", help="show the improver's rolling-window budget usage")
    imp_sub.add_parser("proposals", help="list the durable proposal queue")
    for verb, helptext in (
        ("approve", "mark a proposal approved (ready to execute)"),
        ("reject", "mark a proposal rejected (never re-surfaced)"),
        ("show", "print one proposal in full"),
        ("done", "mark a proposal done (PR opened)"),
        ("execute", "print the subagent execution brief for an approved proposal"),
    ):
        sp = imp_sub.add_parser(verb, help=helptext)
        sp.add_argument("id", help="proposal id (12-char hash from `improve proposals`)")
    return p.parse_args(argv)


def _build_probe(name: str, count: int):  # type: ignore[no-untyped-def]
    from tests.harness.probes import PROBES
    if name not in PROBES:
        raise SystemExit(f"unknown probe: {name!r}")
    return PROBES[name](count)


def _changed_files(base: str) -> set[str]:
    """Files changed vs `base` (committed) plus uncommitted working changes."""
    import subprocess
    out: set[str] = set()
    for cmd in (
        ["git", "diff", "--name-only", f"{base}...HEAD"],
        ["git", "diff", "--name-only"],
        ["git", "diff", "--name-only", "--cached"],
    ):
        r = subprocess.run(cmd, capture_output=True, text=True)  # noqa: S603
        out.update(f for f in r.stdout.split("\n") if f.strip())
    return out


def _run_for_diff(args: argparse.Namespace) -> int:
    """Run the harness probe(s) whose feature the changeset touches. Used by
    review/autopilot to test exactly what was built. Exit code is non-zero if
    any matched probe didn't fully pass."""
    from tests.harness.probes import PROBES
    from tests.harness.report import write_report
    from tests.harness.runner import RunConfig, persist_run_summary, run_probe

    changed = _changed_files(args.base)
    matched = []
    for name, factory in PROBES.items():
        probe = factory(args.count)
        if any(any(pat in f for pat in probe.relevant_paths()) for f in changed):
            matched.append((name, probe))

    if not matched:
        print(
            f"for-diff: none of {len(changed)} changed file(s) match a harness "
            "probe — nothing to test.",
        )
        return 0

    names = ", ".join(n for n, _ in matched)
    print(f"for-diff: changeset touches {names} → running harness ({args.mode})")
    failed = False

    async def _exec() -> None:
        nonlocal failed
        for name, probe in matched:
            cfg = RunConfig(
                api_base=args.api_base, web_base=args.web_base,
                mode=args.mode, judge_sample=args.judge_sample,
            )
            result = await run_probe(probe, cfg)
            out_path = Path(args.out.replace(".html", f".{name}.html"))
            write_report(result, out_path)
            await persist_run_summary(result, out_path.read_text(), args.summary_db)
            det = sum(1 for it in result.items if it.passed)
            ok = len(result.items) > 0 and det == len(result.items)
            failed = failed or not ok
            print(
                f"  [{name}] {'PASS' if ok else 'FAIL'} — {len(result.items)} items, "
                f"{det}/{len(result.items)} deterministic, {len(result.captures)} cards, "
                f"cost={'$0 (replay)' if result.cost_usd == 0 else result.cost_usd}; "
                f"report {out_path}",
            )

    asyncio.run(_exec())
    return 1 if failed else 0


def _run_explore(args: argparse.Namespace) -> int:
    from datetime import UTC, datetime

    from tests.harness.explorer import (
        explore,
        generate_scenarios,
        load_corpus,
        persist_explore_summary,
        promote_failures,
        write_explore_report,
    )
    from tests.harness.runner import run_cost

    probe = _build_probe(args.probe, args.count)

    async def _exec() -> tuple[Any, Path, float | None, bool]:
        started = datetime.now(UTC)
        if args.from_corpus:
            scenarios = load_corpus(probe.name)
        else:
            scenarios = await generate_scenarios(probe, args.scenarios)
        result = await explore(probe, scenarios, args.api_base, args.web_base)
        corpus = promote_failures(result)
        report_html = write_explore_report(result, Path(args.out))
        cost = await run_cost(args.mode, started)
        ok = await persist_explore_summary(
            result, report_html, cost, args.mode, args.summary_db,
        )
        return result, corpus, cost, ok

    result, corpus, cost, ok = asyncio.run(_exec())
    total = len(result.results)
    passed = result.passed
    print(
        f"\n[explore:{args.mode}] {probe.name}: {total} scenarios, "
        f"{passed} passed, {total - passed} promoted to corpus, "
        f"cost={'$0 (replay)' if cost == 0 else cost}",
    )
    print(f"report: {args.out}")
    print(f"corpus: {corpus}")
    print(f"admin summary: {'written to main DB' if ok else 'SKIPPED'}")
    return 0


def _run_improve_queue(args: argparse.Namespace) -> int:
    """List / approve / reject / show entries in the durable proposal queue.
    Approval is what gates execution — `improve approve <id>` is exactly what
    Ben's 'do #2' reply maps to."""
    from tests.harness.improver.state import Queue

    queue = Queue.load()
    cmd = args.improve_cmd

    def _score(it: object) -> float:
        v = getattr(it, "proposal", {}).get("score", 0)
        return float(v) if isinstance(v, (int, float)) else 0.0

    if cmd == "proposals":
        live = queue.by_status("proposed", "approved")
        if not live:
            print("[improve:proposals] queue empty — run `improve scan` first.")
            return 0
        print(f"[improve:proposals] {len(live)} open ({len(queue.by_status('proposed'))} proposed, "
              f"{len(queue.by_status('approved'))} approved):")
        for item in sorted(live, key=_score, reverse=True):
            p = item.proposal
            print(f"  {item.status:<8} {p['id']}  [{p.get('score')}] {p.get('est_size')}/{p.get('severity')} "
                  f"{p.get('category')}  {p.get('title')}")
        return 0

    target = queue.get(args.id)
    if target is None:
        print(f"[improve:{cmd}] no proposal with id {args.id!r}")
        return 1

    if cmd == "show":
        print(json.dumps(target.proposal, indent=2))
        print(f"status: {target.status}")
        return 0

    new_status = {"approve": "approved", "reject": "rejected", "done": "done"}[cmd]
    queue.set_status(args.id, new_status)
    print(f"[improve:{cmd}] {args.id} → {new_status}: {target.proposal.get('title')}")
    return 0


def _run_improve_execute(args: argparse.Namespace) -> int:
    """Print the subagent execution brief for an approved proposal, gated by the
    execution budget. The orchestrating agent spawns a worktree-isolated subagent
    with this brief; it does NOT code here (Python can't run /autopilot)."""
    from tests.harness.improver.budget import BudgetCaps, Ledger, check_execute
    from tests.harness.improver.execute import build_brief
    from tests.harness.improver.state import Queue

    queue = Queue.load()
    target = queue.get(args.id)
    if target is None:
        print(f"[improve:execute] no proposal with id {args.id!r}")
        return 1
    if target.status != "approved":
        print(f"[improve:execute] {args.id} is '{target.status}', not 'approved' — approve it first.")
        return 1

    caps = BudgetCaps.from_env()
    ledger = Ledger.load()
    verdict = check_execute(caps, ledger)
    if not verdict.ok:
        print(f"[improve:execute] BLOCKED — {verdict.reason}")
        return 1

    ledger.record("execute", note=f"brief for {target.id}: {target.proposal.get('title')}")
    print(build_brief(target.proposal, branch=f"improver/{target.id}"))
    return 0


def _run_improve_budget(args: argparse.Namespace) -> int:
    """Print the improver's rolling-window budget usage vs. caps."""
    from datetime import UTC, datetime

    from tests.harness.improver.budget import (
        BudgetCaps,
        Ledger,
        check_execute,
        check_scan,
        improver_api_key,
    )

    caps = BudgetCaps.from_env()
    ledger = Ledger.load()
    now = datetime.now(UTC)
    print("[improve:budget]")
    print(f"  api key:     {'separate IMPROVER key' if improver_api_key() else 'subscription/default key'}")
    print(f"  scans / 5h:  {ledger.scans_in_5h(now)} / {caps.max_scans_per_5h}")
    print(f"  execs / 7d:  {ledger.executions_in_7d(now)} / {caps.max_executions_per_7d}")
    print(f"  spend / 7d:  ${ledger.spend_in_7d(now):.2f} / ${caps.max_usd_per_7d:.2f}")
    print(f"  scan now?    {check_scan(caps, ledger, now=now).reason}")
    print(f"  execute now? {check_execute(caps, ledger, now=now).reason}")
    return 0


def _run_improve_scan(args: argparse.Namespace) -> int:
    """Scan the configured surfaces, detect + judge, and synthesize ranked
    proposals into an HTML report a human can eyeball. Gated + metered by the
    budget governor so it can never run past its rolling-window allowance."""
    from datetime import UTC, datetime

    from tests.harness.browser import HarnessBrowser
    from tests.harness.improver.budget import BudgetCaps, Ledger, check_scan
    from tests.harness.improver.proposals import Proposal, generate_proposals, merge
    from tests.harness.improver.report import write_scan_report
    from tests.harness.improver.scanner import scan_surfaces
    from tests.harness.improver.sources import content_quality_proposals, feature_proposals
    from tests.harness.improver.state import Queue
    from tests.harness.improver.surfaces import surfaces_for
    from tests.harness.improver.types import PageObservation
    from tests.harness.runner import run_cost
    from tests.harness.seed import seed_world

    caps = BudgetCaps.from_env()
    ledger = Ledger.load()
    if not args.ignore_budget:
        verdict = check_scan(caps, ledger)
        if not verdict.ok:
            print(f"[improve:scan] SKIPPED — {verdict.reason}")
            return 0
    queue = Queue.load()
    seen = queue.seen_ids()

    apps = tuple(a.strip() for a in args.apps.split(",") if a.strip())
    surfaces = surfaces_for(apps)
    if args.max_surfaces:
        surfaces = surfaces[: args.max_surfaces]
    bases: dict[str, str] = {
        k: v for k, v in {
            "web": args.web_base, "admin": args.admin_base, "mobile_web": args.mobile_base,
        }.items() if v
    }

    async def _exec() -> tuple[list[PageObservation], list[Proposal], float | None]:
        started = datetime.now(UTC)
        seed = await seed_world()
        async with HarnessBrowser(args.web_base) as browser:
            obs = await scan_surfaces(
                browser, surfaces, bases, seed, judge=not args.no_judge,
            )
        # Three proposal sources feed one ranked list: UI (from the scan),
        # AI-output quality (from the harness corpus), and small features.
        batches: list[list[Proposal]] = []
        if not args.no_propose:
            batches.append(await generate_proposals(obs, max_size=args.max_size))
            if not args.no_content:
                batches.append(await content_quality_proposals(max_size=args.max_size))
            if not args.no_features:
                batches.append(await feature_proposals(surfaces, max_size=args.max_size))
        # Dedupe against everything ever queued so known/rejected ideas never
        # resurface.
        proposals = merge(batches, seen_ids=seen)
        cost = await run_cost(args.mode, started)
        return obs, proposals, cost

    obs, proposals, cost = asyncio.run(_exec())
    # If the cost read failed (None) on a billable run, record a conservative
    # non-zero estimate so the 7d $ cap still trips — never silently log $0 and
    # let the dollar guarantee degrade to the scan-count cap alone.
    if cost is None:
        cost_for_ledger = 0.0 if args.mode == "replay" else 0.50
    else:
        cost_for_ledger = cost
    ledger.record("scan", cost_usd=cost_for_ledger, note=f"{len(proposals)} new proposals")
    added = queue.add(proposals)
    out = write_scan_report(obs, proposals, Path(args.out))
    scanned = sum(1 for o in obs if o.ok)
    hits = sum(len(o.hits) for o in obs)
    cost_str = "$0 (replay)" if cost == 0 else (f"~${cost_for_ledger} (est)" if cost is None else f"${cost}")
    print(
        f"\n[improve:scan:{args.mode}] {scanned}/{len(obs)} surfaces loaded, "
        f"{hits} hits, {len(added)} new proposals queued, cost={cost_str}",
    )
    for p in proposals[:12]:
        print(f"  [{p.score:.2f}] {p.est_size}/{p.severity:<6} {p.category:<11} {p.id}  {p.title}")
    print(f"report: {out}")
    print(f"queue:  {queue.path}")
    return 0


_PROTECTED_DBS = {"mathapp"}  # the main app DB — never seed/generate into it


def _safe_db(url: str) -> str:
    """The harness SEEDS fake users and GENERATES content, so it must target a
    dedicated DB — never the main app DB (run summaries go to --summary-db
    separately). Refuse the main DB outright."""
    name = url.rstrip("/").rsplit("/", 1)[-1].split("?")[0]
    if name in _PROTECTED_DBS:
        raise SystemExit(
            f"refusing to run the harness against DB {name!r}: it seeds + "
            "generates data and must use a separate DB (e.g. mathapp_harness). "
            "Pass --db or set HARNESS_DATABASE_URL.",
        )
    return url


def main(argv: list[str]) -> int:
    args = _parse(argv)

    # Must be set before importing api/runner: cassette mode + DB target.
    # Force (not setdefault) so an ambient DATABASE_URL — e.g. one pointing at
    # the main DB — can't leak in and get seeded into. getattr keeps subcommands
    # that don't seed (e.g. `improve budget`) from needing these flags.
    os.environ["HARNESS_LLM_MODE"] = getattr(args, "mode", "replay")
    os.environ["DATABASE_URL"] = _safe_db(getattr(args, "db", _DEFAULT_DB))

    if args.cmd == "improve":
        # Bill the improver's LLM spend to its dedicated Console key when set, so
        # the subscription is never touched. Must precede any api.* import.
        from tests.harness.improver.budget import improver_api_key
        key = improver_api_key()
        if key:
            os.environ["CLAUDE_API_KEY"] = key
        improve_cmd = getattr(args, "improve_cmd", None)
        if improve_cmd == "budget":
            return _run_improve_budget(args)
        if improve_cmd == "execute":
            return _run_improve_execute(args)
        if improve_cmd in ("proposals", "approve", "reject", "show", "done"):
            return _run_improve_queue(args)
        return _run_improve_scan(args)
    if args.cmd == "explore":
        return _run_explore(args)
    if args.cmd == "for-diff":
        return _run_for_diff(args)

    from tests.harness.report import write_report
    from tests.harness.runner import RunConfig, persist_run_summary, run_probe

    probe = _build_probe(args.probe, args.count)
    cfg = RunConfig(
        api_base=args.api_base, web_base=args.web_base,
        mode=args.mode, judge_sample=args.judge_sample,
    )

    async def _execute() -> tuple[Any, Path, bool]:
        result = await run_probe(probe, cfg)
        out_path = write_report(result, Path(args.out))
        report_html = out_path.read_text()
        summary_ok = await persist_run_summary(result, report_html, args.summary_db)
        return result, out_path, summary_ok

    result, out, summary_ok = asyncio.run(_execute())

    det_passed = sum(1 for it in result.items if it.passed)
    print(
        f"\n[{result.mode}] {result.probe_name}: "
        f"{len(result.items)} items, {det_passed} passed deterministic checks, "
        f"{len(result.captures)} cards captured, "
        f"cost={'$0 (replay)' if result.cost_usd == 0 else result.cost_usd}",
    )
    print(f"report: {out}")
    print(f"admin summary: {'written to main DB' if summary_ok else 'SKIPPED (see --summary-db)'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
