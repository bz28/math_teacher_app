"""Graph checklists on questions: when they are written, what edits do to
them, how their points resolve, and the writer's code around the model.

The model is never called: the writer is faked at its import site in
api.core.graph_checklist (the background write), or `call_claude_json` is
faked inside drawing_check (the writer's own parsing). What a good
checklist says is measured separately, by the lead, not here.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from api.core import drawing_check, graph_checklist
from api.core.checklist_points import fit_checklist
from api.core.drawing_check import ChecklistItem, WrittenChecklist, values_not_given, write_graph_checklist
from api.core.graph_checklist import drain_checklist_tasks, needs_checklist, source_of, to_stored
from api.database import get_session_factory
from api.models.assignment import Assignment
from api.models.course import Course
from api.models.question_bank import QuestionBankItem
from tests.conftest import auth_headers as _auth
from tests.test_question_edits import _own_course

pytestmark = pytest.mark.asyncio

QUESTION = "Graph $y = \\frac{1}{x - 2} + 1$. Draw and label both asymptotes."
ANSWER = "Vertical asymptote x = 2, horizontal asymptote y = 1, crosses the x-axis at (1, 0)."
RULE = {"id": "r1", "text": "Label every asymptote", "points": 2}


class Writer:
    """Stands in for write_graph_checklist: records each call, answers
    with `reply` (a list of items, a WrittenChecklist, or an exception
    to raise)."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self.reply: Any = [
            ChecklistItem("Vertical asymptote drawn at x = 2", 3),
            ChecklistItem("Horizontal asymptote drawn at y = 1", 3),
            ChecklistItem("Asymptotes labeled", 2, "r1"),
        ]
        self.during: Any = None

    async def __call__(self, question: str, final_answer: str, points: int, **kw: Any) -> Any:
        self.calls.append({"question": question, "final_answer": final_answer, "points": points, **kw})
        if self.during is not None:
            await self.during()
        if isinstance(self.reply, Exception):
            raise self.reply
        if isinstance(self.reply, WrittenChecklist):
            return self.reply
        return WrittenChecklist(list(self.reply))


@pytest.fixture
def writer(monkeypatch: pytest.MonkeyPatch) -> Writer:
    fake = Writer()
    monkeypatch.setattr(graph_checklist, "write_graph_checklist", fake)
    return fake


async def _item(item_id: Any) -> QuestionBankItem:
    async with get_session_factory()() as s:
        return (await s.execute(
            select(QuestionBankItem).where(QuestionBankItem.id == uuid.UUID(str(item_id)))
        )).scalar_one()


async def _set(model: Any, row_id: Any, **fields: Any) -> None:
    async with get_session_factory()() as s:
        row = (await s.execute(select(model).where(model.id == row_id))).scalar_one()
        for k, v in fields.items():
            setattr(row, k, v)
        await s.commit()


@pytest.fixture
async def hw(world: dict[str, Any]) -> dict[str, Any]:
    """A draft homework worth 10 points holding one pending graph
    question, in a class with one rule worth 2 points."""
    await _own_course(world)
    async with get_session_factory()() as s:
        primary = (await s.execute(
            select(QuestionBankItem).where(QuestionBankItem.id == world["primary_id"])
        )).scalar_one()
        course = (await s.execute(select(Course).where(Course.id == primary.course_id))).scalar_one()
        course.rubric = {"rules": [RULE], "rev": 1}
        a = Assignment(
            course_id=course.id, unit_ids=[world["unit_id"]], teacher_id=world["teacher_id"],
            title="HW 2", type="homework", status="draft", content={"problem_ids": []},
            total_points=10,
        )
        s.add(a)
        await s.flush()
        item = QuestionBankItem(
            course_id=course.id, unit_id=world["unit_id"], originating_assignment_id=a.id,
            title="Rational graph", question=QUESTION, final_answer=ANSWER,
            status="pending", requires_drawing=True,
        )
        s.add(item)
        await s.commit()
        return {**world, "hw_id": a.id, "item_id": item.id, "course_id": course.id}


async def _approve(client: AsyncClient, hw: dict[str, Any]) -> None:
    r = await client.post(
        f"/v1/teacher/question-bank/{hw['item_id']}/approve", headers=_auth(hw["teacher_token"]),
    )
    assert r.status_code == 200, r.text
    await drain_checklist_tasks()


