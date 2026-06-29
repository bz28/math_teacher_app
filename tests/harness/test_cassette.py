"""Tests for the harness record/replay cassette layer.

Covers the store itself (key stability, get/put, identity reduction) and
the env-gated decorator in llm_client (record → replay → miss, and the
production passthrough when the harness is off).
"""

from __future__ import annotations

from typing import Any

import pytest

import tests.harness.cassette as cass_mod
from api.core.llm_client import MODEL_HAIKU, _cassetted
from tests.harness.cassette import (
    MISS,
    Cassette,
    CassetteMissError,
    build_identity,
)

_TOOL = {"name": "t", "input_schema": {"type": "object"}}


@pytest.fixture
def cassette_dir(tmp_path, monkeypatch):  # type: ignore[no-untyped-def]
    """Point cassettes at a temp dir and reset the module singleton so
    each test starts clean and mode switches take effect."""
    monkeypatch.setenv("HARNESS_CASSETTE_DIR", str(tmp_path))
    cass_mod._instance = None
    yield tmp_path
    cass_mod._instance = None


# ── Store ────────────────────────────────────────────────────────────


def test_key_is_stable_and_order_independent() -> None:
    c = Cassette("record", root=cass_mod._DEFAULT_DIR)
    k1 = c.key("call_claude_json", {"a": 1, "b": 2, "model": "m"})
    k2 = c.key("call_claude_json", {"b": 2, "a": 1, "model": "m"})
    assert k1 == k2
    assert c.key("call_claude_json", {"a": 1, "b": 3, "model": "m"}) != k1


def test_key_redacts_run_varying_ids() -> None:
    """A multi-turn agent's transcript carries run-varying ids — a fresh DB-row
    UUID (the integrity `problem_id`) and the live API's ephemeral `toolu_…`
    tool-use ids. The key must redact BOTH so the same logical turn replays at
    $0 across record/replay sessions, while genuinely different content (the
    growing transcript / tool input) still hashes distinctly."""
    c = Cassette("record", root=cass_mod._DEFAULT_DIR)

    def turn(problem_id: str, toolu: str) -> dict[str, Any]:
        return {
            "mode": "integrity_agent",
            "model": "m",
            "system_prompt": "agent",
            "messages": [
                {"role": "user", "content": f"problem_id: {problem_id}"},
                {
                    "role": "assistant",
                    "content": [
                        {"type": "tool_use", "id": toolu, "name": "v", "input": {}},
                    ],
                },
            ],
        }

    # Same logical turn, different run-varying ids → identical key.
    k_run1 = c.key(
        "call_claude_conversation",
        turn("d5f7b3a2-1c4e-4a6b-9e0d-2f8c7a1b6e30", "toolu_01AAAAAAAAAAAAAAAAAAAAAA"),
    )
    k_run2 = c.key(
        "call_claude_conversation",
        turn("9e0d2f8c-7a1b-4e30-8c7a-1b6e305f7b3a", "toolu_01ZZZZZZZZZZZZZZZZZZZZZZ"),
    )
    assert k_run1 == k_run2

    # A different tool name is real content — must still hash distinctly even
    # though the ids redact to the same tokens.
    other = turn("d5f7b3a2-1c4e-4a6b-9e0d-2f8c7a1b6e30", "toolu_01AAAAAAAAAAAAAAAAAAAAAA")
    other["messages"][1]["content"][0]["name"] = "finish_check"
    assert c.key("call_claude_conversation", other) != k_run1


def test_build_identity_drops_noise_and_resolves_model() -> None:
    ident = build_identity(
        {
            "system_prompt": "s",
            "user_message": "u",
            "mode": "test",
            "model": None,
            "session_id": "abc",
            "user_id": "xyz",
            "submission_id": "s1",
            "call_metadata": {"k": "v"},
            "max_retries": 3,
        },
        default_model="haiku-default",
    )
    assert ident["model"] == "haiku-default"  # None resolved to default
    assert "session_id" not in ident and "user_id" not in ident
    assert "submission_id" not in ident and "call_metadata" not in ident
    assert ident["system_prompt"] == "s"


async def test_get_put_roundtrip(cassette_dir) -> None:  # type: ignore[no-untyped-def]
    c = Cassette("record", root=cassette_dir)
    key = c.key("call_claude_json", {"x": 1})
    assert c.get("call_claude_json", key) is MISS
    await c.put("call_claude_json", key, {"answer": 42}, {"mode": "test"})
    assert c.get("call_claude_json", key) == {"answer": 42}


# ── Decorator (record → replay → miss → off) ─────────────────────────


async def test_record_then_replay_skips_live_call(cassette_dir, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    calls = {"n": 0}

    @_cassetted(default_model=MODEL_HAIKU)
    async def fake(
        system_prompt: str, suser_message: str, mode: str, *,
        tool_schema: dict[str, Any], model: str | None = None,
    ) -> dict[str, Any]:
        calls["n"] += 1
        return {"answer": 42, "call": calls["n"]}

    # Record: underlying runs once and the response is saved.
    monkeypatch.setenv("HARNESS_LLM_MODE", "record")
    cass_mod._instance = None
    r1 = await fake("sys", "hi", "test", tool_schema=_TOOL)
    assert r1 == {"answer": 42, "call": 1}
    assert calls["n"] == 1

    # Replay: same inputs return the cached response WITHOUT calling live.
    monkeypatch.setenv("HARNESS_LLM_MODE", "replay")
    cass_mod._instance = None
    r2 = await fake("sys", "hi", "test", tool_schema=_TOOL)
    assert r2 == {"answer": 42, "call": 1}  # cached value, not a fresh call
    assert calls["n"] == 1  # underlying never ran again — $0


async def test_replay_miss_raises(cassette_dir, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    @_cassetted(default_model=MODEL_HAIKU)
    async def fake(
        system_prompt: str, suser_message: str, mode: str, *,
        tool_schema: dict[str, Any], model: str | None = None,
    ) -> dict[str, Any]:
        return {"x": 1}

    monkeypatch.setenv("HARNESS_LLM_MODE", "replay")
    cass_mod._instance = None
    with pytest.raises(CassetteMissError):
        await fake("sys", "never recorded", "test", tool_schema=_TOOL)


async def test_off_is_transparent_passthrough(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    calls = {"n": 0}

    @_cassetted(default_model=MODEL_HAIKU)
    async def fake(
        system_prompt: str, suser_message: str, mode: str, *,
        tool_schema: dict[str, Any], model: str | None = None,
    ) -> dict[str, Any]:
        calls["n"] += 1
        return {"ok": True}

    monkeypatch.delenv("HARNESS_LLM_MODE", raising=False)
    r = await fake("s", "u", "m", tool_schema=_TOOL)
    assert r == {"ok": True}
    assert calls["n"] == 1  # always runs live; cassette inert
