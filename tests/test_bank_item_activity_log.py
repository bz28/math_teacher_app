"""Question-bank mutations leave an activity-log trace.

The bug this guards: the generation-quality board reads REJECTED
straight off `question_bank_items.status`, but only /approve and
/reject logged a status change. /revert restores the pre-edit snapshot
INCLUDING `previous_status`, so Undo could move an item back to
rejected with nothing on the timeline — the board and the timeline
would then contradict each other about the same item, with no row
anywhere explaining which one was stale.

Eight mutations recorded nothing. These tests pin the two that change
what an operator concludes (revert's status restore, delete's
vanishing row) plus the edit/retag split, and assert the metadata
contract: ids / titles / counts, never chat text or student content.
"""

from __future__ import annotations

from typing import Any

from httpx import AsyncClient
from sqlalchemy import text

from api.database import get_session_factory


async def _link_teacher_to_course(teacher_id: Any, course_id: Any) -> None:
    from api.models.course import CourseTeacher
    async with get_session_factory()() as s:
        s.add(CourseTeacher(course_id=course_id, teacher_id=teacher_id, role="owner"))
        await s.commit()


async def _setup(world: dict[str, Any]) -> None:
    async with get_session_factory()() as s:
        course_id = (await s.execute(
            text("SELECT course_id FROM assignments WHERE id=:id"),
            {"id": world["assignment_id"]},
        )).scalar_one()
    await _link_teacher_to_course(world["teacher_id"], course_id)


async def _actions(item_id: Any) -> list[tuple[str, dict[str, Any] | None]]:
    """Every activity row for one bank item, oldest first."""
    async with get_session_factory()() as s:
        rows = (await s.execute(
            text(
                "SELECT action, action_metadata FROM activity_log "
                "WHERE target_id=:id ORDER BY performed_at, action"
            ),
            {"id": item_id},
        )).all()
    return [(r[0], r[1]) for r in rows]


def _hdr(world: dict[str, Any]) -> dict[str, str]:
    return {"Authorization": f"Bearer {world['teacher_token']}"}


