"""Admin endpoint: autonomous test-harness run history."""

import uuid as uuid_lib
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import CurrentUser, require_admin
from api.models.harness_run import HarnessRun

router = APIRouter()


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


@router.get("/harness-runs")
async def harness_runs(
    probe: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    base = select(HarnessRun)
    if probe:
        base = base.where(HarnessRun.probe == probe)

    total = (
        await db.execute(select(func.count()).select_from(base.subquery()))
    ).scalar_one()

    rows = (
        await db.execute(
            base.order_by(HarnessRun.created_at.desc()).limit(limit).offset(offset),
        )
    ).scalars().all()

    # Per-probe rollup across the whole table (for the header chips).
    agg = (
        await db.execute(
            select(
                HarnessRun.probe,
                func.count().label("runs"),
                func.avg(HarnessRun.judge_mean).label("avg_judge"),
                func.coalesce(func.sum(HarnessRun.cost_usd), 0.0).label("total_cost"),
            ).group_by(HarnessRun.probe),
        )
    ).all()

    return {
        "runs": [_serialize(r) for r in rows],
        "total_count": total,
        "by_probe": [
            {
                "probe": p,
                "runs": runs,
                "avg_judge": round(float(avg_judge), 2) if avg_judge is not None else None,
                "total_cost": round(float(total_cost), 4),
            }
            for p, runs, avg_judge, total_cost in agg
        ],
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
