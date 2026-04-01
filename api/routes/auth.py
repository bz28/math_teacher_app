from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.auth import (
    check_lockout,
    create_access_token,
    create_refresh_token,
    hash_password,
    record_failed_login,
    reset_failed_logins,
    rotate_refresh_token,
    verify_password,
)
from api.core.entitlements import (
    FREE_DAILY_CHAT_LIMIT,
    FREE_DAILY_IMAGE_SCAN_LIMIT,
    FREE_DAILY_SESSION_LIMIT,
    Entitlement,
    get_daily_chat_count,
    get_daily_decomp_count,
    get_daily_llm_call_count,
    is_pro,
    usage_cutoff,
)
from api.database import get_db
from api.middleware.auth import get_current_user_full
from api.middleware.rate_limit import limiter
from api.models.user import User
from api.schemas.auth import (
    CheckEmailRequest,
    EntitlementLimits,
    EntitlementsResponse,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UserResponse,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/check-email")
async def check_email(body: CheckEmailRequest, db: AsyncSession = Depends(get_db)) -> dict[str, bool]:
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
    return {"available": True}


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("3/minute")
async def register(request: Request, body: RegisterRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    user = User(
        email=body.email,
        name=body.name,
        password_hash=hash_password(body.password),
        grade_level=body.grade_level,
        role=body.role,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    access_token = create_access_token(str(user.id), user.role)
    refresh_token = await create_refresh_token(db, user.id)
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/login", response_model=TokenResponse)
@limiter.limit("5/minute")
async def login(request: Request, body: LoginRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account deactivated")

    if check_lockout(user):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Account temporarily locked. Try again later.",
        )

    if not verify_password(body.password, user.password_hash):
        await record_failed_login(db, user)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    await reset_failed_logins(db, user)
    access_token = create_access_token(str(user.id), user.role)
    refresh_token = await create_refresh_token(db, user.id)
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    result = await rotate_refresh_token(db, body.refresh_token)
    if result is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token")
    access_token, new_refresh, _ = result
    return TokenResponse(access_token=access_token, refresh_token=new_refresh)


@router.get("/me", response_model=UserResponse)
async def me(
    user: User = Depends(get_current_user_full),
    db: AsyncSession = Depends(get_db),
) -> UserResponse:
    return UserResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        grade_level=user.grade_level,
        role=user.role,
        subscription_tier=user.subscription_tier,
        subscription_status=user.subscription_status,
        subscription_expires_at=user.subscription_expires_at,
        is_pro=is_pro(user),
    )


@router.get("/entitlements", response_model=EntitlementsResponse)
async def entitlements(
    user: User = Depends(get_current_user_full),
    db: AsyncSession = Depends(get_db),
) -> EntitlementsResponse:
    """Return the current user's entitlement state."""
    user_is_pro = is_pro(user)
    cutoff = usage_cutoff(user)
    problems_used = await get_daily_decomp_count(db, user.id, cutoff)
    scans_used = await get_daily_llm_call_count(db, user.id, "image_extract", cutoff)
    chats_used = await get_daily_chat_count(db, user.id, cutoff)

    gated_features = []
    if not user_is_pro:
        gated_features = [e.value for e in Entitlement if e != Entitlement.CREATE_SESSION]

    return EntitlementsResponse(
        is_pro=user_is_pro,
        subscription_tier=user.subscription_tier,
        subscription_status=user.subscription_status,
        subscription_expires_at=user.subscription_expires_at,
        limits=EntitlementLimits(
            daily_sessions_used=problems_used,
            daily_sessions_limit=None if user_is_pro else FREE_DAILY_SESSION_LIMIT,
            daily_scans_used=scans_used,
            daily_scans_limit=None if user_is_pro else FREE_DAILY_IMAGE_SCAN_LIMIT,
            daily_chats_used=chats_used,
            daily_chats_limit=None if user_is_pro else FREE_DAILY_CHAT_LIMIT,
        ),
        gated_features=gated_features,
    )
