from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy import text

from api.config import settings
from api.middleware.setup import configure_middleware
from api.routes.admin import router as admin_router
from api.routes.auth import router as auth_router
from api.routes.health import router as health_router
from api.routes.image import router as image_router
from api.routes.practice import router as practice_router
from api.routes.session import router as session_router


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Startup
    if settings.sentry_dsn:
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

    yield

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
app.include_router(admin_router, prefix="/v1")
