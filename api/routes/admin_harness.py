"""Admin endpoint: autonomous test-harness run history."""

import secrets
import uuid as uuid_lib
from collections import defaultdict
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings
from api.database import get_db
from api.middleware.auth import CurrentUser, require_admin
from api.middleware.rate_limit import limiter
from api.models.harness_run import HarnessRun

router = APIRouter()

# How many recent runs per probe feed a probe's sparkline + the "vs previous
# run" delta. Small so the trend reads "recent", not lifetime.
_SPARK_WINDOW = 12
# How many of the most-recent runs (across every probe) the top-line
# "N of last M failing" alarm summarizes.
_RECENT_WINDOW = 20

# Cap the remotely-writable report so a leaked ingest token can't bloat a row.
# CI sends a few KB of text digest — screenshots stay in the run artifacts, not
# here — so this is generous headroom, not a real constraint on honest callers.
_MAX_REPORT_HTML = 512 * 1024


def _serialize(r: HarnessRun) -> dict[str, Any]:
    return {
        "id": str(r.id),
        "probe": r.probe,
        "mode": r.mode,
        "items_generated": r.items_generated,
        "det_pass": r.det_pass,
        "det_total": r.det_total,
        "captures": r.captures,
        "judge_count": r.judge_count,
        "judge_mean": r.judge_mean,
        "cost_usd": r.cost_usd,
        "passed": r.passed,
        "note": r.note,
        "prompt": r.prompt,
        "created_at": r.created_at.isoformat(),
    }


async def _probe_health(db: AsyncSession) -> list[dict[str, Any]]:
    """Per-probe *current* health for the top band — the AI-quality regression
    alarm. For each probe: its latest run's pass/fail + deterministic pass-rate,
    the previous run's rate (so the UI can flag a REGRESSION), a recent (not
    lifetime) judge score, a short sparkline of recent pass-rates, and when it
    last ran (so a probe that stopped reporting can be flagged stale).

    Computed over ALL runs, independent of the table's probe/failure filter —
    the band is a global alarm, not a view of the filtered rows.
    """
    rn = func.row_number().over(
        partition_by=HarnessRun.probe,
        order_by=HarnessRun.created_at.desc(),
    ).label("rn")
    recent = select(
        HarnessRun.id, HarnessRun.probe, HarnessRun.mode, HarnessRun.created_at,
        HarnessRun.passed, HarnessRun.det_pass, HarnessRun.det_total,
        HarnessRun.judge_mean, rn,
    ).subquery()
    rows = (
        await db.execute(
            select(recent).where(recent.c.rn <= _SPARK_WINDOW).order_by(
                recent.c.probe, recent.c.rn,
            ),
        )
    ).all()

    # Lifetime run count per probe — context alongside the recent-window trend.
    counts: dict[str, int] = {
        probe: count
        for probe, count in (
            await db.execute(
                select(HarnessRun.probe, func.count()).group_by(HarnessRun.probe),
            )
        ).all()
    }

    grouped: dict[str, list[Any]] = defaultdict(list)
    for row in rows:
        grouped[row.probe].append(row)  # already ordered newest-first (rn asc)

    health: list[dict[str, Any]] = []
    for probe, group in grouped.items():
        latest = group[0]
        prev = group[1] if len(group) > 1 else None
        recent_judge = next(
            (g.judge_mean for g in group if g.judge_mean is not None), None,
        )
        # Sparkline: deterministic pass-rate per run, oldest→newest. Runs with
        # no deterministic checks are "no data" (mirrors detRate() → null on the
        # client) and are omitted, never plotted as a fake 0% dip.
        spark = [
            round(g.det_pass / g.det_total, 4)
            for g in reversed(group)
            if g.det_total
        ]
        health.append({
            "probe": probe,
            "latest_run_id": str(latest.id),
            "latest_mode": latest.mode,
            "latest_passed": latest.passed,
            "latest_det_pass": latest.det_pass,
            "latest_det_total": latest.det_total,
            "prev_det_pass": prev.det_pass if prev else None,
            "prev_det_total": prev.det_total if prev else None,
            "recent_judge_mean": (
                round(float(recent_judge), 2) if recent_judge is not None else None
            ),
            "last_run_at": latest.created_at.isoformat(),
            "spark": spark,
            "total_runs": counts.get(probe, len(group)),
        })
    # Latest-first, so the freshest signal leads the band.
    health.sort(key=lambda h: h["last_run_at"], reverse=True)
    return health


