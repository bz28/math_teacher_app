"""Regression guard for the kind='individual' filter in /v1/admin/schools.

Indie teachers each get a synthetic personal school post-bp1000059;
without the filter, the admin "real schools" list would balloon with
one entry per self-signup. This test seeds one of each kind and
asserts only the institutional row comes back.
"""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.school import SCHOOL_KIND_INDIVIDUAL, SCHOOL_KIND_INSTITUTIONAL, School
from api.models.user import User


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
async def _truncate() -> None:
    async with get_session_factory()() as s:
        await s.execute(text("TRUNCATE TABLE schools, users RESTART IDENTITY CASCADE"))
        await s.commit()


@pytest.mark.asyncio
async def test_admin_schools_list_excludes_individual(client: AsyncClient) -> None:
    tag = uuid.uuid4().hex[:6]
    async with get_session_factory()() as s:
        admin = User(
            email=f"admin_{tag}@t.com",
            password_hash=hash_password("x"),
            grade_level=12,
            role="admin",
            name="A",
        )
        institutional = School(
            name=f"Lincoln High {tag}",
            kind=SCHOOL_KIND_INSTITUTIONAL,
            contact_name="Principal",
            contact_email=f"prin_{tag}@l.com",
        )
        personal = School(
            name=f"Jane Doe's classroom {tag}",
            kind=SCHOOL_KIND_INDIVIDUAL,
            contact_name="Jane Doe",
            contact_email=f"jane_{tag}@t.com",
        )
        s.add_all([admin, institutional, personal])
        await s.commit()
        await s.refresh(admin)
        await s.refresh(institutional)
        admin_id = admin.id
        institutional_id = institutional.id

    token = create_access_token(str(admin_id), "admin")
    resp = await client.get("/v1/admin/schools", headers=auth_headers(token))
    assert resp.status_code == 200, resp.text

    returned_ids = {row["id"] for row in resp.json()["schools"]}
    assert str(institutional_id) in returned_ids
    # The personal school must not appear in the admin "real schools" list.
    returned_kinds = {row.get("name") for row in resp.json()["schools"]}
    assert all("classroom" not in (name or "") for name in returned_kinds)
