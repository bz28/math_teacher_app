"""Regression test: the '(solution failed …)' placeholder must not be
approvable as a real answer key.

When automatic step decomposition throws while solving a generated
question, assignment_generation stores SOLUTION_FAILED_SENTINEL as the
bank item's final_answer. It's a truthy string, so the approve gate's
emptiness check let it through — and it would then anchor the integrity
check + AI grading on a non-answer. The approve gate now rejects it.
"""

from __future__ import annotations

from typing import Any

from httpx import AsyncClient
from sqlalchemy import text

from api.core.constants import SOLUTION_FAILED_SENTINEL
from api.database import get_session_factory


async def _link_teacher_to_course(teacher_id: Any, course_id: Any) -> None:
    from api.models.course import CourseTeacher
    async with get_session_factory()() as s:
        s.add(CourseTeacher(course_id=course_id, teacher_id=teacher_id, role="owner"))
        await s.commit()


async def _set_final_answer(item_id: Any, final_answer: str) -> None:
    async with get_session_factory()() as s:
        await s.execute(
            text(
                "UPDATE question_bank_items "
                "SET final_answer=:fa, status='pending' WHERE id=:id"
            ),
            {"fa": final_answer, "id": item_id},
        )
        await s.commit()


async def test_approve_rejects_solution_failed_sentinel(
    client: AsyncClient,
    world: dict[str, Any],
) -> None:
    async with get_session_factory()() as s:
        course_id = (await s.execute(
            text("SELECT course_id FROM assignments WHERE id=:id"),
            {"id": world["assignment_id"]},
        )).scalar_one()
    await _link_teacher_to_course(world["teacher_id"], course_id)

    # Plant the sentinel as the primary's final_answer.
    await _set_final_answer(world["primary_id"], SOLUTION_FAILED_SENTINEL)

    r = await client.post(
        f"/v1/teacher/question-bank/{world['primary_id']}/approve",
        headers={"Authorization": f"Bearer {world['teacher_token']}"},
    )
    assert r.status_code == 400, r.text
    assert "solution failed to generate" in r.json()["detail"]

    # The item must NOT have been flipped to approved.
    async with get_session_factory()() as s:
        item_status = (await s.execute(
            text("SELECT status FROM question_bank_items WHERE id=:id"),
            {"id": world["primary_id"]},
        )).scalar_one()
    assert item_status == "pending"


async def test_approve_accepts_real_final_answer(
    client: AsyncClient,
    world: dict[str, Any],
) -> None:
    """Control: a real final_answer still approves cleanly — the new gate
    only rejects the sentinel, not legitimate answers."""
    async with get_session_factory()() as s:
        course_id = (await s.execute(
            text("SELECT course_id FROM assignments WHERE id=:id"),
            {"id": world["assignment_id"]},
        )).scalar_one()
    await _link_teacher_to_course(world["teacher_id"], course_id)

    await _set_final_answer(world["primary_id"], "x = 2 or x = 3")

    r = await client.post(
        f"/v1/teacher/question-bank/{world['primary_id']}/approve",
        headers={"Authorization": f"Bearer {world['teacher_token']}"},
    )
    assert r.status_code == 200, r.text
