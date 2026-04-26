"""Integration tests for the `description` field on PATCH
/v1/teacher/assignments/{id}.

Covers the contract the frontend relies on: trim+collapse-to-null,
2000-char cap, and that description edits are allowed even on
published HWs (parallels rubric — neither changes which problems
students see).
"""
from __future__ import annotations

from typing import Any

from httpx import AsyncClient
from sqlalchemy import select

from api.database import get_session_factory
from api.models.assignment import Assignment
from api.models.course import CourseTeacher
from tests.conftest import auth_headers as _auth


async def _link_teacher_to_course(teacher_id: Any, course_id: Any) -> None:
    """Mirror of the helper in test_teacher_clone_practice.py — the
    `world` fixture seeds the assignment but doesn't create a
    CourseTeacher row, which the PATCH endpoint indirectly requires
    via the teacher-owns-assignment check."""
    async with get_session_factory()() as s:
        s.add(CourseTeacher(course_id=course_id, teacher_id=teacher_id, role="owner"))
        await s.commit()


async def _course_id_for(assignment_id: Any) -> Any:
    async with get_session_factory()() as s:
        a = (
            await s.execute(
                select(Assignment).where(Assignment.id == assignment_id)
            )
        ).scalar_one()
        return a.course_id


async def _description_of(assignment_id: Any) -> str | None:
    async with get_session_factory()() as s:
        a = (
            await s.execute(
                select(Assignment).where(Assignment.id == assignment_id)
            )
        ).scalar_one()
        return a.description


async def _set_status(assignment_id: Any, status: str) -> None:
    async with get_session_factory()() as s:
        a = (
            await s.execute(
                select(Assignment).where(Assignment.id == assignment_id)
            )
        ).scalar_one()
        a.status = status
        await s.commit()


async def test_patch_description_stores_text(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    course_id = await _course_id_for(world["assignment_id"])
    await _link_teacher_to_course(world["teacher_id"], course_id)

    res = await client.patch(
        f"/v1/teacher/assignments/{world['assignment_id']}",
        json={"description": "Show all work, no calculators."},
        headers=_auth(world["teacher_token"]),
    )
    assert res.status_code == 200
    assert await _description_of(world["assignment_id"]) == "Show all work, no calculators."


async def test_patch_empty_description_collapses_to_null(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """Empty string is the frontend's "clear" sentinel — backend trims
    and collapses to NULL so the student page renders no block."""
    course_id = await _course_id_for(world["assignment_id"])
    await _link_teacher_to_course(world["teacher_id"], course_id)

    # Set something first.
    await client.patch(
        f"/v1/teacher/assignments/{world['assignment_id']}",
        json={"description": "hi"},
        headers=_auth(world["teacher_token"]),
    )
    assert await _description_of(world["assignment_id"]) == "hi"

    # Then clear with an empty string.
    res = await client.patch(
        f"/v1/teacher/assignments/{world['assignment_id']}",
        json={"description": ""},
        headers=_auth(world["teacher_token"]),
    )
    assert res.status_code == 200
    assert await _description_of(world["assignment_id"]) is None


async def test_patch_whitespace_only_description_collapses_to_null(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """Trim + collapse ensures whitespace doesn't render as a phantom
    empty block on the student page."""
    course_id = await _course_id_for(world["assignment_id"])
    await _link_teacher_to_course(world["teacher_id"], course_id)

    res = await client.patch(
        f"/v1/teacher/assignments/{world['assignment_id']}",
        json={"description": "   \n\t  "},
        headers=_auth(world["teacher_token"]),
    )
    assert res.status_code == 200
    assert await _description_of(world["assignment_id"]) is None


async def test_patch_description_over_max_length_rejects(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """Backend caps at 2000 chars to defend against non-browser
    callers bloating the column past what the textarea allows."""
    course_id = await _course_id_for(world["assignment_id"])
    await _link_teacher_to_course(world["teacher_id"], course_id)

    res = await client.patch(
        f"/v1/teacher/assignments/{world['assignment_id']}",
        json={"description": "x" * 2001},
        headers=_auth(world["teacher_token"]),
    )
    assert res.status_code == 422
    assert await _description_of(world["assignment_id"]) is None


async def test_patch_description_allowed_on_published_hw(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """Description edits parallel rubric edits — both are allowed on
    published HWs because neither changes the problem set students
    see, only the surrounding context. Title/units/etc. would 400.

    The `world` fixture seeds the assignment as published already, so
    we round-trip draft→published here to make the state transition
    load-bearing rather than incidental to the fixture setup.
    """
    course_id = await _course_id_for(world["assignment_id"])
    await _link_teacher_to_course(world["teacher_id"], course_id)
    await _set_status(world["assignment_id"], "draft")
    await _set_status(world["assignment_id"], "published")

    # Title PATCH should fail on published HW (sanity check on the lock).
    res = await client.patch(
        f"/v1/teacher/assignments/{world['assignment_id']}",
        json={"title": "New title"},
        headers=_auth(world["teacher_token"]),
    )
    assert res.status_code == 400

    # Description PATCH on the same published HW should succeed.
    res = await client.patch(
        f"/v1/teacher/assignments/{world['assignment_id']}",
        json={"description": "Reminder: no calculators."},
        headers=_auth(world["teacher_token"]),
    )
    assert res.status_code == 200
    assert await _description_of(world["assignment_id"]) == "Reminder: no calculators."
