import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta

from fastapi import FastAPI
from sqlalchemy import delete, func, or_, select, text, update

from api.config import settings
from api.core.constants import STALE_SESSION_HOURS
from api.middleware.setup import configure_middleware
from api.routes.admin import router as admin_router
from api.routes.auth import router as auth_router
from api.routes.health import router as health_router
from api.routes.image import router as image_router
from api.routes.practice import router as practice_router
from api.routes.session import router as session_router
from api.routes.work import router as work_router

logger = logging.getLogger(__name__)


async def _cleanup_stale_sessions() -> None:
    """Mark sessions with no activity for 1 hour as abandoned."""
    from api.database import get_session_factory
    from api.models.session import Session, SessionStatus

    cutoff = datetime.now(UTC) - timedelta(hours=STALE_SESSION_HOURS)
    async with get_session_factory()() as db:
        result = await db.execute(
            update(Session)
            .where(Session.status == SessionStatus.ACTIVE, Session.updated_at < cutoff)
            .values(status=SessionStatus.ABANDONED)
        )
        await db.commit()
        if result.rowcount:  # type: ignore[attr-defined]
            logger.info("Marked %d stale sessions as abandoned", result.rowcount)  # type: ignore[attr-defined]


async def _cleanup_expired_tokens() -> None:
    """Delete revoked and expired refresh tokens."""
    from api.database import get_session_factory
    from api.models.user import RefreshToken

    async with get_session_factory()() as db:
        result = await db.execute(
            delete(RefreshToken).where(
                or_(
                    RefreshToken.is_revoked.is_(True),
                    RefreshToken.expires_at < datetime.now(UTC),
                )
            )
        )
        await db.commit()
        if result.rowcount:  # type: ignore[attr-defined]
            logger.info("Cleaned up %d expired/revoked refresh tokens", result.rowcount)  # type: ignore[attr-defined]


async def _send_daily_digest() -> None:
    """Send a daily digest email to admins. Runs once per day at ~midnight UTC."""
    from api.core.notifications import notify_daily_digest
    from api.database import get_session_factory
    from api.models.llm_call import LLMCall
    from api.models.session import Session
    from api.models.user import User

    while True:
        # Sleep until next midnight UTC
        now = datetime.now(UTC)
        tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=5, second=0, microsecond=0)
        sleep_seconds = (tomorrow - now).total_seconds()
        await asyncio.sleep(sleep_seconds)

        try:
            yesterday = datetime.now(UTC) - timedelta(days=1)
            async with get_session_factory()() as db:
                new_users = (
                    await db.execute(select(func.count()).where(User.created_at >= yesterday))
                ).scalar() or 0

                total_sessions = (
                    await db.execute(select(func.count()).where(Session.created_at >= yesterday))
                ).scalar() or 0

                cost_row = await db.execute(
                    select(func.coalesce(func.sum(LLMCall.cost_usd), 0.0)).where(LLMCall.created_at >= yesterday)
                )
                total_cost = float(cost_row.scalar() or 0.0)

                error_count = (
                    await db.execute(
                        select(func.count()).where(LLMCall.created_at >= yesterday, LLMCall.success.is_(False))
                    )
                ).scalar() or 0

                await notify_daily_digest(
                    db,
                    new_users=new_users,
                    total_sessions=total_sessions,
                    total_cost=total_cost,
                    error_count=error_count,
                )
                logger.info("Daily digest sent")
        except Exception:
            logger.exception("Failed to send daily digest")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Startup
    if settings.sentry_dsn and settings.sentry_dsn.startswith("https://"):
        import sentry_sdk

        sentry_sdk.init(
            dsn=settings.sentry_dsn,
            environment=settings.app_env,
            traces_sample_rate=1.0 if settings.app_env == "development" else 0.2,
        )

    from api.database import get_engine

    engine = get_engine()
    async with engine.begin() as conn:
        await conn.execute(text("SELECT 1"))

    # Run cleanup on startup
    await _cleanup_stale_sessions()
    await _cleanup_expired_tokens()

    # Start daily digest background task
    digest_task = asyncio.create_task(_send_daily_digest())

    yield

    digest_task.cancel()
    await engine.dispose()


app = FastAPI(
    title="Math Teacher API",
    version="1.0.0",
    lifespan=lifespan,
)

configure_middleware(app)
app.include_router(health_router, prefix="/v1")
app.include_router(auth_router, prefix="/v1")
app.include_router(session_router, prefix="/v1")
app.include_router(practice_router, prefix="/v1")
app.include_router(image_router, prefix="/v1")
app.include_router(work_router, prefix="/v1")
app.include_router(admin_router, prefix="/v1")
