"""Where `requires_drawing` comes from (founder decision, PR #907).

- Generated / uploaded items: the call that wrote or read the question
  returns it (GENERATE_QUESTIONS_SCHEMA) — no extra call; regex fallback.
- Text changes nobody's AI produced (a teacher's edit, an accepted
  Workshop rewrite): one small, time-boxed classification call runs
  INSIDE the save, so the response carries the final flag — unless a
  teacher has set the flag.
- Either source saying yes flags it (combine_requires_drawing).
- Never at grading/extraction time: those only read the column.
"""

import asyncio
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

# conftest stubs `_llm_requires_drawing` for every test (autouse); tests of
# the call itself restore this real one, captured at import.
_REAL_LLM_REQUIRES_DRAWING = drawing_requirement._llm_requires_drawing


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


async def test_a_text_edit_returns_the_ai_answer_in_the_response(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    """The AI decides inside the save, so the open Workshop is handed the
    final flag — nothing changes in the database after the response."""
    await _own_course(world)
    item_id = world["primary_id"]
    # The regex says no drawing; the AI says yes.
    with patch.object(drawing_requirement, "_llm_requires_drawing",
                      new=AsyncMock(return_value=True)) as llm:
        r = await _patch(client, world["teacher_token"], item_id,
                         question="Represent the data however you like, then explain.")
        assert r.status_code == 200
        llm.assert_awaited_once()
    assert r.json()["requires_drawing"] is True
    assert (await _item(item_id)).requires_drawing is True


async def test_a_teacher_set_flag_survives_a_text_edit(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    await _own_course(world)
    item_id = world["primary_id"]
    # the teacher set it (on, then back off — an explicit "no")
    await _patch(client, world["teacher_token"], item_id, requires_drawing=True)
    await _patch(client, world["teacher_token"], item_id, requires_drawing=False)
    with patch.object(drawing_requirement, "_llm_requires_drawing",
                      new=AsyncMock(return_value=True)) as llm:
        r = await _patch(client, world["teacher_token"], item_id, question="Graph y = 2x + 1.")
        assert r.status_code == 200
        llm.assert_not_awaited()
    assert r.json()["requires_drawing"] is False


async def test_a_slow_call_is_time_boxed_and_the_regex_stands(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The call sits on a teacher's save: past the time box it gives up."""
    async def hang(*_: Any, **__: Any) -> dict[str, Any]:
        await asyncio.sleep(5)
        return {"requires_drawing": True}

    monkeypatch.setattr(drawing_requirement, "_CLASSIFY_TIMEOUT_S", 0.05)
    monkeypatch.setattr(drawing_requirement, "_llm_requires_drawing", _REAL_LLM_REQUIRES_DRAWING)
    call = AsyncMock(side_effect=hang)
    with patch("api.core.llm_client.call_claude_json", new=call):
        started = asyncio.get_running_loop().time()
        assert await drawing_requirement._llm_requires_drawing("Graph y = x.") is None
        assert asyncio.get_running_loop().time() - started < 1  # cut off, not 5 s
        assert await drawing_requirement.classify_requires_drawing("Solve x + 1 = 2.") is False
        assert await drawing_requirement.classify_requires_drawing("Graph y = x.") is True
    assert call.await_count == 3  # the real call path ran each time


async def test_a_failed_call_falls_back_to_the_regex(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(drawing_requirement, "_llm_requires_drawing", _REAL_LLM_REQUIRES_DRAWING)
    call = AsyncMock(side_effect=RuntimeError("down"))
    with patch("api.core.llm_client.call_claude_json", new=call):
        assert await drawing_requirement._llm_requires_drawing("Graph y = x.") is None
    call.assert_awaited_once()
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


async def test_a_toggle_committed_during_the_call_is_never_overwritten(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    """The text save awaits the AI call (~0.6 s). A teacher's toggle from
    another page that commits meanwhile must win: the save re-reads the
    row under lock after the call and leaves a teacher-set flag alone."""
    await _own_course(world)
    item_id = world["primary_id"]

    assert (await _item(item_id)).requires_drawing is False

    # The teacher sets an explicit "no" (on, then back off) on another page
    # while the AI is deciding the new text is a drawing question. A single
    # toggle can't show the race: the save would write back the value it
    # loaded, which the ORM skips as unchanged.
    async def explicit_no_meanwhile(*_: Any, **__: Any) -> bool:
        for v in (True, False):
            r = await _patch(client, world["teacher_token"], item_id, requires_drawing=v)
            assert r.status_code == 200
        return True

    with patch.object(drawing_requirement, "_llm_requires_drawing",
                      new=AsyncMock(side_effect=explicit_no_meanwhile)):
        r = await _patch(client, world["teacher_token"], item_id,
                         question="Represent the data however you like, then explain.")
    assert r.status_code == 200
    assert r.json()["requires_drawing"] is False
    stored = await _item(item_id)
    assert stored.question == "Represent the data however you like, then explain."
    assert stored.requires_drawing is False and stored.requires_drawing_teacher_set is True


async def test_resaving_the_same_text_makes_no_call(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    await _own_course(world)
    item_id = world["primary_id"]
    same = (await _item(item_id)).question
    with patch.object(drawing_requirement, "_llm_requires_drawing",
                      new=AsyncMock(return_value=True)) as llm:
        r = await _patch(client, world["teacher_token"], item_id, question=same)
    assert r.status_code == 200
    llm.assert_not_awaited()


async def test_the_response_carries_the_teachers_flag_when_their_toggle_wins(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    """A single toggle committed during the call: the database keeps the
    teacher's value and the save's response must show it too."""
    await _own_course(world)
    item_id = world["primary_id"]
    assert (await _item(item_id)).requires_drawing is False

    async def toggle_on_meanwhile(*_: Any, **__: Any) -> bool:
        r = await _patch(client, world["teacher_token"], item_id, requires_drawing=True)
        assert r.status_code == 200
        return False

    with patch.object(drawing_requirement, "_llm_requires_drawing",
                      new=AsyncMock(side_effect=toggle_on_meanwhile)):
        r = await _patch(client, world["teacher_token"], item_id, question="Solve 3x = 12.")
    assert r.status_code == 200
    assert r.json()["requires_drawing"] is True
    assert r.json()["requires_drawing_teacher_set"] is True
    assert (await _item(item_id)).requires_drawing is True


async def test_an_invalid_request_is_rejected_before_any_model_call(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    await _own_course(world)
    item_id = world["primary_id"]
    before = (await _item(item_id)).question
    with patch.object(drawing_requirement, "_llm_requires_drawing",
                      new=AsyncMock(return_value=True)) as llm:
        r = await _patch(client, world["teacher_token"], item_id,
                         question="Graph y = x.", distractors=["1"])
    assert r.status_code == 400
    llm.assert_not_awaited()
    assert (await _item(item_id)).question == before
