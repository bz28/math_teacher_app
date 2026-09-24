"""Workshop step add / delete / reorder via PATCH /question-bank/{id}.

The Workshop editor now sends the whole solution_steps array for every
structural edit, so the PATCH route is the only gate between arbitrary
JSON and every reader downstream (student practice, the integrity
agent's canonical steps, the step-chat tutor). These pin:

- add / delete / reorder each land as one undoable edit and one
  question_edits row (field=solution),
- a reorder moves whole step objects — a step's figure travels with it,
- blank or malformed steps are refused without touching the undo slot,
- deleting the last step stores None (the pipeline's "no steps"),
- locked items refuse step edits.

Origin: a generated problem whose solve failed had zero steps and the
teacher had no way to add any.
"""

from __future__ import annotations

from typing import Any

from httpx import AsyncClient
from sqlalchemy import text

from api.core.constants import SOLUTION_FAILED_SENTINEL
from api.database import get_session_factory

A = {"title": "Factor", "description": "(x-2)(x-3) = 0"}
B = {"title": "Solve", "description": "x = 2 or x = 3"}
FIG = {
    "title": "Draw",
    "description": "Drop the altitude",
    "figure_spec": {"kind": "triangle"},
    "figure_svg": "<svg viewBox='0 0 10 10'></svg>",
}


async def _setup(world: dict[str, Any], steps: list[Any] | None) -> Any:
    """Link the teacher to the course and give the pending item `steps`."""
    from api.models.course import CourseTeacher

    item_id = world["pending_sibling_id"]
    async with get_session_factory()() as s:
        course_id = (await s.execute(
            text("SELECT course_id FROM assignments WHERE id=:id"),
            {"id": world["assignment_id"]},
        )).scalar_one()
        s.add(CourseTeacher(course_id=course_id, teacher_id=world["teacher_id"], role="owner"))
        await s.commit()
    async with get_session_factory()() as s:
        from api.models.question_bank import QuestionBankItem

        item = await s.get(QuestionBankItem, item_id)
        assert item is not None
        item.solution_steps = steps
        await s.commit()
    return item_id


async def _row(item_id: Any) -> dict[str, Any]:
    async with get_session_factory()() as s:
        r = (await s.execute(
            text(
                "SELECT solution_steps, previous_solution_steps, previous_question "
                "FROM question_bank_items WHERE id=:id"
            ),
            {"id": item_id},
        )).one()
        edits = (await s.execute(
            text("SELECT field, kind FROM question_edits WHERE bank_item_id=:id"),
            {"id": item_id},
        )).all()
    return {
        "steps": r[0],
        "previous_steps": r[1],
        "has_undo": r[2] is not None,
        "edits": [(e[0], e[1]) for e in edits],
    }


async def _patch(client: AsyncClient, world: dict[str, Any], item_id: Any, steps: Any) -> Any:
    return await client.patch(
        f"/v1/teacher/question-bank/{item_id}",
        json={"solution_steps": steps},
        headers={"Authorization": f"Bearer {world['teacher_token']}"},
    )


