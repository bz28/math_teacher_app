import pytest
from httpx import AsyncClient

REGISTER_URL = "/v1/auth/register"
LOGIN_URL = "/v1/auth/login"
REFRESH_URL = "/v1/auth/refresh"
ME_URL = "/v1/auth/me"


def _user(email: str = "test@example.com", password: str = "StrongPass1", grade_level: int = 8) -> dict:
    return {"email": email, "password": password, "name": "Test", "grade_level": grade_level}


@pytest.mark.asyncio
async def test_register_success(client: AsyncClient) -> None:
    resp = await client.post(REGISTER_URL, json=_user("reg@test.com"))
    assert resp.status_code == 201
    data = resp.json()
    assert "access_token" in data
    assert "refresh_token" in data


@pytest.mark.asyncio
async def test_register_duplicate_email(client: AsyncClient) -> None:
    await client.post(REGISTER_URL, json=_user("dup@test.com"))
    resp = await client.post(REGISTER_URL, json=_user("dup@test.com"))
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_register_weak_password(client: AsyncClient) -> None:
    resp = await client.post(REGISTER_URL, json=_user("weak@test.com", password="short"))
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_register_invalid_grade(client: AsyncClient) -> None:
    resp = await client.post(REGISTER_URL, json=_user("grade@test.com", grade_level=99))
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_login_success(client: AsyncClient) -> None:
    await client.post(REGISTER_URL, json=_user("login@test.com"))
    resp = await client.post(LOGIN_URL, json={"email": "login@test.com", "password": "StrongPass1"})
    assert resp.status_code == 200
    assert "access_token" in resp.json()