async def _patch(client: AsyncClient, hw: dict[str, Any], **body: Any) -> Any:
    r = await client.patch(
        f"/v1/teacher/question-bank/{hw['item_id']}", headers=_auth(hw["teacher_token"]), json=body,
    )
    assert r.status_code == 200, r.text
    await drain_checklist_tasks()
    return r.json()


async def _put(client: AsyncClient, hw: dict[str, Any], items: list[dict[str, Any]]) -> Any:
    return await client.put(
        f"/v1/teacher/question-bank/{hw['item_id']}/graph-checklist",
        headers=_auth(hw["teacher_token"]), json={"items": items},
    )


async def _view(client: AsyncClient, hw: dict[str, Any]) -> Any:
    r = await client.get(
        f"/v1/teacher/courses/{hw['course_id']}/question-bank",
        headers=_auth(hw["teacher_token"]), params={"assignment_id": str(hw["hw_id"])},
    )
    assert r.status_code == 200, r.text
    (item,) = [i for i in r.json()["items"] if i["id"] == str(hw["item_id"])]
    return item["graph_checklist"]


MINE = [
    {"text": "Vertical asymptote at x = 2", "points": 4, "rule_id": None},
    {"text": "Curve crosses the x-axis at (1, 0)", "points": 2, "rule_id": None},
]


# ── written on approve ──


async def test_approve_writes_the_checklist_from_the_final_question(
    hw: dict[str, Any], client: AsyncClient, writer: Writer,
) -> None:
    await _approve(client, hw)
    (call,) = writer.calls
    assert (call["question"], call["final_answer"], call["points"]) == (QUESTION, ANSWER, 10)
    assert call["class_rules"] == [RULE]
    stored = (await _item(hw["item_id"])).graph_checklist
    assert stored["points"] == 10 and stored["teacher_edited"] is False
    view = await _view(client, hw)
    assert [(i["text"], i["points"], i["rule_id"]) for i in view["items"]] == [
        ("Vertical asymptote drawn at x = 2", 3, None),
        ("Horizontal asymptote drawn at y = 1", 3, None),
        ("Asymptotes labeled", 2, "r1"),
    ]
    assert (view["graph_points"], view["problem_points"]) == (8, 10)


async def test_a_question_without_a_drawing_gets_none(
    hw: dict[str, Any], client: AsyncClient, writer: Writer,
) -> None:
    await _set(QuestionBankItem, hw["item_id"], requires_drawing=False)
    await _approve(client, hw)
    assert writer.calls == []
    assert await _view(client, hw) is None


async def test_a_question_the_writer_reads_as_no_drawing_is_kept_empty(
    hw: dict[str, Any], client: AsyncClient, writer: Writer,
) -> None:
    """Saved as "asks for no drawing", so the teacher sees why there is no
    checklist and the next save doesn't pay for another call."""
    writer.reply = WrittenChecklist([], asks_for_drawing=False)
    await _approve(client, hw)
    view = await _view(client, hw)
    assert (view["items"], view["asks_for_drawing"]) == ([], False)
    await _patch(client, hw, title="Renamed")
    assert len(writer.calls) == 1


async def test_a_failed_write_never_fails_the_approval(
    hw: dict[str, Any], client: AsyncClient, writer: Writer,
) -> None:
    writer.reply = RuntimeError("model down")
    await _approve(client, hw)
    item = await _item(hw["item_id"])
    assert item.status == "approved" and item.graph_checklist is None
    assert str(item.id) in (await _hw(hw)).content["problem_ids"]


async def _hw(hw: dict[str, Any]) -> Assignment:
    async with get_session_factory()() as s:
        return (await s.execute(select(Assignment).where(Assignment.id == hw["hw_id"]))).scalar_one()


async def test_no_answer_key_no_checklist() -> None:
    item = QuestionBankItem(status="approved", requires_drawing=True, final_answer="  ")
    assert not needs_checklist(item)
    item.final_answer = "(solution failed: timeout)"
    assert not needs_checklist(item)
    item.final_answer = "y = 2x"
    assert needs_checklist(item)
    item.parent_question_id = uuid.uuid4()  # a variation is never graded on a homework
    assert not needs_checklist(item)


# ── edits ──


