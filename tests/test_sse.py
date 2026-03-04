import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_sse_demo_streams_events(client: AsyncClient) -> None:
    response = await client.get("/v1/sse/demo")
    assert response.status_code == 200
    assert response.headers["content-type"] == "text/event-stream; charset=utf-8"

    lines = response.text.strip().split("\n\n")
    # 5 chunk events + 1 done event + [DONE] sentinel
    data_lines = [line for line in lines if line.startswith("data:")]
    assert len(data_lines) == 7  # 5 chunks + 1 done + [DONE]
    assert "data: [DONE]" in response.text


@pytest.mark.asyncio
async def test_sse_headers(client: AsyncClient) -> None:
    response = await client.get("/v1/sse/demo")
    assert response.headers["cache-control"] == "no-cache"
