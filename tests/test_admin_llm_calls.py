"""Tests for GET /v1/admin/llm-calls — the operator's search-first call inspector.

Covers the redesign's new server-side capabilities: the free-text search over
prompt in / response out, the function selector, the success/failure toggle, the
session scope (the "session link"), the failing-functions rollup, and the
window-level p95 latency + totals that feed the top strip.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import text

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.llm_call import LLMCall
from api.models.session import Session
from api.models.user import User
from tests.conftest import auth_headers


async def _seed_admin() -> str:
    async with get_session_factory()() as s:
        await s.execute(
            text("TRUNCATE TABLE llm_calls, sessions, users RESTART IDENTITY CASCADE")
        )
        admin = User(email=f"a_{uuid.uuid4().hex[:6]}@t.com", password_hash=hash_password("x"),
                     grade_level=99, role="admin", name="A")
        s.add(admin)
        await s.flush()
        admin_id = str(admin.id)
        await s.commit()
    return admin_id


def _call(
    *, function: str, success: bool, when: datetime,
    input_text: str = "in", output_text: str = "out",
    latency_ms: float = 10.0, session_id: uuid.UUID | None = None,
) -> LLMCall:
    return LLMCall(
        function=function, model="claude-sonnet-4-6",
        input_tokens=1, output_tokens=1, latency_ms=latency_ms, cost_usd=0.01,
        input_text=input_text, output_text=output_text, success=success,
        session_id=session_id, created_at=when,
    )


async def _seed_calls(calls: list[LLMCall]) -> None:
    async with get_session_factory()() as s:
        s.add_all(calls)
        await s.commit()


async def _get(client: AsyncClient, token: str, **params: str) -> dict:
    r = await client.get("/v1/admin/llm-calls", params=params, headers=auth_headers(token))
    assert r.status_code == 200, r.text
    return r.json()


async def test_strip_totals_and_p95(client: AsyncClient) -> None:
    admin_id = await _seed_admin()
    base = datetime.now(UTC) - timedelta(hours=1)
    # Latencies 10..100 → p95 sits near the top of the distribution.
    await _seed_calls([
        _call(function="solve", success=True, when=base, latency_ms=float(i * 10))
        for i in range(1, 11)
    ])
    token = create_access_token(admin_id, "admin")
    body = await _get(client, token, hours="24")
    assert body["total_count_window"] == 10
    assert abs(body["total_cost_window"] - 0.10) < 1e-6
    assert body["p95_latency_ms"] >= 90        # tail latency, not the mean (~55)
    assert body["failure_count"] == 0 and body["failure_rate"] == 0.0


async def test_search_over_input_and_output(client: AsyncClient) -> None:
    admin_id = await _seed_admin()
    base = datetime.now(UTC) - timedelta(minutes=5)
    await _seed_calls([
        _call(function="solve", success=True, when=base, input_text="quadratic formula", output_text="x = 2"),
        _call(function="grade", success=True, when=base, input_text="prompt", output_text="the pythagorean theorem"),
        _call(function="tutor", success=True, when=base, input_text="hello", output_text="world"),
    ])
    token = create_access_token(admin_id, "admin")
    # Matches on INPUT text.
    hit_in = await _get(client, token, hours="24", search="quadratic")
    assert hit_in["total_count"] == 1
    assert hit_in["calls"][0]["function"] == "solve"
    # Matches on OUTPUT text.
    hit_out = await _get(client, token, hours="24", search="pythagorean")
    assert hit_out["total_count"] == 1
    assert hit_out["calls"][0]["function"] == "grade"
    # A wildcard char is escaped → treated literally, matches nothing here.
    none = await _get(client, token, hours="24", search="%")
    assert none["total_count"] == 0


async def test_function_filter_and_success_toggle(client: AsyncClient) -> None:
    admin_id = await _seed_admin()
    base = datetime.now(UTC) - timedelta(minutes=5)
    await _seed_calls([
        _call(function="solve", success=True, when=base),
        _call(function="solve", success=False, when=base),
        _call(function="grade", success=True, when=base),
    ])
    token = create_access_token(admin_id, "admin")
    # Function selector scopes the list + total_count.
    only_solve = await _get(client, token, hours="24", function="solve")
    assert only_solve["total_count"] == 2
    # Failure toggle scopes server-side (folds in the old Failures tab).
    only_failed = await _get(client, token, hours="24", success="false")
    assert only_failed["total_count"] == 1 and only_failed["calls"][0]["success"] is False
    # Combined function + failure.
    solve_failed = await _get(client, token, hours="24", function="solve", success="false")
    assert solve_failed["total_count"] == 1


async def test_failures_by_function_rollup(client: AsyncClient) -> None:
    admin_id = await _seed_admin()
    base = datetime.now(UTC) - timedelta(minutes=5)
    await _seed_calls([
        _call(function="solve", success=False, when=base),
        _call(function="solve", success=False, when=base),
        _call(function="grade", success=False, when=base),
        _call(function="grade", success=True, when=base),
    ])
    token = create_access_token(admin_id, "admin")
    body = await _get(client, token, hours="24")
    rollup = {r["function"]: r["count"] for r in body["failures_by_function"]}
    assert rollup == {"solve": 2, "grade": 1}
    assert body["failure_count"] == 3
    # Regression: avg() of the integer retry_count returns a Decimal; without a
    # float() cast it JSON-encodes as a string ("2.0") and breaks the dashboard's
    # numeric .toFixed(). Every strip/rollup number must be a real JSON number.
    for r in body["failures_by_function"]:
        assert isinstance(r["avg_retries"], (int, float))
    for key in ("p95_latency_ms", "total_cost_window", "failure_rate"):
        assert isinstance(body[key], (int, float)), key


async def test_session_scope(client: AsyncClient) -> None:
    admin_id = await _seed_admin()
    base = datetime.now(UTC) - timedelta(minutes=5)
    sess, other = uuid.uuid4(), uuid.uuid4()
    async with get_session_factory()() as s:
        s.add_all([
            Session(id=sess, problem="p", problem_type="algebra"),
            Session(id=other, problem="p", problem_type="algebra"),
        ])
        await s.commit()
    await _seed_calls([
        _call(function="tutor", success=True, when=base, session_id=sess),
        _call(function="tutor", success=True, when=base, session_id=sess),
        _call(function="solve", success=True, when=base, session_id=other),
    ])
    token = create_access_token(admin_id, "admin")
    body = await _get(client, token, hours="24", session_id=str(sess))
    assert body["total_count"] == 2
    assert all(c["session_id"] == str(sess) for c in body["calls"])


async def test_invalid_session_id_400(client: AsyncClient) -> None:
    admin_id = await _seed_admin()
    token = create_access_token(admin_id, "admin")
    r = await client.get(
        "/v1/admin/llm-calls", params={"session_id": "not-a-uuid"},
        headers=auth_headers(token),
    )
    assert r.status_code == 400
