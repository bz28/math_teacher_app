r"""LaTeX survives a tool result whose fields the API already JSON-decoded.

Prod (Nov 2026): MCQ distractors stored with formfeed + "rac" in place of
`\frac`. The model writes `\frac` with one backslash in its tool-call JSON,
and the Anthropic API's own decode turns `\f` into a formfeed (`\b` into a
backspace, `\r` into a CR). `block.input` is an ordinary dict of ordinary
arrays, so `_normalize_arrays` (stringified arrays only) never looked at it.
These feed that exact shape through the real call path.
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from api.core.llm_client import LLMMode, call_claude_json, restore_latex_escapes
from api.core.llm_schemas import DECOMPOSITION_SCHEMA
from api.core.practice import generate_distractors

_CONTROL = "\f\v\b\r"


def _no_control_chars(obj: Any) -> bool:
    return not any(c in s for s in _strings(obj) for c in _CONTROL)


def _strings(obj: Any) -> list[str]:
    if isinstance(obj, str):
        return [obj]
    if isinstance(obj, list):
        return [s for x in obj for s in _strings(x)]
    if isinstance(obj, dict):
        return [s for v in obj.values() for s in _strings(v)]
    return []


def _decoded_by_api(model_json: str) -> dict[str, Any]:
    """What `block.input` holds: the model's raw JSON, decoded once."""
    parsed = json.loads(model_json)
    assert isinstance(parsed, dict)
    return parsed


def _client(tool_input: dict[str, Any]) -> SimpleNamespace:
    response = SimpleNamespace(
        stop_reason="tool_use",
        content=[SimpleNamespace(type="tool_use", input=tool_input)],
        usage=SimpleNamespace(
            input_tokens=10, output_tokens=5,
            cache_read_input_tokens=0, cache_creation_input_tokens=0,
        ),
    )
    return SimpleNamespace(messages=SimpleNamespace(create=AsyncMock(return_value=response)))


async def _run(tool_input: dict[str, Any], coro_factory: Any) -> tuple[Any, list[dict[str, Any]]]:
    logged: list[dict[str, Any]] = []

    async def fake_log(*_args: Any, **kwargs: Any) -> None:
        logged.append(kwargs)

    with (
        patch("api.core.llm_client.get_client", return_value=_client(tool_input)),
        patch("api.core.llm_client._log_and_persist", side_effect=fake_log),
    ):
        return await coro_factory(), logged


@pytest.mark.asyncio
async def test_distractors_keep_their_latex() -> None:
    # Single-backslash LaTeX, exactly as the model writes it.
    tool_input = _decoded_by_api(
        r'{"distractors": ["$\frac{3}{4}$", "$2\beta$", "$x \rightarrow \rho$"]}'
    )
    assert "\f" in tool_input["distractors"][0]  # the corruption is really there

    out, logged = await _run(
        tool_input, lambda: generate_distractors("Simplify", "$\\frac{1}{2}$"),
    )

    assert out == [r"$\frac{3}{4}$", r"$2\beta$", r"$x \rightarrow \rho$"]
    # The LLM-call log records the repaired output too.
    assert _no_control_chars(json.loads(logged[0]["output_text"]))


@pytest.mark.asyncio
async def test_solution_steps_and_final_answer_keep_their_latex() -> None:
    # A real array of objects (not a stringified one) plus a plain string.
    tool_input = _decoded_by_api(
        r'{"steps": [{"title": "Divide", "description": "$\frac{6}{3} = 2$\nso $\beta = 2$"}],'
        r' "final_answer": "$\frac{1}{2}$", "answer_type": "text"}'
    )

    out, _ = await _run(
        tool_input,
        lambda: call_claude_json(
            "system", "user", LLMMode.DECOMPOSE, tool_schema=DECOMPOSITION_SCHEMA,
        ),
    )

    assert out["final_answer"] == r"$\frac{1}{2}$"
    # The real newline between the two sentences is kept.
    assert out["steps"][0]["description"] == "$\\frac{6}{3} = 2$\nso $\\beta = 2$"
    assert _no_control_chars(out)


def test_every_corruption_char_is_restored() -> None:
    assert restore_latex_escapes("\frac \beta \rho \vec") == r"\frac \beta \rho \vec"


def test_crlf_and_clean_values_are_left_alone() -> None:
    assert restore_latex_escapes("line one\r\nline two") == "line one\r\nline two"
    assert restore_latex_escapes(r"$\frac{1}{2}$") == r"$\frac{1}{2}$"
    assert restore_latex_escapes([None, 3, True, "", []]) == [None, 3, True, "", []]


def test_idempotent() -> None:
    once = restore_latex_escapes({"a": ["\frac{1}{2}", {"b": "\rightarrow"}]})
    assert restore_latex_escapes(once) == once == {"a": [r"\frac{1}{2}", {"b": r"\rightarrow"}]}