async def test_add_first_step_to_an_item_with_none(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """The prod case: a failed solve left the item with no steps."""
    item_id = await _setup(world, None)

    r = await _patch(client, world, item_id, [A])
    assert r.status_code == 200, r.text
    assert r.json()["solution_steps"] == [A]

    row = await _row(item_id)
    assert row["steps"] == [A]
    assert row["previous_steps"] is None  # undo restores "no steps"
    assert row["has_undo"]
    assert row["edits"] == [("solution", "edit_manual")]


async def test_reorder_moves_whole_steps_and_keeps_figures(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    item_id = await _setup(world, [A, FIG, B])

    r = await _patch(client, world, item_id, [FIG, A, B])
    assert r.status_code == 200, r.text

    row = await _row(item_id)
    assert row["steps"] == [FIG, A, B]
    assert row["steps"][0]["figure_svg"] == FIG["figure_svg"]
    assert row["steps"][0]["figure_spec"] == FIG["figure_spec"]
    assert row["previous_steps"] == [A, FIG, B]
    # One PATCH, one question_edits row — not one per moved step.
    assert row["edits"] == [("solution", "edit_manual")]


async def test_delete_a_step(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    item_id = await _setup(world, [A, FIG, B])

    r = await _patch(client, world, item_id, [A, B])
    assert r.status_code == 200, r.text
    row = await _row(item_id)
    assert row["steps"] == [A, B]
    assert row["previous_steps"] == [A, FIG, B]
    assert row["edits"] == [("solution", "edit_manual")]


async def test_deleting_the_last_step_stores_none(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    item_id = await _setup(world, [A])

    r = await _patch(client, world, item_id, [])
    assert r.status_code == 200, r.text
    assert r.json()["solution_steps"] is None
    row = await _row(item_id)
    assert row["steps"] is None
    assert row["previous_steps"] == [A]


async def test_revert_restores_steps_before_a_structural_edit(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    item_id = await _setup(world, [A, FIG, B])
    assert (await _patch(client, world, item_id, [B])).status_code == 200

    r = await client.post(
        f"/v1/teacher/question-bank/{item_id}/revert",
        headers={"Authorization": f"Bearer {world['teacher_token']}"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["solution_steps"] == [A, FIG, B]


async def test_titles_and_descriptions_are_trimmed(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    item_id = await _setup(world, None)

    r = await _patch(client, world, item_id, [{"title": "  Factor ", "description": "x\n"}])
    assert r.status_code == 200, r.text
    assert (await _row(item_id))["steps"] == [{"title": "Factor", "description": "x"}]

    # A title-only step is a real step.
    r = await _patch(client, world, item_id, [{"title": "Check", "description": ""}])
    assert r.status_code == 200, r.text


async def test_blank_or_malformed_steps_are_refused_without_losing_undo(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    item_id = await _setup(world, [A])
    # Establish an undo snapshot the bad PATCHes must not clobber.
    assert (await _patch(client, world, item_id, [A, B])).status_code == 200

    for bad in (
        [A, {"title": "  ", "description": ""}],
        [A, {"title": None, "description": None}],
        [A, None],
        [A, "just a string"],
        [{"title": 3, "description": "x"}],
    ):
        r = await _patch(client, world, item_id, bad)
        assert r.status_code == 400, (bad, r.text)

    row = await _row(item_id)
    assert row["steps"] == [A, B]
    assert row["previous_steps"] == [A]
    assert row["edits"] == [("solution", "edit_manual")]


async def test_locked_item_refuses_step_edits(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    item_id = await _setup(world, [A])
    async with get_session_factory()() as s:
        await s.execute(
            text("UPDATE question_bank_items SET locked=true WHERE id=:id"),
            {"id": item_id},
        )
        await s.commit()

    r = await _patch(client, world, item_id, [A, B])
    assert r.status_code == 409, r.text
    row = await _row(item_id)
    assert row["steps"] == [A]
    assert row["edits"] == []


async def test_failed_solve_item_becomes_approvable_after_manual_fix(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """End to end for the prod report: sentinel answer + no steps →
    teacher adds a step and types the answer → approve succeeds."""
    item_id = await _setup(world, None)
    async with get_session_factory()() as s:
        await s.execute(
            text("UPDATE question_bank_items SET final_answer=:fa WHERE id=:id"),
            {"fa": SOLUTION_FAILED_SENTINEL, "id": item_id},
        )
        await s.commit()
    hdr = {"Authorization": f"Bearer {world['teacher_token']}"}

    r = await client.post(f"/v1/teacher/question-bank/{item_id}/approve", headers=hdr)
    assert r.status_code == 400

    assert (await _patch(client, world, item_id, [A, B])).status_code == 200
    r = await client.patch(
        f"/v1/teacher/question-bank/{item_id}",
        json={"final_answer": "x = 6 or x = 7"},
        headers=hdr,
    )
    assert r.status_code == 200, r.text

    r = await client.post(f"/v1/teacher/question-bank/{item_id}/approve", headers=hdr)
    assert r.status_code == 200, r.text
