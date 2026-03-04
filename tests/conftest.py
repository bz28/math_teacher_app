import os

# Set test environment variables before importing anything else
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://mathapp:mathapp@localhost:5432/mathapp_test")
os.environ.setdefault("JWT_SECRET", "test-secret-key")
os.environ.setdefault("CLAUDE_API_KEY", "sk-ant-test-key")
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("SENTRY_DSN", "")

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from api.database import get_session_factory
from api.main import app


@pytest.fixture(scope="session", autouse=True)
async def clean_db() -> None:
    """Truncate all app tables before the test session."""
    async with get_session_factory()() as session:
        await session.execute(text("TRUNCATE TABLE refresh_tokens, users CASCADE"))
        await session.commit()


@pytest.fixture(scope="session")
async def client() -> AsyncClient:  # type: ignore[misc]
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
