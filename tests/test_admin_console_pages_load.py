"""Every page of the admin console must at least LOAD.

## Why this exists

The Independent teachers page 500'd on every request and nobody knew.
It shipped broken and stayed broken, because:

  * no test hit `GET /admin/users` with the filter combination that
    page sends (`role=teacher&no_school=true`), and
  * an unhandled 500 reached the browser without a CORS header, so the
    console reported it as an unreachable server rather than an error.

The second half is fixed in `api/middleware/errors.py`. This file
fixes the first: a broad, shallow sweep that requests what each
console page requests and asserts it does not blow up.

## What it is and is not

It is a SMOKE test. It asserts "this endpoint answers", not "the
answer is right" — depth belongs in the per-endpoint suites, which is
where the interesting assertions already live. The bug this exists to
prevent was not a subtly wrong number; it was a page that had never
worked at all.

Breadth is the point: one parametrized case per request the console
makes, so adding a page without covering it is a visible omission
rather than a silent one.

The query strings are copied from `dashboard/src/lib/api.ts` rather
than simplified. `role=teacher&no_school=true` is exactly the pair
that triggered the auto-correlation crash, and a tidied-up
`?role=teacher` would have passed while the real page kept failing.
"""

from __future__ import annotations

import uuid

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
from api.models.user import User
from tests.conftest import auth_headers

# One entry per request an admin console page makes on load, with the
# query string the UI actually sends.
CONSOLE_REQUESTS = [
    # ── Monitor ──
    ("overview", "/v1/admin/overview?hours=720"),
    ("llm-calls", "/v1/admin/llm-calls?hours=720&limit=25&offset=0"),
    ("grading-quality", "/v1/admin/grading-quality?hours=720"),
    ("grading-quality-overrides", "/v1/admin/grading-quality/overrides?hours=720&limit=25"),
    ("generation-quality-summary", "/v1/admin/generation-quality/summary?days=30"),
    ("generation-quality-questions", "/v1/admin/generation-quality/questions?days=30&limit=50"),
    ("generation-jobs", "/v1/admin/generation/jobs?limit=25&offset=0"),
    ("solution-quality", "/v1/admin/quality?hours=720&limit=25"),
    ("harness-runs", "/v1/admin/harness-runs?limit=25"),
    ("golden-set", "/v1/admin/golden-set"),
    # ── Customers ──
    ("schools", "/v1/admin/schools"),
    ("leads", "/v1/admin/leads?limit=25&offset=0"),
    # The two that were broken. The filter pair is the whole point —
    # `role=teacher` alone did not reproduce the crash.
    (
        "independent-teachers",
        "/v1/admin/users?hours=720&sort_by=total_cost&limit=25&offset=0"
        "&role=teacher&no_school=true",
    ),
    (
        "independent-students",
        "/v1/admin/users?hours=720&sort_by=total_cost&limit=25&offset=0"
        "&role=student&no_school=true",
    ),
    # ── System ──
    ("users", "/v1/admin/users?hours=720&limit=25&offset=0"),
    ("users-admins", "/v1/admin/users?hours=720&limit=25&offset=0&role=admin"),
    ("activity", "/v1/admin/activity?hours=720&limit=25"),
    ("audit-timeline", "/v1/admin/audit-logs/timeline?limit=25"),
    ("audit-student-access", "/v1/admin/audit-logs/student-access?limit=25"),
]


@pytest.fixture(scope="module")
def console_ids() -> dict[str, str]:
    return {}


async def _seed() -> str:
    """A minimal but NON-EMPTY world.

    Empty tables are the easy case — several of these endpoints only
    do interesting work once there are rows to join against, and an
    all-empty database would let a broken join pass.
    """
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
        institutional = School(
            name="Lincoln High", kind=SCHOOL_KIND_INSTITUTIONAL,
            contact_name="C", contact_email=f"c_{uuid.uuid4().hex[:6]}@s.com",
        )
        personal = School(
            name="Indie's classroom", kind=SCHOOL_KIND_INDIVIDUAL,
            contact_name="I", contact_email=f"i_{uuid.uuid4().hex[:6]}@s.com",
        )
        s.add_all([admin, institutional, personal])
        await s.flush()

        s.add_all([
            User(
                email=f"staff_{uuid.uuid4().hex[:6]}@t.com",
                password_hash=hash_password("x"), grade_level=12,
                role="teacher", name="Staff Teacher", school_id=institutional.id,
            ),
            User(
                email=f"indie_{uuid.uuid4().hex[:6]}@t.com",
                password_hash=hash_password("x"), grade_level=12,
                role="teacher", name="Indie Teacher", school_id=personal.id,
            ),
            User(
                email=f"stu_{uuid.uuid4().hex[:6]}@t.com",
                password_hash=hash_password("x"), grade_level=9,
                role="student", name="Solo Student",
            ),
        ])
        await s.commit()
        return create_access_token(str(admin.id), "admin")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("page", "url"), CONSOLE_REQUESTS, ids=[p for p, _ in CONSOLE_REQUESTS],
)
async def test_console_page_endpoint_answers(
    client: AsyncClient, page: str, url: str,
) -> None:
    """The request this page makes returns 200, not a 500."""
    token = await _seed()
    res = await client.get(url, headers=auth_headers(token))
    assert res.status_code == 200, (
        f"the {page} page's request failed with {res.status_code}: {res.text[:400]}"
    )


@pytest.mark.asyncio
async def test_every_console_request_requires_admin(client: AsyncClient) -> None:
    """No console endpoint answers an unauthenticated caller.

    Cheap to fold in here: this file already enumerates the console's
    surface, so it is the one place that notices a new page shipping
    without auth.
    """
    for page, url in CONSOLE_REQUESTS:
        res = await client.get(url)
        assert res.status_code in (401, 403), (
            f"{page} answered an unauthenticated request with {res.status_code}"
        )
