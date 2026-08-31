"""What every LLM call sent is recorded, and deduped by content.

`llm_calls.input_text` has only ever held the user message, so the log
carried roughly 4% of what was actually sent — and the missing 96% is the
part that decides behaviour (the grading rubric, the tutoring guardrails,
the generation spec). These tests pin the three properties that make
recording it viable rather than ruinous:

  1. it is stored, and linked to its call;
  2. the SAME prompt across many calls costs ONE row — which is what
     makes this affordable on the fastest-growing table in the schema,
     and is guaranteed by the caching contract (`_build_system_prompt`
     excludes everything student-specific so a class shares one prefix);
  3. a call with no system prompt links to nothing rather than to a
     placeholder, so "not recorded" stays distinguishable from "empty".
"""

from __future__ import annotations

import hashlib

import pytest
from sqlalchemy import func, select

from api.core.llm_logging import persist_llm_call
from api.database import get_session_factory
from api.models.llm_call import LLMCall
from api.models.llm_payload import LLMPayload

pytestmark = pytest.mark.anyio

GRADING_PROMPT = (
    "You are grading Algebra I homework.\n\nRUBRIC:\n"
    "- Full credit for a correct final answer with shown work.\n"
    "- Half credit for a correct method with an arithmetic slip.\n"
)
TUTOR_PROMPT = "You are a tutor. Guide, never give the answer outright."


async def _persist(
    function: str,
    system_prompt: str | None,
    marker: str,
    tool_schema_text: str | None = None,
) -> None:
    await persist_llm_call(
        model="claude-sonnet-4-6",
        function=function,
        input_tokens=100,
        output_tokens=20,
        latency_ms=123.0,
        cost_usd=0.001,
        input_text=marker,
        output_text="ok",
        system_prompt=system_prompt,
        tool_schema_text=tool_schema_text,
    )


async def _call_by_marker(marker: str) -> LLMCall:
    async with get_session_factory()() as db:
        return (await db.execute(
            select(LLMCall).where(LLMCall.input_text == marker)
        )).scalars().one()


async def test_system_prompt_is_stored_and_linked() -> None:
    await _persist("ai_grading", GRADING_PROMPT, "marker-linked")
    call = await _call_by_marker("marker-linked")
    assert call.system_prompt_id is not None

    async with get_session_factory()() as db:
        tpl = (await db.execute(
            select(LLMPayload).where(LLMPayload.id == call.system_prompt_id)
        )).scalars().one()

    # The whole point: the text we can now read back is the text that was
    # sent, not a summary of it.
    assert tpl.text == GRADING_PROMPT
    assert tpl.char_len == len(GRADING_PROMPT)
    assert tpl.function == "ai_grading"
    assert tpl.kind == "system_prompt"
    assert tpl.sha256 == hashlib.sha256(GRADING_PROMPT.encode()).hexdigest()


async def test_identical_prompt_across_calls_costs_one_row() -> None:
    """A class of submissions shares one cached prefix — and one row.

    Without this, recording the prompt would duplicate ~18KB per call on
    `llm_calls`. With it, a term of grading costs about one row per
    rubric.
    """
    for i in range(5):
        await _persist("ai_grading", GRADING_PROMPT, f"marker-dedupe-{i}")

    digest = hashlib.sha256(GRADING_PROMPT.encode()).hexdigest()
    async with get_session_factory()() as db:
        rows = (await db.execute(
            select(func.count()).select_from(LLMPayload)
            .where(LLMPayload.sha256 == digest)
        )).scalar()
    assert rows == 1

    ids = {(await _call_by_marker(f"marker-dedupe-{i}")).system_prompt_id
           for i in range(5)}
    assert len(ids) == 1 and None not in ids


async def test_different_prompts_get_different_rows() -> None:
    """Two calls in one class carrying different ids is the signal that
    something student-specific leaked into the cached half and silently
    killed the cache hit. That only works if distinct text distinguishes.
    """
    await _persist("tutor", TUTOR_PROMPT, "marker-distinct-a")
    await _persist("tutor", TUTOR_PROMPT + " Be brief.", "marker-distinct-b")

    a = await _call_by_marker("marker-distinct-a")
    b = await _call_by_marker("marker-distinct-b")
    assert a.system_prompt_id is not None
    assert b.system_prompt_id is not None
    assert a.system_prompt_id != b.system_prompt_id


async def test_no_system_prompt_links_to_nothing() -> None:
    """NULL has to keep meaning "not recorded".

    Every historical row is NULL and deliberately un-backfilled, and the
    console renders that as an explicit "not recorded" note. If an absent
    prompt were stored as an empty row instead, that honest distinction
    would collapse.
    """
    await _persist("vision_extract", None, "marker-none")
    call = await _call_by_marker("marker-none")
    assert call.system_prompt_id is None


