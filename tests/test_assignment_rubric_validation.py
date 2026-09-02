"""Integration tests for the write contract on `Assignment.rubric`.

The column used to accept any dict at all — no key whitelist, no value
validation, no length cap. Every reader assumes the four fields are
strings: the teacher review page renders them through `MathText`, the
homework page's `normalizeRubric` calls `.trim()` on them, and
`grading_ai._build_rubric_block` interpolates them into a prompt. A list
reaching any of those is a crash rather than a graceful degrade, and a
crash on the review page takes the whole grading surface down behind an
error boundary with no way out from the UI.

These pin the contract that closes it.
"""
from __future__ import annotations

from typing import Any

from httpx import AsyncClient
from sqlalchemy import select

from api.core.constants import MAX_RUBRIC_FIELD_CHARS
from api.database import get_session_factory
from api.models.assignment import Assignment
from api.models.course import CourseTeacher
from tests.conftest import auth_headers as _auth


async def _link_teacher_to_course(teacher_id: Any, course_id: Any) -> None:
    async with get_session_factory()() as s:
        s.add(CourseTeacher(course_id=course_id, teacher_id=teacher_id, role="owner"))
        await s.commit()


async def _course_id_for(assignment_id: Any) -> Any:
    async with get_session_factory()() as s:
        a = (
            await s.execute(select(Assignment).where(Assignment.id == assignment_id))
        ).scalar_one()
        return a.course_id


async def _rubric_of(assignment_id: Any) -> dict[str, Any] | None:
    async with get_session_factory()() as s:
        a = (
            await s.execute(select(Assignment).where(Assignment.id == assignment_id))
        ).scalar_one()
        return a.rubric


async def _patch_rubric(
    client: AsyncClient, world: dict[str, Any], rubric: Any
) -> Any:
    return await client.patch(
        f"/v1/teacher/assignments/{world['assignment_id']}",
        json={"rubric": rubric},
        headers=_auth(world["teacher_token"]),
    )


async def test_patch_rubric_stores_the_four_fields(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    course_id = await _course_id_for(world["assignment_id"])
    await _link_teacher_to_course(world["teacher_id"], course_id)

    res = await _patch_rubric(
        client,
        world,
        {
            "full_credit": "Correct answer with work shown.",
            "partial_credit": "Right method, arithmetic slip.",
            "common_mistakes": "Dropping the negative.",
            "notes": "Half credit if unsimplified.",
        },
    )
    assert res.status_code == 200
    assert await _rubric_of(world["assignment_id"]) == {
        "full_credit": "Correct answer with work shown.",
        "partial_credit": "Right method, arithmetic slip.",
        "common_mistakes": "Dropping the negative.",
        "notes": "Half credit if unsimplified.",
    }


async def test_patch_rubric_rejects_a_list_field(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """The shape that actually caused the crash: a field stored as a list
    of strings rather than one string."""
    course_id = await _course_id_for(world["assignment_id"])
    await _link_teacher_to_course(world["teacher_id"], course_id)

    res = await _patch_rubric(
        client,
        world,
        {"common_mistakes": ["Dropping the negative", "Adding the legs"]},
    )
    assert res.status_code == 422
    assert await _rubric_of(world["assignment_id"]) is None


async def test_patch_rubric_rejects_unknown_keys(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """The rubric editor emits exactly four keys, so anything else is a
    client bug. A 422 says so; silently dropping would lose the
    teacher's writing without telling anyone."""
    course_id = await _course_id_for(world["assignment_id"])
    await _link_teacher_to_course(world["teacher_id"], course_id)

    res = await _patch_rubric(
        client, world, {"full_credit": "ok", "grading_mode": "answer_only"},
    )
    assert res.status_code == 422
    assert await _rubric_of(world["assignment_id"]) is None


async def test_patch_rubric_caps_field_length(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """These four fields are rendered verbatim into the grading prompt,
    so an unbounded field is an unbounded prompt."""
    course_id = await _course_id_for(world["assignment_id"])
    await _link_teacher_to_course(world["teacher_id"], course_id)

    res = await _patch_rubric(
        client, world, {"notes": "x" * (MAX_RUBRIC_FIELD_CHARS + 1)},
    )
    assert res.status_code == 422

    res = await _patch_rubric(
        client, world, {"notes": "x" * MAX_RUBRIC_FIELD_CHARS},
    )
    assert res.status_code == 200


async def test_patch_rubric_drops_blank_fields(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """Mirrors the frontend's `normalizeRubric`: a field cleared in the
    UI shouldn't persist as `""` and make every reader write its own
    falsy check."""
    course_id = await _course_id_for(world["assignment_id"])
    await _link_teacher_to_course(world["teacher_id"], course_id)

    res = await _patch_rubric(
        client, world, {"full_credit": "  Correct answer.  ", "notes": "   "},
    )
    assert res.status_code == 200
    assert await _rubric_of(world["assignment_id"]) == {
        "full_credit": "Correct answer.",
    }


async def test_create_assignment_validates_rubric(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """The create path takes the same model — validating only PATCH
    would leave the front door open."""
    course_id = await _course_id_for(world["assignment_id"])
    await _link_teacher_to_course(world["teacher_id"], course_id)

    res = await client.post(
        f"/v1/teacher/courses/{course_id}/assignments",
        json={
            "title": "Rubric shape check",
            "type": "homework",
            "unit_ids": [str(world["unit_id"])],
            "rubric": {"common_mistakes": ["a", "b"]},
        },
        headers=_auth(world["teacher_token"]),
    )
    assert res.status_code == 422


async def test_patch_rubric_all_blank_stores_null_not_empty_dict(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """An empty rubric and no rubric mean the same thing to every reader,
    and `rubric-sources` already has to filter `{}` back out. Writing one
    would re-create the shape migration cl1000081 exists to remove."""
    course_id = await _course_id_for(world["assignment_id"])
    await _link_teacher_to_course(world["teacher_id"], course_id)

    res = await _patch_rubric(client, world, {"full_credit": "   ", "notes": ""})
    assert res.status_code == 200
    assert await _rubric_of(world["assignment_id"]) is None
