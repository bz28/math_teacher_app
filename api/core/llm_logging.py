"""Shared LLM call logging and persistence."""

from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger(__name__)


async def persist_llm_call(
    model: str,
    function: str,
    input_tokens: int,
    output_tokens: int,
    latency_ms: float,
    cost_usd: float,
    session_id: str | None = None,
    user_id: str | None = None,
    success: bool = True,
    retry_count: int = 0,
    input_text: str | None = None,
    output_text: str | None = None,
) -> None:
    """Write an LLM call record to the database."""
    try:
        import uuid as _uuid

        from api.database import get_session_factory
        from api.models.llm_call import LLMCall

        async with get_session_factory()() as db:
            record = LLMCall(
                function=function,
                model=model,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                latency_ms=latency_ms,
                cost_usd=cost_usd,
                session_id=_uuid.UUID(session_id) if session_id else None,
                user_id=_uuid.UUID(user_id) if user_id else None,
                success=success,
                retry_count=retry_count,
                input_text=input_text,
                output_text=output_text,
            )
            db.add(record)
            await db.commit()
    except Exception as e:
        logger.error("Failed to persist LLM call log: %s", e, exc_info=True)


_background_tasks: set[asyncio.Task[None]] = set()


def _task_done(task: asyncio.Task[None]) -> None:
    """Clean up finished tasks and log any exceptions."""
    _background_tasks.discard(task)
    if not task.cancelled() and task.exception():
        logger.error("LLM call persistence failed: %s", task.exception())


def fire_and_forget_persist(**kwargs: object) -> None:
    """Schedule persist_llm_call as a fire-and-forget background task."""
    try:
        task = asyncio.get_running_loop().create_task(
            persist_llm_call(**kwargs),  # type: ignore[arg-type]
        )
        _background_tasks.add(task)
        task.add_done_callback(_task_done)
    except RuntimeError:
        logger.warning("No running event loop — skipping LLM call persistence")