@pytest.mark.asyncio
async def test_login_wrong_password(client: AsyncClient) -> None:
    await client.post(REGISTER_URL, json=_user("wrongpw@test.com"))
    resp = await client.post(LOGIN_URL, json={"email": "wrongpw@test.com", "password": "WrongPass1"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_login_nonexistent_user(client: AsyncClient) -> None:
    resp = await client.post(LOGIN_URL, json={"email": "noone@test.com", "password": "StrongPass1"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_refresh_token_rotation(client: AsyncClient) -> None:
    reg = await client.post(REGISTER_URL, json=_user("refresh@test.com"))
    refresh_token = reg.json()["refresh_token"]

    # Use refresh token
    resp = await client.post(REFRESH_URL, json={"refresh_token": refresh_token})
    assert resp.status_code == 200
    new_tokens = resp.json()
    assert "access_token" in new_tokens
    assert new_tokens["refresh_token"] != refresh_token

    # Old refresh token should be rejected
    resp2 = await client.post(REFRESH_URL, json={"refresh_token": refresh_token})
    assert resp2.status_code == 401


@pytest.mark.asyncio
async def test_refresh_reuse_invalidates_family(client: AsyncClient) -> None:
    reg = await client.post(REGISTER_URL, json=_user("family@test.com"))
    old_refresh = reg.json()["refresh_token"]

    # Rotate once
    resp = await client.post(REFRESH_URL, json={"refresh_token": old_refresh})
    new_refresh = resp.json()["refresh_token"]

    # Reuse old token (theft detection) — should invalidate family
    await client.post(REFRESH_URL, json={"refresh_token": old_refresh})

    # New token should also be invalidated now
    resp3 = await client.post(REFRESH_URL, json={"refresh_token": new_refresh})
    assert resp3.status_code == 401


@pytest.mark.asyncio
async def test_me_with_valid_token(client: AsyncClient) -> None:
    reg = await client.post(REGISTER_URL, json=_user("me@test.com"))
    token = reg.json()["access_token"]
    resp = await client.get(ME_URL, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["email"] == "me@test.com"
    assert resp.json()["name"] == "Test"
    assert resp.json()["grade_level"] == 8


@pytest.mark.asyncio
async def test_me_without_token(client: AsyncClient) -> None:
    resp = await client.get(ME_URL)
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_me_with_invalid_token(client: AsyncClient) -> None:
    resp = await client.get(ME_URL, headers={"Authorization": "Bearer invalid.token.here"})
    assert resp.status_code == 401


# ── Teacher self-signup ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_teacher_self_signup_no_invite(client: AsyncClient) -> None:
    """A teacher can self-register without any invite token."""
    payload = {
        "email": "solo_teacher@test.com",
        "password": "StrongPass1",
        "name": "Solo Teacher",
        "grade_level": 12,
        "role": "teacher",
    }
    resp = await client.post(REGISTER_URL, json=payload)
    assert resp.status_code == 201, resp.text
    token = resp.json()["access_token"]

    me = await client.get(ME_URL, headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    me_data = me.json()
    assert me_data["role"] == "teacher"
    assert me_data["school_id"] is None


@pytest.mark.asyncio
async def test_teacher_self_signup_persists_school_name(client: AsyncClient) -> None:
    """signup_school_name lands on the user row when provided."""
    from sqlalchemy import select

    from api.database import get_session_factory
    from api.models.user import User

    payload = {
        "email": "with_school@test.com",
        "password": "StrongPass1",
        "name": "Named Teacher",
        "grade_level": 12,
        "role": "teacher",
        "signup_school_name": "Lincoln High School",
    }
    resp = await client.post(REGISTER_URL, json=payload)
    assert resp.status_code == 201, resp.text

    async with get_session_factory()() as session:
        user = (await session.execute(
            select(User).where(User.email == "with_school@test.com")
        )).scalar_one()
        assert user.signup_school_name == "Lincoln High School"


@pytest.mark.asyncio
async def test_teacher_self_signup_school_name_optional(client: AsyncClient) -> None:
    """Omitting signup_school_name leaves the column NULL."""
    from sqlalchemy import select

    from api.database import get_session_factory
    from api.models.user import User

    payload = {
        "email": "noschool_teacher@test.com",
        "password": "StrongPass1",
        "name": "Anon Teacher",
        "grade_level": 12,
        "role": "teacher",
    }
    resp = await client.post(REGISTER_URL, json=payload)
    assert resp.status_code == 201, resp.text

    async with get_session_factory()() as session:
        user = (await session.execute(
            select(User).where(User.email == "noschool_teacher@test.com")
        )).scalar_one()
        assert user.signup_school_name is None


@pytest.mark.asyncio
async def test_join_code_with_teacher_role_forces_student(client: AsyncClient) -> None:
    """role=teacher + a valid join_code must resolve to a student account.

    Regression: with bare role=teacher self-signup now allowed, the
    join_code branch needs its own role-override or a caller could use
    a leaked code to escalate into a teacher attached to that school.
    """
    import uuid
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import select

    from api.database import get_session_factory
    from api.models.course import Course
    from api.models.section import Section
    from api.models.user import User

    tag = uuid.uuid4().hex[:6].upper()
    async with get_session_factory()() as s:
        course = Course(name=f"Algebra {tag}", subject="math")
        s.add(course)
        await s.flush()
        section = Section(
            course_id=course.id,
            name="Period 1",
            join_code=f"JC{tag}",
            join_code_expires_at=datetime.now(UTC) + timedelta(days=7),
        )
        s.add(section)
        await s.commit()

    payload = {
        "email": f"escalate_{tag.lower()}@test.com",
        "password": "StrongPass1",
        "name": "Escalator",
        "grade_level": 8,
        "role": "teacher",
        "join_code": f"JC{tag}",
    }
    resp = await client.post(REGISTER_URL, json=payload)
    assert resp.status_code == 201, resp.text

    async with get_session_factory()() as s:
        user = (await s.execute(
            select(User).where(User.email == payload["email"])
        )).scalar_one()
        assert user.role == "student", "join_code must force student role"


@pytest.mark.asyncio
async def test_student_signup_ignores_school_name(client: AsyncClient) -> None:
    """signup_school_name is teacher-scoped — student rows stay NULL."""
    from sqlalchemy import select

    from api.database import get_session_factory
    from api.models.user import User

    payload = {
        "email": "student_with_school@test.com",
        "password": "StrongPass1",
        "name": "Student",
        "grade_level": 8,
        "role": "student",
        "signup_school_name": "Should Be Ignored",
    }
    resp = await client.post(REGISTER_URL, json=payload)
    assert resp.status_code == 201, resp.text

    async with get_session_factory()() as session:
        user = (await session.execute(
            select(User).where(User.email == "student_with_school@test.com")
        )).scalar_one()
        assert user.signup_school_name is None
