"""The figure text-auditor eval (api/core/geometry/audit.py).

Each case is a problem and an agreed fact list (corpus:
tests/harness/_corpus/figure_auditor.json):
  - MISSED: the list leaves out something the problem states. Each
    left-out statement is labelled with the problem's own words (one or
    more acceptable spans). Sources: real agreed readings with one fact
    removed, real agreed readings refused today by coverage that do miss
    something, and hand-written wordings (comparisons, complements,
    "respectively", "each", the subject of "intersects", methods that
    assert a relation, story wordings).
  - CLEAN: the list captures everything: real agreed readings trusted
    today, real readings refused today only for coverage words, and
    hand-written clean twins of the story cases.

The auditor is asked about each case RUNS times (each run is its own
recorded call: the run number is in the call's mode). Reported: recall (a
left-out statement counts as caught only when a finding's quote covers
it), the share of missed cases refused at all, the false-alarm rate on
clean cases, run-to-run consistency, and cost.

Record (under a hard spending cap, with the shared ledger):
    HARNESS_LLM_MODE=auto python -m tests.harness.probes.figure_auditor --cap 4
Replay ($0): HARNESS_LLM_MODE=replay python -m tests.harness.probes.figure_auditor
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from pathlib import Path
from typing import Any

_HERE = Path(__file__).resolve().parent.parent
CORPUS = _HERE / "_corpus" / "figure_auditor.json"
CASSETTE_DIR = _HERE / "_cassettes" / "figure_auditor"
RUNS = 2


def load_cases() -> list[dict[str, Any]]:
    return list(json.loads(CORPUS.read_text())["cases"])


def _span(text: str, part: str) -> tuple[int, int] | None:
    """Where `part` sits in `text`, both normalized (notation, case, spaces)."""
    from api.core.geometry.audit import _squash

    t, p = _squash(text), _squash(part)
    i = t.find(p) if p else -1
    return (i, i + len(p)) if i >= 0 else None


def covers(text: str, quote: str, gold: str) -> bool:
    """The finding's quote covers the labelled words: it overlaps at least
    half of them."""
    q, g = _span(text, quote), _span(text, gold)
    if q is None or g is None:
        return False
    return min(q[1], g[1]) - max(q[0], g[0]) >= 0.5 * (g[1] - g[0])


async def run_case(case: dict[str, Any], run: int) -> dict[str, Any]:
    from api.core.geometry.audit import audit_reading
    from api.core.geometry.facts import FigureFacts

    facts = FigureFacts.model_validate(case["facts"])
    try:
        found = await audit_reading(case["text"], facts, request=case.get("request", ""),
                                    mode=f"figure_audit_r{run}", user_id=None)
    except Exception as e:  # noqa: BLE001 - a case that can't run is reported as an error
        return {"id": case["id"], "run": run, "error": repr(e)[:200], "findings": []}
    return {"id": case["id"], "run": run, "error": "",
            "findings": [{"quote": f.quote, "missing": f.missing, "quoted": f.quoted} for f in found]}


async def run_all(cases: list[dict[str, Any]] | None = None, runs: int = RUNS) -> list[dict[str, Any]]:
    cases = cases if cases is not None else load_cases()
    prev = os.environ.get("HARNESS_CASSETTE_DIR")
    os.environ["HARNESS_CASSETTE_DIR"] = str(CASSETTE_DIR)
    sem = asyncio.Semaphore(6)

    async def one(c: dict[str, Any], r: int) -> dict[str, Any]:
        async with sem:
            return await run_case(c, r)

    try:
        return list(await asyncio.gather(*(one(c, r) for r in range(1, runs + 1) for c in cases)))
    finally:
        if prev is None:
            os.environ.pop("HARNESS_CASSETTE_DIR", None)
        else:
            os.environ["HARNESS_CASSETTE_DIR"] = prev


def score(cases: list[dict[str, Any]], results: list[dict[str, Any]]) -> dict[str, Any]:
    by = {(r["id"], r["run"]): r for r in results}
    runs = sorted({r["run"] for r in results})
    out: dict[str, Any] = {"runs": runs, "per_run": {}, "missed_detail": {}, "clean_alarms": {}}
    for run in runs:
        caught = total = refused = n_missed = alarms = n_clean = errors = unquoted = 0
        for c in cases:
            r = by.get((c["id"], run))
            if r is None or r["error"]:
                errors += 1
                continue
            fs = r["findings"]
            unquoted += sum(1 for f in fs if not f["quoted"])
            if c["set"] == "missed":
                n_missed += 1
                refused += bool(fs)
                for alts in c["missed"]:
                    total += 1
                    hit = any(covers(c["text"], f["quote"], g) for f in fs for g in alts)
                    caught += hit
                    if not hit:
                        out["missed_detail"].setdefault(c["id"], []).append(
                            {"run": run, "gold": alts[0], "findings": [f["quote"] for f in fs]})
            else:
                n_clean += 1
                alarms += bool(fs)
                if fs:
                    out["clean_alarms"].setdefault(c["id"], []).append(
                        {"run": run, "findings": [(f["quote"], f["missing"]) for f in fs]})
        out["per_run"][run] = {
            "recall_quote_covered": f"{caught}/{total}", "recall": round(caught / total, 3) if total else None,
            "missed_cases_refused": f"{refused}/{n_missed}",
            "clean_false_alarms": f"{alarms}/{n_clean}",
            "false_alarm_rate": round(alarms / n_clean, 3) if n_clean else None,
            "errors": errors, "unquoted_findings": unquoted,
        }
    if len(runs) >= 2:
        same_verdict = same_quotes = n = 0
        for c in cases:
            rs = [by.get((c["id"], run)) for run in runs]
            if any(r is None or r["error"] for r in rs):
                continue
            n += 1
            same_verdict += len({bool(r["findings"]) for r in rs}) == 1  # type: ignore[index]
            same_quotes += len({tuple(sorted(f["quote"] for f in r["findings"])) for r in rs}) == 1  # type: ignore[index]
        out["consistency"] = {"same_verdict": f"{same_verdict}/{n}", "same_findings": f"{same_quotes}/{n}"}
    return out


def main() -> None:
    from tests.harness.budget import ledger_from_env, spending_cap

    parser = argparse.ArgumentParser()
    parser.add_argument("--only", nargs="*")
    parser.add_argument("--runs", type=int, default=RUNS)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--cap", type=float, default=4.0)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    cases = [c for c in load_cases() if not args.only or c["id"] in args.only][: args.limit]
    ledger, total = ledger_from_env()
    with spending_cap("figure-auditor", cap_usd=args.cap, ledger=ledger, total_usd=total) as spend:
        results = asyncio.run(run_all(cases, args.runs))
    summary = score(cases, results)
    cost = spend.row(problems=len(cases) * args.runs)
    print(json.dumps({k: v for k, v in summary.items() if k in ("per_run", "consistency")}, indent=1))
    print("COST", json.dumps(cost))
    if spend.stopped:
        print(spend.stopped)
    if args.out:
        args.out.write_text(json.dumps({"results": results, "summary": summary, "cost": cost}, indent=1,
                                       ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()
