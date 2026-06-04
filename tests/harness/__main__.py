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

_DEFAULT_API = "http://localhost:8000/v1"
_DEFAULT_WEB = "http://localhost:3000"
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
    return p.parse_args(argv)


def _build_probe(name: str, count: int):  # type: ignore[no-untyped-def]
    if name == "geometry":
        from tests.harness.probes.geometry import GeometryProbe
        return GeometryProbe(count=count)
    raise SystemExit(f"unknown probe: {name!r}")


def main(argv: list[str]) -> int:
    args = _parse(argv)

    # Must be set before importing api/runner: cassette mode + DB target.
    os.environ["HARNESS_LLM_MODE"] = args.mode
    os.environ.setdefault("DATABASE_URL", args.db)

    from tests.harness.report import write_report
    from tests.harness.runner import RunConfig, run_probe

    probe = _build_probe(args.probe, args.count)
    cfg = RunConfig(
        api_base=args.api_base, web_base=args.web_base,
        mode=args.mode, judge_sample=args.judge_sample,
    )

    result = asyncio.run(run_probe(probe, cfg))
    out = write_report(result, Path(args.out))

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
