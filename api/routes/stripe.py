"""Stripe Checkout and Customer Portal endpoints."""

import logging
from typing import Any

import stripe
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings
from api.database import get_db
from api.middleware.auth import get_current_user_full
from api.models.user import User
from api.schemas.stripe import (
    CheckoutSessionRequest,
    CheckoutSessionResponse,
    PortalSessionRequest,
    PortalSessionResponse,
)

router = APIRouter(prefix="/stripe", tags=["stripe"])
logger = logging.getLogger(__name__)

stripe.api_key = settings.stripe_secret_key


async def _ensure_stripe_customer(db: AsyncSession, user: User) -> str:
    """Return existing Stripe customer ID, or create one and persist it."""
    if user.stripe_customer_id:
        return user.stripe_customer_id

    customer = stripe.Customer.create(
        email=user.email,
        metadata={"user_id": str(user.id)},
    )
    user.stripe_customer_id = customer.id
    await db.commit()
    return customer.id


@router.post("/checkout-session", response_model=CheckoutSessionResponse)
async def create_checkout_session(
    body: CheckoutSessionRequest,
    user: User = Depends(get_current_user_full),
    db: AsyncSession = Depends(get_db),
) -> CheckoutSessionResponse:
    """Create a Stripe Checkout Session for subscription purchase."""
    valid_prices = {settings.stripe_price_id_weekly, settings.stripe_price_id_yearly}
    if body.price_id not in valid_prices:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid price ID")

    customer_id = await _ensure_stripe_customer(db, user)

    session_params: dict[str, Any] = {
        "mode": "subscription",
        "customer": customer_id,
        "line_items": [{"price": body.price_id, "quantity": 1}],
        "metadata": {"user_id": str(user.id)},
        "success_url": body.success_url,
        "cancel_url": body.cancel_url,
    }

    # Free trials: 3 days for weekly, 7 days for yearly
    if body.price_id == settings.stripe_price_id_weekly:
        session_params["subscription_data"] = {"trial_period_days": 3}
    elif body.price_id == settings.stripe_price_id_yearly:
        session_params["subscription_data"] = {"trial_period_days": 7}

    checkout_session = stripe.checkout.Session.create(**session_params)
    return CheckoutSessionResponse(checkout_url=checkout_session.url)


@router.post("/portal-session", response_model=PortalSessionResponse)
async def create_portal_session(
    body: PortalSessionRequest,
    user: User = Depends(get_current_user_full),
    db: AsyncSession = Depends(get_db),
) -> PortalSessionResponse:
    """Create a Stripe Customer Portal session for subscription management."""
    if not user.stripe_customer_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No Stripe subscription found",
        )

    portal_session = stripe.billing_portal.Session.create(
        customer=user.stripe_customer_id,
        return_url=body.return_url,
    )
    return PortalSessionResponse(portal_url=portal_session.url)
