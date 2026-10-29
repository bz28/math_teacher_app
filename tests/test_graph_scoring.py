"""A graph problem's grade from its two parts, and the teacher's review of it.

`run_ai_grading_for_submission` grades a problem whose question has a
graph checklist in two parts — the drawing against the checklist, the
written work by the grader — and keeps the check on
`SubmissionGrade.graph_checks`. The teacher then settles every item the
check couldn't decide (✓ keeps its points, ✗ takes them off), and Approve
waits until she has. A problem she re-scores by hand is hers.
"""

from __future__ import annotations

import base64
import io
import uuid
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from PIL import Image
from sqlalchemy import select

from api.core import graph_grading
from api.core.drawing_check import ChecklistItem, DrawingCheck, ItemResult
from api.core.grading_ai import run_ai_grading_for_submission as _real_run_ai_grading
from api.core.graph_checklist import source_of, to_stored
from api.database import get_session_factory
from api.models.assignment import Submission, SubmissionGrade
from api.models.question_bank import QuestionBankItem
from tests.conftest import auth_headers as _auth
from tests.test_teacher_review_checkpoint import _seed_hw

pytestmark = pytest.mark.asyncio

# Each problem is worth 50 points (100 split two ways). The checklist,
# written as 2 + 3 of 10, is fitted to 10 + 15 of 50, leaving 25 for the
# written work.
ITEMS = [ChecklistItem("Line through (0, 1) and (2, 5)", 2), ChecklistItem("Intersection marked at (2, 5)", 3)]
BOX = {"x0": 0.1, "y0": 0.1, "x1": 0.5, "y1": 0.5}

_EXTRACTION: dict[str, Any] = {
    "steps": [
        {"step_num": 1, "problem_position": 1, "page_index": 1, "latex": "y = 2x + 1", "plain_english": ""},
        {"step_num": 1, "problem_position": 2, "page_index": 1, "latex": "x = 2, 3", "plain_english": ""},
    ],
    "final_answers": [
        {"problem_position": 1, "answer_latex": "(2, 5)", "answer_plain": "", "page_index": 1},
        {"problem_position": 2, "answer_latex": "x=2,3", "answer_plain": "", "page_index": 1},
    ],
    "visual_work": [{
        "problem_position": 1, "kind": "graph", "present": True, "page_index": 1, "bbox": BOX,
        "plotted_elements": ["a rising line"], "labeled_points": ["(2, 5)"], "answer_on_drawing": "(2, 5)",
    }],
    "confidence": 0.9,
}


def _grades(p1: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"grades": [
        {"problem_position": 1, "score_status": "full", "percent": 100, "confidence": 0.9,
         "student_feedback": "Right answer.", "reasoning": "r", "deductions": [], **(p1 or {})},
        {"problem_position": 2, "score_status": "full", "percent": 100, "confidence": 0.9,
         "student_feedback": "Right.", "reasoning": "r", "deductions": []},
    ]}


def _jpeg() -> str:
    buf = io.BytesIO()
    Image.new("RGB", (300, 400), (250, 250, 250)).save(buf, format="JPEG")
    return base64.b64encode(buf.getvalue()).decode()


async def _seed(*, graph: bool = True) -> dict[str, Any]:
    world = await _seed_hw(n_problems=2)
    async with get_session_factory()() as s:
        item = await s.get(QuestionBankItem, uuid.UUID(world["bank_item_ids"][0]))
        assert item is not None
        if graph:
            item.question, item.final_answer = "Graph y = 2x + 1 and y = 5.", "(2, 5)"
            item.requires_drawing = True
            item.graph_checklist = to_stored(ITEMS, 10, source=source_of(item), teacher_edited=False)
        sub = await s.get(Submission, world["submission_ids"][0])
        assert sub is not None
        sub.files = [{"data": _jpeg(), "media_type": "image/jpeg"}]
        sub.extraction = _EXTRACTION
        await s.commit()
    world["sub_id"] = world["submission_ids"][0]
    world["graph_id"] = world["bank_item_ids"][0]
    world["other_id"] = world["bank_item_ids"][1]
    return world


