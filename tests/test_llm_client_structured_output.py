"""`call_claude_json` on a model that always thinks.

Opus 5.5 rejects a forced `tool_choice`, `temperature` and a thinking
budget — the three things the tool-use path sends. Asked with tool_choice
"auto" instead, a model can write the tool call out as text and return no
tool_use block. So an always-thinking model is asked for the same JSON
through structured outputs (`output_config.format`): the tool's input
schema is the response format, and the answer is one text block of
schema-valid JSON.

These pin the request each path sends — Sonnet/Haiku exactly as before —
and that the structured answer goes through the same parse, retry,
truncation and logging handling as a tool call.
"""

from __future__ import annotations

import json
from contextlib import ExitStack
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from api.core import grading_ai
from api.core.llm_client import (
    MODEL_HAIKU,
    MODEL_OPUS,
    MODEL_SONNET,
    LLMMode,
    OutputTruncatedError,
    _strict_json_schema,
    _system_with_cache,
    _to_tool_params,
    _with_safety,
    call_claude_json,
)
from api.core.llm_schemas import AI_GRADING_SCHEMA, DECOMPOSITION_SCHEMA

_GRADES = {"grades": [{
    "problem_position": 1, "student_answer": "$x=2$", "reasoning": "Matches the key.",
    "score_status": "full", "percent": 100, "confidence": 0.9,
    "student_feedback": "Nice work.", "deductions": [],
}]}


def _usage(out: int = 50) -> SimpleNamespace:
    return SimpleNamespace(
        input_tokens=100, output_tokens=out,
        cache_read_input_tokens=0, cache_creation_input_tokens=0,
    )


def _text_response(text: str, stop: str = "end_turn") -> SimpleNamespace:
    # Opus returns a (display-omitted) thinking block ahead of the answer.
    return SimpleNamespace(
        stop_reason=stop,
        content=[
            SimpleNamespace(type="thinking", thinking="", signature="sig"),
            SimpleNamespace(type="text", text=text),
        ],
        usage=_usage(),
    )


def _client(create: AsyncMock) -> SimpleNamespace:
    return SimpleNamespace(messages=SimpleNamespace(create=create))


def _patches(create: AsyncMock, log: Any = None) -> ExitStack:
    stack = ExitStack()
    stack.enter_context(patch("api.core.llm_client.get_client", return_value=_client(create)))
    stack.enter_context(patch(
        "api.core.llm_client._log_and_persist",
        side_effect=log if log is not None else None, new_callable=AsyncMock,
    ))
    stack.enter_context(patch("api.core.llm_client.asyncio.sleep", new=AsyncMock()))
    return stack


# ── request shape ────────────────────────────────────────────────────


async def test_opus_is_asked_for_json_through_structured_outputs() -> None:
    create = AsyncMock(return_value=_text_response(json.dumps(_GRADES)))
    with _patches(create):
        result = await call_claude_json(
            "grade it", "the work", LLMMode.AI_GRADING,
            tool_schema=AI_GRADING_SCHEMA, model=MODEL_OPUS, max_tokens=16384, timeout=300.0,
        )

    assert result == _GRADES
    assert create.await_args is not None
    sent = create.await_args.kwargs
    assert sent == {
        "model": MODEL_OPUS,
        "max_tokens": 16384,
        "system": _system_with_cache(_with_safety("grade it")),
        "messages": [{"role": "user", "content": "the work"}],
        "timeout": 300.0,
        "output_config": {"format": {
            "type": "json_schema",
            "schema": _strict_json_schema(AI_GRADING_SCHEMA["input_schema"]),
        }},
    }
    # Nothing Opus rejects.
    assert not {"tools", "tool_choice", "temperature", "thinking"} & sent.keys()


@pytest.mark.parametrize("model", [MODEL_SONNET, MODEL_HAIKU])
async def test_sonnet_and_haiku_send_exactly_what_they_did(model: str) -> None:
    ok = SimpleNamespace(
        stop_reason="tool_use",
        content=[SimpleNamespace(type="tool_use", input=dict(_GRADES))],
        usage=_usage(),
    )
    create = AsyncMock(return_value=ok)
    with _patches(create):
        await call_claude_json(
            "s", "u", LLMMode.AI_GRADING, tool_schema=AI_GRADING_SCHEMA,
            model=model, max_tokens=4096, timeout=60.0, temperature=0.0,
        )
    tools, choice = _to_tool_params(AI_GRADING_SCHEMA)
    assert create.await_args is not None
    assert create.await_args.kwargs == {
        "model": model,
        "max_tokens": 4096,
        "system": _system_with_cache(_with_safety("s")),
        "messages": [{"role": "user", "content": "u"}],
        "tools": tools,
        "tool_choice": choice,
        "timeout": 60.0,
        "temperature": 0.0,
    }


async def test_sonnet_with_a_thinking_budget_is_unchanged() -> None:
    ok = SimpleNamespace(
        stop_reason="tool_use",
        content=[SimpleNamespace(type="tool_use", input=dict(_GRADES))],
        usage=_usage(),
    )
    create = AsyncMock(return_value=ok)
    with _patches(create):
        await call_claude_json(
            "s", "u", LLMMode.DECOMPOSE, tool_schema=AI_GRADING_SCHEMA,
            model=MODEL_SONNET, max_tokens=8000, thinking_budget=2000,
        )
    assert create.await_args is not None
    sent = create.await_args.kwargs
    assert sent["thinking"] == {"type": "enabled", "budget_tokens": 2000}
    assert sent["tool_choice"] == {"type": "auto"}
    assert "output_config" not in sent


