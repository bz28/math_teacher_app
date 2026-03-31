"""Stripe webhook endpoint for web subscription lifecycle events."""

import logging
from datetime import UTC, datetime

import stripe
from fastapi import APIRouter, Depends, Header, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings
from api.database import get_db
from api.models.user import User

router = APIRouter(tags=["webhooks"])
logger = logging.getLogger(__name__)

_STATUS_MAP: dict[str, str] = {
    "active": "active",
    "trialing": "trial",
    "past_due": "billing_issue",
    "canceled": "cancelled",
    "unpaid": "billing_issue",
    "paused": "cancelled",
}


async def _find_user_by_stripe_id(db: AsyncSession, customer_id: str) -> User | None:
    result = await db.execute(select(User).where(User.stripe_customer_id == customer_id))
    return result.scalar_one_or_none()


async def _handle_checkout_completed(db: AsyncSession, session: dict) -> str:
    user_id = session.get("metadata", {}).get("user_id")
    if not user_id:
        logger.warning("Checkout session missing user_id metadata")
        return "missing_metadata"

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        logger.warning("User not found for checkout: user_id=%s", user_id)
        return "user_not_found"

    user.stripe_customer_id = session["customer"]
    user.subscription_provider = "stripe"
    user.subscription_tier = "pro"

    sub_id = session.get("subscription")
    if sub_id:
        stripe.api_key = settings.stripe_secret_key
        sub = stripe.Subscription.retrieve(sub_id)
        user.subscription_status = "trial" if sub.status == "trialing" else "active"
        user.subscription_expires_at = datetime.fromtimestamp(sub.current_period_end, tz=UTC)
    else:
        user.subscription_status = "active"

    await db.commit()
    logger.info("Checkout completed: user=%s tier=pro status=%s", user_id, user.subscription_status)
    return "ok"


async def _handle_subscription_updated(db: AsyncSession, subscription: dict) -> str:
    customer_id = subscription["customer"]
    user = await _find_user_by_stripe_id(db, customer_id)
    if user is None:
        logger.warning("User not found for subscription update: customer=%s", customer_id)
        return "user_not_found"

    status = _STATUS_MAP.get(subscription["status"], subscription["status"])
    user.subscription_status = status

    if subscription["status"] in ("active", "trialing"):
        user.subscription_tier = "pro"

    user.subscription_expires_at = datetime.fromtimestamp(
        subscription["current_period_end"], tz=UTC
    )

    await db.commit()
    logger.info("Subscription updated: user=%s status=%s", user.id, status)
    return "ok"


async def _handle_subscription_deleted(db: AsyncSession, subscription: dict) -> str:
    customer_id = subscription["customer"]
    user = await _find_user_by_stripe_id(db, customer_id)
    if user is None:
        logger.warning("User not found for subscription deletion: customer=%s", customer_id)
        return "user_not_found"

    user.subscription_tier = "free"
    user.subscription_status = "expired"
    user.subscription_expires_at = None

    await db.commit()
    logger.info("Subscription deleted: user=%s downgraded to free", user.id)
    return "ok"


async def _handle_invoice_payment_failed(db: AsyncSession, invoice: dict) -> str:
    customer_id = invoice["customer"]
    user = await _find_user_by_stripe_id(db, customer_id)
    if user is None:
        return "user_not_found"

    user.subscription_status = "billing_issue"
    await db.commit()
    logger.info("Invoice payment failed: user=%s", user.id)
    return "ok"


async def _handle_invoice_paid(db: AsyncSession, invoice: dict) -> str:
    customer_id = invoice["customer"]
    user = await _find_user_by_stripe_id(db, customer_id)
    if user is None:
        return "user_not_found"

    user.subscription_tier = "pro"
    user.subscription_status = "active"

    sub_id = invoice.get("subscription")
    if sub_id:
        stripe.api_key = settings.stripe_secret_key
        sub = stripe.Subscription.retrieve(sub_id)
        user.subscription_expires_at = datetime.fromtimestamp(sub.current_period_end, tz=UTC)

    await db.commit()
    logger.info("Invoice paid: user=%s renewed", user.id)
    return "ok"


_EVENT_DISPATCH = {
    "checkout.session.completed": lambda db, evt: _handle_checkout_completed(db, evt["data"]["object"]),
    "customer.subscription.updated": lambda db, evt: _handle_subscription_updated(db, evt["data"]["object"]),
    "customer.subscription.deleted": lambda db, evt: _handle_subscription_deleted(db, evt["data"]["object"]),
    "invoice.payment_failed": lambda db, evt: _handle_invoice_payment_failed(db, evt["data"]["object"]),
    "invoice.paid": lambda db, evt: _handle_invoice_paid(db, evt["data"]["object"]),
}


@router.post("/webhooks/stripe", status_code=200)
async def stripe_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
    stripe_signature: str | None = Header(default=None, alias="stripe-signature"),
) -> dict[str, str]:
    """Handle Stripe subscription lifecycle events."""
    payload = await request.body()

    secret = settings.stripe_webhook_secret
    if secret and stripe_signature:
        try:
            event = stripe.Webhook.construct_event(payload, stripe_signature, secret)
        except (stripe.SignatureVerificationError, ValueError) as e:
            logger.warning("Stripe webhook signature verification failed: %s", e)
            return {"status": "invalid_signature"}
    elif secret:
        logger.warning("Missing stripe-signature header")
        return {"status": "missing_signature"}
    else:
        import json
        event = json.loads(payload)

    event_type = event.get("type", "")
    logger.info("Received Stripe event: type=%s", event_type)

    handler = _EVENT_DISPATCH.get(event_type)
    if handler is None:
        return {"status": "ignored"}

    result = await handler(db, event)
    return {"status": result}