@router.get("/harness-runs")
async def harness_runs(
    probe: str | None = Query(default=None),
    failed_only: bool = Query(default=False),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    base = select(HarnessRun)
    if probe:
        base = base.where(HarnessRun.probe == probe)
    if failed_only:
        # Server-side so total_count + pagination stay honest (mirrors the
        # LLM-calls failures view). "Failed" = anything that isn't a clean pass.
        base = base.where(HarnessRun.passed.is_(False))

    total = (
        await db.execute(select(func.count()).select_from(base.subquery()))
    ).scalar_one()

    rows = (
        await db.execute(
            # `id` breaks ties: created_at defaults to now(), the
            # TRANSACTION timestamp, and an ingest writes a batch — so
            # OFFSET paging over an unstable order repeats and skips runs.
            base.order_by(HarnessRun.created_at.desc(), HarnessRun.id)
            .limit(limit)
            .offset(offset),
        )
    ).scalars().all()

    health = await _probe_health(db)

    # Top-line alarm inputs, over the most-recent runs across every probe —
    # filter-independent so the headline never lies about global health. Cost
    # rides along here (folded out of the per-row column into the strip).
    recent = (
        await db.execute(
            select(HarnessRun.passed, HarnessRun.cost_usd).order_by(
                HarnessRun.created_at.desc(),
            ).limit(_RECENT_WINDOW),
        )
    ).all()

    return {
        "runs": [_serialize(r) for r in rows],
        "total_count": total,
        "probe_health": health,
        "summary": {
            "recent_window": len(recent),
            "recent_failing": sum(1 for r in recent if not r.passed),
            "recent_cost": round(sum(r.cost_usd or 0.0 for r in recent), 4),
            "probe_count": len(health),
            "newest_run_at": health[0]["last_run_at"] if health else None,
        },
    }


@router.get("/harness-runs/{run_id}/report")
async def harness_run_report(
    run_id: str,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Return one run's self-contained HTML report so the dashboard can
    render it in-app (auth-gated; not a public file)."""
    try:
        rid = uuid_lib.UUID(run_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found") from e
    row = (
        await db.execute(select(HarnessRun).where(HarnessRun.id == rid))
    ).scalar_one_or_none()
    if row is None or not row.report_html:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Report not found",
        )
    return {"html": row.report_html}


class HarnessRunIngest(BaseModel):
    """Run-summary payload for the service-authenticated ingest path. Fields map
    1:1 to the writable HarnessRun columns; id + created_at are server-set."""

    probe: str = Field(max_length=50)
    mode: str = Field(max_length=20)
    items_generated: int = 0
    det_pass: int = 0
    det_total: int = 0
    captures: int = 0
    judge_count: int = 0
    judge_mean: float | None = None
    cost_usd: float | None = None
    passed: bool = False
    note: str | None = None
    prompt: str | None = None
    report_html: str | None = None


@router.post("/harness-runs/ingest", status_code=status.HTTP_201_CREATED)
@limiter.limit("60/minute")
async def ingest_harness_run(
    request: Request,
    payload: HarnessRunIngest,
    x_harness_token: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Service-authenticated write path for the "Harness Runs" tab.

    CI (GitHub Actions) can't open a Postgres connection to prod, so the
    autonomous harness POSTs its run summary here instead of writing the row
    directly. Guarded by a shared secret (``X-Harness-Token``), never a user
    session — disabled (503) when the token isn't configured."""
    token = settings.harness_ingest_token
    if not token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Harness ingest not configured",
        )
    # Compare as bytes: Starlette decodes headers as Latin-1, so a non-ASCII
    # token would make compare_digest raise (→ 500) instead of cleanly failing.
    supplied = (x_harness_token or "").encode("utf-8")
    if not secrets.compare_digest(supplied, token.encode("utf-8")):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid harness token",
        )
    if payload.report_html and len(payload.report_html) > _MAX_REPORT_HTML:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="report_html too large",
        )
    row = HarnessRun(**payload.model_dump())
    db.add(row)
    await db.commit()
    return {"id": str(row.id)}
