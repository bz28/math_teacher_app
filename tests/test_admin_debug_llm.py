"""Tests for POST /v1/admin/llm-calls/{id}/debug — the admin debug-agent button.

Covers the admin gate, the not-configured / not-found paths, and that a valid
admin click fires a GitHub `repository_dispatch` with the call's payload (the
GitHub call is mocked — no network).
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from api.config import settings
from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.llm_call import LLMCall
from api.models.user import User
from api.routes import admin_llm
from tests.conftest import auth_headers


async def _seed() -> tuple[str, str, str]:
    """An admin, a non-admin student, and one LLM call. Returns their ids."""
    async with get_session_factory()() as s:
        await s.execute(text("TRUNCATE TABLE llm_calls, users RESTART IDENTITY CASCADE"))
        admin = User(email=f"a_{uuid.uuid4().hex[:6]}@t.com", password_hash=hash_password("x"),
                     grade_level=99, role="admin", name="A")
        student = User(email=f"s_{uuid.uuid4().hex[:6]}@t.com", password_hash=hash_password("x"),
                       grade_level=8, role="student", name="S")
        s.add_all([admin, student])
        await s.flush()
        call = LLMCall(
            function="decompose", model="claude-sonnet-4-6",
            input_tokens=10, output_tokens=20, latency_ms=100.0, cost_usd=0.01,
            input_text="problem text", output_text=r'{"steps":["$\frac{1}{2}$"]}',
        )
        s.add(call)
        await s.flush()
        ids = (str(admin.id), str(student.id), str(call.id))
        await s.commit()
    return ids


@pytest.fixture(autouse=True)
def _token(monkeypatch: pytest.MonkeyPatch) -> None:
    # Feature on by default for these tests; individual tests override.
    monkeypatch.setattr(settings, "github_dispatch_token", "ghp_test")
    monkeypatch.setattr(settings, "github_repo", "owner/repo")


async def test_non_admin_forbidden(client: AsyncClient) -> None:
    _, student_id, call_id = await _seed()
    token = create_access_token(student_id, "student")
    r = await client.post(f"/v1/admin/llm-calls/{call_id}/debug", headers=auth_headers(token))
    assert r.status_code == 403


async def test_not_configured_returns_503(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    admin_id, _, call_id = await _seed()
    monkeypatch.setattr(settings, "github_dispatch_token", "")
    token = create_access_token(admin_id, "admin")
    r = await client.post(f"/v1/admin/llm-calls/{call_id}/debug", headers=auth_headers(token))
    assert r.status_code == 503


async def test_unknown_call_404(client: AsyncClient) -> None:
    admin_id, _, _ = await _seed()
    token = create_access_token(admin_id, "admin")
    r = await client.post(f"/v1/admin/llm-calls/{uuid.uuid4()}/debug", headers=auth_headers(token))
    assert r.status_code == 404


async def test_dispatch_payload(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    admin_id, _, call_id = await _seed()
    captured: dict[str, object] = {}

    async def fake_dispatch(payload: dict[str, object]) -> int:
        captured["payload"] = payload
        return 204

    monkeypatch.setattr(admin_llm, "_github_dispatch", fake_dispatch)
    token = create_access_token(admin_id, "admin")
    r = await client.post(f"/v1/admin/llm-calls/{call_id}/debug", headers=auth_headers(token))

    assert r.status_code == 200
    assert r.json()["status"] == "dispatched"
    payload = captured["payload"]
    assert payload["call_id"] == call_id
    assert payload["function"] == "decompose"
    assert r"\frac" in payload["output_text"]


async def test_dispatch_rejected_returns_502(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    admin_id, _, call_id = await _seed()

    async def fake_dispatch(payload: dict[str, object]) -> int:
        return 401  # bad token

    monkeypatch.setattr(admin_llm, "_github_dispatch", fake_dispatch)
    token = create_access_token(admin_id, "admin")
    r = await client.post(f"/v1/admin/llm-calls/{call_id}/debug", headers=auth_headers(token))
    assert r.status_code == 502
