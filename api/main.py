import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from sqlalchemy import delete, or_, text

from api.config import settings
from api.core.entitlements import EntitlementError
from api.middleware.rate_limit import limiter
from api.middleware.setup import configure_middleware
from api.routes.admin import router as admin_router
from api.routes.auth import router as auth_router
from api.routes.contact import router as contact_router
from api.routes.health import router as health_router
from api.routes.image import router as image_router
from api.routes.practice import router as practice_router
from api.routes.promo import router as promo_router
from api.routes.school_student_practice import router as school_student_router
from api.routes.session import router as session_router
from api.routes.teacher import router as teacher_router
from api.routes.webhook import router as webhook_router
from api.routes.work import router as work_router

logger = logging.getLogger(__name__)


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

    if settings.bypass_subscription and settings.app_env != "development":
        raise RuntimeError("BYPASS_SUBSCRIPTION=true is not allowed outside development")

    from api.database import get_engine

    engine = get_engine()
    async with engine.begin() as conn:
        await conn.execute(text("SELECT 1"))

    await _cleanup_expired_tokens()

    yield

    await engine.dispose()


app = FastAPI(
    title="Math Teacher API",
    version="1.0.0",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]

configure_middleware(app)


@app.exception_handler(EntitlementError)
async def entitlement_error_handler(request: Request, exc: EntitlementError) -> JSONResponse:
    return JSONResponse(
        status_code=403,
        content={
            "error": "entitlement_required",
            "entitlement": exc.entitlement.value,
            "message": exc.message,
            "is_limit": exc.is_limit,
        },
    )


app.include_router(health_router, prefix="/v1")
app.include_router(auth_router, prefix="/v1")
app.include_router(session_router, prefix="/v1")
app.include_router(practice_router, prefix="/v1")
app.include_router(image_router, prefix="/v1")
app.include_router(work_router, prefix="/v1")
app.include_router(admin_router, prefix="/v1")
app.include_router(webhook_router, prefix="/v1")
app.include_router(promo_router, prefix="/v1")
app.include_router(contact_router, prefix="/v1")
app.include_router(teacher_router, prefix="/v1")
app.include_router(school_student_router, prefix="/v1")