class _Look:
    """Stands in for check_drawing."""

    def __init__(self, *verdicts: str) -> None:
        self.verdicts = verdicts
        self.calls = 0

    async def __call__(self, *a: Any, **kw: Any) -> DrawingCheck:
        self.calls += 1
        return DrawingCheck("tight", "whole", [ItemResult(n, v, f"saw {n}") for n, v in enumerate(self.verdicts, 1)])  # type: ignore[arg-type]


async def _grade(
    sub_id: uuid.UUID, look: _Look, *, grades: dict[str, Any] | None = None, force: bool = False,
) -> AsyncMock:
    grader = AsyncMock(return_value=grades or _grades())
    with (
        patch("api.core.grading_ai.grade_submission_with_ai", grader),
        patch.object(graph_grading, "check_drawing", look),
    ):
        async with get_session_factory()() as s:
            await _real_run_ai_grading(sub_id, _EXTRACTION, s, force=force)
            await s.commit()
    return grader


async def _row(sub_id: uuid.UUID) -> SubmissionGrade:
    async with get_session_factory()() as s:
        return (await s.execute(select(SubmissionGrade).where(SubmissionGrade.submission_id == sub_id))).scalar_one()


def _entry(row: SubmissionGrade, pid: str) -> dict[str, Any]:
    return next(e for e in row.breakdown or [] if e["problem_id"] == pid)


# ── grading ────────────────────────────────────────────────────────


async def test_a_graph_problem_is_graded_in_two_parts() -> None:
    w = await _seed()
    grader = await _grade(w["sub_id"], _Look("yes", "no"))
    problems = grader.await_args.args[1]
    assert problems[0]["graph_part"].work_points == 25 and "graph_part" not in problems[1]

    row = await _row(w["sub_id"])
    e = _entry(row, w["graph_id"])
    # Work 25/25 + line 10/10 + intersection 0/15 = 35/50.
    assert e["score_status"] == "partial" and e["percent"] == pytest.approx(70)
    assert [d["reason"] for d in e["deductions"]] == ["Graph: Intersection marked at (2, 5)"]
    assert "graph" not in e and "needs_check" not in e
    assert row.final_score == pytest.approx(85)
    stored = (row.graph_checks or {})[w["graph_id"]]
    assert [(i["text"], i["verdict"], i["teacher"]) for i in stored["items"]] == [
        (ITEMS[0].text, "yes", None), (ITEMS[1].text, "no", None),
    ]
    # The AI's call is the whole problem's grade; the grader's own is kept.
    ai = next(g for g in (row.ai_breakdown or {})["grades"] if g["problem_position"] == 1)
    assert ai["percent"] == pytest.approx(70) and ai["work_percent"] == 100
    assert ai["deductions"] == e["deductions"]
    assert row.ai_score == pytest.approx(85)


async def test_a_homework_without_graph_checklists_grades_as_before() -> None:
    w = await _seed(graph=False)
    look = _Look()
    grader = await _grade(w["sub_id"], look)
    assert look.calls == 0 and all("graph_part" not in p for p in grader.await_args.args[1])
    row = await _row(w["sub_id"])
    assert row.graph_checks is None and row.final_score == 100


async def test_a_regrade_keeps_the_check_until_the_checklist_changes(client: AsyncClient) -> None:
    w = await _seed()
    first = _Look("yes", "unclear")
    await _grade(w["sub_id"], first)
    r = await client.post(
        f"/v1/teacher/submissions/{w['sub_id']}/graph-items",
        json={"problem_id": w["graph_id"], "n": 2, "verdict": "no"}, headers=_auth(w["teacher_token"]),
    )
    assert r.status_code == 200, r.text

    again = _Look("yes", "yes")
    await _grade(w["sub_id"], again, force=True)
    stored = ((await _row(w["sub_id"])).graph_checks or {})[w["graph_id"]]
    # Same checklist: no new look, and her call is cleared with the rest
    # of her review — the item is unclear again.
    assert again.calls == 0 and [i["verdict"] for i in stored["items"]] == ["yes", "unclear"]
    assert all(i["teacher"] is None for i in stored["items"])

    async with get_session_factory()() as s:
        item = await s.get(QuestionBankItem, uuid.UUID(w["graph_id"]))
        assert item is not None
        item.graph_checklist = to_stored(
            [ITEMS[0], ChecklistItem("Intersection labeled (2, 5)", 3)], 10,
            source=source_of(item), teacher_edited=True,
        )
        await s.commit()
    await _grade(w["sub_id"], again, force=True)
    stored = ((await _row(w["sub_id"])).graph_checks or {})[w["graph_id"]]
    assert again.calls == 1 and [i["verdict"] for i in stored["items"]] == ["yes", "yes"]


