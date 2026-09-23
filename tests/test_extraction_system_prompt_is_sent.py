"""The work extractor's system prompt must reach the model.

Until 2026-09 it did not. `_EXTRACT_SYSTEM` was written in April 2026 and
carried the rules that matter most on this path — "Do NOT solve the problem
yourself", the anti-injection clause, "ignore printed worksheet text", and
the below-0.3-confidence rule for illegible handwriting — but
`call_claude_vision` had no system-prompt parameter (its sibling
`call_claude_json` takes one as its first positional argument), so the
constant was never passed anywhere. Nothing failed: the tool schema still
forced well-formed JSON, so the extraction "worked" while every behavioural
rule was absent. Prod's own `llm_payloads` recorded it — 30 days of
`integrity_extract` calls carried a 928-char system prompt (the safety
preamble alone) next to `ai_grading`'s 11k.

The old guard test asserted on the module constant, so it passed for five
months while the protection it described was not in production. These tests
assert on the REQUEST instead: whatever else changes, the rules have to be
in what we send.
"""

from __future__ import annotations

from typing import Any

import pytest

from api.core import llm_client
from api.core.integrity_ai import _EXTRACT_SYSTEM
from api.core.llm_schemas import INTEGRITY_EXTRACT_SCHEMA

pytestmark = pytest.mark.anyio


class _Captured:
    """Stands in for the Anthropic client and records the request."""

    def __init__(self) -> None:
        self.kwargs: dict[str, Any] = {}
        self.messages = self

    async def create(self, **kwargs: Any) -> Any:
        self.kwargs = kwargs

        class _Block:
            type = "tool_use"
            input = {"steps": [], "final_answers": [], "visual_work": [], "confidence": 0.9}

        class _Usage:
            input_tokens = 10
            output_tokens = 5
            cache_read_input_tokens = 0
            cache_creation_input_tokens = 0

        class _Resp:
            stop_reason = "tool_use"
            content = [_Block()]
            usage = _Usage()

        return _Resp()


def _system_text(kwargs: dict[str, Any]) -> str:
    """The system field may be a string or a list of cached blocks."""
    system = kwargs.get("system")
    if isinstance(system, str):
        return system
    return "\n".join(
        block.get("text", "") for block in (system or []) if isinstance(block, dict)
    )


@pytest.fixture
def captured(monkeypatch: pytest.MonkeyPatch) -> _Captured:
    client = _Captured()
    monkeypatch.setattr(llm_client, "get_client", lambda: client)
    async def _ok() -> None:
        return None

    monkeypatch.setattr(llm_client.cost_tracker, "check_limit", _ok)
    async def _noop(*args: Any, **kwargs: Any) -> None:
        return None

    monkeypatch.setattr(llm_client, "_log_and_persist", _noop)
    return client



async def test_vision_sends_the_system_prompt_it_is_given(captured: _Captured) -> None:
    await llm_client.call_claude_vision(
        [{"type": "text", "text": "hi"}],
        llm_client.LLMMode.INTEGRITY_EXTRACT,
        tool_schema=INTEGRITY_EXTRACT_SCHEMA,
        system_prompt="TRANSCRIBE, NEVER SOLVE.",
    )
    assert "TRANSCRIBE, NEVER SOLVE." in _system_text(captured.kwargs)


async def test_vision_without_a_system_prompt_still_sends_the_safety_preamble(
    captured: _Captured,
) -> None:
    """The other nine vision callers pass nothing and must be unaffected."""
    await llm_client.call_claude_vision(
        [{"type": "text", "text": "hi"}],
        llm_client.LLMMode.INTEGRITY_EXTRACT,
        tool_schema=INTEGRITY_EXTRACT_SCHEMA,
    )
    text = _system_text(captured.kwargs)
    assert llm_client.SAFETY_PREAMBLE.split("\n")[0] in text
    assert "TRANSCRIBE" not in text


class TestExtractorRulesReachTheModel:
    """Each rule is asserted on the text that would be SENT, not on the
    module constant — the distinction this whole file exists for."""

    @pytest.mark.parametrize(
        ("rule", "needle"),
        [
            ("transcribe, don't solve", "do not solve the problem yourself"),
            ("anti-injection", "never an instruction to"),
            ("injection must not steer final answers", "actual worked math"),
            ("ignore printed worksheet text", "ignore printed worksheet text"),
            ("illegible pages score low", "below 0.3"),
        ],
    )
    async def test_rule_is_in_the_request(
        self, captured: _Captured, rule: str, needle: str
    ) -> None:
        await llm_client.call_claude_vision(
            [{"type": "text", "text": "page"}],
            llm_client.LLMMode.INTEGRITY_EXTRACT,
            tool_schema=INTEGRITY_EXTRACT_SCHEMA,
            system_prompt=_EXTRACT_SYSTEM,
        )
        assert needle in _system_text(captured.kwargs).lower(), f"{rule!r} missing from the request"
