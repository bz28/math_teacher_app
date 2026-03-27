"""Admin sessions analytics endpoint."""

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import Date, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import CurrentUser, require_admin
from api.models.session import Session
from api.models.user import User

router = APIRouter()


def _time_range(hours: int) -> datetime:
    return datetime.now(UTC) - timedelta(hours=hours)


@router.get("/sessions")
async def sessions(
    hours: int = Query(default=168, ge=1, le=87600),
    user_id: str | None = Query(default=None),
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    since = _time_range(hours)
    base_filters = [Session.created_at >= since]
    if user_id:
        base_filters.append(Session.user_id == user_id)

    # Total sessions
    total_count = (await db.execute(
        select(func.count()).select_from(Session).where(*base_filters)
    )).scalar() or 0

    # By mode
    by_mode = (await db.execute(
        select(
            Session.mode,
            func.count().label("count"),
        )
        .where(*base_filters)
        .group_by(Session.mode)
    )).all()

    # Sessions per day (for trend chart)
    sessions_by_day = (await db.execute(
        select(
            cast(Session.created_at, Date).label("day"),
            func.count().label("count"),
        )
        .where(*base_filters)
        .group_by("day")
        .order_by("day")
    )).all()

    # Users dropdown for filter
    user_rows = (await db.execute(
        select(User.id, User.email)
        .where(
            User.id.in_(
                select(func.distinct(Session.user_id))
                .where(Session.created_at >= since)
            )
        )
        .order_by(User.email)
    )).all()

    return {
        "total_count": total_count,
        "by_mode": [
            {"mode": r.mode, "count": r.count}
            for r in by_mode
        ],
        "sessions_by_day": [
            {"day": str(r.day), "count": r.count}
            for r in sessions_by_day
        ],
        "users": [
            {"id": str(r.id), "email": r.email}
            for r in user_rows
        ],
    }
