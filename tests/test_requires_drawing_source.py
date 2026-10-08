"""Where `requires_drawing` comes from (founder decision, PR #907).

- Generated / uploaded items: the call that wrote or read the question
  returns it (GENERATE_QUESTIONS_SCHEMA) — no extra call; regex fallback.
- Text changes nobody's AI produced (a teacher's edit, an accepted
  Workshop rewrite): the regex answers at save time, then one small
  classification call runs AFTER the save and can add a yes — unless the
  text changed again or a teacher set the flag meanwhile.
- Either source saying yes flags it (combine_requires_drawing).
- Never at grading/extraction time: those only read the column.
"""

import uuid
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from api.core import drawing_requirement
from api.core.llm_schemas import GENERATE_QUESTIONS_SCHEMA, REGENERATE_QA_SCHEMA
from api.database import get_session_factory
from api.models.question_bank import QuestionBankItem
from tests.test_question_bank_upload import TINY_PNG
from tests.test_question_edits import _own_course, _patch

pytestmark = pytest.mark.asyncio


async def _item(item_id: Any) -> QuestionBankItem:
    async with get_session_factory()() as s:
        return (await s.execute(
            select(QuestionBankItem).where(QuestionBankItem.id == uuid.UUID(str(item_id)))
        )).scalar_one()


def test_generation_and_regeneration_schemas_carry_the_flag() -> None:
    q = GENERATE_QUESTIONS_SCHEMA["input_schema"]["properties"]["questions"]["items"]
    assert q["properties"]["requires_drawing"]["type"] == "boolean"
    assert "requires_drawing" in q["required"]
    assert "requires_drawing" in REGENERATE_QA_SCHEMA["input_schema"]["required"]


async def test_uploaded_worksheet_keeps_the_extractors_flag() -> None:
    from api.core.question_bank_generation import _extract_from_files

    async def fake_vision(*_: Any, **__: Any) -> dict[str, Any]:
        return {"questions": [
            {"title": "a", "text": "Use the graph shown to find f(2).", "difficulty": "easy",
             "requires_drawing": False},
            {"title": "b", "text": "Solve x + 1 = 2.", "difficulty": "easy", "requires_drawing": True},
            {"title": "c", "text": "Graph y = x.", "difficulty": "easy"},  # missing → no key
        ]}

    with patch("api.core.question_bank_generation.call_claude_vision",
               new=AsyncMock(side_effect=fake_vision)):
        out = await _extract_from_files(
            [{"data": TINY_PNG, "media_type": "image/png"}], subject="math", user_id="u1",
        )
    assert [q.get("requires_drawing") for q in out] == [False, True, None]


async def test_a_text_edit_takes_the_ai_answer_after_the_save(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    await _own_course(world)
    item_id = world["primary_id"]
    # The regex says no drawing; the AI (run after the save) says yes.
    with patch.object(drawing_requirement, "_llm_requires_drawing",
                      new=AsyncMock(return_value=True)) as llm:
        r = await _patch(client, world["teacher_token"], item_id,
                         question="Represent the data however you like, then explain.")
        assert r.status_code == 200
        llm.assert_awaited_once()
    assert (await _item(item_id)).requires_drawing is True


async def test_the_ai_answer_never_overrides_a_teacher_or_a_newer_text(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    await _own_course(world)
    item_id = world["primary_id"]
    item = await _item(item_id)
    with patch.object(drawing_requirement, "_llm_requires_drawing", new=AsyncMock(return_value=True)):
        # the text moved on since the call was scheduled
        await drawing_requirement.refresh_requires_drawing(item.id, "an older wording")
        assert (await _item(item_id)).requires_drawing is False
        # the teacher set it (on, then back off — an explicit "no")
        await _patch(client, world["teacher_token"], item_id, requires_drawing=True)
        await _patch(client, world["teacher_token"], item_id, requires_drawing=False)
        await drawing_requirement.refresh_requires_drawing(item.id, (await _item(item_id)).question)
        assert (await _item(item_id)).requires_drawing is False


async def test_a_failed_call_falls_back_to_the_regex() -> None:
    with patch("api.core.llm_client.call_claude_json", new=AsyncMock(side_effect=RuntimeError("down"))):
        assert await drawing_requirement._llm_requires_drawing("Graph y = x.") is None
    assert drawing_requirement.combine_requires_drawing("Graph y = x.", None) is True


@pytest.mark.parametrize(("question", "ai_flag", "expected"), [
    # drawing-flag eval: the AI said no, the regex caught it
    ("Label the vertex on your graph.", False, True),
    # the AI catches a phrasing the regex has never seen
    ("Represent the data however you like, then explain.", True, True),
    ("Solve x + 1 = 2.", False, False),
    ("Solve x + 1 = 2.", None, False),
])
def test_either_the_ai_or_the_regex_saying_yes_flags_it(
    question: str, ai_flag: Any, expected: bool,
) -> None:
    assert drawing_requirement.combine_requires_drawing(question, ai_flag) is expected


async def test_an_ai_no_never_clears_a_regex_yes(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    await _own_course(world)
    item_id = world["primary_id"]
    with patch.object(drawing_requirement, "_llm_requires_drawing",
                      new=AsyncMock(return_value=False)) as llm:
        r = await _patch(client, world["teacher_token"], item_id,
                         question="Label the vertex on your graph.")
        assert r.status_code == 200
        llm.assert_awaited_once()
    assert (await _item(item_id)).requires_drawing is True


def test_grading_and_extraction_never_call_the_classifier() -> None:
    import inspect

    from api.core import grading_ai, integrity_ai

    for mod in (grading_ai, integrity_ai):
        src = inspect.getsource(mod)
        assert "requires_drawing(" not in src.replace('get("requires_drawing")', "")
        assert "classify_requires_drawing" not in src and "_llm_requires_drawing" not in src
