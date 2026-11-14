"""A teacher's own edit (PATCH /question-bank/{id}) and the construction
figures checked against the old problem (review round 2, finding 7).

A construction figure is kept only beside the reading (`figure_facts`) it
was checked against. New wording voids that reading: the stored facts
describe the old problem, and a later step figure would be checked
against them. So the question's construction figure, its facts, and each
step's construction figure go (undo restores them); a figure of another
kind, which no reading backs, stays.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from api.database import get_session_factory
from api.models.question_bank import QuestionBankItem
from tests.test_construction_figure_wiring import GOOD, PROBLEM, READING
from tests.test_question_edits import _own_course, _patch

pytestmark = pytest.mark.asyncio

STEP_FIG = {"title": "Draw", "description": "The parallelogram", "figure_spec": GOOD, "figure_svg": "<svg/>"}
PLAIN_STEP = {"title": "Note", "description": "AB ≅ CD", "figure_spec": {"kind": "triangle"}, "figure_svg": "<svg/>"}


async def _item(item_id: Any) -> QuestionBankItem:
    async with get_session_factory()() as s:
        return (await s.execute(
            select(QuestionBankItem).where(QuestionBankItem.id == uuid.UUID(str(item_id)))
        )).scalar_one()


async def _seed(item_id: Any, **fields: Any) -> None:
    async with get_session_factory()() as s:
        it = (await s.execute(
            select(QuestionBankItem).where(QuestionBankItem.id == uuid.UUID(str(item_id)))
        )).scalar_one()
        for k, v in fields.items():
            setattr(it, k, v)
        await s.commit()


async def _with_construction(world: dict[str, Any]) -> Any:
    await _own_course(world)
    item_id = world["primary_id"]
    await _seed(
        item_id, question=PROBLEM, final_answer="AD ≅ BC", figure_spec=GOOD, figure_svg="<svg/>",
        figure_facts=READING.model_dump(), solution_steps=[STEP_FIG, PLAIN_STEP],
    )
    return item_id


async def test_new_wording_drops_the_construction_figures_checked_against_the_old(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    item_id = await _with_construction(world)
    new = PROBLEM.replace(r"\parallel", r"\perp")
    r = await _patch(client, world["teacher_token"], item_id, question=new)
    assert r.status_code == 200, r.text
    item = await _item(item_id)
    assert item.question == new
    assert item.figure_spec is None and item.figure_svg is None and item.figure_facts is None
    # The step's construction figure goes; a step figure of another kind stays.
    assert item.solution_steps == [
        {"title": "Draw", "description": "The parallelogram"}, PLAIN_STEP,
    ]
    # One undo brings the figure and its reading back with the old words.
    r = await client.post(
        f"/v1/teacher/question-bank/{item_id}/revert",
        headers={"Authorization": f"Bearer {world['teacher_token']}"},
    )
    assert r.status_code == 200, r.text
    item = await _item(item_id)
    assert item.question == PROBLEM and item.figure_spec == GOOD and item.figure_facts == READING.model_dump()


async def test_the_same_wording_keeps_the_figure(world: dict[str, Any], client: AsyncClient) -> None:
    item_id = await _with_construction(world)
    r = await _patch(client, world["teacher_token"], item_id, question=PROBLEM, title="Renamed")
    assert r.status_code == 200, r.text
    item = await _item(item_id)
    assert item.figure_spec == GOOD and item.figure_facts == READING.model_dump()
    assert item.solution_steps == [STEP_FIG, PLAIN_STEP]


async def test_a_figure_of_another_kind_stays_with_new_wording(
    world: dict[str, Any], client: AsyncClient,
) -> None:
    await _own_course(world)
    item_id = world["primary_id"]
    other = {"type": "geometry", "shape": "triangle", "vertices": ["A", "B", "C"]}
    await _seed(item_id, figure_spec=other, figure_svg="<svg/>", figure_facts=None)
    r = await _patch(client, world["teacher_token"], item_id, question="Find the area of triangle ABC.")
    assert r.status_code == 200, r.text
    assert (await _item(item_id)).figure_spec == other