async def test_a_blank_graph_problem_earns_no_graph_points() -> None:
    w = await _seed()
    blank = {**_EXTRACTION, "steps": _EXTRACTION["steps"][1:], "final_answers": _EXTRACTION["final_answers"][1:],
             "visual_work": []}
    grader = AsyncMock(return_value=_grades({"score_status": "zero", "percent": 0}))
    look = _Look()
    with (
        patch("api.core.grading_ai.grade_submission_with_ai", grader),
        patch.object(graph_grading, "check_drawing", look),
    ):
        async with get_session_factory()() as s:
            await _real_run_ai_grading(w["sub_id"], blank, s)
            await s.commit()
    row = await _row(w["sub_id"])
    assert look.calls == 0 and _entry(row, w["graph_id"])["percent"] == 0
    stored = (row.graph_checks or {})[w["graph_id"]]
    assert stored["note"] == "not_drawn" and {i["verdict"] for i in stored["items"]} == {"no"}

    # A regrade over a read that finds the drawing looks at it: a stand-in
    # for a blank problem is never reused.
    again = _Look("yes", "yes")
    await _grade(w["sub_id"], again, force=True)
    stored = ((await _row(w["sub_id"])).graph_checks or {})[w["graph_id"]]
    assert again.calls == 1 and stored["note"] is None


# ── the teacher's review ───────────────────────────────────────────


async def _verdict(client: AsyncClient, w: dict[str, Any], n: int, verdict: str) -> Any:
    return await client.post(
        f"/v1/teacher/submissions/{w['sub_id']}/graph-items",
        json={"problem_id": w["graph_id"], "n": n, "verdict": verdict}, headers=_auth(w["teacher_token"]),
    )


async def _approve(client: AsyncClient, w: dict[str, Any]) -> Any:
    return await client.post(f"/v1/teacher/submissions/{w['sub_id']}/mark-reviewed", headers=_auth(w["teacher_token"]))


async def test_the_review_page_gets_the_check_item_by_item(client: AsyncClient) -> None:
    w = await _seed()
    await _grade(w["sub_id"], _Look("yes", "unclear"))
    r = await client.get(f"/v1/teacher/submissions/{w['sub_id']}", headers=_auth(w["teacher_token"]))
    assert r.status_code == 200, r.text
    problems = {p["bank_item_id"]: p for p in r.json()["problems"]}
    g = problems[w["graph_id"]]["graph"]
    assert g["points"] == 50 and g["graph_points"] == 25 and g["open_items"] == 1
    assert [(i["text"], i["points"], i["verdict"], i["seen"]) for i in g["items"]] == [
        (ITEMS[0].text, 10, "yes", "saw 1"), (ITEMS[1].text, 15, "unclear", "saw 2"),
    ]
    assert problems[w["other_id"]]["graph"] is None


async def test_approve_waits_on_every_unclear_item(client: AsyncClient) -> None:
    w = await _seed()
    await _grade(w["sub_id"], _Look("unclear", "unclear"))
    r = await _approve(client, w)
    assert r.status_code == 409 and "2 graph checklist items" in r.json()["detail"]
    assert (await _verdict(client, w, 1, "yes")).status_code == 200
    r = await _approve(client, w)
    assert r.status_code == 409 and "1 graph checklist item " in r.json()["detail"]
    assert (await _verdict(client, w, 2, "yes")).status_code == 200
    assert (await _approve(client, w)).status_code == 200


