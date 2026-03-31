from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.auth import (
    create_access_token,
    create_refresh_token,
    hash_password,
    rotate_refresh_token,
    verify_password,
)
from api.core.entitlements import (
    FREE_DAILY_SESSION_LIMIT,
    Entitlement,
    get_daily_session_count,
    is_pro,
)
from api.database import get_db
from api.middleware.auth import get_current_user_full
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
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    user = User(
        email=body.email,
        name=body.name,
        password_hash=hash_password(body.password),
        grade_level=body.grade_level,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    access_token = create_access_token(str(user.id), user.role)
    refresh_token = await create_refresh_token(db, user.id)
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account deactivated")

    if not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
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
    daily_used = await get_daily_session_count(db, user.id)

    gated_features = []
    if not user_is_pro:
        gated_features = [e.value for e in Entitlement if e != Entitlement.CREATE_SESSION]

    return EntitlementsResponse(
        is_pro=user_is_pro,
        subscription_tier=user.subscription_tier,
        subscription_status=user.subscription_status,
        subscription_expires_at=user.subscription_expires_at,
        limits=EntitlementLimits(
            daily_sessions_used=daily_used,
            daily_sessions_limit=None if user_is_pro else FREE_DAILY_SESSION_LIMIT,
        ),
        gated_features=gated_features,
    )
