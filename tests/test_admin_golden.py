"""Integration tests for /v1/admin/golden-set — the eval golden-set console.

Covers the health tiles (set size, last run, pass rate, regression alarm),
failures-first serialization, and the curate actions (add / retire / re-run).
The console leads with the regression count, so the regression flag
(prev pass → now fail) gets its own assertion.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select, text

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.golden_case import GoldenCase
from api.models.user import User
from tests.conftest import auth_headers


async def _wipe() -> None:
    async with get_session_factory()() as s:
        await s.execute(text("TRUNCATE TABLE golden_cases RESTART IDENTITY CASCADE"))
        await s.execute(text("TRUNCATE TABLE users CASCADE"))
        await s.commit()


@pytest.fixture
async def seeded() -> dict[str, Any]:
    """Four golden cases (a pass, a fresh fail, a regression, a pending) + a
    retired one, plus an admin token."""
    await _wipe()
    now = datetime.now(UTC)
    run_id = uuid.uuid4()
    async with get_session_factory()() as s:
        admin = User(
            email=f"admin_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"),
            grade_level=99, role="admin", name="Admin",
        )
        s.add(admin)
        s.add_all([
            GoldenCase(
                probe="geometry", name="Passing circle", constraint="draw a circle",
                adversarial=False, last_status="pass", prev_status="pass",
                last_run_at=now, last_model="claude-x", last_run_id=run_id,
                last_output="Passed — output matched the steer.",
            ),
            GoldenCase(
                probe="geometry", name="Regression sliver", constraint="sliver triangle",
                adversarial=True, last_status="fail", prev_status="pass",
                last_run_at=now, last_model="claude-x", last_run_id=run_id,
                last_output="produced shape didn't match the steer",
            ),
            GoldenCase(
                probe="geometry", name="Chronic fail", constraint="bad spec",
                adversarial=True, last_status="fail", prev_status="fail",
                last_run_at=now - timedelta(days=1), last_model="claude-x",
                last_output="1 deterministic check(s) failed",
            ),
            GoldenCase(
                probe="grading", name="Pending case", constraint="new case",
                adversarial=False, last_status="pending",
            ),
            GoldenCase(
                probe="geometry", name="Retired case", constraint="old",
                adversarial=False, last_status="pass", retired=True,
            ),
        ])
        await s.flush()
        token = create_access_token(str(admin.id), "admin")
        await s.commit()
    return {"token": token, "run_id": str(run_id)}


async def test_requires_admin(client: AsyncClient) -> None:
    r = await client.get("/v1/admin/golden-set")
    assert r.status_code in (401, 403)


async def test_tiles_and_regression_alarm(client: AsyncClient, seeded: dict[str, Any]) -> None:
    r = await client.get("/v1/admin/golden-set", headers=auth_headers(seeded["token"]))
    assert r.status_code == 200
    data = r.json()
    stats = data["stats"]
    # 4 active (retired excluded).
    assert stats["set_size"] == 4
    # 3 evaluated (pending excluded), 1 passing.
    assert stats["pass_rate"] == {"passing": 1, "evaluated": 3}
    # Exactly one regression (prev pass → now fail).
    assert stats["regressions"] == 1
    # Last run reflects the most recent eval + its model.
    assert stats["last_run"]["model"] == "claude-x"
    assert stats["last_run"]["at"] is not None

    reg = next(c for c in data["cases"] if c["name"] == "Regression sliver")
    assert reg["is_regression"] is True
    assert reg["last_run_id"] == seeded["run_id"]
    chronic = next(c for c in data["cases"] if c["name"] == "Chronic fail")
    assert chronic["is_regression"] is False  # was already failing


async def test_add_case_starts_pending(client: AsyncClient, seeded: dict[str, Any]) -> None:
    r = await client.post(
        "/v1/admin/golden-set",
        headers=auth_headers(seeded["token"]),
        json={
            "probe": "geometry", "name": "Brand new", "constraint": "a square",
            "adversarial": False, "expected_shapes": ["polygon"], "rationale": "coverage",
        },
    )
    assert r.status_code == 201
    assert r.json()["last_status"] == "pending"

    # Duplicate (probe, name) is rejected.
    dup = await client.post(
        "/v1/admin/golden-set",
        headers=auth_headers(seeded["token"]),
        json={"probe": "geometry", "name": "Brand new", "constraint": "again"},
    )
    assert dup.status_code == 409


async def test_retire_drops_from_set_size(client: AsyncClient, seeded: dict[str, Any]) -> None:
    async with get_session_factory()() as s:
        case = (
            await s.execute(
                select(GoldenCase).where(GoldenCase.name == "Passing circle"),
            )
        ).scalar_one()
        cid = str(case.id)

    r = await client.patch(
        f"/v1/admin/golden-set/{cid}/retire",
        headers=auth_headers(seeded["token"]),
        json={"retired": True},
    )
    assert r.status_code == 200
    assert r.json()["retired"] is True

    after = await client.get("/v1/admin/golden-set", headers=auth_headers(seeded["token"]))
    assert after.json()["stats"]["set_size"] == 3


async def test_rerun_flags_active_cases(client: AsyncClient, seeded: dict[str, Any]) -> None:
    r = await client.post(
        "/v1/admin/golden-set/rerun", headers=auth_headers(seeded["token"]), json={},
    )
    assert r.status_code == 200
    # 4 active cases flagged (retired excluded).
    assert r.json()["requested"] == 4

    data = await client.get("/v1/admin/golden-set", headers=auth_headers(seeded["token"]))
    active = [c for c in data.json()["cases"] if not c["retired"]]
    assert all(c["rerun_requested"] for c in active)
