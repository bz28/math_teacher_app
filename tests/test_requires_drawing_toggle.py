"""The Workshop's "Requires a drawing" toggle (PATCH requires_drawing).

It decides whether a drawing is part of the answer, so it follows the
content-edit rules: refused while the item is in a published homework,
and recorded in question_edits (field "requires_drawing") without
touching the one-level question undo.
"""

import uuid
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from api.database import get_session_factory
from api.models.question_bank import QuestionBankItem
from api.models.question_edit import EDIT_MANUAL, FIELD_REQUIRES_DRAWING
from tests.conftest import auth_headers as _auth
from tests.test_question_edits import _edits, _own_course, _patch

pytestmark = pytest.mark.asyncio


async def _item(item_id: Any) -> QuestionBankItem:
    async with get_session_factory()() as s:
        return (await s.execute(
            select(QuestionBankItem).where(QuestionBankItem.id == uuid.UUID(str(item_id)))
        )).scalar_one()


async def test_toggle_on_and_off_is_saved_serialized_and_audited(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    await _own_course(world)
    item_id = world["primary_id"]
    before = await _item(item_id)
    prev_question = before.previous_question

    r = await _patch(client, world["teacher_token"], item_id, requires_drawing=True)
    assert r.status_code == 200, r.text
    assert r.json()["requires_drawing"] is True
    assert (await _item(item_id)).requires_drawing is True

    r = await _patch(client, world["teacher_token"], item_id, requires_drawing=False)
    assert r.status_code == 200 and r.json()["requires_drawing"] is False

    edits = [e for e in await _edits(uuid.UUID(str(item_id))) if e.field == FIELD_REQUIRES_DRAWING]
    assert [(e.kind, e.before, e.after) for e in edits] == [
        (EDIT_MANUAL, "no", "yes"), (EDIT_MANUAL, "yes", "no"),
    ]
    # Only the flag rows — the snapshot diff must not re-report old edits.
    assert len(await _edits(uuid.UUID(str(item_id)))) == 2
    # The toggle is its own undo; it leaves the question undo slot alone.
    assert (await _item(item_id)).previous_question == prev_question


async def test_resending_the_same_value_records_nothing(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    await _own_course(world)
    item_id = world["primary_id"]
    r = await _patch(client, world["teacher_token"], item_id, requires_drawing=False)
    assert r.status_code == 200
    assert await _edits(uuid.UUID(str(item_id))) == []


async def test_locked_item_refuses_the_toggle(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    await _own_course(world)
    item_id = world["primary_id"]
    async with get_session_factory()() as s:
        it = (await s.execute(
            select(QuestionBankItem).where(QuestionBankItem.id == uuid.UUID(str(item_id)))
        )).scalar_one()
        it.locked = True
        await s.commit()
    r = await _patch(client, world["teacher_token"], item_id, requires_drawing=True)
    assert r.status_code == 409
    assert (await _item(item_id)).requires_drawing is False
    # A no-op value on a locked item is not a content change.
    r = await _patch(client, world["teacher_token"], item_id, requires_drawing=False)
    assert r.status_code == 200


async def test_other_teachers_cannot_toggle(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    item_id = world["primary_id"]
    r = await client.patch(
        f"/v1/teacher/question-bank/{item_id}",
        headers=_auth(world["student_token"]), json={"requires_drawing": True},
    )
    assert r.status_code in (401, 403)
