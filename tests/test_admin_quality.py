"""Integration tests for the admin solution-quality report.

Seeds sessions (across subjects + modes) with judge scores — some
passing, some failing, plus one weak subject and a score in the prior
window — then exercises /v1/admin/quality and the drill-in detail
endpoint:

- Window summary: pass rate, prior-window delta, coverage, failed count
- Trend buckets and by-subject / by-mode breakdowns (worst-first)
- Evaluations list defaults worst-first (failures on top)
- only_failed scopes the list but NOT the headline summary
- Detail endpoint returns problem + steps + judge verdict; 404 on miss
- Non-admin tokens are rejected
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.quality_score import QualityScore
from api.models.session import Session
from api.models.user import User
from tests.conftest import auth_headers


async def _wipe() -> None:
    async with get_session_factory()() as s:
        await s.execute(text("TRUNCATE TABLE quality_scores, sessions, users RESTART IDENTITY CASCADE"))
        await s.commit()


def _session(
    *, subject: str, mode: str, problem: str, created_at: datetime,
    problem_type: str = "algebra",
) -> Session:
    return Session(
        problem=problem,
        problem_type=problem_type,
        subject=subject,
        mode=mode,
        steps=[{"title": "Step 1", "description": "Do the thing", "final_answer": "42"}],
        total_steps=1,
        created_at=created_at,
    )


def _score(*, session_id: uuid.UUID, dims: tuple[int, int, int, int], created_at: datetime) -> QualityScore:
    c, o, cl, f = dims
    return QualityScore(
        session_id=session_id,
        correctness=c, optimality=o, clarity=cl, flow=f,
        passed=all(x >= 4 for x in dims),
        issues=None if all(x >= 4 for x in dims) else "weak reasoning",
        created_at=created_at,
    )


@pytest.fixture
async def quality_world() -> dict[str, Any]:
    """Seed: 3 math sessions (2 pass, 1 fail), 1 chemistry session (fail —
    the weak subject), all in the last 24h, plus one passing math score in
    the prior 24-48h window so the delta has something to compare to."""
    await _wipe()
    now = datetime.now(UTC)
    in_window = now - timedelta(hours=2)
    prior_window = now - timedelta(hours=36)

    async with get_session_factory()() as s:
        admin = User(email=f"a_{uuid.uuid4().hex[:6]}@t.com", password_hash=hash_password("x"),
                     grade_level=12, role="admin", name="Admin")
        student = User(email=f"s_{uuid.uuid4().hex[:6]}@t.com", password_hash=hash_password("x"),
                       grade_level=8, role="student", name="Stu")
        s.add_all([admin, student])
        await s.flush()

        sessions = [
            _session(subject="math", mode="learn", problem="Solve x^2-5x+6=0", created_at=in_window),
            _session(subject="math", mode="practice", problem="Differentiate x^3", created_at=in_window),
            _session(subject="math", mode="learn", problem="Bad math solution", created_at=in_window),
            _session(subject="chemistry", mode="learn", problem="Balance H2 + O2", created_at=in_window),
            _session(subject="math", mode="learn", problem="Older passing session", created_at=prior_window),
        ]
        s.add_all(sessions)
        await s.flush()

        scores = [
            _score(session_id=sessions[0].id, dims=(5, 5, 5, 5), created_at=in_window),  # pass
            _score(session_id=sessions[1].id, dims=(4, 4, 4, 4), created_at=in_window),  # pass
            _score(session_id=sessions[2].id, dims=(2, 3, 3, 2), created_at=in_window),  # FAIL (worst)
            _score(session_id=sessions[3].id, dims=(3, 4, 4, 3), created_at=in_window),  # FAIL (chemistry)
            _score(session_id=sessions[4].id, dims=(5, 5, 5, 5), created_at=prior_window),  # prior pass
        ]
        s.add_all(scores)
        await s.commit()

        return {
            "admin_token": create_access_token(str(admin.id), "admin"),
            "student_token": create_access_token(str(student.id), "student"),
            "worst_session_id": str(sessions[2].id),
            "bare_session_id": str(sessions[3].id),
        }


async def test_quality_summary_and_delta(client: AsyncClient, quality_world: dict[str, Any]) -> None:
    r = await client.get("/v1/admin/quality", params={"hours": 24},
                         headers=auth_headers(quality_world["admin_token"]))
    assert r.status_code == 200
    summary = r.json()["summary"]
    # 4 in-window scores, 2 passing → 50%.
    assert summary["total"] == 4
    assert summary["passed"] == 2
    assert summary["failed"] == 2
    assert summary["pass_rate"] == 50.0
    # Prior window: 1 score, passing → 100%. Delta is negative.
    assert summary["prior_pass_rate"] == 100.0
    assert summary["prior_total"] == 1
    # Coverage: 4 evaluated of 4 sessions created in-window (100%).
    assert summary["total_sessions"] == 4
    assert summary["coverage_pct"] == 100.0


async def test_breakdowns_worst_first(client: AsyncClient, quality_world: dict[str, Any]) -> None:
    r = await client.get("/v1/admin/quality", params={"hours": 24},
                         headers=auth_headers(quality_world["admin_token"]))
    body = r.json()
    subjects = {b["name"]: b for b in body["by_subject"]}
    assert subjects["chemistry"]["pass_rate"] == 0.0
    assert subjects["math"]["pass_rate"] == pytest.approx(66.7, abs=0.1)
    # Worst subject (chemistry, 0%) sorts first.
    assert body["by_subject"][0]["name"] == "chemistry"
    # Mode breakdown present with both learn and practice.
    modes = {b["name"] for b in body["by_mode"]}
    assert {"learn", "practice"} <= modes
    # Trend has at least one day bucket.
    assert len(body["trend"]) >= 1
    assert all("pass_rate" in d and "evaluated" in d for d in body["trend"])


async def test_scores_worst_first_and_chips(client: AsyncClient, quality_world: dict[str, Any]) -> None:
    r = await client.get("/v1/admin/quality", params={"hours": 24},
                         headers=auth_headers(quality_world["admin_token"]))
    scores = r.json()["scores"]
    assert len(scores) == 4
    # Failures on top; the very worst (summed 10) is first.
    assert scores[0]["passed"] is False
    assert scores[0]["session_id"] == quality_world["worst_session_id"]
    # Rows carry subject/mode chips + the session deep-link.
    assert scores[0]["subject"] in {"math", "chemistry"}
    assert scores[0]["mode"] in {"learn", "practice"}


async def test_only_failed_scopes_list_not_summary(client: AsyncClient, quality_world: dict[str, Any]) -> None:
    r = await client.get("/v1/admin/quality", params={"hours": 24, "only_failed": "true"},
                         headers=auth_headers(quality_world["admin_token"]))
    body = r.json()
    # List is filtered to the 2 failures…
    assert body["total_count"] == 2
    assert all(s["passed"] is False for s in body["scores"])
    # …but the summary still reflects the whole window.
    assert body["summary"]["total"] == 4
    assert body["summary"]["pass_rate"] == 50.0


async def test_session_detail_drill_in(client: AsyncClient, quality_world: dict[str, Any]) -> None:
    sid = quality_world["worst_session_id"]
    r = await client.get(f"/v1/admin/quality/{sid}",
                         headers=auth_headers(quality_world["admin_token"]))
    assert r.status_code == 200
    body = r.json()
    assert body["session"]["id"] == sid
    assert body["session"]["problem"] == "Bad math solution"
    assert len(body["session"]["steps"]) == 1
    assert body["session"]["steps"][0]["description"] == "Do the thing"
    assert body["score"]["passed"] is False
    assert body["score"]["issues"] == "weak reasoning"


async def test_session_detail_404(client: AsyncClient, quality_world: dict[str, Any]) -> None:
    r = await client.get(f"/v1/admin/quality/{uuid.uuid4()}",
                         headers=auth_headers(quality_world["admin_token"]))
    assert r.status_code == 404


async def test_requires_admin(client: AsyncClient, quality_world: dict[str, Any]) -> None:
    r = await client.get("/v1/admin/quality",
                         headers=auth_headers(quality_world["student_token"]))
    assert r.status_code == 403
