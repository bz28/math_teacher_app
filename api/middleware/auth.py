from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.auth import decode_access_token
from api.database import get_db

if TYPE_CHECKING:
    from api.models.user import User

# HttpOnly cookie names. Set by /auth/login, /auth/login/verify-mfa,
# /auth/register, /auth/refresh; cleared by /auth/logout. The middleware
# below accepts cookies OR an Authorization Bearer header — cookies are
# preferred for browser clients (immune to XSS-driven localStorage
# theft), the header path is kept for mobile and API consumers.
COOKIE_ACCESS = "veradic_access"
COOKIE_REFRESH = "veradic_refresh"


class CurrentUser:
    def __init__(self, user_id: uuid.UUID, role: str, name: str = ""):
        self.user_id = user_id
        self.role = role
        self.name = name


def _extract_access_token(request: Request) -> str | None:
    """Token extraction with cookie-first preference.

    Cookies are preferred because they live in HttpOnly storage that
    JS can't read, so an XSS in the marketing site can't steal a
    teacher's session. Authorization header is the fallback for
    mobile (expo-secure-store) and any direct API integrations.
    """
    cookie = request.cookies.get(COOKIE_ACCESS)
    if cookie:
        return cookie
    auth = request.headers.get("authorization")
    if auth and auth.lower().startswith("bearer "):
        return auth[7:].strip() or None
    return None


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> CurrentUser:
    token = _extract_access_token(request)
    if not token:
        raise _unauthorized()
    payload = decode_access_token(token)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    user_id = uuid.UUID(str(payload["sub"]))

    # Verify user is still active on every request
    from api.models.user import User

    result = await db.execute(select(User.is_active, User.name, User.email).where(User.id == user_id))
    row = result.one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if not row.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account deactivated")

    return CurrentUser(user_id=user_id, role=str(payload["role"]), name=row.name or row.email)


async def get_current_user_full(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> User:
    """Return the full User ORM object for the current authenticated user."""
    token = _extract_access_token(request)
    if not token:
        raise _unauthorized()
    payload = decode_access_token(token)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    user_id = uuid.UUID(str(payload["sub"]))

    from api.models.user import User

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account deactivated")

    return user


async def require_admin(
    current_user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    """Dependency that enforces admin role. Use via Depends(require_admin)."""
    if current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user


async def require_teacher(
    current_user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    """Dependency that enforces teacher (or admin) role."""
    if current_user.role not in ("teacher", "admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Teacher access required")
    return current_user
