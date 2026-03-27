"""Admin quality score endpoints."""

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import CurrentUser, require_admin
from api.models.quality_score import QualityScore
from api.models.session import Session

router = APIRouter()


def _time_range(hours: int) -> datetime:
    return datetime.now(UTC) - timedelta(hours=hours)


@router.get("/quality")
async def quality_scores(
    hours: int = Query(default=168, ge=1, le=2160),
    only_failed: bool = Query(default=False),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    since = _time_range(hours)

    base_filters = [QualityScore.created_at >= since]
    if only_failed:
        base_filters.append(QualityScore.passed.is_(False))

    # Aggregate stats
    agg = (await db.execute(
        select(
            func.count().label("total"),
            func.sum(case((QualityScore.passed.is_(True), 1), else_=0)).label("passed"),
            func.avg(QualityScore.correctness).label("avg_correctness"),
            func.avg(QualityScore.optimality).label("avg_optimality"),
            func.avg(QualityScore.clarity).label("avg_clarity"),
            func.avg(QualityScore.flow).label("avg_flow"),
        ).where(*base_filters)
    )).one()

    total = agg.total or 0
    pass_rate = round((agg.passed or 0) / total * 100, 1) if total else 0.0

    # Recent scores with session problem
    rows = (await db.execute(
        select(QualityScore, Session.problem)
        .join(Session, Session.id == QualityScore.session_id)
        .where(*base_filters)
        .order_by(QualityScore.created_at.desc())
        .offset(offset)
        .limit(limit)
    )).all()

    return {
        "summary": {
            "total": total,
            "passed": agg.passed or 0,
            "pass_rate": pass_rate,
            "avg_correctness": round(agg.avg_correctness or 0, 2),
            "avg_optimality": round(agg.avg_optimality or 0, 2),
            "avg_clarity": round(agg.avg_clarity or 0, 2),
            "avg_flow": round(agg.avg_flow or 0, 2),
        },
        "scores": [
            {
                "id": str(qs.id),
                "session_id": str(qs.session_id),
                "problem": problem[:80],
                "correctness": qs.correctness,
                "optimality": qs.optimality,
                "clarity": qs.clarity,
                "flow": qs.flow,
                "passed": qs.passed,
                "issues": qs.issues,
                "created_at": qs.created_at.isoformat(),
            }
            for qs, problem in rows
        ],
        "total_count": total,
    }