async def test_answer_change_rewrites_an_unedited_checklist(
    hw: dict[str, Any], client: AsyncClient, writer: Writer,
) -> None:
    await _approve(client, hw)
    writer.reply = [ChecklistItem("Vertical asymptote drawn at x = 3", 4)]
    body = await _patch(client, hw, final_answer="Vertical asymptote x = 3.")
    # Stale the moment the answer changed; the response never shows it.
    assert body["graph_checklist"] is None
    assert writer.calls[-1]["final_answer"] == "Vertical asymptote x = 3."
    assert [i["text"] for i in (await _view(client, hw))["items"]] == ["Vertical asymptote drawn at x = 3"]


async def test_a_teacher_edited_checklist_is_never_rewritten(
    hw: dict[str, Any], client: AsyncClient, writer: Writer,
) -> None:
    await _approve(client, hw)
    r = await _put(client, hw, MINE)
    assert r.status_code == 200, r.text
    assert r.json()["graph_checklist"]["teacher_edited"] is True
    await _patch(client, hw, question="Graph $y = \\frac{1}{x - 3}$.", final_answer="x = 3")
    assert len(writer.calls) == 1
    view = await _view(client, hw)
    assert [i["text"] for i in view["items"]] == [m["text"] for m in MINE]


async def test_rewrite_from_the_answer_key_clears_the_edit(
    hw: dict[str, Any], client: AsyncClient, writer: Writer,
) -> None:
    await _approve(client, hw)
    assert (await _put(client, hw, MINE)).status_code == 200
    writer.reply = [ChecklistItem("Fresh item", 2)]
    r = await client.post(
        f"/v1/teacher/question-bank/{hw['item_id']}/graph-checklist/rewrite",
        headers=_auth(hw["teacher_token"]),
    )
    assert r.status_code == 200, r.text
    view = r.json()["graph_checklist"]
    assert view["teacher_edited"] is False and [i["text"] for i in view["items"]] == ["Fresh item"]


async def test_a_failed_rewrite_keeps_the_teachers_checklist(
    hw: dict[str, Any], client: AsyncClient, writer: Writer,
) -> None:
    await _approve(client, hw)
    assert (await _put(client, hw, MINE)).status_code == 200
    writer.reply = RuntimeError("model down")
    r = await client.post(
        f"/v1/teacher/question-bank/{hw['item_id']}/graph-checklist/rewrite",
        headers=_auth(hw["teacher_token"]),
    )
    assert r.status_code == 502
    assert (await _view(client, hw))["teacher_edited"] is True


async def test_a_question_edit_during_the_write_wins(
    hw: dict[str, Any], client: AsyncClient, writer: Writer,
) -> None:
    """The model ran on the old text; the checklist it wrote is dropped."""
    async def edit_meanwhile() -> None:
        await _set(QuestionBankItem, hw["item_id"], question="Graph $y = x$.")
    writer.during = edit_meanwhile
    await _approve(client, hw)
    assert (await _item(hw["item_id"])).graph_checklist is None