async def test_revert_records_the_status_it_restored(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """The headline case. A rejected item is edited, then approved, then
    undone — Undo silently puts it back to `rejected`, which is what the
    quality board reads. Without a row here the board says REJECTED while
    the timeline's last status event says approve."""
    await _setup(world)
    item_id = world["pending_sibling_id"]
    async with get_session_factory()() as s:
        await s.execute(
            text("UPDATE question_bank_items SET status='rejected' WHERE id=:id"),
            {"id": item_id},
        )
        await s.commit()

    # Edit the question — snapshot_history captures status='rejected'.
    r = await client.patch(
        f"/v1/teacher/question-bank/{item_id}",
        json={"question": "Solve x^2 - 13x + 42 = 0 by factoring"},
        headers=_hdr(world),
    )
    assert r.status_code == 200, r.text

    r = await client.post(
        f"/v1/teacher/question-bank/{item_id}/approve", headers=_hdr(world),
    )
    assert r.status_code == 200, r.text

    r = await client.post(
        f"/v1/teacher/question-bank/{item_id}/revert", headers=_hdr(world),
    )
    assert r.status_code == 200, r.text

    # The item is back to rejected …
    async with get_session_factory()() as s:
        assert (await s.execute(
            text("SELECT status FROM question_bank_items WHERE id=:id"),
            {"id": item_id},
        )).scalar_one() == "rejected"

    # … and the timeline says so, in the same order it happened.
    actions = _names(await _actions(item_id))
    assert actions == [
        "bank_item.edit", "bank_item.approve", "bank_item.revert",
    ], actions
    revert_meta = dict(await _actions(item_id))["bank_item.revert"]
    assert revert_meta is not None
    assert revert_meta["restored_status"] == "rejected"


async def test_revert_that_does_not_move_status_says_so(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """Control: an Undo that only restores prose reports no status move,
    so the row can't be misread as a hidden re-reject."""
    await _setup(world)
    item_id = world["pending_sibling_id"]

    await client.patch(
        f"/v1/teacher/question-bank/{item_id}",
        json={"question": "Solve x^2 - 13x + 42 = 0 by factoring"},
        headers=_hdr(world),
    )
    r = await client.post(
        f"/v1/teacher/question-bank/{item_id}/revert", headers=_hdr(world),
    )
    assert r.status_code == 200, r.text

    revert_meta = dict(await _actions(item_id))["bank_item.revert"]
    assert revert_meta is not None
    assert revert_meta["restored_status"] is None


async def test_content_edit_and_metadata_retag_are_different_actions(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    await _setup(world)
    item_id = world["pending_sibling_id"]

    r = await client.patch(
        f"/v1/teacher/question-bank/{item_id}",
        json={"final_answer": "x = 6, x = 7"},
        headers=_hdr(world),
    )
    assert r.status_code == 200, r.text

    r = await client.patch(
        f"/v1/teacher/question-bank/{item_id}",
        json={"difficulty": "hard"},
        headers=_hdr(world),
    )
    assert r.status_code == 200, r.text

    rows = await _actions(item_id)
    assert _names(rows) == ["bank_item.edit", "bank_item.retag"], rows
    edit_meta, retag_meta = rows[0][1], rows[1][1]
    assert edit_meta is not None and retag_meta is not None
    assert edit_meta["fields"] == ["final_answer"]
    assert retag_meta["difficulty"] == "hard"
    # Titles are allowed metadata; question/solution prose is not.
    assert "question" not in retag_meta and "question" not in edit_meta


async def test_patch_that_changes_nothing_records_nothing(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """A re-save of identical values is not an edit. Logging it would put
    a phantom entry on a timeline read to explain why an item looks the
    way it does."""
    await _setup(world)
    item_id = world["pending_sibling_id"]
    async with get_session_factory()() as s:
        question = (await s.execute(
            text("SELECT question FROM question_bank_items WHERE id=:id"),
            {"id": item_id},
        )).scalar_one()

    r = await client.patch(
        f"/v1/teacher/question-bank/{item_id}",
        json={"question": question, "difficulty": "medium"},
        headers=_hdr(world),
    )
    assert r.status_code == 200, r.text
    assert await _actions(item_id) == []


async def test_delete_is_recorded_before_the_row_goes(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """target_id has no FK, so the row survives the delete — but the title
    only survives if it was captured before."""
    await _setup(world)
    item_id = world["pending_sibling_id"]

    r = await client.delete(
        f"/v1/teacher/question-bank/{item_id}", headers=_hdr(world),
    )
    assert r.status_code == 200, r.text

    async with get_session_factory()() as s:
        assert (await s.execute(
            text("SELECT count(*) FROM question_bank_items WHERE id=:id"),
            {"id": item_id},
        )).scalar_one() == 0

    rows = await _actions(item_id)
    assert _names(rows) == ["bank_item.delete"], rows
    assert rows[0][1] is not None
    assert rows[0][1]["title"] == "Sib pending"


async def test_workshop_discard_is_attributed_to_the_teacher(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """discard took no current_user before this change, so it had no actor
    to attribute — the row must now name one."""
    await _setup(world)
    item_id = world["pending_sibling_id"]
    async with get_session_factory()() as s:
        await s.execute(
            text("UPDATE question_bank_items SET chat_messages=:m WHERE id=:id"),
            {
                "m": '[{"role": "ai", "content": "try this", '
                     '"proposal": {"question": "Solve x^2 = 4"}}]',
                "id": item_id,
            },
        )
        await s.commit()

    r = await client.post(
        f"/v1/teacher/question-bank/{item_id}/chat/discard",
        json={"message_index": 0},
        headers=_hdr(world),
    )
    assert r.status_code == 200, r.text

    async with get_session_factory()() as s:
        actor = (await s.execute(
            text(
                "SELECT actor_user_id FROM activity_log "
                "WHERE target_id=:id AND action='bank_item.workshop_discard'"
            ),
            {"id": item_id},
        )).scalar_one()
    assert str(actor) == str(world["teacher_id"])


def _names(rows: list[tuple[str, dict[str, Any] | None]]) -> list[str]:
    return [a for a, _ in rows]