@pytest.mark.parametrize("kwargs", [{"temperature": 0.0}, {"thinking_budget": 2048}])
async def test_opus_refuses_temperature_and_thinking_budget(kwargs: dict[str, Any]) -> None:
    create = AsyncMock()
    with _patches(create), pytest.raises(ValueError, match="neither temperature"):
        await call_claude_json(
            "s", "u", LLMMode.AI_GRADING, tool_schema=AI_GRADING_SCHEMA,
            model=MODEL_OPUS, **kwargs,
        )
    create.assert_not_awaited()


def test_strict_schema_closes_every_object_without_touching_the_original() -> None:
    schema = {"type": "object", "properties": {
        "a": {"type": "array", "items": {"type": "object", "properties": {"b": {"type": "string"}}}},
        "c": {"type": ["string", "null"]},
    }}
    strict = _strict_json_schema(schema)
    assert strict["additionalProperties"] is False
    assert strict["properties"]["a"]["items"]["additionalProperties"] is False
    assert strict["properties"]["c"] == {"type": ["string", "null"]}
    assert "additionalProperties" not in schema  # input not mutated
    # The grading schema is already strict: the format is the tool schema.
    assert _strict_json_schema(AI_GRADING_SCHEMA["input_schema"]) == AI_GRADING_SCHEMA["input_schema"]


# ── response handling ────────────────────────────────────────────────


async def test_stringified_array_is_normalized_like_a_tool_call() -> None:
    steps = [{"title": "t", "description": "d"}]
    body = {"steps": json.dumps(steps), "final_answer": "x", "answer_type": "text"}
    create = AsyncMock(return_value=_text_response(json.dumps(body)))
    with _patches(create):
        result = await call_claude_json(
            "s", "u", LLMMode.DECOMPOSE, tool_schema=DECOMPOSITION_SCHEMA, model=MODEL_OPUS,
        )
    assert result["steps"] == steps


async def test_bad_json_is_retried_with_a_fresh_call_and_logged_as_a_failure() -> None:
    create = AsyncMock(side_effect=[
        _text_response('{"grades": [{"problem_position": 1,'),
        _text_response(json.dumps(_GRADES)),
    ])
    logged: list[dict[str, Any]] = []

    async def log(*args: Any, **kwargs: Any) -> None:
        logged.append({"args": args, **kwargs})

    with _patches(create, log):
        result = await call_claude_json(
            "s", "u", LLMMode.AI_GRADING, tool_schema=AI_GRADING_SCHEMA,
            model=MODEL_OPUS, max_retries=2,
        )
    assert result == _GRADES
    assert create.await_count == 2
    assert [row["success"] for row in logged] == [False, True]
    assert "not valid JSON" in logged[0]["output_text"]
    assert logged[0]["args"][2:4] == (100, 50)  # the bad call was billed


@pytest.mark.parametrize("text", ["", "[1, 2]", "not json"])
async def test_persistently_unusable_text_fails_loudly(text: str) -> None:
    create = AsyncMock(return_value=_text_response(text))
    with _patches(create), pytest.raises(RuntimeError, match="failed after 2 retries"):
        await call_claude_json(
            "s", "u", LLMMode.AI_GRADING, tool_schema=AI_GRADING_SCHEMA,
            model=MODEL_OPUS, max_retries=2,
        )
    assert create.await_count == 2


async def test_a_refusal_is_an_unusable_response() -> None:
    create = AsyncMock(return_value=_text_response("", stop="refusal"))
    with _patches(create), pytest.raises(RuntimeError, match="refusal"):
        await call_claude_json(
            "s", "u", LLMMode.AI_GRADING, tool_schema=AI_GRADING_SCHEMA,
            model=MODEL_OPUS, max_retries=1,
        )


async def test_truncation_raises_the_typed_error_with_billed_usage() -> None:
    """Thinking counts toward max_tokens, so an Opus grade can truncate.
    The grader acts on the type (`skipped_too_long`), so it must survive."""
    truncated = _text_response('{"grades": [', stop="max_tokens")
    truncated.usage = _usage(out=16384)
    create = AsyncMock(return_value=truncated)
    logged: list[dict[str, Any]] = []

    async def log(*args: Any, **kwargs: Any) -> None:
        logged.append({"args": args, **kwargs})

    with _patches(create, log), pytest.raises(OutputTruncatedError):
        await call_claude_json(
            "s", "u", LLMMode.AI_GRADING, tool_schema=AI_GRADING_SCHEMA,
            model=MODEL_OPUS, max_tokens=16384, max_retries=1,
        )
    assert create.await_count == 1
    assert len(logged) == 1 and logged[0]["success"] is False
    assert logged[0]["args"][2:4] == (100, 16384)


# ── the grader ───────────────────────────────────────────────────────


async def test_grader_calls_opus_without_temperature_or_thinking(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: dict[str, Any] = {}

    async def fake_call(*args: Any, **kwargs: Any) -> dict[str, Any]:
        seen.update(kwargs)
        return {"grades": []}

    monkeypatch.setattr(grading_ai, "call_claude_json", fake_call)
    await grading_ai.grade_submission_with_ai(
        {"steps": [], "final_answers": [], "confidence": 0.9},
        [{"position": 1, "question": "Solve.", "final_answer": "2"}], None,
    )
    assert seen["model"] == MODEL_OPUS
    assert seen["tool_schema"] is AI_GRADING_SCHEMA
    assert "temperature" not in seen and "thinking_budget" not in seen