async def _interleave(
    client: AsyncClient, hw: dict[str, Any], monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A question edit whose request loads the row, then a background write
    for the OLD text commits, then the request commits the new text.

    The commit is slipped in through the requires-drawing classifier,
    which a question edit awaits between loading the row and committing."""
    from api.routes import teacher_question_bank

    old = source_of(QuestionBankItem(question=QUESTION, final_answer=ANSWER))

    async def background_write_lands(question: str, **_: Any) -> bool:
        await _set(QuestionBankItem, hw["item_id"], graph_checklist=to_stored(
            [ChecklistItem("Vertical asymptote drawn at x = 2", 3)], 10, source=old, teacher_edited=False,
        ))
        return True

    monkeypatch.setattr(teacher_question_bank, "classify_requires_drawing", background_write_lands)
    await _patch(client, hw, question="Graph $y = \\frac{1}{x - 3}$.")


async def test_an_old_text_write_landing_mid_edit_is_replaced(
    hw: dict[str, Any], client: AsyncClient, writer: Writer, monkeypatch: pytest.MonkeyPatch,
) -> None:
    writer.reply = []  # approve writes nothing; the old-text write lands mid-edit
    await _approve(client, hw)
    writer.reply = [ChecklistItem("Vertical asymptote drawn at x = 3", 3)]
    await _interleave(client, hw, monkeypatch)
    item = await _item(hw["item_id"])
    assert writer.calls[-1]["question"] == "Graph $y = \\frac{1}{x - 3}$."
    assert item.graph_checklist["source"] == source_of(item)
    assert [i["text"] for i in (await _view(client, hw))["items"]] == ["Vertical asymptote drawn at x = 3"]


async def test_a_stale_checklist_is_never_shown(
    hw: dict[str, Any], client: AsyncClient, writer: Writer, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Even when its replacement fails, an old-text checklist reads as not
    written, never as the new question's."""
    writer.reply = []
    await _approve(client, hw)
    await _interleave(client, hw, monkeypatch)
    assert (await _item(hw["item_id"])).graph_checklist is not None
    assert await _view(client, hw) is None
    # The same for text changed from another tab, with no save here at all.
    writer.reply = [ChecklistItem("Vertical asymptote drawn at x = 3", 3)]
    await _patch(client, hw, requires_drawing=False)
    await _patch(client, hw, requires_drawing=True)
    assert await _view(client, hw) is not None
    await _set(QuestionBankItem, hw["item_id"], final_answer="Something else")
    assert await _view(client, hw) is None


async def test_two_saves_during_one_write_make_one_call(
    hw: dict[str, Any], client: AsyncClient, writer: Writer,
) -> None:
    writer.reply = []  # approve's write saves nothing, so another is due
    await _approve(client, hw)
    item = await _item(hw["item_id"])
    graph_checklist.schedule_write(item, user_id=None)
    graph_checklist.schedule_write(item, user_id=None)
    await drain_checklist_tasks()
    assert len(writer.calls) == 2  # approve's, then one for both saves


async def test_rewrite_on_a_one_point_problem_says_why(
    hw: dict[str, Any], client: AsyncClient, writer: Writer,
) -> None:
    await _approve(client, hw)
    await _set(Assignment, hw["hw_id"], total_points=1)
    r = await client.post(
        f"/v1/teacher/question-bank/{hw['item_id']}/graph-checklist/rewrite",
        headers=_auth(hw["teacher_token"]),
    )
    assert r.status_code == 400 and "worth 1 point" in r.json()["detail"]


# ── requires a drawing on / off ──


async def test_switching_requires_drawing_on_writes_and_off_keeps_it(
    hw: dict[str, Any], client: AsyncClient, writer: Writer,
) -> None:
    await _set(QuestionBankItem, hw["item_id"], requires_drawing=False)
    await _approve(client, hw)
    assert writer.calls == []
    await _patch(client, hw, requires_drawing=True)
    assert len(writer.calls) == 1
    assert (await _view(client, hw)) is not None
    await _patch(client, hw, requires_drawing=False)
    assert (await _view(client, hw)) is not None
    # Back on: it already has one, so nothing is written again.
    await _patch(client, hw, requires_drawing=True)
    assert len(writer.calls) == 1


# ── points ──


async def test_rule_linked_items_take_the_rules_points_live(
    hw: dict[str, Any], client: AsyncClient, writer: Writer,
) -> None:
    await _approve(client, hw)
    await _set(Course, hw["course_id"], rubric={"rules": [{**RULE, "points": 1}], "rev": 2})
    assert [i["points"] for i in (await _view(client, hw))["items"]] == [3, 3, 1]
    # A rule with no points: the item keeps its own.
    await _set(Course, hw["course_id"], rubric={"rules": [{**RULE, "points": None}], "rev": 3})
    assert [(i["points"], i["rule_id"]) for i in (await _view(client, hw))["items"]][2] == (2, "r1")
    # A deleted rule: the item is unlinked.
    await _set(Course, hw["course_id"], rubric={"rules": [], "rev": 4})
    assert [(i["points"], i["rule_id"]) for i in (await _view(client, hw))["items"]][2] == (2, None)


async def test_a_rule_the_homework_skips_is_never_linked(
    hw: dict[str, Any], client: AsyncClient, writer: Writer,
) -> None:
    await _set(Assignment, hw["hw_id"], rubric={"skipped_rule_ids": ["r1"]})
    await _approve(client, hw)
    # The writer only hears about the rules the grader applies here.
    assert writer.calls[0]["class_rules"] == []
    # Stored linked (as a stale model answer would be): read unlinked, own points.
    await _set(QuestionBankItem, hw["item_id"], graph_checklist={
        **(await _item(hw["item_id"])).graph_checklist,
        "items": [{"text": "Asymptotes labeled", "points": 3, "rule_id": "r1"}],
    })
    assert [(i["points"], i["rule_id"]) for i in (await _view(client, hw))["items"]] == [(3, None)]
    r = await _put(client, hw, [{"text": "Asymptotes labeled", "points": 1, "rule_id": "r1"}])
    assert r.status_code == 400


async def test_without_problem_points_a_deleted_rule_still_unlinks(
    hw: dict[str, Any], client: AsyncClient, writer: Writer,
) -> None:
    await _approve(client, hw)
    await _set(Assignment, hw["hw_id"], content={"problem_ids": []})
    await _set(Course, hw["course_id"], rubric={"rules": [], "rev": 2})
    view = await _view(client, hw)
    assert view["problem_points"] is None
    assert [(i["points"], i["rule_id"]) for i in view["items"]][2] == (2, None)


async def test_the_checklist_scales_with_the_problems_points(
    hw: dict[str, Any], client: AsyncClient, writer: Writer,
) -> None:
    await _approve(client, hw)
    await _set(Assignment, hw["hw_id"], total_points=20)
    view = await _view(client, hw)
    # Free items double; the rule item keeps the rule's 2.
    assert [i["points"] for i in view["items"]] == [6, 6, 2]
    assert (view["graph_points"], view["problem_points"]) == (14, 20)
    await _set(Assignment, hw["hw_id"], total_points=5)
    view = await _view(client, hw)
    assert view["graph_points"] < 5 and all(i["points"] >= 1 for i in view["items"])


async def test_fit_scales_proportionally_in_whole_points() -> None:
    items = [ChecklistItem("a", 2), ChecklistItem("b", 3, "r1"), ChecklistItem("c", 1)]
    fitted = fit_checklist(items, 10, 20, [RULE])
    assert [i.points for i in fitted] == [4, 2, 2]
    # Back at the stored points, the stored points (rule item at the rule's).
    assert [i.points for i in fit_checklist(items, 10, 10, [RULE])] == [2, 2, 1]


async def test_fit_keeps_the_graph_part_below_the_problem() -> None:
    items = [ChecklistItem("a", 3), ChecklistItem("b", 3), ChecklistItem("c", 3, "r1")]
    # 9 of 10 fits; on a 6-point problem the free items give way first.
    assert [i.points for i in fit_checklist(items, 10, 10)] == [3, 3, 3]
    fitted = fit_checklist(items, 6, 6, [{**RULE, "points": 3}])
    assert sum(i.points for i in fitted) == 5 and fitted[2].points == 3
    # More items than points to give: the last ones go to 0, never over.
    assert [i.points for i in fit_checklist(items, 10, 2)] == [1, 0, 0]


async def test_fit_unlinks_a_missing_rule() -> None:
    (item,) = fit_checklist([ChecklistItem("a", 2, "gone")], 10, 10, [RULE])
    assert (item.rule_id, item.points) == (None, 2)


# ── validation ──


@pytest.mark.parametrize(("items", "code"), [
    ([], 422),
    ([{"text": f"item {n}", "points": 1} for n in range(7)], 422),
    ([{"text": "   ", "points": 1}], 422),
    ([{"text": "x" * 201, "points": 1}], 422),
    ([{"text": "a", "points": 0}], 422),
    ([{"text": "a", "points": 1.5}], 422),
    ([{"text": "a", "points": 6}, {"text": "b", "points": 4}], 400),  # sum = the problem's 10
    ([{"text": "a", "points": 1, "rule_id": "nope"}], 400),
])
async def test_edit_validation(
    hw: dict[str, Any], client: AsyncClient, writer: Writer, items: list[dict[str, Any]], code: int,
) -> None:
    await _approve(client, hw)
    r = await _put(client, hw, items)
    assert r.status_code == code, r.text
    assert (await _view(client, hw))["teacher_edited"] is False


async def test_edit_counts_a_rule_item_at_the_rules_points(
    hw: dict[str, Any], client: AsyncClient, writer: Writer,
) -> None:
    await _approve(client, hw)
    await _set(Course, hw["course_id"], rubric={"rules": [{**RULE, "points": 6}], "rev": 2})
    r = await _put(client, hw, [{"text": "a", "points": 4}, {"text": "b", "points": 1, "rule_id": "r1"}])
    assert r.status_code == 400  # 4 + the rule's 6 leaves nothing for the work


# ── the writer's code around the model ──


class Reply:
    def __init__(self, out: dict[str, Any]) -> None:
        self.out = out
        self.calls: list[str] = []

    async def __call__(self, system: str, user: str, mode: str, **kw: Any) -> dict[str, Any]:
        self.calls.append(user)
        return self.out


async def test_writer_parses_defensively_and_holds_the_sum(monkeypatch: pytest.MonkeyPatch) -> None:
    reply = Reply({"items": [
        {"text": "Vertical asymptote drawn at x = 2", "points": "lots", "rule_id": None},
        {"text": "Horizontal asymptote drawn at y = 1", "points": 0, "rule_id": None},
        {"text": "Asymptotes labeled", "points": 7, "rule_id": "r1"},
        {"text": "Crosses the x-axis at (1, 0)", "points": 9, "rule_id": "made-up"},
        {"text": "   ", "points": 2, "rule_id": None},
        "junk",
    ]})
    monkeypatch.setattr(drawing_check, "call_claude_json", reply)
    items = (await write_graph_checklist(QUESTION, ANSWER, 10, class_rules=[RULE])).items
    assert "worth 10 points" in reply.calls[0]
    assert [i.text for i in items] == [
        "Vertical asymptote drawn at x = 2", "Horizontal asymptote drawn at y = 1",
        "Asymptotes labeled", "Crosses the x-axis at (1, 0)",
    ]
    # Unparseable and 0 points become 1; the rule item takes the rule's 2;
    # the made-up rule is unlinked; the total leaves a point for the work.
    assert items[0].points == 1 and items[1].points == 1
    assert (items[2].points, items[2].rule_id) == (2, "r1")
    assert items[3].rule_id is None
    assert sum(i.points for i in items) <= 9


async def test_writer_caps_the_item_count(monkeypatch: pytest.MonkeyPatch) -> None:
    reply = Reply({"items": [{"text": f"item {n}", "points": 1, "rule_id": None} for n in range(9)]})
    monkeypatch.setattr(drawing_check, "call_claude_json", reply)
    assert len((await write_graph_checklist(QUESTION, ANSWER, 20)).items) == 6


async def test_writer_skips_a_problem_with_no_room_for_a_graph_part(monkeypatch: pytest.MonkeyPatch) -> None:
    reply = Reply({"items": []})
    monkeypatch.setattr(drawing_check, "call_claude_json", reply)
    assert (await write_graph_checklist(QUESTION, ANSWER, 1)).items == []
    assert reply.calls == []


def test_values_the_key_never_gives_are_flagged() -> None:
    question = "Sketch two periods of $y = -2 + 3\\tan(5x - 30°)$."
    key = "Period: 36°. Points: (-3°, -5), (6°, -2), (15°, 1)."
    assert values_not_given("Curve passes through (-3°, -5) and (6°, -2)", question, key) == []
    assert values_not_given("Vertical asymptotes at x = -1.5° and x = 16.5°", question, key) == ["1.5", "16.5"]
    # 0 is the axes; ½ is 1/2.
    assert values_not_given("Crosses the y-axis at (0, −½)", "f(x) = (x+1)/(x-2)") == []


async def test_writer_flags_values_it_worked_out(monkeypatch: pytest.MonkeyPatch) -> None:
    reply = Reply({"asks_for_drawing": True, "items": [
        {"text": "Vertical asymptote drawn at x = 2", "points": 3, "rule_id": None},
        {"text": "Crosses the y-axis at (0, -0.5)", "points": 3, "rule_id": None},
    ]})
    monkeypatch.setattr(drawing_check, "call_claude_json", reply)
    items = (await write_graph_checklist("Graph f(x) = (x+1)/(x-2).", "VA x = 2, HA y = 1", 10)).items
    assert [i.values_to_check for i in items] == [[], ["0.5"]]


async def test_writer_can_say_no_drawing_is_asked(monkeypatch: pytest.MonkeyPatch) -> None:
    reply = Reply({"asks_for_drawing": False, "items": [
        {"text": "No graph required", "points": 9, "rule_id": None},
    ]})
    monkeypatch.setattr(drawing_check, "call_claude_json", reply)
    written = await write_graph_checklist("Find the hypotenuse.", "12", 10)
    assert written == WrittenChecklist([], asks_for_drawing=False)
