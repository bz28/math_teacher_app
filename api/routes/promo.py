"""Promo code redemption and admin CRUD routes."""

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import CurrentUser, get_current_user_full, require_admin
from api.models.promo import PromoCode, PromoRedemption
from api.models.user import User
from api.schemas.promo import (
    CreatePromoCodeRequest,
    PromoCodeResponse,
    PromoRedemptionResponse,
    RedeemPromoRequest,
    RedeemPromoResponse,
    UpdatePromoCodeRequest,
)

router = APIRouter(prefix="/promo", tags=["promo"])


def _code_response(c: PromoCode) -> PromoCodeResponse:
    return PromoCodeResponse(
        id=c.id,
        code=c.code,
        duration_days=c.duration_days,
        max_redemptions=c.max_redemptions,
        times_redeemed=c.times_redeemed,
        expires_at=c.expires_at,
        is_active=c.is_active,
        created_at=c.created_at,
    )


# ── User endpoint ──────────────────────────────────────────────────────────


@router.post("/redeem", response_model=RedeemPromoResponse)
async def redeem_promo_code(
    body: RedeemPromoRequest,
    user: User = Depends(get_current_user_full),
    db: AsyncSession = Depends(get_db),
) -> RedeemPromoResponse:
    """Redeem a promo code to receive Pro access."""
    normalized = body.code.strip().upper()

    # Block if user already has an active paid subscription
    if (
        user.subscription_tier == "pro"
        and user.subscription_status in ("active", "trial")
        and user.subscription_provider in ("stripe", "revenuecat", "apple", "google")
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You already have an active paid subscription",
        )

    # Look up the code with row-level lock to prevent race conditions
    result = await db.execute(
        select(PromoCode)
        .where(PromoCode.code == normalized, PromoCode.is_active.is_(True))
        .with_for_update()
    )
    promo = result.scalar_one_or_none()
    if promo is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invalid promo code")

    # Check code hasn't expired
    if promo.expires_at is not None and promo.expires_at < datetime.now(UTC):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This promo code has expired")

    # Check redemption limit
    if promo.times_redeemed >= promo.max_redemptions:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This promo code has reached its redemption limit",
        )

    # Check user hasn't already redeemed this code
    existing = await db.execute(
        select(PromoRedemption).where(
            PromoRedemption.promo_code_id == promo.id,
            PromoRedemption.user_id == user.id,
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You have already redeemed this code")

    # Calculate subscription expiry
    now = datetime.now(UTC)
    if promo.duration_days == 0:
        sub_expires_at = None
    else:
        # Stack on existing promo expiry if applicable
        base = now
        if (
            user.subscription_provider == "promo"
            and user.subscription_expires_at is not None
            and user.subscription_expires_at > now
        ):
            base = user.subscription_expires_at
        sub_expires_at = base + timedelta(days=promo.duration_days)

    # Update user subscription
    user.subscription_tier = "pro"
    user.subscription_provider = "promo"
    if promo.duration_days == 0:
        user.subscription_status = "active"
        user.subscription_expires_at = None
    else:
        # Keep status as "none" so is_pro() relies on expires_at check
        user.subscription_status = "none"
        user.subscription_expires_at = sub_expires_at

    # Create redemption record
    redemption = PromoRedemption(
        promo_code_id=promo.id,
        user_id=user.id,
        expires_at=sub_expires_at,
    )
    db.add(redemption)

    # Atomic increment to prevent race conditions
    await db.execute(
        update(PromoCode)
        .where(PromoCode.id == promo.id)
        .values(times_redeemed=PromoCode.times_redeemed + 1)
    )

    await db.commit()

    if promo.duration_days == 0:
        message = "Lifetime Pro access activated!"
    else:
        message = f"Pro access activated for {promo.duration_days} days!"

    return RedeemPromoResponse(status="ok", message=message, expires_at=sub_expires_at)


# ── Admin endpoints ────────────────────────────────────────────────────────


@router.post("/codes", response_model=PromoCodeResponse)
async def create_promo_code(
    body: CreatePromoCodeRequest,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> PromoCodeResponse:
    """Create a new promo code (admin only)."""
    normalized = body.code.strip().upper()

    # Check uniqueness
    existing = await db.execute(select(PromoCode).where(PromoCode.code == normalized))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A code with this name already exists")

    promo = PromoCode(
        code=normalized,
        duration_days=body.duration_days,
        max_redemptions=body.max_redemptions,
        expires_at=body.expires_at,
    )
    db.add(promo)
    await db.commit()
    await db.refresh(promo)

    return _code_response(promo)


@router.get("/codes", response_model=list[PromoCodeResponse])
async def list_promo_codes(
    active_only: bool = False,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> list[PromoCodeResponse]:
    """List all promo codes (admin only)."""
    query = select(PromoCode).order_by(PromoCode.created_at.desc())
    if active_only:
        query = query.where(PromoCode.is_active.is_(True))

    result = await db.execute(query)
    return [_code_response(c) for c in result.scalars().all()]


@router.patch("/codes/{code_id}", response_model=PromoCodeResponse)
async def update_promo_code(
    code_id: str,
    body: UpdatePromoCodeRequest,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> PromoCodeResponse:
    """Update a promo code (admin only)."""
    result = await db.execute(select(PromoCode).where(PromoCode.id == code_id))
    promo = result.scalar_one_or_none()
    if promo is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Promo code not found")

    if body.is_active is not None:
        promo.is_active = body.is_active
    if body.max_redemptions is not None:
        promo.max_redemptions = body.max_redemptions
    if body.expires_at is not None:
        promo.expires_at = body.expires_at

    await db.commit()
    await db.refresh(promo)

    return _code_response(promo)


@router.get("/codes/{code_id}/redemptions", response_model=list[PromoRedemptionResponse])
async def list_redemptions(
    code_id: str,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> list[PromoRedemptionResponse]:
    """List all redemptions for a promo code (admin only)."""
    result = await db.execute(
        select(PromoRedemption, User.email)
        .join(User, PromoRedemption.user_id == User.id)
        .where(PromoRedemption.promo_code_id == code_id)
        .order_by(PromoRedemption.redeemed_at.desc())
    )

    return [
        PromoRedemptionResponse(
            user_id=redemption.user_id,
            user_email=email,
            redeemed_at=redemption.redeemed_at,
            expires_at=redemption.expires_at,
        )
        for redemption, email in result.all()
    ]
