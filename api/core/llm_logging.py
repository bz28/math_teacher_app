"""Shared LLM call logging and persistence."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from api.core.constants import MAX_STORED_TEXT_LENGTH

logger = logging.getLogger(__name__)


# Cap structured-tag payloads at ~4KB after JSON encoding. Real values
# are dozens of bytes; the cap is generous headroom that catches a
# stray "stamp the entire transcript" mistake before it bloats the
# row. Oversized blobs get dropped (warn) rather than truncated since
# truncating JSON yields invalid JSON.
_MAX_METADATA_BYTES = 4_096


def _truncate(text: str | None) -> str | None:
    if text is None or len(text) <= MAX_STORED_TEXT_LENGTH:
        return text
    return text[:MAX_STORED_TEXT_LENGTH] + "... [truncated]"


def _safe_metadata(metadata: dict[str, Any] | None) -> dict[str, Any] | None:
    """Return metadata if it's serializable + under the size cap.
    Returns None and warns on oversized or non-serializable inputs.
    """
    if metadata is None:
        return None
    try:
        import json
        encoded = json.dumps(metadata, default=str)
    except (TypeError, ValueError) as e:
        logger.warning("LLM call metadata not JSON-serializable: %s", e)
        return None
    if len(encoded) > _MAX_METADATA_BYTES:
        logger.warning(
            "LLM call metadata exceeds %d bytes (got %d) — dropping",
            _MAX_METADATA_BYTES, len(encoded),
        )
        return None
    return metadata


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
    submission_id: str | None = None,
    call_metadata: dict[str, Any] | None = None,
) -> None:
    """Write an LLM call record to the database. Looks up school_id
    from users.school_id at write time so the dashboard can filter
    calls by school without a multi-hop join (snapshot semantics —
    historical calls keep the school they had at log time).
    """
    try:
        import uuid as _uuid

        from sqlalchemy import select

        from api.database import get_session_factory
        from api.models.llm_call import LLMCall
        from api.models.user import User

        user_uuid = _uuid.UUID(user_id) if user_id else None
        submission_uuid = _uuid.UUID(submission_id) if submission_id else None

        async with get_session_factory()() as db:
            school_id: _uuid.UUID | None = None
            if user_uuid is not None:
                # School lookup must never break the call. If it fails
                # for any reason (deleted user, schema drift), the row
                # still gets logged with school_id=None and lands in
                # the Internal bucket.
                try:
                    school_id = (await db.execute(
                        select(User.school_id).where(User.id == user_uuid)
                    )).scalar_one_or_none()
                except Exception as lookup_err:
                    logger.warning(
                        "school_id lookup failed for user %s: %s",
                        user_id, lookup_err,
                    )

            record = LLMCall(
                function=function,
                model=model,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                latency_ms=latency_ms,
                cost_usd=cost_usd,
                session_id=_uuid.UUID(session_id) if session_id else None,
                user_id=user_uuid,
                school_id=school_id,
                submission_id=submission_uuid,
                success=success,
                retry_count=retry_count,
                input_text=_truncate(input_text),
                output_text=_truncate(output_text),
                call_metadata=_safe_metadata(call_metadata),
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
