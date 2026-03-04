"""SSE streaming infrastructure for LLM response streaming."""

import json
from collections.abc import AsyncIterator

from fastapi import APIRouter
from starlette.responses import StreamingResponse

router = APIRouter()


async def sse_stream(event_generator: AsyncIterator[dict[str, str | int]]) -> StreamingResponse:
    """Wrap an async event generator as an SSE StreamingResponse."""

    async def _format() -> AsyncIterator[str]:
        async for event in event_generator:
            data = json.dumps(event)
            yield f"data: {data}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        _format(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


async def _demo_events() -> AsyncIterator[dict[str, str]]:
    """Demo event generator for testing SSE infrastructure."""
    import asyncio

    for i in range(5):
        yield {"type": "chunk", "content": f"Token {i}"}
        await asyncio.sleep(0.1)
    yield {"type": "done"}


@router.get("/sse/demo")
async def sse_demo() -> StreamingResponse:
    """Proof-of-concept SSE endpoint for testing streaming."""
    return await sse_stream(_demo_events())
