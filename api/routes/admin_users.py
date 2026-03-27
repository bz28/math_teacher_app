"""Admin user management endpoints."""

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import Date, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import CurrentUser, require_admin
from api.models.llm_call import LLMCall
from api.models.session import Session
from api.models.user import User

router = APIRouter()


def _time_range(hours: int) -> datetime:
    return datetime.now(UTC) - timedelta(hours=hours)


@router.get("/users")
async def users(
    hours: int = Query(default=720, ge=1, le=2160),
    sort_by: str = Query(default="total_cost", pattern=r"^(total_cost|session_count|last_active|name)$"),
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    since = _time_range(hours)

    # Total users
    total_users = (await db.execute(select(func.count()).select_from(User))).scalar() or 0

    # Active users (7d)
    active_7d = (await db.execute(
        select(func.count(func.distinct(Session.user_id)))
        .where(Session.created_at >= _time_range(168))
    )).scalar() or 0

    # Total spend (all users, in period)
    total_spend = (await db.execute(
        select(func.coalesce(func.sum(LLMCall.cost_usd), 0.0))
        .where(LLMCall.created_at >= since)
    )).scalar() or 0.0

    # Registrations over time
    registrations_by_day = (await db.execute(
        select(
            cast(User.created_at, Date).label("day"),
            func.count().label("count"),
        )
        .where(User.created_at >= since)
        .group_by("day")
        .order_by("day")
    )).all()

    # Per-user cost subquery
    user_cost = (
        select(
            LLMCall.user_id,
            func.coalesce(func.sum(LLMCall.cost_usd), 0.0).label("total_cost"),
            func.count().label("llm_call_count"),
        )
        .where(LLMCall.created_at >= since, LLMCall.user_id.isnot(None))
        .group_by(LLMCall.user_id)
        .subquery()
    )

    # Per-user session subquery
    user_sessions = (
        select(
            Session.user_id,
            func.count().label("session_count"),
            func.max(Session.created_at).label("last_active"),
        )
        .where(Session.created_at >= since)
        .group_by(Session.user_id)
        .subquery()
    )

    # Sort column mapping
    sort_columns = {
        "total_cost": func.coalesce(user_cost.c.total_cost, 0.0).desc(),
        "session_count": func.coalesce(user_sessions.c.session_count, 0).desc(),
        "last_active": func.coalesce(user_sessions.c.last_active, User.created_at).desc(),
        "name": User.name.asc(),
    }

    # All users with cost + session data
    all_users = (await db.execute(
        select(
            User.id,
            User.email,
            User.name,
            User.role,
            User.grade_level,
            User.created_at,
            func.coalesce(user_sessions.c.session_count, 0).label("session_count"),
            func.coalesce(user_cost.c.total_cost, 0.0).label("total_cost"),
            func.coalesce(user_cost.c.llm_call_count, 0).label("llm_call_count"),
            user_sessions.c.last_active,
        )
        .outerjoin(user_cost, user_cost.c.user_id == User.id)
        .outerjoin(user_sessions, user_sessions.c.user_id == User.id)
        .order_by(sort_columns.get(sort_by, sort_columns["total_cost"]))
    )).all()

    return {
        "total_users": total_users,
        "active_7d": active_7d,
        "total_spend": round(total_spend, 4),
        "registrations_by_day": [
            {"day": str(r.day), "count": r.count}
            for r in registrations_by_day
        ],
        "users": [
            {
                "id": str(r.id),
                "email": r.email,
                "name": r.name,
                "role": r.role,
                "grade_level": r.grade_level,
                "session_count": r.session_count,
                "total_cost": round(r.total_cost, 4),
                "llm_call_count": r.llm_call_count,
                "avg_cost_per_session": round(r.total_cost / r.session_count, 4) if r.session_count else 0.0,
                "last_active": r.last_active.isoformat() if r.last_active else None,
                "registered": r.created_at.isoformat(),
            }
            for r in all_users
        ],
    }


class UpdateRoleRequest(BaseModel):
    role: str


@router.patch("/users/{user_id}/role")
async def update_user_role(
    user_id: str,
    body: UpdateRoleRequest,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    if body.role not in ("student", "admin"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Role must be 'student' or 'admin'")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Prevent removing your own admin role
    if str(user.id) == str(current_user.user_id) and body.role != "admin":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot remove your own admin role")

    user.role = body.role
    await db.commit()
    return {"status": "ok", "role": body.role}


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: str,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Prevent deleting yourself
    if str(user.id) == str(current_user.user_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete your own account")

    await db.delete(user)
    await db.commit()
    return {"status": "ok"}
