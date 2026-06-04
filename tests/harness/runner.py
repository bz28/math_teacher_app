"""Runner — orchestrates one probe end to end against an already-running app.

seed → generate → deterministic checks → drive browser to capture cards →
sampled judge → tally cost. Returns a RunResult the reporter renders. Does
NOT boot the app (v1 connects to a running API+web).
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

from tests.harness.browser import HarnessBrowser
from tests.harness.eval import JudgeScore, judge_card
from tests.harness.probe import Probe
from tests.harness.seed import seed_world
from tests.harness.types import CardCapture, CheckResult, GeneratedItem, HarnessContext


@dataclass
class ItemResult:
    item: GeneratedItem
    checks: list[CheckResult]

    @property
    def passed(self) -> bool:
        return all(c.passed for c in self.checks)


@dataclass
class CaptureResult:
    capture: CardCapture
    judge: JudgeScore | None


@dataclass
class RunResult:
    probe_name: str
    mode: str
    items: list[ItemResult] = field(default_factory=list)
    captures: list[CaptureResult] = field(default_factory=list)
    cost_usd: float | None = None
    note: str = ""


@dataclass
class RunConfig:
    api_base: str
    web_base: str
    mode: str
    judge_sample: int = 3


def _summary_fields(result: RunResult) -> dict[str, object]:
    det_pass = sum(1 for it in result.items if it.passed)
    judged = [c.judge for c in result.captures if c.judge is not None]
    judge_mean = (
        round(sum(j.mean for j in judged) / len(judged), 2) if judged else None
    )
    return {
        "probe": result.probe_name,
        "mode": result.mode,
        "items_generated": len(result.items),
        "det_pass": det_pass,
        "det_total": len(result.items),
        "captures": len(result.captures),
        "judge_count": len(judged),
        "judge_mean": judge_mean,
        "cost_usd": result.cost_usd,
        "passed": len(result.items) > 0 and det_pass == len(result.items),
        "note": result.note,
    }


async def persist_run_summary(
    result: RunResult, report_path: str, summary_db_url: str,
) -> bool:
    """Write a one-row run summary to the MAIN app DB (which the admin
    dashboard reads), separate from the harness test DB. Best-effort:
    returns False on any failure rather than crashing the run."""
    try:
        from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

        from api.models.harness_run import HarnessRun

        engine = create_async_engine(summary_db_url)
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                s.add(HarnessRun(report_path=report_path, **_summary_fields(result)))
                await s.commit()
        finally:
            await engine.dispose()
        return True
    except Exception:  # noqa: BLE001 — summary is observability, never fatal
        return False


async def run_probe(probe: Probe, cfg: RunConfig) -> RunResult:
    started = _utcnow()
    seed = await seed_world()
    ctx = HarnessContext(
        api_base=cfg.api_base, web_base=cfg.web_base,
        teacher_token=seed.teacher_token, student_token=seed.student_token,
        teacher_refresh=seed.teacher_refresh, student_refresh=seed.student_refresh,
        teacher_id=seed.teacher_id, student_id=seed.student_id,
        course_id=seed.course_id, unit_id=seed.unit_id,
        assignment_id=seed.assignment_id,
    )

    items = await probe.generate(ctx)
    item_results = [ItemResult(it, probe.deterministic_checks(it)) for it in items]

    rubric = probe.judge_rubric()
    async with HarnessBrowser(ctx.web_base) as browser:
        caps = await probe.capture_cards(ctx, browser, items)

    capture_results: list[CaptureResult] = []
    for i, cap in enumerate(caps):
        score = await judge_card(cap, rubric) if i < cfg.judge_sample else None
        capture_results.append(CaptureResult(cap, score))

    cost = await _run_cost(cfg.mode, started)
    return RunResult(
        probe_name=probe.name, mode=cfg.mode,
        items=item_results, captures=capture_results, cost_usd=cost,
        note=f"{len(items)} figure items generated; {len(caps)} cards captured",
    )


def _utcnow() -> object:
    from datetime import UTC, datetime
    return datetime.now(UTC)


async def _run_cost(mode: str, started: object) -> float | None:
    """Sum the USD cost of LLM calls logged during this run. Replay makes no
    live calls, so it's $0 by definition. On record/auto, read the persisted
    LLMCall rows (give fire-and-forget persists a moment to land first)."""
    if mode == "replay":
        return 0.0
    await asyncio.sleep(2.0)
    try:
        from sqlalchemy import func, select

        from api.database import get_session_factory
        from api.models.llm_call import LLMCall

        async with get_session_factory()() as s:
            total = (await s.execute(
                select(func.coalesce(func.sum(LLMCall.cost_usd), 0.0))
                .where(LLMCall.created_at >= started),
            )).scalar_one()
        return round(float(total), 4)
    except Exception:  # noqa: BLE001 — cost is best-effort reporting, never fatal
        return None
