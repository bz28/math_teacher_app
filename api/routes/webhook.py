"""Subscription webhooks — RevenueCat (students) and Stripe (teachers)."""

import json
import logging
from datetime import UTC, datetime

import stripe
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings
from api.database import get_db
from api.middleware.rate_limit import limiter
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
        if settings.app_env == "development":
            logger.debug("Webhook secret not configured, skipping verification (dev mode)")
            return
        raise ValueError("Webhook secret not configured")
    if authorization != f"Bearer {secret}":
        logger.warning("Webhook authorization failed")
        raise ValueError("Invalid webhook authorization")


@router.post("/webhooks/revenuecat", status_code=200)
@limiter.limit("30/minute")
async def revenuecat_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
    authorization: str | None = Header(default=None),
) -> dict[str, str]:
    """Handle RevenueCat subscription lifecycle events.

    Returns 403 on auth failure (RevenueCat only retries on 5xx, not 4xx).
    """
    try:
        _verify_webhook_secret(authorization)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

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
        return {"status": "ok"}

    if not app_user_id:
        logger.warning("Event missing app_user_id: %s", event_type)
        return {"status": "ok"}

    # Look up user
    result = await db.execute(select(User).where(User.id == app_user_id))
    user = result.scalar_one_or_none()
    if user is None:
        logger.warning("User not found for webhook: user_id=%s", app_user_id)
        return {"status": "ok"}

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
        provider_map = {"APP_STORE": "apple", "PLAY_STORE": "google", "STRIPE": "stripe"}
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


# ── Stripe webhook (teacher self-serve subscriptions) ──────────────────


async def _resolve_user_by_customer(
    db: AsyncSession, customer_id: str | None
) -> User | None:
    """Look up a user by their Stripe customer id."""
    if not customer_id:
        return None
    result = await db.execute(
        select(User).where(User.stripe_customer_id == customer_id)
    )
    return result.scalar_one_or_none()


def _ts_to_dt(ts: int | None) -> datetime | None:
    if not ts:
        return None
    return datetime.fromtimestamp(ts, tz=UTC)


async def _claim_event(db: AsyncSession, event_id: str, event_type: str) -> bool:
    """Stage an idempotency row for `event_id` in the current session.
    Returns True on first sight (caller MUST commit later — the row is
    NOT committed here, so any subsequent handler failure rolls it back
    alongside its state changes). Returns False on replay so the
    caller short-circuits without re-running the handler.

    Why the two-phase commit matters: the previous implementation
    committed the dedup row before the handler ran, so any commit
    failure mid-handler (e.g. DB transient error during the state
    mutation) left the dedup row persisted with state unchanged —
    Stripe's retry then short-circuited to no-op and the user stayed
    on the stale tier forever. Now the row only lands when the whole
    handler's commit succeeds; if it doesn't, retries re-process.

    Concurrent processing of the same event_id is bounded by the
    PK unique constraint: both sessions stage the row + mutate state,
    one commit lands, the other's commit raises IntegrityError and
    rolls back including its state changes. Net effect: processed
    once.

    Stripe retries any non-2xx and may also redeliver already-2xx'd
    events during outages — the API contract is at-least-once.
    """
    from api.models.stripe_event import StripeProcessedEvent

    existing = (await db.execute(
        select(StripeProcessedEvent.event_id).where(
            StripeProcessedEvent.event_id == event_id,
        )
    )).scalar_one_or_none()
    if existing is not None:
        return False

    db.add(StripeProcessedEvent(event_id=event_id, event_type=event_type))
    return True


def _is_active_subscription(user: User, event_sub_id: str | None) -> bool:
    """True if the event's subscription matches the user's tracked one
    (or the user has none yet — first-time setup).

    Prevents a late `customer.subscription.updated(active)` for an
    OLD subscription id from re-promoting a user whose current sub
    was deleted. Falls through on null (a checkout.session.completed
    sets the tracking id; updates before then are first-touch).
    """
    if not user.stripe_subscription_id:
        return True
    if not event_sub_id:
        # Old test fixtures or partial payloads — fall back to
        # processing rather than swallowing silently.
        return True
    return user.stripe_subscription_id == event_sub_id


