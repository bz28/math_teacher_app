"""Tests for GET /v1/admin/harness-runs — the read path behind the redesigned
'Harness Runs' tab (the AI-quality regression alarm).

Covers the per-probe health band (latest verdict, the vs-previous-run
deterministic delta that drives the REGRESSION flag, recent-not-lifetime judge
score, sparkline, latest-first order), the top-line summary (recent failing
count + folded-in cost + newest_run_at for the staleness warning), and the
server-side probe / failed_only filters that keep pagination honest.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.harness_run import HarnessRun
from api.models.user import User
from tests.conftest import auth_headers


async def _wipe() -> None:
    async with get_session_factory()() as s:
        await s.execute(text("TRUNCATE TABLE harness_runs RESTART IDENTITY CASCADE"))
        await s.execute(text("TRUNCATE TABLE users RESTART IDENTITY CASCADE"))
        await s.commit()


def _run(probe: str, *, minutes_ago: float, passed: bool, det_pass: int,
         det_total: int, judge_mean: float | None = None, cost_usd: float | None = None,
         note: str | None = None) -> HarnessRun:
    return HarnessRun(
        probe=probe, mode="replay",
        items_generated=det_total, det_pass=det_pass, det_total=det_total,
        captures=0, judge_count=3 if judge_mean is not None else 0,
        judge_mean=judge_mean, cost_usd=cost_usd, passed=passed, note=note,
        created_at=datetime.now(UTC) - timedelta(minutes=minutes_ago),
    )


@pytest.fixture
async def admin_token() -> str:
    await _wipe()
    async with get_session_factory()() as s:
        admin = User(
            email=f"admin_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"), grade_level=99, role="admin", name="Admin",
        )
        s.add(admin)
        await s.flush()
        token = create_access_token(str(admin.id), "admin")
        await s.commit()
    return token


async def _seed(runs: list[HarnessRun]) -> None:
    async with get_session_factory()() as s:
        s.add_all(runs)
        await s.commit()


async def test_probe_health_flags_regression(admin_token: str, client: AsyncClient) -> None:
    # geometry regressed on its latest run (8/10, was 10/10); algebra is holding.
    await _seed([
        _run("geometry", minutes_ago=5, passed=False, det_pass=8, det_total=10, judge_mean=4.1),
        _run("geometry", minutes_ago=60, passed=True, det_pass=10, det_total=10, judge_mean=4.6),
        _run("algebra", minutes_ago=10, passed=True, det_pass=6, det_total=6, judge_mean=4.8),
    ])
    r = await client.get("/v1/admin/harness-runs", headers=auth_headers(admin_token))
    assert r.status_code == 200
    body = r.json()

    health = {h["probe"]: h for h in body["probe_health"]}
    geo = health["geometry"]
    assert geo["latest_passed"] is False
    assert (geo["latest_det_pass"], geo["latest_det_total"]) == (8, 10)
    assert (geo["prev_det_pass"], geo["prev_det_total"]) == (10, 10)
    # recent (latest) judge, not the lifetime average of 4.1 and 4.6.
    assert geo["recent_judge_mean"] == 4.1
    # sparkline is oldest→newest deterministic pass-rate.
    assert geo["spark"] == [1.0, 0.8]

    algebra = health["algebra"]
    assert algebra["latest_passed"] is True
    assert algebra["prev_det_pass"] is None  # only one run

    # Latest-first ordering (geometry's newest run is 5m old vs algebra's 10m).
    assert body["probe_health"][0]["probe"] == "geometry"


async def test_summary_counts_and_cost(admin_token: str, client: AsyncClient) -> None:
    await _seed([
        _run("geometry", minutes_ago=5, passed=False, det_pass=8, det_total=10, cost_usd=0.02),
        _run("algebra", minutes_ago=10, passed=True, det_pass=6, det_total=6, cost_usd=None),
    ])
    body = (await client.get("/v1/admin/harness-runs", headers=auth_headers(admin_token))).json()
    summary = body["summary"]
    assert summary["recent_window"] == 2
    assert summary["recent_failing"] == 1
    assert summary["recent_cost"] == 0.02  # None cost folds to 0
    assert summary["probe_count"] == 2
    assert summary["newest_run_at"] is not None


async def test_failed_only_and_probe_filters(admin_token: str, client: AsyncClient) -> None:
    await _seed([
        _run("geometry", minutes_ago=5, passed=False, det_pass=8, det_total=10),
        _run("geometry", minutes_ago=60, passed=True, det_pass=10, det_total=10),
        _run("algebra", minutes_ago=10, passed=True, det_pass=6, det_total=6),
    ])
    # failed_only keeps total_count honest (server-side filter).
    fo = (await client.get(
        "/v1/admin/harness-runs", params={"failed_only": "true"},
        headers=auth_headers(admin_token),
    )).json()
    assert fo["total_count"] == 1
    assert all(not run["passed"] for run in fo["runs"])
    # ...but the health band stays global (all probes still present).
    assert {h["probe"] for h in fo["probe_health"]} == {"geometry", "algebra"}

    # probe filter narrows the rows, not the band.
    pf = (await client.get(
        "/v1/admin/harness-runs", params={"probe": "algebra"},
        headers=auth_headers(admin_token),
    )).json()
    assert pf["total_count"] == 1
    assert all(run["probe"] == "algebra" for run in pf["runs"])


async def test_requires_admin(client: AsyncClient) -> None:
    assert (await client.get("/v1/admin/harness-runs")).status_code == 401
