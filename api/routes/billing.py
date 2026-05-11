"""Teacher self-serve billing — Stripe Checkout + Customer Portal.

Mounted under `/v1/billing`. Student billing (RevenueCat) is unaffected.

Both endpoints require auth. The checkout endpoint is teacher-only; the
portal endpoint allows any role with an existing `stripe_customer_id`
(in case a student account ever connects through Stripe, which is
possible via RevenueCat → Stripe routing).
"""

import asyncio
import logging

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings
from api.database import get_db
from api.middleware.auth import get_current_user_full
from api.middleware.rate_limit import limiter
from api.models.user import User
from api.schemas.billing import CheckoutResponse, PortalResponse
from api.services.stripe_client import is_configured

router = APIRouter(prefix="/billing", tags=["billing"])
logger = logging.getLogger(__name__)


def _require_stripe_configured() -> None:
    if not is_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Billing is not configured on this environment.",
        )


async def _ensure_stripe_customer(user: User, db: AsyncSession) -> str:
    """Return the user's Stripe customer id, creating one if absent.

    Serialized via `SELECT ... FOR UPDATE` on the user row. Without
    the lock, two concurrent /teacher-checkout calls from a brand-new
    teacher both pass the customer-check and create two Stripe
    customers — one of which ends up on the user row, the other
    orphaned. When the orphaned customer's checkout completes,
    the webhook arrives with a customer id that doesn't match the
    user row and the user silently never flips to Pro. That's a
    quiet revenue bug, so serialize at the DB layer.
    """
    locked = (await db.execute(
        select(User).where(User.id == user.id).with_for_update()
    )).scalar_one()

    if locked.stripe_customer_id:
        return locked.stripe_customer_id

    customer = await asyncio.to_thread(
        stripe.Customer.create,
        email=locked.email,
        name=locked.name or locked.email,
        metadata={"user_id": str(locked.id)},
    )
    locked.stripe_customer_id = customer.id
    await db.commit()
    return customer.id


@router.post(
    "/teacher-checkout",
    response_model=CheckoutResponse,
    status_code=status.HTTP_200_OK,
)
@limiter.limit("10/minute")
async def teacher_checkout(
    request: Request,
    user: User = Depends(get_current_user_full),
    db: AsyncSession = Depends(get_db),
) -> CheckoutResponse:
    """Start a Stripe Checkout session for the Teacher Pro plan.

    Teacher-only. Returns a hosted-checkout URL the frontend redirects to.
    """
    _require_stripe_configured()
    if user.role != "teacher":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Teacher checkout is only available to teacher accounts.",
        )

    customer_id = await _ensure_stripe_customer(user, db)

    session = await asyncio.to_thread(
        stripe.checkout.Session.create,
        mode="subscription",
        customer=customer_id,
        line_items=[{"price": settings.teacher_pro_stripe_price_id, "quantity": 1}],
        success_url=settings.stripe_checkout_success_url,
        cancel_url=settings.stripe_checkout_cancel_url,
        client_reference_id=str(user.id),
    )

    logger.info("Stripe checkout created: user=%s session=%s", user.id, session.id)
    return CheckoutResponse(checkout_url=session.url or "")


@router.get(
    "/teacher-portal",
    response_model=PortalResponse,
    status_code=status.HTTP_200_OK,
)
@limiter.limit("10/minute")
async def teacher_portal(
    request: Request,
    user: User = Depends(get_current_user_full),
) -> PortalResponse:
    """Return a Stripe Customer Portal URL for the current user.

    Requires a `stripe_customer_id` on the user (i.e., they've started
    a checkout before). 404 if absent — there's nothing to manage.
    """
    _require_stripe_configured()
    if not user.stripe_customer_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No Stripe subscription found for this account.",
        )

    portal = await asyncio.to_thread(
        stripe.billing_portal.Session.create,
        customer=user.stripe_customer_id,
        return_url=settings.stripe_portal_return_url,
    )
    return PortalResponse(portal_url=portal.url or "")
