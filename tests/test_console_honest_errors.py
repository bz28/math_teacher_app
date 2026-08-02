"""The console must be able to tell a broken endpoint from a dead server.

## The bug these pin

An operator opened /teachers/independent and saw:

    "Can't reach the backend. Either Railway is down or the service is
     restarting — check Railway status."

Railway was not down. The server was up and answering every other
request. Two separate defects stacked into that misdiagnosis:

1. `GET /admin/users?role=teacher&no_school=true` raised
   InvalidRequestError. The independent-teacher filter builds an
   EXISTS over `schools`, and one of the queries it is applied to
   already outer-joins `schools`, so SQLAlchemy auto-correlated the
   subquery's only FROM away — leaving a SELECT with no FROM.

2. An unhandled exception propagates past CORSMiddleware, so the 500
   reaching the browser carried NO `access-control-allow-origin`. The
   browser blocks such a response and `fetch` REJECTS, which the
   client cannot distinguish from an unreachable host — so a bug on
   ONE endpoint was reported to operators as a platform outage.

Together they turned "this page has a bug" into "the host is down",
which is the most expensive kind of wrong: it sends people to a status
page instead of the logs.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi import APIRouter
from httpx import AsyncClient
from starlette.testclient import TestClient
from sqlalchemy import text

from api.config import settings
from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.main import app
from api.models.school import (
    SCHOOL_KIND_INDIVIDUAL,
    SCHOOL_KIND_INSTITUTIONAL,
    School,
)
from api.models.user import User
from tests.conftest import auth_headers

# Must be an origin the app is actually configured to allow —
# CORSMiddleware only stamps access-control-allow-origin for those, so
# testing with an unlisted origin would assert nothing about the fix.
ORIGIN = settings.cors_origins[0]


async def _seed_admin_and_indie_teacher() -> str:
    async with get_session_factory()() as s:
        await s.execute(text(
            "TRUNCATE TABLE llm_calls, submission_grades, submissions, "
            "assignments, section_enrollments, sections, units, "
            "course_teachers, courses, teacher_invites, schools, users "
            "RESTART IDENTITY CASCADE"
        ))
        await s.commit()

    async with get_session_factory()() as s:
        admin = User(
            email=f"admin_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"), grade_level=99,
            role="admin", name="Admin",
        )
        # An independent teacher: a real teacher whose school is the
        # synthetic personal container, which is exactly what the
        # failing filter selects for.
        personal = School(
            name="Ms. Indie's classroom", kind=SCHOOL_KIND_INDIVIDUAL,
            contact_name="Indie", contact_email=f"i_{uuid.uuid4().hex[:6]}@t.com",
        )
        # A real school, to prove the filter EXCLUDES institutional staff.
        institutional = School(
            name="Lincoln High", kind=SCHOOL_KIND_INSTITUTIONAL,
            contact_name="C", contact_email=f"c_{uuid.uuid4().hex[:6]}@s.com",
        )
        s.add_all([admin, personal, institutional])
        await s.flush()

        s.add_all([
            User(
                email=f"indie_{uuid.uuid4().hex[:6]}@t.com",
                password_hash=hash_password("x"), grade_level=12,
                role="teacher", name="Ms. Indie", school_id=personal.id,
            ),
            User(
                email=f"staff_{uuid.uuid4().hex[:6]}@t.com",
                password_hash=hash_password("x"), grade_level=12,
                role="teacher", name="Mr. Staff", school_id=institutional.id,
            ),
        ])
        await s.commit()
        return create_access_token(str(admin.id), "admin")


@pytest.mark.asyncio
async def test_independent_teachers_page_loads(client: AsyncClient) -> None:
    """The exact request the Independent teachers page makes.

    This 500'd with InvalidRequestError before the `.correlate(User)`
    fix, which is why the page showed an outage banner.
    """
    token = await _seed_admin_and_indie_teacher()

    res = await client.get(
        "/v1/admin/users?hours=720&sort_by=total_cost&limit=25&offset=0"
        "&role=teacher&no_school=true",
        headers=auth_headers(token),
    )

    assert res.status_code == 200, res.text
    body = res.json()
    names = [u["name"] for u in body["users"]]
    assert "Ms. Indie" in names, "the independent teacher must be listed"
    assert "Mr. Staff" not in names, (
        "a teacher at a real school is not an independent teacher"
    )
    # The aggregates are scope-filtered by the same predicate, so if the
    # EXISTS were silently dropped they would count everyone.
    assert body["total_users"] == 1


@pytest.mark.asyncio
async def test_independent_students_page_loads(client: AsyncClient) -> None:
    """The sibling page takes the other branch of the same filter."""
    token = await _seed_admin_and_indie_teacher()
    res = await client.get(
        "/v1/admin/users?role=student&no_school=true&limit=25",
        headers=auth_headers(token),
    )
    assert res.status_code == 200, res.text


def test_a_crash_still_carries_cors_headers() -> None:
    """A 500 must be a real HTTP response, not a dropped connection.

    Without the catch-all handler the exception escapes past
    CORSMiddleware, the browser blocks the header-less 500, `fetch`
    rejects, and the console reports an outage for a server that is up.

    Uses its own app-level route so it tests the handler rather than
    any particular endpoint's bugs, and Starlette's TestClient with
    `raise_server_exceptions=False` so the client behaves like a real
    browser (receives the response) instead of re-raising into the
    test.
    """
    boom = APIRouter()

    @boom.get("/v1/__test_explode")
    async def _explode() -> dict[str, str]:
        raise RuntimeError("kaboom")

    app.include_router(boom)
    try:
        with TestClient(app, raise_server_exceptions=False) as c:
            res = c.get("/v1/__test_explode", headers={"Origin": ORIGIN})

        assert res.status_code == 500
        # The header is the whole point: without it the browser discards
        # the response and the client cannot tell a bug from an outage.
        assert res.headers.get("access-control-allow-origin") == ORIGIN
        assert res.json()["detail"] == "Something went wrong on our end."
    finally:
        app.router.routes = [
            r for r in app.router.routes
            if getattr(r, "path", None) != "/v1/__test_explode"
        ]