async def test_a_tick_keeps_the_points_and_a_cross_takes_them_off(client: AsyncClient) -> None:
    w = await _seed()
    await _grade(w["sub_id"], _Look("yes", "unclear"))
    assert _entry(await _row(w["sub_id"]), w["graph_id"])["percent"] == pytest.approx(100)

    r = await _verdict(client, w, 2, "no")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["entry"]["percent"] == pytest.approx(70) and body["final_score"] == pytest.approx(85)
    assert body["graph"]["open_items"] == 0 and body["graph"]["items"][1]["teacher"] == "no"
    assert body["graph_items_open"] == 0
    row = await _row(w["sub_id"])
    e = _entry(row, w["graph_id"])
    assert e["score_status"] == "partial"
    assert [(d["reason"], d["points_off"]) for d in e["deductions"]] == [("Graph: Intersection marked at (2, 5)", 30)]

    # Changing her mind puts the points back and the line goes.
    r = await _verdict(client, w, 2, "yes")
    e = _entry(await _row(w["sub_id"]), w["graph_id"])
    assert e["percent"] == pytest.approx(100) and e["score_status"] == "full" and e["deductions"] == []
    assert r.json()["final_score"] == pytest.approx(100)


async def test_only_items_the_check_left_unclear_take_a_call(client: AsyncClient) -> None:
    w = await _seed()
    await _grade(w["sub_id"], _Look("yes", "no"))
    r = await _verdict(client, w, 1, "no")
    assert r.status_code == 409 and "couldn't decide" in r.json()["detail"]
    assert (await _verdict(client, w, 9, "no")).status_code == 409
    r = await client.post(
        f"/v1/teacher/submissions/{w['sub_id']}/graph-items",
        json={"problem_id": w["other_id"], "n": 1, "verdict": "no"}, headers=_auth(w["teacher_token"]),
    )
    assert r.status_code == 404


async def _save(client: AsyncClient, w: dict[str, Any], percent: float, feedback: str = "f") -> None:
    row = await _row(w["sub_id"])
    breakdown = [
        {**e, "feedback": feedback, "percent": percent, "score_status": "partial",
         "deductions": None} if e["problem_id"] == w["graph_id"] else e
        for e in row.breakdown or []
    ]
    r = await client.patch(
        f"/v1/teacher/submissions/{w['sub_id']}/grade", json={"breakdown": breakdown},
        headers=_auth(w["teacher_token"]),
    )
    assert r.status_code == 200, r.text


async def test_a_problem_she_rescores_by_hand_is_hers(client: AsyncClient) -> None:
    w = await _seed()
    await _grade(w["sub_id"], _Look("yes", "unclear"))
    assert (await _approve(client, w)).status_code == 409
    await _save(client, w, 80)
    stored = ((await _row(w["sub_id"])).graph_checks or {})[w["graph_id"]]
    assert stored["overridden"] is True
    r = await _verdict(client, w, 2, "no")
    assert r.status_code == 409 and "re-scored" in r.json()["detail"]
    assert (await _approve(client, w)).status_code == 200


async def test_a_save_that_keeps_the_score_doesnt_take_the_problem_over(client: AsyncClient) -> None:
    w = await _seed()
    await _grade(w["sub_id"], _Look("yes", "no"))
    row = await _row(w["sub_id"])
    breakdown = [{**e, "feedback": "Nice graph."} for e in row.breakdown or []]
    r = await client.patch(
        f"/v1/teacher/submissions/{w['sub_id']}/grade", json={"breakdown": breakdown},
        headers=_auth(w["teacher_token"]),
    )
    assert r.status_code == 200, r.text
    row = await _row(w["sub_id"])
    assert ((row.graph_checks or {})[w["graph_id"]])["overridden"] is False
    # The graph deduction survives the save as part of the ledger.
    assert [d["source"] for d in _entry(row, w["graph_id"])["deductions"]] == ["graph_checklist"]


async def test_the_roster_counts_the_graph_items_waiting_on_her(client: AsyncClient) -> None:
    w = await _seed()
    await _grade(w["sub_id"], _Look("unclear", "unclear"))

    async def waiting() -> int:
        r = await client.get(
            f"/v1/teacher/assignments/{w['assignment_id']}/submissions", headers=_auth(w["teacher_token"]),
        )
        assert r.status_code == 200, r.text
        row = next(x for x in r.json()["submissions"] if x["id"] == str(w["sub_id"]))
        return int(row["graph_items_open"])

    assert await waiting() == 2
    await _verdict(client, w, 1, "no")
    assert await waiting() == 1
