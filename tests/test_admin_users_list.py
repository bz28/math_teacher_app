"""Tests for GET /v1/admin/users — the consolidated role-filtered users
list — plus the admin resend-invite endpoint.

Covers the fields the Users tab depends on:
- role filter scopes rows to a single role
- the School column joins institutional schools, and hides synthetic
  kind='individual' schools (the indie-teacher signal → no school)
- the plan filter narrows by subscription tier
- invite_status: pending → active once a login (refresh token) exists;
  expired when the set-password token has lapsed
- last_login surfaces the most recent refresh token
- resend-invite rotates the token for a pending admin and rejects
  non-admins / already-activated admins / unknown ids
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.school import (
    SCHOOL_KIND_INDIVIDUAL,
    SCHOOL_KIND_INSTITUTIONAL,
    School,
)
from api.models.user import RefreshToken, User


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
async def _truncate() -> None:
    async with get_session_factory()() as s:
        await s.execute(text(
            "TRUNCATE TABLE refresh_tokens, schools, users RESTART IDENTITY CASCADE"
        ))
        await s.commit()


async def _admin_token() -> str:
    async with get_session_factory()() as s:
        admin = User(
            email=f"admin_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"),
            grade_level=0, role="admin", name="Root Admin",
        )
        s.add(admin)
        await s.commit()
        return create_access_token(str(admin.id), "admin")


def _row_for(body: dict, email: str) -> dict:
    matches = [u for u in body["users"] if u["email"] == email]
    assert matches, f"{email} not in {[u['email'] for u in body['users']]}"
    return matches[0]


@pytest.mark.asyncio
async def test_role_filter_and_school_column(client: AsyncClient) -> None:
    token = await _admin_token()
    tag = uuid.uuid4().hex[:6]
    async with get_session_factory()() as s:
        inst = School(
            name="Riverside High", kind=SCHOOL_KIND_INSTITUTIONAL,
            contact_name="C", contact_email=f"c_{tag}@s.com",
        )
        indie = School(
            name="Indie Personal", kind=SCHOOL_KIND_INDIVIDUAL,
            contact_name="C", contact_email=f"i_{tag}@s.com",
        )
        s.add_all([inst, indie])
        await s.flush()
        s.add_all([
            User(email=f"t_inst_{tag}@t.com", password_hash=hash_password("x"),
                 grade_level=0, role="teacher", name="Inst Teacher", school_id=inst.id),
            User(email=f"t_indie_{tag}@t.com", password_hash=hash_password("x"),
                 grade_level=0, role="teacher", name="Indie Teacher", school_id=indie.id),
            User(email=f"stu_{tag}@t.com", password_hash=hash_password("x"),
                 grade_level=8, role="student", name="Solo Student"),
        ])
        await s.commit()

    # role=teacher returns only teachers
    resp = await client.get("/v1/admin/users", params={"role": "teacher"}, headers=auth_headers(token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert {u["role"] for u in body["users"]} == {"teacher"}

    # Institutional school joins onto the row; the synthetic individual
    # school is hidden (indie-teacher signal → no school).
    inst_row = _row_for(body, f"t_inst_{tag}@t.com")
    assert inst_row["school"] == {"id": inst_row["school"]["id"], "name": "Riverside High"}
    indie_row = _row_for(body, f"t_indie_{tag}@t.com")
    assert indie_row["school"] is None

    # role=student excludes the teachers
    resp = await client.get("/v1/admin/users", params={"role": "student"}, headers=auth_headers(token))
    assert {u["role"] for u in resp.json()["users"]} == {"student"}


@pytest.mark.asyncio
async def test_plan_filter(client: AsyncClient) -> None:
    token = await _admin_token()
    tag = uuid.uuid4().hex[:6]
    async with get_session_factory()() as s:
        s.add_all([
            User(email=f"pro_{tag}@t.com", password_hash=hash_password("x"),
                 grade_level=8, role="student", name="Pro", subscription_tier="pro"),
            User(email=f"free_{tag}@t.com", password_hash=hash_password("x"),
                 grade_level=8, role="student", name="Free", subscription_tier="free"),
        ])
        await s.commit()

    resp = await client.get("/v1/admin/users", params={"plan": "pro"}, headers=auth_headers(token))
    assert resp.status_code == 200, resp.text
    emails = {u["email"] for u in resp.json()["users"]}
    assert f"pro_{tag}@t.com" in emails
    assert f"free_{tag}@t.com" not in emails


@pytest.mark.asyncio
async def test_invite_status_and_last_login(client: AsyncClient) -> None:
    token = await _admin_token()
    tag = uuid.uuid4().hex[:6]
    async with get_session_factory()() as s:
        pending = User(
            email=f"pending_{tag}@t.com", password_hash=hash_password("x"),
            grade_level=0, role="admin", name="Pending",
            password_reset_token_hash="tok-pending",
            password_reset_expires=datetime.now(UTC) + timedelta(hours=24),
        )
        expired = User(
            email=f"expired_{tag}@t.com", password_hash=hash_password("x"),
            grade_level=0, role="admin", name="Expired",
            password_reset_token_hash="tok-expired",
            password_reset_expires=datetime.now(UTC) - timedelta(hours=1),
        )
        active = User(
            email=f"active_{tag}@t.com", password_hash=hash_password("x"),
            grade_level=0, role="admin", name="Active",
            password_reset_token_hash="tok-active",
            password_reset_expires=datetime.now(UTC) + timedelta(hours=24),
        )
        s.add_all([pending, expired, active])
        await s.flush()
        # A refresh token = the admin has logged in → active, and drives
        # last_login even though the set-password token is still set.
        s.add(RefreshToken(
            user_id=active.id, token_hash=f"rt-{tag}", family_id=uuid.uuid4(),
            expires_at=datetime.now(UTC) + timedelta(days=7),
        ))
        await s.commit()

    resp = await client.get("/v1/admin/users", params={"role": "admin"}, headers=auth_headers(token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert _row_for(body, f"pending_{tag}@t.com")["invite_status"] == "pending"
    assert _row_for(body, f"expired_{tag}@t.com")["invite_status"] == "expired"
    active_row = _row_for(body, f"active_{tag}@t.com")
    assert active_row["invite_status"] == "active"
    assert active_row["last_login"] is not None


@pytest.mark.asyncio
async def test_resend_invite(client: AsyncClient) -> None:
    token = await _admin_token()
    tag = uuid.uuid4().hex[:6]
    async with get_session_factory()() as s:
        pending = User(
            email=f"pending_{tag}@t.com", password_hash=hash_password("x"),
            grade_level=0, role="admin", name="Pending",
            password_reset_token_hash="original-token",
            password_reset_expires=datetime.now(UTC) + timedelta(hours=1),
        )
        teacher = User(
            email=f"teach_{tag}@t.com", password_hash=hash_password("x"),
            grade_level=0, role="teacher", name="Teacher",
        )
        activated = User(
            email=f"act_{tag}@t.com", password_hash=hash_password("x"),
            grade_level=0, role="admin", name="Activated",
        )
        s.add_all([pending, teacher, activated])
        await s.flush()
        s.add(RefreshToken(
            user_id=activated.id, token_hash=f"rt-{tag}", family_id=uuid.uuid4(),
            expires_at=datetime.now(UTC) + timedelta(days=7),
        ))
        pending_id, teacher_id, activated_id = pending.id, teacher.id, activated.id
        await s.commit()

    # Pending admin → token rotated
    resp = await client.post(f"/v1/admin/users/{pending_id}/resend-invite", headers=auth_headers(token))
    assert resp.status_code == 200, resp.text
    async with get_session_factory()() as s:
        refreshed = await s.get(User, pending_id)
        assert refreshed is not None
        assert refreshed.password_reset_token_hash != "original-token"

    # Non-admin → 400
    resp = await client.post(f"/v1/admin/users/{teacher_id}/resend-invite", headers=auth_headers(token))
    assert resp.status_code == 400, resp.text

    # Already activated (has a refresh token) → 400
    resp = await client.post(f"/v1/admin/users/{activated_id}/resend-invite", headers=auth_headers(token))
    assert resp.status_code == 400, resp.text

    # Unknown id → 404
    resp = await client.post(f"/v1/admin/users/{uuid.uuid4()}/resend-invite", headers=auth_headers(token))
    assert resp.status_code == 404, resp.text
