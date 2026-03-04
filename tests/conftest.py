import os

# Set test environment variables before importing anything else
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://mathapp:mathapp@localhost:5432/mathapp_test")
os.environ.setdefault("JWT_SECRET", "test-secret-key")
# CLAUDE_API_KEY: not set here — reads from .env locally, from env vars in CI
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("SENTRY_DSN", "")

from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from api.database import Base, get_engine, get_session_factory
from api.main import app
from api.models.session import Session  # noqa: F401 — register models with Base
from api.models.user import RefreshToken, User  # noqa: F401 — register models with Base


@pytest.fixture(scope="session", autouse=True)
async def setup_db() -> None:
    """Create tables (if missing) and truncate before the test session."""
    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with get_session_factory()() as session:
        await session.execute(text("TRUNCATE TABLE sessions, refresh_tokens, users CASCADE"))
        await session.commit()


@pytest.fixture(scope="session")
async def client() -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
