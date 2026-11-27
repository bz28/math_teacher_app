"""The Calls hub: the attention band, the homework filter, who each row
is for, and the teacher/student pickers.

Reuses the whose-call world from test_llm_attribution (one school, Tess
and Theo teaching Sam and Ola, plus an admin call with no school).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from api.database import get_session_factory
from api.models.assignment import Submission
from api.models.llm_call import LLMCall
from api.routes.admin_llm_attention import attention_items
from tests.conftest import auth_headers
from tests.test_llm_attribution import _call, world  # noqa: F401  (fixture)

pytestmark = pytest.mark.asyncio


async def _get(client: AsyncClient, w: dict[str, Any], url: str, **params: str) -> Any:
    r = await client.get(url, params=params, headers=auth_headers(w["token"]))
    assert r.status_code == 200, r.text
    return r.json()


async def test_rows_say_which_school_teacher_and_student_they_are_for(
    client: AsyncClient, world: dict[str, Any],  # noqa: F811
) -> None:
    body = await _get(client, world, "/v1/admin/llm-calls", hours="24")
    rows = {c["id"]: c for c in body["calls"]}
    grade = rows[world["calls"]["grade"]]
    assert (grade["school_name"], grade["teacher_name"], grade["student_name"]) == (
        "Holy Prep", "Tess", "Sam",
    )
    gen = rows[world["calls"]["gen"]]
    assert (gen["school_name"], gen["teacher_name"], gen["student_name"]) == ("Holy Prep", None, None)
    assert rows[world["calls"]["admin"]]["school_name"] is None


async def test_pickers_list_the_scopes_teachers_and_students(
    client: AsyncClient, world: dict[str, Any],  # noqa: F811
) -> None:
    body = await _get(client, world, "/v1/admin/llm-calls", hours="24", school_id=world["school"])
    assert [t["name"] for t in body["teachers"]] == ["Tess", "Theo"]
    assert [s["name"] for s in body["students"]] == ["Ola", "Sam"]
    internal = await _get(client, world, "/v1/admin/llm-calls", hours="24", school_id="internal")
    assert internal["teachers"] == [] and internal["students"] == []


async def test_homework_filter_is_the_calls_on_its_submissions(
    client: AsyncClient, world: dict[str, Any],  # noqa: F811
) -> None:
    async with get_session_factory()() as s:
        sub = await s.get(Submission, uuid.UUID(str(
            (await s.execute(select(LLMCall.submission_id).where(
                LLMCall.id == uuid.UUID(world["calls"]["grade"])
            ))).scalar_one()
        )))
        assert sub is not None
        assignment_id = str(sub.assignment_id)
    body = await _get(
        client, world, "/v1/admin/llm-calls/summary", hours="24", assignment_id=assignment_id,
    )
    # Only Sam's grading call on Tess's HW — not her own generation call,
    # not the deleted-submission call, not Theo's homework.
    assert (body["calls"], body["spend"]) == (1, 1.0)
    r = await client.get(
        "/v1/admin/llm-calls/summary", params={"assignment_id": "nope"},
        headers=auth_headers(world["token"]),
    )
    assert r.status_code == 400


async def _add(*calls: LLMCall) -> None:
    async with get_session_factory()() as s:
        s.add_all(calls)
        await s.commit()


async def test_attention_band(world: dict[str, Any]) -> None:  # noqa: F811
    now = datetime.now(UTC)
    school = uuid.UUID(world["school"])
    sam = uuid.UUID(world["sam"])

    def at(hours_ago: float, **kw: Any) -> LLMCall:
        return _call(user_id=sam, school_id=school, created_at=now - timedelta(hours=hours_ago), **kw)

    await _add(
        # integrity_extract: 3 of its last 5 failed → failing.
        *[at(1 + i, function="integrity_extract", success=i >= 3, cost_usd=0.0) for i in range(5)],
        # judge: 1 failure in 20 → noise, not flagged.
        *[at(1 + i * 0.5, function="judge", success=i != 0, cost_usd=0.0) for i in range(20)],
        # ai_grading: p95 ~1s the week before, ~12s today.
        *[at(48 + i, function="drawing_check", latency_ms=1000.0, cost_usd=0.0) for i in range(12)],
        *[at(2 + i, function="drawing_check", latency_ms=12000.0, cost_usd=0.0) for i in range(6)],
    )
    async with get_session_factory()() as s:
        items = await attention_items(s, None)
        scoped_elsewhere = await attention_items(s, "internal")

    failing = [i for i in items if i["kind"] == "function_failing"]
    assert [(i["function"], i["failed"], i["of"]) for i in failing] == [("integrity_extract", 3, 5)]

    schools = [i for i in items if i["kind"] == "school_failures"]
    # 3 integrity_extract + 1 judge + the world's failed integrity_agent.
    assert schools == [{
        "kind": "school_failures", "school_id": world["school"],
        "school_name": "Holy Prep", "failed": 5,
    }]

    slow = [i for i in items if i["kind"] == "p95_up"]
    assert [i["function"] for i in slow] == ["drawing_check"]
    assert slow[0]["p95_ms"] == pytest.approx(12000.0)
    assert slow[0]["was_ms"] == pytest.approx(1000.0)

    # Scoped to the Internal bucket, none of the school's trouble shows.
    assert scoped_elsewhere == []


async def test_attention_endpoint_validates_the_school(
    client: AsyncClient, world: dict[str, Any],  # noqa: F811
) -> None:
    body = await _get(client, world, "/v1/admin/llm-calls/attention")
    assert isinstance(body["items"], list)
    r = await client.get(
        "/v1/admin/llm-calls/attention", params={"school_id": "nope"},
        headers=auth_headers(world["token"]),
    )
    assert r.status_code == 400
