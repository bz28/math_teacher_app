"""A new homework arrives with student-visible instructions already set.

A teacher asked for submission guidance at the top of the student's
homework page. That page already renders her own Instructions block
there, so the guidance goes in as the *default value of that field*
rather than as a second line beside it — one block, her voice, and she
can edit or clear it like any other text she wrote.

Practice is excluded: it has no student-visible instructions surface,
so seeding one would write text nothing renders.
"""

from __future__ import annotations

import uuid
from typing import Any

from httpx import AsyncClient
from sqlalchemy import text

from api.core.constants import DEFAULT_HOMEWORK_INSTRUCTIONS
from api.database import get_session_factory


async def _course_and_unit(world: dict[str, Any]) -> tuple[Any, Any]:
    from api.models.course import CourseTeacher
    async with get_session_factory()() as s:
        course_id = (await s.execute(
            text("SELECT course_id FROM assignments WHERE id=:i"),
            {"i": world["assignment_id"]},
        )).scalar_one()
        unit_id = (await s.execute(
            text("SELECT id FROM units WHERE course_id=:c LIMIT 1"),
            {"c": course_id},
        )).scalar_one()
        s.add(CourseTeacher(
            course_id=course_id, teacher_id=world["teacher_id"], role="owner",
        ))
        await s.commit()
    return course_id, unit_id


def _hdr(world: dict[str, Any]) -> dict[str, str]:
    return {"Authorization": f"Bearer {world['teacher_token']}"}


async def _description(assignment_id: str) -> str | None:
    async with get_session_factory()() as s:
        return (await s.execute(
            text("SELECT description FROM assignments WHERE id=:i"),
            {"i": uuid.UUID(assignment_id)},
        )).scalar_one()


async def test_new_homework_gets_the_default_instructions(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    course_id, unit_id = await _course_and_unit(world)
    r = await client.post(
        f"/v1/teacher/courses/{course_id}/assignments",
        json={
            "title": "HW 8", "type": "homework",
            "unit_ids": [str(unit_id)], "content": {"problems": []},
        },
        headers=_hdr(world),
    )
    assert r.status_code in (200, 201), r.text
    assert await _description(r.json()["id"]) == DEFAULT_HOMEWORK_INSTRUCTIONS


async def test_practice_gets_no_instructions(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """Practice has no student-visible instructions surface — seeding one
    would write text nothing ever renders."""
    course_id, unit_id = await _course_and_unit(world)
    r = await client.post(
        f"/v1/teacher/courses/{course_id}/assignments",
        json={
            "title": "Practice set", "type": "practice",
            "unit_ids": [str(unit_id)], "content": {"problems": []},
        },
        headers=_hdr(world),
    )
    assert r.status_code in (200, 201), r.text
    assert await _description(r.json()["id"]) is None


async def test_the_teacher_can_clear_it(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """A default she cannot remove would be a rule, not a default."""
    course_id, unit_id = await _course_and_unit(world)
    r = await client.post(
        f"/v1/teacher/courses/{course_id}/assignments",
        json={
            "title": "HW 9", "type": "homework",
            "unit_ids": [str(unit_id)], "content": {"problems": []},
        },
        headers=_hdr(world),
    )
    hw_id = r.json()["id"]

    r = await client.patch(
        f"/v1/teacher/assignments/{hw_id}",
        json={"description": ""},
        headers=_hdr(world),
    )
    assert r.status_code == 200, r.text
    assert await _description(hw_id) is None
