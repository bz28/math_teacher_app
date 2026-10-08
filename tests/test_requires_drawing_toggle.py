"""The "Requires a drawing" flag: the Workshop toggle, AI rewrites, undo.

- The toggle is an answer-requirement fix, not a content edit: allowed on
  locked (published) items, recorded in question_edits, and it marks the
  flag teacher-set.
- AI rewrites (Workshop accept, regenerate) re-derive the flag from the
  new text only while no teacher has set it.
- Undo restores the flag that travelled with the prose — never over a
  teacher's explicit setting.
"""

import uuid
from datetime import UTC, datetime
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


async def _set(item_id: Any, **fields: Any) -> None:
    async with get_session_factory()() as s:
        it = (await s.execute(
            select(QuestionBankItem).where(QuestionBankItem.id == uuid.UUID(str(item_id)))
        )).scalar_one()
        for k, v in fields.items():
            setattr(it, k, v)
        await s.commit()


async def _accept_proposal(client: AsyncClient, token: str, item_id: Any, question: str) -> Any:
    """Seed a pending Workshop proposal that rewrites the question, then accept it."""
    await _set(item_id, chat_messages=[
        {"role": "teacher", "text": "rewrite it", "ts": datetime.now(UTC).isoformat()},
        {"role": "ai", "text": "Here you go.", "ts": datetime.now(UTC).isoformat(),
         "proposal": {"question": question}},
    ])
    return await client.post(
        f"/v1/teacher/question-bank/{item_id}/chat/accept",
        headers=_auth(token), json={"message_index": 1},
    )


async def test_toggle_on_and_off_is_saved_serialized_and_audited(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    await _own_course(world)
    item_id = world["primary_id"]
    prev_question = (await _item(item_id)).previous_question

    r = await _patch(client, world["teacher_token"], item_id, requires_drawing=True)
    assert r.status_code == 200, r.text
    assert r.json()["requires_drawing"] is True
    assert r.json()["requires_drawing_teacher_set"] is True
    r = await _patch(client, world["teacher_token"], item_id, requires_drawing=False)
    assert r.status_code == 200 and r.json()["requires_drawing"] is False

    edits = await _edits(uuid.UUID(str(item_id)))
    assert [(e.kind, e.field, e.before, e.after) for e in edits] == [
        (EDIT_MANUAL, FIELD_REQUIRES_DRAWING, "no", "yes"),
        (EDIT_MANUAL, FIELD_REQUIRES_DRAWING, "yes", "no"),
    ]
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
    assert (await _item(item_id)).requires_drawing_teacher_set is False


async def test_toggle_is_allowed_on_a_locked_published_item(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    """It fixes what the answer requires — a teacher who spots a missed
    flag on a published homework has to be able to fix it and regrade."""
    await _own_course(world)
    item_id = world["primary_id"]
    await _set(item_id, locked=True)
    r = await _patch(client, world["teacher_token"], item_id, requires_drawing=True)
    assert r.status_code == 200, r.text
    assert (await _item(item_id)).requires_drawing is True
    # Content edits stay locked.
    r = await _patch(client, world["teacher_token"], item_id, question="Changed text.")
    assert r.status_code == 409


async def test_ai_rewrite_rederives_the_flag_only_when_not_teacher_set(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    await _own_course(world)
    item_id = world["primary_id"]
    # Not teacher-set: new AI text that asks for a graph flips it on.
    r = await _accept_proposal(client, world["teacher_token"], item_id, "Graph $y = 2x + 1$.")
    assert r.status_code == 200, r.text
    assert (await _item(item_id)).requires_drawing is True

    # Teacher turns it off; the next AI rewrite (still graph wording) keeps it off.
    r = await _patch(client, world["teacher_token"], item_id, requires_drawing=False)
    assert r.status_code == 200
    r = await _accept_proposal(client, world["teacher_token"], item_id, "Sketch the graph of $y = x^2$.")
    assert r.status_code == 200, r.text
    assert (await _item(item_id)).requires_drawing is False


async def test_ai_rewrite_takes_the_ai_answer_in_the_response(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    """Accepting a rewrite the regex misses: the AI's yes is decided inside
    the accept, so the response already carries it."""
    from unittest.mock import AsyncMock, patch

    from api.core import drawing_requirement

    await _own_course(world)
    item_id = world["primary_id"]
    with patch.object(drawing_requirement, "_llm_requires_drawing",
                      new=AsyncMock(return_value=True)) as llm:
        r = await _accept_proposal(client, world["teacher_token"], item_id,
                                   "Represent the data however you like, then explain.")
    assert r.status_code == 200, r.text
    llm.assert_awaited_once()
    assert r.json()["requires_drawing"] is True
    assert (await _item(item_id)).requires_drawing is True


async def test_undo_restores_the_derived_flag_but_never_a_teacher_setting(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    await _own_course(world)
    item_id = world["primary_id"]
    assert (await _item(item_id)).requires_drawing is False
    r = await _accept_proposal(client, world["teacher_token"], item_id, "Graph $y = 2x + 1$.")
    assert r.status_code == 200 and (await _item(item_id)).requires_drawing is True
    r = await client.post(f"/v1/teacher/question-bank/{item_id}/revert",
                          headers=_auth(world["teacher_token"]))
    assert r.status_code == 200, r.text
    # The flag travelled with the prose it was derived from.
    assert (await _item(item_id)).requires_drawing is False

    # Now the teacher sets it; an AI rewrite + undo must not move it.
    r = await _patch(client, world["teacher_token"], item_id, requires_drawing=True)
    r = await _accept_proposal(client, world["teacher_token"], item_id, "Solve $x + 1 = 2$.")
    assert (await _item(item_id)).requires_drawing is True
    r = await client.post(f"/v1/teacher/question-bank/{item_id}/revert",
                          headers=_auth(world["teacher_token"]))
    assert r.status_code == 200
    assert (await _item(item_id)).requires_drawing is True


async def test_students_cannot_toggle(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    item_id = world["primary_id"]
    r = await client.patch(
        f"/v1/teacher/question-bank/{item_id}",
        headers=_auth(world["student_token"]), json={"requires_drawing": True},
    )
    assert r.status_code in (401, 403)


async def test_manual_question_edit_rederives_unless_teacher_set(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    await _own_course(world)
    item_id = world["primary_id"]
    r = await _patch(client, world["teacher_token"], item_id, question="Graph $y = 2x + 1$.")
    assert r.status_code == 200 and r.json()["requires_drawing"] is True
    # undo brings back the old wording AND its flag
    r = await client.post(f"/v1/teacher/question-bank/{item_id}/revert",
                          headers=_auth(world["teacher_token"]))
    assert r.status_code == 200 and (await _item(item_id)).requires_drawing is False
    # once the teacher sets it, new wording doesn't move it
    await _patch(client, world["teacher_token"], item_id, requires_drawing=True)
    r = await _patch(client, world["teacher_token"], item_id, question="Solve $x + 1 = 2$.")
    assert r.status_code == 200 and r.json()["requires_drawing"] is True