async def test_persistence_survives_a_python_error_in_the_helper(monkeypatch) -> None:
    """A Python fault while linking must not cost the call row."""
    import api.core.llm_logging as mod

    async def boom(*_a: object, **_k: object) -> None:
        raise RuntimeError("payload store unavailable")

    monkeypatch.setattr(mod, "_payload_row_id", boom)
    await _persist("ai_grading", GRADING_PROMPT, "marker-resilient")

    call = await _call_by_marker("marker-resilient")
    assert call.system_prompt_id is None
    assert call.cost_usd == 0.001


async def test_persistence_survives_a_database_error_on_the_payload() -> None:
    """The case a Python `try/except` cannot cover, and the reason the
    payload write needs its own session.

    Postgres aborts an entire transaction on a statement error. While the
    payload insert shared the caller's session, a bad payload poisoned the
    transaction the `LLMCall` insert was about to use: the original error
    was caught and swallowed, then `db.add(record)` failed with
    `InFailedSQLTransactionError`, the outer handler swallowed THAT, and
    the call row vanished — cost, latency, tokens and text with it.

    A NUL byte is the cheapest real trigger (Postgres rejects `\x00` in
    `text`), and it is genuinely reachable: prompts embed extracted
    handwriting and teacher-authored rubric notes.

    The earlier version of this test raised a Python `RuntimeError`, which
    the call-site guard does catch — so it passed green while the real
    failure shipped. Assert the ledger row, not the guard.
    """
    await _persist("ai_grading", "rubric with a NUL\x00 byte", "marker-db-error")

    # The call MUST still be recorded. The payload link may be null.
    call = await _call_by_marker("marker-db-error")
    assert call.cost_usd == 0.001
    assert call.input_tokens == 100


async def test_tool_schema_is_recorded_separately() -> None:
    """The output contract is part of what was sent.

    On a measured grading call the tool schema was 656 of 962 input
    tokens — larger than the system prompt — and it defines the shape of
    the answer. Recording the system prompt alone still left the majority
    of the payload unaccounted for.
    """
    tools = '{"name":"grade","input_schema":{"properties":{"score":{}}}}'
    await _persist("ai_grading", GRADING_PROMPT, "marker-tools", tools)
    call = await _call_by_marker("marker-tools")

    assert call.system_prompt_id is not None
    assert call.tool_schema_id is not None
    # Two payloads, two rows — never conflated.
    assert call.system_prompt_id != call.tool_schema_id

    async with get_session_factory()() as db:
        row = (await db.execute(
            select(LLMPayload).where(LLMPayload.id == call.tool_schema_id)
        )).scalars().one()
    assert row.kind == "tool_schema"
    assert row.text == tools


async def test_call_with_no_tool_schema_links_to_nothing() -> None:
    await _persist("tutor", TUTOR_PROMPT, "marker-no-tools")
    call = await _call_by_marker("marker-no-tools")
    assert call.tool_schema_id is None


# ── the read endpoint ──────────────────────────────────────────────────
# The API surface had no coverage at all: not the body, not the 404, not
# the admin gate. It is the only way the recorded prompt ever reaches a
# human, so an unguarded regression there silently returns the whole
# feature to invisibility.

async def _admin_token() -> str:
    import uuid as _uuid

    from api.core.auth import create_access_token, hash_password
    from api.models.user import User

    async with get_session_factory()() as s:
        admin = User(
            email=f"pl_{_uuid.uuid4().hex[:8]}@t.com",
            password_hash=hash_password("x"),
            grade_level=99, role="admin", name="A",
        )
        s.add(admin)
        await s.flush()
        token = create_access_token(str(admin.id), "admin")
        await s.commit()
    return token


async def test_endpoint_returns_the_recorded_prompt(client) -> None:
    from tests.conftest import auth_headers

    await _persist("ai_grading", GRADING_PROMPT, "marker-endpoint")
    call = await _call_by_marker("marker-endpoint")
    token = await _admin_token()

    r = await client.get(
        f"/v1/admin/llm-payloads/{call.system_prompt_id}",
        headers=auth_headers(token),
    )
    assert r.status_code == 200
    body = r.json()
    # Byte-identical. A prompt you can only read approximately is not
    # evidence you can debug a grade with.
    assert body["text"] == GRADING_PROMPT
    assert body["kind"] == "system_prompt"
    assert body["char_len"] == len(GRADING_PROMPT)
    assert body["used_by"] >= 1
    # Named for what it holds — a payload can be shared across call sites
    # and only the first writer's function is recorded.
    assert "first_seen_from" in body
    assert "function" not in body


async def test_endpoint_404s_on_an_unknown_id(client) -> None:
    import uuid as _uuid

    from tests.conftest import auth_headers

    token = await _admin_token()
    r = await client.get(
        f"/v1/admin/llm-payloads/{_uuid.uuid4()}", headers=auth_headers(token)
    )
    assert r.status_code == 404


async def test_endpoint_requires_admin(client) -> None:
    """Prompts carry answer keys and teacher rubric notes. A teacher or
    student reaching this would be reading the marking scheme."""
    r = await client.get(f"/v1/admin/llm-payloads/{__import__('uuid').uuid4()}")
    assert r.status_code in (401, 403)
