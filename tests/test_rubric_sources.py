"""Integration tests for GET /v1/teacher/rubric-sources — the data
source behind the "Copy grading setup from another homework" picker on
the grading-setup card.

Contract the frontend relies on:
  * only the teacher's OWN assignments are returned,
  * only those with a NON-EMPTY rubric (no rubric / `{}` are excluded),
  * each row carries id/title/course_name/type/rubric so the picker can
    label the option and load its rubric on pick.
"""
from __future__ import annotations

from typing import Any

from httpx import AsyncClient
from sqlalchemy import select

from api.database import get_session_factory
from api.models.assignment import Assignment
from tests.conftest import auth_headers as _auth


async def _set_rubric(assignment_id: Any, rubric: dict[str, Any] | None) -> None:
    async with get_session_factory()() as s:
        a = (
            await s.execute(select(Assignment).where(Assignment.id == assignment_id))
        ).scalar_one()
        a.rubric = rubric
        await s.commit()


async def test_rubric_sources_lists_assignment_with_rubric(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    await _set_rubric(
        world["assignment_id"],
        {"full_credit": "Correct final answer with work shown."},
    )

    res = await client.get(
        "/v1/teacher/rubric-sources",
        headers=_auth(world["teacher_token"]),
    )
    assert res.status_code == 200
    sources = res.json()["sources"]
    assert len(sources) == 1
    row = sources[0]
    assert row["id"] == str(world["assignment_id"])
    assert row["title"] == "HW 1"
    assert row["type"] == "homework"
    assert row["course_name"]  # joined from Course
    assert row["rubric"] == {"full_credit": "Correct final answer with work shown."}


async def test_rubric_sources_excludes_assignment_without_rubric(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """The seeded assignment has no rubric → it must not surface as a
    copy source (nothing to reuse)."""
    res = await client.get(
        "/v1/teacher/rubric-sources",
        headers=_auth(world["teacher_token"]),
    )
    assert res.status_code == 200
    assert res.json()["sources"] == []


async def test_rubric_sources_excludes_empty_dict_rubric(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """A stored-but-empty `{}` rubric carries no reusable text, so the
    picker excludes it rather than offering a blank copy."""
    await _set_rubric(world["assignment_id"], {})

    res = await client.get(
        "/v1/teacher/rubric-sources",
        headers=_auth(world["teacher_token"]),
    )
    assert res.status_code == 200
    assert res.json()["sources"] == []


async def test_rubric_sources_is_teacher_gated(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """The route requires a teacher — a student token can't reach it, so
    it never leaks another teacher's rubric data to non-teachers."""
    await _set_rubric(
        world["assignment_id"],
        {"full_credit": "Correct final answer."},
    )

    res = await client.get(
        "/v1/teacher/rubric-sources",
        headers=_auth(world["student_token"]),
    )
    assert res.status_code == 403
