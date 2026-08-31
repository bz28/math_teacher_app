"""Shared LLM call logging and persistence."""

from __future__ import annotations

import asyncio
import hashlib
import json
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


async def _payload_row_id(
    db: Any, function: str, kind: str, body: str | None,
) -> Any:
    """Content-address one static call payload into `llm_payloads`.

    Returns the row id for `body`, inserting it the first time that exact
    text is seen and reusing the row every time after. `kind` is
    "system_prompt" or "tool_schema".

    Dedupe is near-total by design rather than by luck: system prompts are
    built to be byte-identical across a class so one cached prefix serves
    a whole set of submissions (see `grading_ai._build_system_prompt`). So
    a term of grading generates roughly one row per rubric, not one per
    call.

    `ON CONFLICT DO NOTHING` rather than a read-then-write: these run as
    fire-and-forget background tasks, so two calls sharing a prompt race
    on first use. The conflict path then re-selects to get the winner's
    id.

    Never raises. Persisting the call matters more than linking its
    prompt, so a failure here logs and returns None, which the UI already
    renders as "not recorded".
    """
    if not body:
        return None
    try:
        from sqlalchemy import select
        from sqlalchemy.dialects.postgresql import insert as pg_insert

        from api.models.llm_payload import LLMPayload

        digest = hashlib.sha256(body.encode("utf-8")).hexdigest()
        stmt = (
            pg_insert(LLMPayload)
            .values(
                sha256=digest,
                text=body,
                char_len=len(body),
                kind=kind,
                function=function,
            )
            .on_conflict_do_nothing(index_elements=["sha256"])
            .returning(LLMPayload.id)
        )
        row_id = (await db.execute(stmt)).scalar_one_or_none()
        if row_id is None:
            # Lost the race (or seen before) — read the existing row.
            row_id = (await db.execute(
                select(LLMPayload.id).where(LLMPayload.sha256 == digest)
            )).scalar_one_or_none()
        return row_id
    except Exception as err:
        logger.warning("%s persistence failed: %s", kind, err)
        return None


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
    generation_job_id: str | None = None,
    call_metadata: dict[str, Any] | None = None,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0,
    system_prompt: str | None = None,
    tool_schema_text: str | None = None,
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
        generation_job_uuid = (
            _uuid.UUID(generation_job_id) if generation_job_id else None
        )

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

            # Resolve (and insert-if-new) the system prompt before the
            # call row, so the FK is set on the first write rather than
            # needing a second UPDATE.
            #
            # Guarded a second time at the call site, not just inside the
            # helper. The enclosing `except` swallows anything raised here
            # and drops the ENTIRE call row — so a fault while linking the
            # prompt would silently cost us the cost/latency/token record
            # too. A missing prompt link is recoverable; a missing call is
            # a hole in the ledger. The helper already defends itself; this
            # makes the invariant hold no matter what it does later.
            try:
                system_prompt_id = await _payload_row_id(
                    db, function, "system_prompt", system_prompt,
                )
                tool_schema_id = await _payload_row_id(
                    db, function, "tool_schema", tool_schema_text,
                )
            except Exception as payload_err:
                logger.warning(
                    "payload link failed, persisting call without it: %s",
                    payload_err,
                )
                system_prompt_id = tool_schema_id = None

            record = LLMCall(
                function=function,
                model=model,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cache_read_tokens=cache_read_tokens,
                cache_write_tokens=cache_write_tokens,
                latency_ms=latency_ms,
                cost_usd=cost_usd,
                session_id=_uuid.UUID(session_id) if session_id else None,
                user_id=user_uuid,
                school_id=school_id,
                submission_id=submission_uuid,
                generation_job_id=generation_job_uuid,
                success=success,
                retry_count=retry_count,
                input_text=_truncate(input_text),
                output_text=_truncate(output_text),
                call_metadata=_safe_metadata(call_metadata),
                system_prompt_id=system_prompt_id,
                tool_schema_id=tool_schema_id,
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