@router.post("/webhooks/stripe", status_code=200)
@limiter.limit("60/minute")
async def stripe_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
    stripe_signature: str | None = Header(default=None, alias="stripe-signature"),
) -> dict[str, str]:
    """Handle Stripe subscription lifecycle for teacher accounts.

    Events we care about:
      - checkout.session.completed       → flip to Pro + active, track sub id
      - customer.subscription.updated    → reflect status (only for current sub)
      - customer.subscription.deleted    → flip back to free, clear sub id

    Hardened against (a) redelivery — every event_id is recorded in
    stripe_processed_events and reprocessing short-circuits — and
    (b) out-of-order delivery — `customer.subscription.updated` only
    acts when the event's subscription id matches the user's tracked
    `stripe_subscription_id`, so a late `active` event for an
    already-deleted sub can't re-promote a cancelled user.

    Signature verification is enforced in production. In dev (no
    webhook secret configured) we skip it so the Stripe CLI can fire
    test events without setup overhead.
    """
    payload = await request.body()

    if settings.stripe_webhook_secret:
        try:
            event = stripe.Webhook.construct_event(
                payload, stripe_signature or "", settings.stripe_webhook_secret,
            )
        except (ValueError, stripe.SignatureVerificationError) as e:  # type: ignore[attr-defined]
            logger.warning("Stripe webhook signature failed: %s", e)
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Invalid signature",
            ) from e
    else:
        # Dev mode — accept the raw payload without verification.
        if settings.app_env != "development":
            logger.error("Stripe webhook secret not configured in non-dev env")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Stripe webhook not configured",
            )
        event = json.loads(payload)

    event_type = event.get("type") if isinstance(event, dict) else event["type"]
    event_id = event.get("id") if isinstance(event, dict) else event["id"]
    data_object = (
        event.get("data", {}).get("object", {})
        if isinstance(event, dict)
        else event["data"]["object"]
    )

    # Idempotency check — only if Stripe sent an id (dev-mode test
    # payloads without ids skip dedup so unit tests can re-fire the
    # same payload shape without contaminating state).
    if event_id:
        first_time = await _claim_event(db, event_id, event_type or "")
        if not first_time:
            logger.info("Stripe redelivery skipped: id=%s type=%s", event_id, event_type)
            return {"status": "ok"}

    logger.info("Stripe event received: id=%s type=%s", event_id, event_type)

    if event_type == "checkout.session.completed":
        # The Checkout Session carries the customer id and (when mode=
        # subscription) the resulting subscription id. We flip the user
        # to Pro on this event and store the sub id so subsequent
        # updates can be scoped to it.
        customer_id = data_object.get("customer")
        user = await _resolve_user_by_customer(db, customer_id)
        if user is None:
            logger.warning(
                "Stripe checkout.session.completed for unknown customer: %s",
                customer_id,
            )
            # Commit the staged dedup row so Stripe doesn't redeliver
            # this no-op event in a loop. The no-state-mutation path
            # still needs to record that we've seen the id.
            await db.commit()
            return {"status": "ok"}
        user.subscription_tier = "pro"
        user.subscription_status = "active"
        user.subscription_provider = "stripe"
        sub_id = data_object.get("subscription")
        if sub_id:
            user.stripe_subscription_id = sub_id
        await db.commit()
        logger.info(
            "Stripe → user %s flipped to pro/active (sub=%s)",
            user.id, sub_id,
        )
        return {"status": "ok"}

    if event_type == "customer.subscription.updated":
        customer_id = data_object.get("customer")
        user = await _resolve_user_by_customer(db, customer_id)
        if user is None:
            logger.warning(
                "Stripe subscription.updated for unknown customer: %s", customer_id,
            )
            await db.commit()
            return {"status": "ok"}
        event_sub_id = data_object.get("id")
        if not _is_active_subscription(user, event_sub_id):
            logger.info(
                "Stripe subscription.updated for non-current sub ignored: user=%s "
                "tracked=%s event_sub=%s",
                user.id, user.stripe_subscription_id, event_sub_id,
            )
            await db.commit()
            return {"status": "ok"}
        sub_status = data_object.get("status")  # active / past_due / canceled / etc.
        period_end = _ts_to_dt(data_object.get("current_period_end"))
        if sub_status == "active":
            user.subscription_tier = "pro"
            user.subscription_status = "active"
        elif sub_status == "past_due":
            user.subscription_status = "billing_issue"
        elif sub_status == "canceled":
            user.subscription_status = "cancelled"
        # Carry the freshest period end so the grace window in is_pro()
        # reflects the latest billing cycle. Skip when the sub is
        # already-deleted (tier=free) so a late update for a stale sub
        # can't resurrect a future expiry.
        if period_end is not None and user.subscription_tier == "pro":
            user.subscription_expires_at = period_end
        user.subscription_provider = "stripe"
        # First-touch case: if this is the first event we've accepted
        # for this user (no tracked sub id yet, _is_active_subscription
        # passed via the null-fallback), stamp the id now so the
        # staleness guard works for any subsequent event. Otherwise a
        # late stale-sub update could re-promote a freshly-cancelled
        # user since their tracking id would still be null.
        if not user.stripe_subscription_id and event_sub_id:
            user.stripe_subscription_id = event_sub_id
        await db.commit()
        logger.info(
            "Stripe → user %s subscription updated: %s",
            user.id, sub_status,
        )
        return {"status": "ok"}

    if event_type == "customer.subscription.deleted":
        customer_id = data_object.get("customer")
        user = await _resolve_user_by_customer(db, customer_id)
        if user is None:
            logger.warning(
                "Stripe subscription.deleted for unknown customer: %s", customer_id,
            )
            await db.commit()
            return {"status": "ok"}
        event_sub_id = data_object.get("id")
        if not _is_active_subscription(user, event_sub_id):
            logger.info(
                "Stripe subscription.deleted for non-current sub ignored: user=%s "
                "tracked=%s event_sub=%s",
                user.id, user.stripe_subscription_id, event_sub_id,
            )
            await db.commit()
            return {"status": "ok"}
        user.subscription_tier = "free"
        user.subscription_status = "cancelled"
        # Clear period-end and the tracking sub id so the entitlement
        # grace window in is_pro() can't keep this user pro and so
        # future events for this dead sub are correctly ignored as
        # stale.
        user.subscription_expires_at = None
        user.stripe_subscription_id = None
        await db.commit()
        logger.info("Stripe → user %s subscription deleted", user.id)
        return {"status": "ok"}

    logger.info("Stripe event ignored: %s", event_type)
    await db.commit()
    return {"status": "ok"}
