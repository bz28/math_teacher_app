"""Admin notification preference endpoints."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.notifications import ALL_EVENT_TYPES, EVENT_LABELS
from api.database import get_db
from api.middleware.auth import CurrentUser, require_admin
from api.models.notification import AdminNotificationPref
from api.schemas.notification import (
    NotificationPrefItem,
    NotificationPrefsResponse,
    UpdateNotificationPrefRequest,
)

router = APIRouter(tags=["admin-notifications"])


@router.get("/notifications", response_model=NotificationPrefsResponse)
async def get_notification_prefs(
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> NotificationPrefsResponse:
    """Get current admin's notification preferences."""
    result = await db.execute(
        select(AdminNotificationPref).where(AdminNotificationPref.user_id == current_user.user_id)
    )
    prefs = {p.event_type: p.enabled for p in result.scalars().all()}

    items = [
        NotificationPrefItem(
            event_type=et,
            label=EVENT_LABELS.get(et, et),
            enabled=prefs.get(et, True),  # default to enabled (opt-out model)
        )
        for et in ALL_EVENT_TYPES
    ]
    return NotificationPrefsResponse(preferences=items)


@router.put("/notifications", response_model=NotificationPrefsResponse)
async def update_notification_pref(
    body: UpdateNotificationPrefRequest,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> NotificationPrefsResponse:
    """Toggle a notification preference for the current admin."""
    if body.event_type not in ALL_EVENT_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unknown event type: {body.event_type}")

    result = await db.execute(
        select(AdminNotificationPref).where(
            AdminNotificationPref.user_id == current_user.user_id,
            AdminNotificationPref.event_type == body.event_type,
        )
    )
    pref = result.scalar_one_or_none()

    if pref is None:
        pref = AdminNotificationPref(
            user_id=current_user.user_id,
            event_type=body.event_type,
            enabled=body.enabled,
        )
        db.add(pref)
    else:
        pref.enabled = body.enabled

    await db.commit()

    # Return full list
    return await get_notification_prefs(current_user, db)
