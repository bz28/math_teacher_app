import os

# Set test environment variables before importing anything else
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://mathapp:mathapp@localhost:5432/mathapp_test")
os.environ.setdefault("JWT_SECRET", "test-secret-key")
os.environ.setdefault("CLAUDE_API_KEY", "sk-ant-test-key")
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("SENTRY_DSN", "")

import pytest
from httpx import ASGITransport, AsyncClient

from api.main import app


@pytest.fixture(scope="session")
async def client() -> AsyncClient:  # type: ignore[misc]
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
