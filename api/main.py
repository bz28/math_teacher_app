from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from api.config import settings


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
    # Verify DB connection
    async with engine.begin() as conn:
        await conn.execute(__import__("sqlalchemy").text("SELECT 1"))

    yield

    # Shutdown
    await engine.dispose()


app = FastAPI(
    title="Math Teacher API",
    version="1.0.0",
    lifespan=lifespan,
)

# Middleware and routes are wired in after app creation to avoid circular imports
from api.middleware.setup import configure_middleware  # noqa: E402
from api.routes.health import router as health_router  # noqa: E402
from api.routes.sse import router as sse_router  # noqa: E402

configure_middleware(app)
app.include_router(health_router, prefix="/v1")
app.include_router(sse_router, prefix="/v1")
