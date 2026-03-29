"""RevenueCat webhook endpoint for subscription lifecycle events."""

import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Header, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings
from api.database import get_db
from api.models.user import User

router = APIRouter(tags=["webhooks"])
logger = logging.getLogger(__name__)

# Map RevenueCat event types to subscription field updates
_EVENT_HANDLERS: dict[str, dict[str, str]] = {
    "INITIAL_PURCHASE": {"tier": "pro"},
    "RENEWAL": {"tier": "pro", "status": "active"},
    "CANCELLATION": {"status": "cancelled"},
    "EXPIRATION": {"tier": "free", "status": "expired"},
    "BILLING_ISSUE_DETECTED": {"status": "billing_issue"},
    "SUBSCRIPTION_PAUSED": {"status": "cancelled"},
    "PRODUCT_CHANGE": {"tier": "pro"},
}


def _verify_webhook_secret(authorization: str | None) -> None:
    """Verify the Authorization header matches our webhook secret."""
    secret = settings.revenuecat_webhook_secret
    if not secret:
        logger.debug("Webhook secret not configured, skipping verification (dev mode)")
        return
    if authorization != f"Bearer {secret}":
        logger.warning("Webhook authorization failed")
        raise ValueError("Invalid webhook authorization")


@router.post("/webhooks/revenuecat", status_code=200)
async def revenuecat_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
    authorization: str | None = Header(default=None),
) -> dict[str, str]:
    """Handle RevenueCat subscription lifecycle events.

    Always returns 200 to prevent RevenueCat from retrying.
    """
    try:
        _verify_webhook_secret(authorization)
    except ValueError:
        # Still return 200 — logging the attempt is enough
        return {"status": "unauthorized"}

    body = await request.json()
    event = body.get("event", {})
    event_type = event.get("type", "")
    app_user_id = event.get("app_user_id", "")

    logger.info(
        "Received RevenueCat event: type=%s user=%s",
        event_type,
        app_user_id,
    )

    if event_type not in _EVENT_HANDLERS:
        logger.info("Ignoring unhandled event type: %s", event_type)
        return {"status": "ignored"}

    if not app_user_id:
        logger.warning("Event missing app_user_id: %s", event_type)
        return {"status": "ignored"}

    # Look up user
    result = await db.execute(select(User).where(User.id == app_user_id))
    user = result.scalar_one_or_none()
    if user is None:
        logger.warning("User not found for webhook: user_id=%s", app_user_id)
        return {"status": "user_not_found"}

    # Apply event updates
    handler = _EVENT_HANDLERS[event_type]

    if "tier" in handler:
        user.subscription_tier = handler["tier"]

    if "status" in handler:
        user.subscription_status = handler["status"]
    elif event_type == "INITIAL_PURCHASE":
        # Determine trial vs active from event data
        is_trial = event.get("is_trial_period", False)
        user.subscription_status = "trial" if is_trial else "active"

    # Update expiration
    expiration_ms = event.get("expiration_at_ms")
    if event_type == "EXPIRATION":
        user.subscription_expires_at = None
    elif expiration_ms:
        user.subscription_expires_at = datetime.fromtimestamp(
            expiration_ms / 1000, tz=UTC
        )

    # Update provider info
    store = event.get("store")
    if store:
        provider_map = {"APP_STORE": "apple", "PLAY_STORE": "google"}
        user.subscription_provider = provider_map.get(store, store.lower())

    # Update RevenueCat customer ID
    rc_id = event.get("id")
    if rc_id and not user.rc_customer_id:
        user.rc_customer_id = rc_id

    await db.commit()

    logger.info(
        "Updated subscription: user=%s tier=%s status=%s",
        app_user_id,
        user.subscription_tier,
        user.subscription_status,
    )

    return {"status": "ok"}
