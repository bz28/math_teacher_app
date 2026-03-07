"""SSE streaming infrastructure for LLM response streaming."""

import json
from collections.abc import AsyncIterator

from starlette.responses import StreamingResponse


async def sse_stream(event_generator: AsyncIterator[dict[str, str]]) -> StreamingResponse:
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
