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
