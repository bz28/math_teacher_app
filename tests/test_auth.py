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


@pytest.mark.asyncio
async def test_mfa_pending_token_cannot_authenticate(client: AsyncClient) -> None:
    """The mfa_pending token proves only the password step — it must NOT
    authenticate normal endpoints, or it would defeat the second factor and
    expose the personal-data export at /auth/my-data."""
    from api.core.auth import decode_access_token
    from api.core.mfa import create_pending_token

    reg = await client.post(REGISTER_URL, json=_user("pending@test.com"))
    payload = decode_access_token(reg.json()["access_token"])
    assert payload is not None  # a real access token still decodes
    pending = create_pending_token(str(payload["sub"]))
    for url in (ME_URL, "/v1/auth/my-data"):
        resp = await client.get(url, headers={"Authorization": f"Bearer {pending}"})
        assert resp.status_code == 401, f"{url} accepted the mfa_pending token"


# ── Teacher self-signup ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_teacher_self_signup_no_invite(client: AsyncClient) -> None:
    """A teacher can self-register without an invite — and gets stamped
    with a synthetic 'individual' school so downstream school-aware
    code doesn't have to special-case nulls."""
    from sqlalchemy import select

    from api.database import get_session_factory
    from api.models.school import SCHOOL_KIND_INDIVIDUAL, School
    from api.models.user import User

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
    assert me_data["school_id"] is not None

    async with get_session_factory()() as session:
        user = (await session.execute(
            select(User).where(User.email == "solo_teacher@test.com")
        )).scalar_one()
        school = (await session.execute(
            select(School).where(School.id == user.school_id)
        )).scalar_one()
        assert school.kind == SCHOOL_KIND_INDIVIDUAL
        assert school.name == "Solo Teacher's classroom"


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
async def test_indie_teacher_join_code_stamps_student_with_individual_school(
    client: AsyncClient,
) -> None:
    """The bug this PR fixes end-to-end: an indie teacher signs up,
    creates a course + section + join code; a student joining via that
    code must get the same school_id as the teacher (the synthetic
    'individual' school). Without this, the student lands on the
    consumer homepage instead of /school/student.
    """
    import uuid

    from sqlalchemy import select

    from api.database import get_session_factory
    from api.models.course import Course, CourseTeacher
    from api.models.school import SCHOOL_KIND_INDIVIDUAL, School
    from api.models.section import Section
    from api.models.user import User

    tag = uuid.uuid4().hex[:6].lower()

    teacher_payload = {
        "email": f"indie_{tag}@t.com",
        "password": "StrongPass1",
        "name": "Indie Teacher",
        "grade_level": 12,
        "role": "teacher",
    }
    resp = await client.post(REGISTER_URL, json=teacher_payload)
    assert resp.status_code == 201, resp.text

    teacher_school_id = None
    async with get_session_factory()() as s:
        teacher = (await s.execute(
            select(User).where(User.email == teacher_payload["email"])
        )).scalar_one()
        teacher_school_id = teacher.school_id
        assert teacher_school_id is not None

        course = Course(
            name=f"Indie Course {tag}",
            subject="math",
            school_id=teacher_school_id,
        )
        s.add(course)
        await s.flush()
        s.add(CourseTeacher(
            course_id=course.id, teacher_id=teacher.id, role="owner",
        ))
        section = Section(
            course_id=course.id,
            name="Period 1",
            join_code=f"IND{tag.upper()}",
        )
        s.add(section)
        await s.commit()

    student_payload = {
        "email": f"indie_student_{tag}@t.com",
        "password": "StrongPass1",
        "name": "Student",
        "grade_level": 8,
        "role": "student",
        "join_code": f"IND{tag.upper()}",
    }
    resp = await client.post(REGISTER_URL, json=student_payload)
    assert resp.status_code == 201, resp.text

    async with get_session_factory()() as s:
        student = (await s.execute(
            select(User).where(User.email == student_payload["email"])
        )).scalar_one()
        # Same school as the indie teacher — the fix.
        assert student.school_id == teacher_school_id

        school = (await s.execute(
            select(School).where(School.id == student.school_id)
        )).scalar_one()
        assert school.kind == SCHOOL_KIND_INDIVIDUAL


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


TOUR_SEEN_URL = "/v1/auth/me/tour-seen"


@pytest.mark.asyncio
async def test_tours_seen_defaults_empty(client: AsyncClient) -> None:
    reg = await client.post(REGISTER_URL, json=_user("tour_default@test.com"))
    token = reg.json()["access_token"]
    resp = await client.get(ME_URL, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["tours_seen"] == []


@pytest.mark.asyncio
async def test_mark_tour_seen_records_and_is_idempotent(client: AsyncClient) -> None:
    reg = await client.post(REGISTER_URL, json=_user("tour_mark@test.com"))
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    resp = await client.post(TOUR_SEEN_URL, json={"persona": "teacher"}, headers=headers)
    assert resp.status_code == 204

    me = await client.get(ME_URL, headers=headers)
    assert me.json()["tours_seen"] == ["teacher"]

    # Idempotent — re-marking the same persona doesn't duplicate or error.
    resp2 = await client.post(TOUR_SEEN_URL, json={"persona": "teacher"}, headers=headers)
    assert resp2.status_code == 204
    me2 = await client.get(ME_URL, headers=headers)
    assert me2.json()["tours_seen"] == ["teacher"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "persona",
    [
        "teacher",
        "student",
        "personal",
    ],
)
async def test_mark_tour_seen_accepts_every_persona(
    client: AsyncClient, persona: str
) -> None:
    # Every onboarding key must be markable so each tour stays once-only:
    # the three persona overviews (teacher, school student, personal
    # learner). The teacher overview now walks every workspace tab, so
    # the old per-feature walkthrough keys were retired.
    reg = await client.post(REGISTER_URL, json=_user(f"tour_{persona}@test.com"))
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    resp = await client.post(TOUR_SEEN_URL, json={"persona": persona}, headers=headers)
    assert resp.status_code == 204

    me = await client.get(ME_URL, headers=headers)
    assert me.json()["tours_seen"] == [persona]


@pytest.mark.asyncio
async def test_mark_tour_seen_rejects_unknown_persona(client: AsyncClient) -> None:
    reg = await client.post(REGISTER_URL, json=_user("tour_bad@test.com"))
    token = reg.json()["access_token"]
    resp = await client.post(
        TOUR_SEEN_URL, json={"persona": "astronaut"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_mark_tour_seen_requires_auth(client: AsyncClient) -> None:
    resp = await client.post(TOUR_SEEN_URL, json={"persona": "teacher"})
    assert resp.status_code == 401
