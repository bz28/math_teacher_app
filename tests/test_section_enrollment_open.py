"""Join codes admit students until the teacher closes enrollment.

Replaces the old 7-day `join_code_expires_at` timer, which silently
killed every code a week after it was minted — a class runs a semester,
so in practice every established section's code was dead while the
teacher UI still displayed it as live.

Covers the gate on both join paths (the /teacher/join box for an
existing account, and the join_code branch of /auth/register), plus the
teacher-facing toggle that opens and closes it.
"""
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.course import Course, CourseTeacher
from api.models.section import Section
from api.models.section_invite import SectionInvite
from api.models.user import User

from .conftest import auth_headers

JOIN_URL = "/v1/teacher/join"
REGISTER_URL = "/v1/auth/register"


@pytest.fixture
async def open_section() -> dict[str, str]:
    """A teacher-owned course + section with a live join code, and a
    student who hasn't joined yet. UUID-tagged so repeated runs don't
    collide (the DB isn't wiped between tests)."""
    tag = uuid.uuid4().hex[:6].upper()
    async with get_session_factory()() as s:
        teacher = User(
            email=f"eo_teacher_{tag}@t.com",
            password_hash=hash_password("x"),
            grade_level=0,
            role="teacher",
            name="EO Teacher",
        )
        student = User(
            email=f"eo_student_{tag}@t.com",
            password_hash=hash_password("x"),
            grade_level=9,
            role="student",
            name="EO Student",
        )
        s.add_all([teacher, student])
        await s.flush()

        course = Course(name=f"Algebra {tag}", subject="math")
        s.add(course)
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))

        section = Section(course_id=course.id, name="Period 1", join_code=f"EO{tag}")
        s.add(section)
        await s.commit()

        return {
            "tag": tag,
            "code": f"EO{tag}",
            "course_id": str(course.id),
            "section_id": str(section.id),
            "teacher_token": create_access_token(str(teacher.id), "teacher"),
            "student_token": create_access_token(str(student.id), "student"),
        }


def _patch_url(fx: dict[str, str]) -> str:
    return f"/v1/teacher/courses/{fx['course_id']}/sections/{fx['section_id']}"


@pytest.mark.asyncio
async def test_new_section_is_open_and_its_code_admits_students(
    client: AsyncClient, open_section: dict[str, str],
) -> None:
    """A fresh section is open, exposes no expiry field, and its code
    admits a student — the shape the 7-day timer used to break."""
    r = await client.get(
        f"/v1/teacher/courses/{open_section['course_id']}/sections",
        headers=auth_headers(open_section["teacher_token"]),
    )
    assert r.status_code == 200, r.text
    section = next(x for x in r.json()["sections"] if x["id"] == open_section["section_id"])
    assert section["enrollment_open"] is True
    assert "join_code_expires_at" not in section

    joined = await client.post(
        JOIN_URL,
        headers=auth_headers(open_section["student_token"]),
        json={"join_code": open_section["code"]},
    )
    assert joined.status_code == 200, joined.text


@pytest.mark.asyncio
async def test_closing_enrollment_blocks_join_and_reopening_restores_it(
    client: AsyncClient, open_section: dict[str, str],
) -> None:
    teacher = auth_headers(open_section["teacher_token"])

    closed = await client.patch(
        _patch_url(open_section), headers=teacher, json={"enrollment_open": False},
    )
    assert closed.status_code == 200, closed.text

    blocked = await client.post(
        JOIN_URL,
        headers=auth_headers(open_section["student_token"]),
        json={"join_code": open_section["code"]},
    )
    assert blocked.status_code == 403, blocked.text
    assert "closed to new students" in blocked.json()["detail"]

    reopened = await client.patch(
        _patch_url(open_section), headers=teacher, json={"enrollment_open": True},
    )
    assert reopened.status_code == 200, reopened.text

    allowed = await client.post(
        JOIN_URL,
        headers=auth_headers(open_section["student_token"]),
        json={"join_code": open_section["code"]},
    )
    assert allowed.status_code == 200, allowed.text


@pytest.mark.asyncio
async def test_closed_enrollment_blocks_signup_with_join_code(
    client: AsyncClient, open_section: dict[str, str],
) -> None:
    """The signup path gates on the same flag — otherwise a closed
    section is still wide open to anyone without an account yet."""
    await client.patch(
        _patch_url(open_section),
        headers=auth_headers(open_section["teacher_token"]),
        json={"enrollment_open": False},
    )

    resp = await client.post(REGISTER_URL, json={
        "email": f"eo_signup_{open_section['tag'].lower()}@t.com",
        "password": "StrongPass1",
        "name": "Late Arrival",
        "grade_level": 9,
        "join_code": open_section["code"],
    })
    assert resp.status_code == 400, resp.text
    assert "closed to new students" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_rename_does_not_disturb_enrollment_state(
    client: AsyncClient, open_section: dict[str, str],
) -> None:
    """PATCH carries two independent fields now; a rename must not
    silently reopen a section the teacher closed."""
    teacher = auth_headers(open_section["teacher_token"])
    await client.patch(_patch_url(open_section), headers=teacher, json={"enrollment_open": False})

    renamed = await client.patch(_patch_url(open_section), headers=teacher, json={"name": "Period 2"})
    assert renamed.status_code == 200, renamed.text

    detail = await client.get(_patch_url(open_section), headers=teacher)
    assert detail.status_code == 200, detail.text
    assert detail.json()["name"] == "Period 2"
    assert detail.json()["enrollment_open"] is False


@pytest.mark.asyncio
async def test_closed_enrollment_still_honours_email_invites(
    client: AsyncClient, open_section: dict[str, str],
) -> None:
    """Closing enrollment shuts the broadcast channel, not the teacher's
    per-person invites. A code can leak to anyone; an invite is addressed
    to one student and can be revoked on its own, so it keeps working."""
    teacher = auth_headers(open_section["teacher_token"])
    invited_email = f"eo_invited_{open_section['tag'].lower()}@t.com"

    invited = await client.post(
        f"/v1/teacher/courses/{open_section['course_id']}"
        f"/sections/{open_section['section_id']}/invites",
        headers=teacher, json={"email": invited_email},
    )
    assert invited.status_code == 200, invited.text
    # The serializer deliberately withholds the token (it's the secret in
    # the emailed link), so read it back from the row.
    async with get_session_factory()() as s:
        token = (await s.execute(
            select(SectionInvite.token).where(SectionInvite.email == invited_email)
        )).scalar_one()

    await client.patch(
        _patch_url(open_section), headers=teacher, json={"enrollment_open": False},
    )

    # The code is shut...
    blocked = await client.post(
        JOIN_URL,
        headers=auth_headers(open_section["student_token"]),
        json={"join_code": open_section["code"]},
    )
    assert blocked.status_code == 403, blocked.text

    # ...but the invited student still gets in.
    assert (await client.get(f"/v1/auth/invite/section/{token}")).status_code == 200
    signup = await client.post(REGISTER_URL, json={
        "email": invited_email,
        "password": "StrongPass1",
        "name": "Invited Student",
        "grade_level": 9,
        "section_invite_token": token,
    })
    assert signup.status_code == 201, signup.text
