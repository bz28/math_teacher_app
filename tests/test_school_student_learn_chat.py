"""Tests for the Learn-mode chat endpoints and the Practice→Learn pivot.

The three endpoints under test:
- POST /v1/school/student/bank-item/{id}/step-chat
- POST /v1/school/student/bank-item/{id}/problem-chat
- POST /v1/school/student/bank-consumption/learn-this

LLM calls are mocked via the tutor-layer's `call_claude_json` so no
real Claude traffic is generated.
"""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from tests.conftest import auth_headers as _auth


@pytest.fixture(autouse=True)
def _mock_tutor_llm() -> Any:
    """Stub the tutor.call_claude_json so step/problem chat returns a
    deterministic feedback string without hitting Claude."""
    with patch(
        "api.core.tutor.call_claude_json",
        new_callable=AsyncMock,
        return_value={"feedback": "Sure — let me explain."},
    ):
        yield


async def _serve(client: AsyncClient, world: dict[str, Any]) -> dict[str, Any]:
    """Serve the first approved sibling and return the payload."""
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/problems/{world['primary_id']}/next-variation",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200, r.text
    body: dict[str, Any] = r.json()
    return body


async def test_step_chat_happy_path(client: AsyncClient, world: dict[str, Any]) -> None:
    served = await _serve(client, world)
    bank_item_id = served["variation"]["bank_item_id"]

    r = await client.post(
        f"/v1/school/student/bank-item/{bank_item_id}/step-chat",
        headers=_auth(world["student_token"]),
        json={
            "step_index": 0,
            "question": "why factor?",
            "prior_messages": [],
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["reply"] == "Sure — let me explain."


async def test_step_chat_with_prior_messages(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    served = await _serve(client, world)
    bank_item_id = served["variation"]["bank_item_id"]

    r = await client.post(
        f"/v1/school/student/bank-item/{bank_item_id}/step-chat",
        headers=_auth(world["student_token"]),
        json={
            "step_index": 0,
            "question": "still not clear",
            "prior_messages": [
                {"role": "user", "content": "why factor?"},
                {"role": "assistant", "content": "Because..."},
            ],
        },
    )
    assert r.status_code == 200


async def test_step_chat_404_for_outsider(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    served = await _serve(client, world)
    bank_item_id = served["variation"]["bank_item_id"]

    r = await client.post(
        f"/v1/school/student/bank-item/{bank_item_id}/step-chat",
        headers=_auth(world["outsider_token"]),
        json={"step_index": 0, "question": "hi", "prior_messages": []},
    )
    assert r.status_code == 404


async def test_step_chat_400_for_invalid_index(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    served = await _serve(client, world)
    bank_item_id = served["variation"]["bank_item_id"]

    r = await client.post(
        f"/v1/school/student/bank-item/{bank_item_id}/step-chat",
        headers=_auth(world["student_token"]),
        json={"step_index": 99, "question": "hi", "prior_messages": []},
    )
    assert r.status_code == 400


async def test_problem_chat_happy_path(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    served = await _serve(client, world)
    bank_item_id = served["variation"]["bank_item_id"]

    r = await client.post(
        f"/v1/school/student/bank-item/{bank_item_id}/problem-chat",
        headers=_auth(world["student_token"]),
        json={"question": "what's the general trick?", "prior_messages": []},
    )
    assert r.status_code == 200
    assert r.json()["reply"] == "Sure — let me explain."


async def test_problem_chat_404_for_outsider(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    served = await _serve(client, world)
    bank_item_id = served["variation"]["bank_item_id"]

    r = await client.post(
        f"/v1/school/student/bank-item/{bank_item_id}/problem-chat",
        headers=_auth(world["outsider_token"]),
        json={"question": "hi", "prior_messages": []},
    )
    assert r.status_code == 404


async def test_learn_this_creates_learn_context_consumption(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    served = await _serve(client, world)
    bank_item_id = served["variation"]["bank_item_id"]

    r = await client.post(
        "/v1/school/student/bank-consumption/learn-this",
        headers=_auth(world["student_token"]),
        json={
            "bank_item_id": bank_item_id,
            "assignment_id": str(world["assignment_id"]),
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "served"
    # Same variation, not a sibling.
    assert body["variation"]["bank_item_id"] == bank_item_id
    # Anchored on the HW primary.
    assert body["anchor_bank_item_id"] == str(world["primary_id"])


async def test_learn_this_creates_new_row_each_call(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Two calls on the same variation produce two distinct consumption
    rows — one per mode-attempt, so the history tab can list them
    separately. (No unique constraint on the table makes this safe.)"""
    served = await _serve(client, world)
    bank_item_id = served["variation"]["bank_item_id"]

    r1 = await client.post(
        "/v1/school/student/bank-consumption/learn-this",
        headers=_auth(world["student_token"]),
        json={
            "bank_item_id": bank_item_id,
            "assignment_id": str(world["assignment_id"]),
        },
    )
    r2 = await client.post(
        "/v1/school/student/bank-consumption/learn-this",
        headers=_auth(world["student_token"]),
        json={
            "bank_item_id": bank_item_id,
            "assignment_id": str(world["assignment_id"]),
        },
    )
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["consumption_id"] != r2.json()["consumption_id"]


async def test_learn_this_404_for_outsider(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    served = await _serve(client, world)
    bank_item_id = served["variation"]["bank_item_id"]

    r = await client.post(
        "/v1/school/student/bank-consumption/learn-this",
        headers=_auth(world["outsider_token"]),
        json={
            "bank_item_id": bank_item_id,
            "assignment_id": str(world["assignment_id"]),
        },
    )
    assert r.status_code == 404


async def test_learn_this_404_for_invalid_bank_item(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    r = await client.post(
        "/v1/school/student/bank-consumption/learn-this",
        headers=_auth(world["student_token"]),
        json={
            "bank_item_id": str(uuid.uuid4()),
            "assignment_id": str(world["assignment_id"]),
        },
    )
    assert r.status_code == 404


@pytest.mark.parametrize("mode", ["practice", "learn"])
async def test_next_variation_writes_mode_as_context(
    client: AsyncClient, world: dict[str, Any], mode: str
) -> None:
    """next-variation stamps the BankConsumption.context column with
    the mode string so the history tab can tell practice apart from
    learn. Covers both values."""
    from sqlalchemy import text

    from api.database import get_session_factory

    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/problems/{world['primary_id']}/next-variation?mode={mode}",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200
    consumption_id = r.json()["consumption_id"]

    async with get_session_factory()() as s:
        row = (await s.execute(
            text("SELECT context FROM bank_consumption WHERE id=:cid"),
            {"cid": consumption_id},
        )).scalar_one()
    assert row == mode


async def test_step_chat_rejects_oversized_question(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """Guard against cost-abuse via huge inputs. Fix #1 — length caps
    on `question` and `prior_messages[*].content`."""
    served = await _serve(client, world)
    bank_item_id = served["variation"]["bank_item_id"]

    r = await client.post(
        f"/v1/school/student/bank-item/{bank_item_id}/step-chat",
        headers=_auth(world["student_token"]),
        json={
            "step_index": 0,
            "question": "x" * 10_000,
            "prior_messages": [],
        },
    )
    assert r.status_code == 422


async def test_step_chat_rejects_too_many_prior_messages(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    served = await _serve(client, world)
    bank_item_id = served["variation"]["bank_item_id"]

    r = await client.post(
        f"/v1/school/student/bank-item/{bank_item_id}/step-chat",
        headers=_auth(world["student_token"]),
        json={
            "step_index": 0,
            "question": "hi",
            "prior_messages": [
                {"role": "user", "content": "m"} for _ in range(100)
            ],
        },
    )
    assert r.status_code == 422
