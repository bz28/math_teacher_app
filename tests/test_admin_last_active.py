"""Two founder-approved admin data corrections.

A) `/admin/overview` now returns a real `p95_latency_ms` (Postgres
   percentile_cont over successful-call latency), not just the mean
   that hides the slow tail.
B) `/admin/users` and `/admin/schools` return a unified
   `last_active_at` that folds in `ActivityLog.performed_at`, so an
   actor whose only recent activity is a logged action (a teacher who
   graded/published, with NO session/submission) no longer reads as
   inactive.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.activity_log import ActivityLog
from api.models.llm_call import LLMCall
from api.models.school import SCHOOL_KIND_INSTITUTIONAL, School
from api.models.user import User


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
async def _truncate() -> None:
    async with get_session_factory()() as s:
        await s.execute(text(
            "TRUNCATE TABLE activity_log, llm_calls, sessions, "
            "schools, users RESTART IDENTITY CASCADE"
        ))
        await s.commit()


# ── B) last_active_at folds in ActivityLog ───────────────────────────


@pytest.mark.asyncio
async def test_user_last_active_at_reflects_activity_without_session(
    client: AsyncClient,
) -> None:
    """A teacher who only graded (a logged ActivityLog action, no
    session at all) reports last_active_at from that action — the exact
    gap the session-only `last_active` misses."""
    action_at = datetime.now(UTC) - timedelta(days=2)
    async with get_session_factory()() as s:
        admin = User(email=f"admin_{uuid.uuid4().hex[:6]}@t.com",
                     password_hash=hash_password("x"), grade_level=12,
                     role="admin", name="Admin")
        teacher = User(email=f"teach_{uuid.uuid4().hex[:6]}@t.com",
                       password_hash=hash_password("x"), grade_level=12,
                       role="teacher", name="Grader")
        s.add_all([admin, teacher])
        await s.flush()
        s.add(ActivityLog(
            actor_user_id=teacher.id, actor_role="teacher",
            action="grade.save", target_type="submission",
            performed_at=action_at,
        ))
        await s.commit()
        admin_token = create_access_token(str(admin.id), "admin")
        teacher_id = str(teacher.id)

    resp = await client.get("/v1/admin/users", headers=auth_headers(admin_token))
    assert resp.status_code == 200, resp.text
    row = next(u for u in resp.json()["users"] if u["id"] == teacher_id)

    # No session → the legacy session-only field stays empty …
    assert row["last_active"] is None
    # … but the unified field surfaces the logged action.
    assert row["last_active_at"] is not None
    delta = abs((datetime.fromisoformat(row["last_active_at"]) - action_at).total_seconds())
    assert delta < 2, row["last_active_at"]


@pytest.mark.asyncio
async def test_school_last_active_at_reflects_activity_without_submission(
    client: AsyncClient,
) -> None:
    """A school whose only recent activity is a teacher's logged action
    (grade/publish) — no student submission — reports last_active_at
    from that action, not NULL."""
    action_at = datetime.now(UTC) - timedelta(days=3)
    async with get_session_factory()() as s:
        admin = User(email=f"admin_{uuid.uuid4().hex[:6]}@t.com",
                     password_hash=hash_password("x"), grade_level=12,
                     role="admin", name="Admin")
        school = School(name=f"School {uuid.uuid4().hex[:6]}",
                        kind=SCHOOL_KIND_INSTITUTIONAL, contact_name="C",
                        contact_email=f"c_{uuid.uuid4().hex[:6]}@s.com")
        s.add_all([admin, school])
        await s.flush()
        teacher = User(email=f"teach_{uuid.uuid4().hex[:6]}@t.com",
                       password_hash=hash_password("x"), grade_level=12,
                       role="teacher", name="Grader", school_id=school.id)
        s.add(teacher)
        await s.flush()
        s.add(ActivityLog(
            actor_user_id=teacher.id, actor_role="teacher", school_id=school.id,
            action="grade.publish", target_type="submission",
            performed_at=action_at,
        ))
        await s.commit()
        admin_token = create_access_token(str(admin.id), "admin")
        school_id = str(school.id)

    resp = await client.get("/v1/admin/schools", headers=auth_headers(admin_token))
    assert resp.status_code == 200, resp.text
    row = next(sc for sc in resp.json()["schools"] if sc["id"] == school_id)

    # No submission → the legacy submission-only field stays empty …
    assert row["last_activity_at"] is None
    # … but the unified field surfaces the logged action.
    assert row["last_active_at"] is not None
    delta = abs((datetime.fromisoformat(row["last_active_at"]) - action_at).total_seconds())
    assert delta < 2, row["last_active_at"]


# ── A) real p95 latency ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_overview_p95_latency_computed_and_at_least_median(
    client: AsyncClient,
) -> None:
    """p95 is a real percentile over the successful-call population and
    sits at or above the median — a skewed body-plus-tail distribution
    proves the average would understate it."""
    # 95 fast calls + 5 slow: median ~100ms, but the tail drags p95 up.
    latencies = [100.0] * 95 + [5000.0] * 5
    async with get_session_factory()() as s:
        admin = User(email=f"admin_{uuid.uuid4().hex[:6]}@t.com",
                     password_hash=hash_password("x"), grade_level=12,
                     role="admin", name="Admin")
        s.add(admin)
        await s.flush()
        for lat in latencies:
            s.add(LLMCall(function="decompose", model="claude", input_tokens=1,
                          output_tokens=1, latency_ms=lat, cost_usd=0.0, success=True))
        # A failed call with an extreme latency must NOT enter the
        # percentile population (successful calls only).
        s.add(LLMCall(function="decompose", model="claude", input_tokens=1,
                      output_tokens=1, latency_ms=99999.0, cost_usd=0.0, success=False))
        await s.commit()
        admin_token = create_access_token(str(admin.id), "admin")

    resp = await client.get("/v1/admin/overview", headers=auth_headers(admin_token))
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert "p95_latency_ms" in body
    p95 = body["p95_latency_ms"]
    median = 100.0  # median of the successful population
    assert p95 >= median
    # The tail pulls p95 above the 100ms body — proof it's not just the mode.
    assert p95 > median
    # The failed 99999ms call must be excluded. With 95×100 + 5×5000
    # successful calls, percentile_cont(0.95) ≈ 345ms; if the filter
    # were dropped the failed call would drag p95 up to ≈5000ms. A
    # tight bound below that gap is what actually guards the exclusion.
    assert p95 < 1000.0
