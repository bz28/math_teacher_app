import hashlib
import uuid
from datetime import UTC, datetime, timedelta

import bcrypt
from jose import JWTError, jwt
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings
from api.models.user import RefreshToken, User

LOCKOUT_DURATION = timedelta(minutes=15)
MAX_FAILED_ATTEMPTS = 5


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(user_id: str, role: str) -> str:
    expire = datetime.now(UTC) + timedelta(minutes=settings.jwt_access_token_expire_minutes)
    return str(jwt.encode({"sub": user_id, "role": role, "exp": expire}, settings.jwt_secret, algorithm="HS256"))


def decode_access_token(token: str) -> dict[str, object] | None:
    try:
        payload: dict[str, object] = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
        return payload
    except JWTError:
        return None


def _hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def create_refresh_token(db: AsyncSession, user_id: uuid.UUID, family_id: uuid.UUID | None = None) -> str:
    raw_token = str(uuid.uuid4())
    token_hash = _hash_refresh_token(raw_token)
    if family_id is None:
        family_id = uuid.uuid4()

    rt = RefreshToken(
        user_id=user_id,
        token_hash=token_hash,
        family_id=family_id,
        expires_at=datetime.now(UTC) + timedelta(days=settings.jwt_refresh_token_expire_days),
    )
    db.add(rt)
    await db.commit()
    return raw_token


async def rotate_refresh_token(db: AsyncSession, raw_token: str) -> tuple[str, str, uuid.UUID] | None:
    """Rotate a refresh token. Returns (new_access_token, new_refresh_token, user_id) or None."""
    token_hash = _hash_refresh_token(raw_token)

    result = await db.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    old_rt = result.scalar_one_or_none()

    if old_rt is None:
        return None

    # Reuse detection: if already revoked, invalidate entire family
    if old_rt.is_revoked:
        await db.execute(
            update(RefreshToken).where(RefreshToken.family_id == old_rt.family_id).values(is_revoked=True)
        )
        await db.commit()
        return None

    if old_rt.expires_at < datetime.now(UTC):
        return None

    # Revoke old token
    old_rt.is_revoked = True
    await db.flush()

    # Get user for access token — also reject deactivated users
    user_result = await db.execute(select(User).where(User.id == old_rt.user_id))
    user = user_result.scalar_one_or_none()
    if user is None or not user.is_active:
        return None

    # Issue new tokens
    access_token = create_access_token(str(user.id), user.role)
    new_refresh = await create_refresh_token(db, user.id, family_id=old_rt.family_id)

    return access_token, new_refresh, user.id


def check_lockout(user: User) -> bool:
    """Returns True if user is currently locked out."""
    if user.locked_until and user.locked_until > datetime.now(UTC):
        return True
    return False


async def record_failed_login(db: AsyncSession, user: User) -> None:
    user.failed_login_attempts += 1
    if user.failed_login_attempts >= MAX_FAILED_ATTEMPTS:
        user.locked_until = datetime.now(UTC) + LOCKOUT_DURATION
    await db.commit()


async def reset_failed_logins(db: AsyncSession, user: User) -> None:
    user.failed_login_attempts = 0
    user.locked_until = None
    await db.commit()
