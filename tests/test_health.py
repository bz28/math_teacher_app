import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_health_returns_200(client: AsyncClient) -> None:
    response = await client.get("/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}


@pytest.mark.asyncio
async def test_security_headers(client: AsyncClient) -> None:
    response = await client.get("/v1/health")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert "strict-transport-security" in response.headers
    assert "x-request-id" in response.headers


@pytest.mark.asyncio
async def test_request_id_propagated(client: AsyncClient) -> None:
    response = await client.get("/v1/health", headers={"X-Request-ID": "test-123"})
    assert response.headers["x-request-id"] == "test-123"
