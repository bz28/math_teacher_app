"""CLI: python -m tests.harness run --probe geometry --mode replay

Connects to an already-running app (API + web), runs a probe end to end, and
writes an HTML report. Env that must be set BEFORE importing app modules
(LLM cassette mode, DB) is applied here at the top.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path
from typing import Any

_DEFAULT_API = "http://localhost:8000/v1"
_DEFAULT_WEB = "http://localhost:3000"
# The demo is a standalone zero-auth Vite SPA; `vite preview` serves it (with
# history-fallback for its deep client-side routes) on :4173 by default.
_DEFAULT_DEMO = "http://localhost:4173"
_DEFAULT_DB = "postgresql+asyncpg://mathapp:mathapp@localhost:5432/mathapp_harness"


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

    fl = sub.add_parser(
        "flows",
        help="run the end-to-end user-journey flows against a running app",
    )
    fl.add_argument("--mode", default="replay", choices=["replay", "record", "auto"])
    fl.add_argument("--db", default=os.environ.get("HARNESS_DATABASE_URL", _DEFAULT_DB))
    fl.add_argument("--api-base", default=os.environ.get("HARNESS_API_BASE", _DEFAULT_API))
    fl.add_argument("--web-base", default=os.environ.get("HARNESS_WEB_BASE", _DEFAULT_WEB))
    fl.add_argument(
        "--only", default="",
        help="comma list of flow names to run (default: all). e.g. "
             "join_class,submit_homework,grade_publish",
    )

    from tests.harness.scorecard import add_parser as add_scorecard_parser
    add_scorecard_parser(sub)

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
    from tests.harness.runner import RunConfig, run_probe

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


def _run_flows(args: argparse.Namespace) -> int:
    """Run the end-to-end user-journey flows against a running app and print a
    PASS/FAIL line per journey. Browser journeys (login/logout) need the web app
    up; API journeys (join_class/submit_homework/grade_publish) need only the
    API. A journey that can't run (e.g. its surface unreachable) is DROPPED, not
    failed, so a flaky environment never reads as a broken journey. Exit code is
    non-zero iff a journey ran and reported a real failure."""
    from tests.harness.browser import HarnessBrowser
    from tests.harness.flows import FlowResult, flow_names, run_flows
    from tests.harness.seed import seed_world

    only = {n.strip() for n in args.only.split(",") if n.strip()} or None
    if only:
        unknown = only - set(flow_names())
        if unknown:
            raise SystemExit(
                f"unknown flow(s): {', '.join(sorted(unknown))}. "
                f"known: {', '.join(flow_names())}",
            )

    async def _exec() -> list[FlowResult]:
        seed = await seed_world()
        async with HarnessBrowser(args.web_base) as browser:
            return await run_flows(
                browser, args.web_base, args.api_base, seed, only=only,
            )

    results = asyncio.run(_exec())
    requested = only or set(flow_names())
    ran = {r.name for r in results}
    dropped = sorted(requested - ran)
    passed = sum(1 for r in results if r.passed)
    print(f"\n[flows] api={args.api_base} web={args.web_base}")
    for r in results:
        print(f"  {'PASS' if r.passed else 'FAIL'}  {r.name:<16} {r.title}")
        if not r.passed:
            for issue in r.issues:
                print(f"        ↳ {issue}")
    for name in dropped:
        print(f"  DROP  {name:<16} (surface unreachable — skipped, not failed)")
    print(f"\n[flows] {passed}/{len(results)} ran-flows passed, {len(dropped)} dropped")
    return 0 if passed == len(results) else 1


def _run_explore(args: argparse.Namespace) -> int:
    from datetime import UTC, datetime

    from tests.harness.explorer import (
        explore,
        generate_scenarios,
        load_corpus,
        promote_failures,
        write_explore_report,
    )
    from tests.harness.runner import run_cost

    probe = _build_probe(args.probe, args.count)

    async def _exec() -> tuple[Any, Path, float | None]:
        started = datetime.now(UTC)
        if args.from_corpus:
            scenarios = load_corpus(probe.name)
        else:
            scenarios = await generate_scenarios(probe, args.scenarios)
        result = await explore(probe, scenarios, args.api_base, args.web_base)
        corpus = promote_failures(result)
        write_explore_report(result, Path(args.out))
        cost = await run_cost(args.mode, started)
        return result, corpus, cost

    result, corpus, cost = asyncio.run(_exec())
    total = len(result.results)
    passed = result.passed
    print(
        f"\n[explore:{args.mode}] {probe.name}: {total} scenarios, "
        f"{passed} passed, {total - passed} promoted to corpus, "
        f"cost={'$0 (replay)' if cost == 0 else cost}",
    )
    print(f"report: {args.out}")
    print(f"corpus: {corpus}")
    return 0


_PROTECTED_DBS = {"mathapp"}  # the main app DB — never seed/generate into it


def _safe_db(url: str) -> str:
    """The harness SEEDS fake users and GENERATES content, so it must target a
    dedicated DB — never the main app DB. Refuse the main DB outright."""
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

    if args.cmd == "scorecard":
        # Sets its own env (replay only, a key that can't spend, no database)
        # before any api.* import.
        from tests.harness.scorecard import run_cli
        return run_cli(args)

    # Must be set before importing api/runner: cassette mode + DB target.
    # Force (not setdefault) so an ambient DATABASE_URL — e.g. one pointing at
    # the main DB — can't leak in and get seeded into. getattr keeps subcommands
    # that don't define them from needing these flags.
    os.environ["HARNESS_LLM_MODE"] = getattr(args, "mode", "replay")
    os.environ["DATABASE_URL"] = _safe_db(getattr(args, "db", _DEFAULT_DB))

    if args.cmd == "explore":
        return _run_explore(args)
    if args.cmd == "for-diff":
        return _run_for_diff(args)
    if args.cmd == "flows":
        return _run_flows(args)

    from tests.harness.report import write_report
    from tests.harness.runner import RunConfig, run_probe

    probe = _build_probe(args.probe, args.count)
    cfg = RunConfig(
        api_base=args.api_base, web_base=args.web_base,
        mode=args.mode, judge_sample=args.judge_sample,
    )

    async def _execute() -> tuple[Any, Path]:
        result = await run_probe(probe, cfg)
        return result, write_report(result, Path(args.out))

    result, out = asyncio.run(_execute())

    det_passed = sum(1 for it in result.items if it.passed)
    print(
        f"\n[{result.mode}] {result.probe_name}: "
        f"{len(result.items)} items, {det_passed} passed deterministic checks, "
        f"{len(result.captures)} cards captured, "
        f"cost={'$0 (replay)' if result.cost_usd == 0 else result.cost_usd}",
    )
    print(f"report: {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
