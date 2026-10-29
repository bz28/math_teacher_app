"""Homework points: the even split, point-weighted scores, class rules
charged in real points, and re-weighing saved grades when points change."""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from api.core.grading_ai import _build_breakdown, _build_system_prompt
from api.core.homework_points import even_split, problem_points, weighted_percent
from api.database import get_session_factory
from api.models.assignment import Assignment, SubmissionGrade
from tests.conftest import auth_headers as _auth
from tests.test_teacher_review_checkpoint import _seed_hw

pytestmark = pytest.mark.anyio


# ── the split and the score ──────────────────────────────────────────


def test_even_split_gives_the_remainder_to_the_first_problems() -> None:
    assert even_split(100, 7) == [15, 15, 14, 14, 14, 14, 14]
    assert even_split(30, 3) == [10, 10, 10]
    assert even_split(100, 0) == []


def test_no_problem_is_ever_worth_nothing() -> None:
    assert even_split(3, 7) == [1] * 7


def test_hand_set_points_fill_a_new_problem_with_the_average() -> None:
    assert problem_points(100, {"a": 10, "b": 30}, ["a", "b", "c"]) == {"a": 10, "b": 30, "c": 20}
    assert problem_points(30, None, ["a", "b", "c"]) == {"a": 10, "b": 10, "c": 10}


def test_equal_points_give_exactly_the_old_average() -> None:
    """The backfill's promise: 10 points each changes no score."""
    percents = [100.0, 70.0, 100.0, 50.0, 80.0]
    ids = [f"p{i}" for i in range(5)]
    score = weighted_percent(zip(ids, percents, strict=True), problem_points(50, None, ids))
    assert score == sum(percents) / 5 == 80.0


def test_points_weigh_the_score() -> None:
    assert weighted_percent([("a", 100.0), ("b", 0.0)], {"a": 30, "b": 10}) == 75.0
    assert weighted_percent([], {"a": 1}) is None


# ── grading in points ────────────────────────────────────────────────


def _partial(percent: float, *deductions: tuple[float, str | None]) -> dict[str, Any]:
    return {
        "problem_position": 1, "score_status": "partial", "percent": percent,
        "deductions": [
            {"points_off": po, "reason": "r", "step_ref": None, "rule_id": rid}
            for po, rid in deductions
        ],
    }


def _one(grade: dict[str, Any], points: int, rules: dict[str, int | None] | None = None) -> dict[str, Any]:
    breakdown, _ = _build_breakdown([grade], {1: "p1"}, points={"p1": points}, rules=rules or {})
    return breakdown[0]


def test_a_cited_rule_costs_exactly_its_points() -> None:
    # The model took 5% for the units rule; on a 14-point problem the
    # rule's 1 point is 7.14%.
    e = _one(_partial(95, (5, "r1")), 14, {"r1": 1})
    assert e["deductions"][0]["points_off"] == pytest.approx(100 / 14)
    assert e["deductions"][0]["source"] == "class_rule"
    assert e["percent"] == pytest.approx(13 / 14 * 100)


def test_a_rule_is_charged_once_per_problem() -> None:
    e = _one(_partial(90, (5, "r1"), (5, "r1")), 10, {"r1": 1})
    assert len(e["deductions"]) == 1
    assert e["percent"] == 90.0


def test_ai_judgment_rounds_to_half_a_point_and_never_to_nothing() -> None:
    e = _one(_partial(97, (3, None)), 10)  # 0.3 points
    assert e["deductions"][0]["points_off"] == 5.0  # 0.5 of 10
    assert e["deductions"][0]["source"] == "ai_judgment"
    e = _one(_partial(87, (13, None)), 10)  # 1.3 points
    assert e["percent"] == 85.0


def test_small_ai_lines_are_rounded_together_not_one_by_one() -> None:
    # Three 1% slips on a 4-point problem are 0.12 points: half a point
    # in all, not half a point each.
    e = _one(_partial(97, (1, None), (1, None), (1, None)), 4)
    assert e["percent"] == 87.5
    assert sum(d["points_off"] for d in e["deductions"]) == 12.5


def test_many_lines_still_add_up_to_the_rounded_total() -> None:
    e = _one(_partial(88, (3, None), (3, None), (3, None), (3, None)), 10)  # 1.2 points
    assert e["percent"] == 90.0


def test_nothing_takes_off_more_than_the_problem_is_worth() -> None:
    e = _one(_partial(35, (60, None), (5, "r1")), 2, {"r1": 5})
    assert e["percent"] == 0.0 and e["score_status"] == "zero"


def test_a_ledger_short_of_the_percent_keeps_the_grade_partial() -> None:
    e = _one(_partial(99), 100)
    assert e["score_status"] == "partial" and e["percent"] == 99.0


def _full(*deductions: tuple[float, str | None]) -> dict[str, Any]:
    return {**_partial(100, *deductions), "score_status": "full", "percent": 100}


def test_a_cited_rule_turns_a_full_call_partial() -> None:
    # The grader called it full but listed the units rule (683d8bfa P2):
    # the rule still costs its point, and its line stays on the receipt.
    grade = _full((5, "r1"))
    e = _one(grade, 10, {"r1": 1})
    assert e["score_status"] == "partial" and e["percent"] == 90.0
    assert [(d["rule_id"], d["source"]) for d in e["deductions"]] == [("r1", "class_rule")]
    assert grade["score_status"] == "partial" and grade["percent"] == 90.0


def test_a_full_call_drops_its_own_judgment_lines_but_keeps_rule_lines() -> None:
    e = _one(_full((3, None), (5, "r1")), 10, {"r1": 1})
    assert e["percent"] == 90.0
    assert [d["rule_id"] for d in e["deductions"]] == ["r1"]


def test_a_rule_with_no_points_is_sized_by_the_grader() -> None:
    e = _one(_full((20, "r1")), 10, {"r1": None})
    assert e["score_status"] == "partial" and e["percent"] == 80.0


def test_a_full_call_without_a_rule_line_stays_full() -> None:
    for grade in (_full(), _full((5, None)), _full((5, "not-a-class-rule")), _full((0, "r1"))):
        e = _one(grade, 10, {"r1": 1})
        assert e["score_status"] == "full" and e["percent"] == 100.0
        assert sum(d["points_off"] for d in e["deductions"]) == 0


def test_a_rule_cited_again_and_again_on_a_full_call_is_charged_once() -> None:
    # The cold review's repro: r1 three times at 50% on a 2-point problem
    # with a 1-point units rule. One class-rule line, 1 of 2 off.
    e = _one(_full((50, "r1"), (50, "r1"), (50, "r1")), 2, {"r1": 1})
    assert e["score_status"] == "partial" and e["percent"] == 50.0
    assert [(d["rule_id"], d["source"]) for d in e["deductions"]] == [("r1", "class_rule")]


def test_an_oversized_rule_with_no_points_keeps_its_tag() -> None:
    e = _one(_full((150, "r1")), 10, {"r1": None})
    assert [d["source"] for d in e["deductions"]] == ["class_rule"]
    assert sum(d["points_off"] for d in e["deductions"]) == pytest.approx(100 - e["percent"])


def test_a_rule_worth_more_than_the_problem_takes_it_to_zero_tagged() -> None:
    e = _one(_full((5, "r1")), 2, {"r1": 5})
    assert e["score_status"] == "zero" and e["percent"] == 0.0
    assert [d["source"] for d in e["deductions"]] == ["class_rule"]


def test_a_converted_call_names_its_rules_in_the_reasoning() -> None:
    grade = {**_full((5, "r1")), "reasoning": "All correct, full credit."}
    _build_breakdown(
        [grade], {1: "p1"}, points={"p1": 10}, rules={"r1": 1},
        rule_texts={"r1": "Final answers need units"},
    )
    assert grade["reasoning"] == "Class rule: Final answers need units. Otherwise full credit."


def test_the_raw_grade_carries_the_final_call() -> None:
    """The review page reads the raw grade as the AI's call."""
    grade = _partial(95, (5, "r1"))
    _build_breakdown([grade], {1: "p1"}, points={"p1": 10}, rules={"r1": 2})
    assert grade["percent"] == 80.0 and grade["deductions"][0]["source"] == "class_rule"


def test_the_ai_score_is_weighted_by_points() -> None:
    grades = [
        {"problem_position": 1, "score_status": "full", "percent": 100},
        {"problem_position": 2, "score_status": "zero", "percent": 0},
    ]
    _, ai_score = _build_breakdown(grades, {1: "a", 2: "b"}, points={"a": 30, "b": 10})
    assert ai_score == 75.0


def test_problem_points_reach_the_prompt_only_with_class_rules() -> None:
    problems = [{"position": 1, "question": "Q", "final_answer": "A", "points": 14}]
    assert "Worth:" not in _build_system_prompt({"notes": "n"}, problems)
    with_rules = _build_system_prompt({"rules": [{"id": "r1", "text": "Units", "points": 1}]}, problems)
    assert "Worth: 14 points" in with_rules
    assert "[r1] Units (take off 1 of the problem's points)" in with_rules


# ── endpoints ────────────────────────────────────────────────────────


async def _grade(sub_id: Any, breakdown: list[dict[str, Any]], ai_percents: dict[str, float] | None) -> None:
    async with get_session_factory()() as s:
        score = sum(e["percent"] for e in breakdown) / len(breakdown)
        s.add(SubmissionGrade(
            submission_id=sub_id, breakdown=breakdown, final_score=score,
            ai_score=score if ai_percents else None,
            ai_breakdown={"grades": [], "problem_percents": ai_percents} if ai_percents else None,
        ))
        await s.commit()


async def _row(sub_id: Any) -> SubmissionGrade:
    async with get_session_factory()() as s:
        return (await s.execute(
            select(SubmissionGrade).where(SubmissionGrade.submission_id == sub_id)
        )).scalar_one()


async def test_setting_points_rescores_saved_grades(client: AsyncClient) -> None:
    world = await _seed_hw(n_problems=2)
    a, b = world["bank_item_ids"]
    sub = world["submission_ids"][0]
    await _grade(sub, [
        {"problem_id": a, "score_status": "full", "percent": 100.0},
        {"problem_id": b, "score_status": "zero", "percent": 0.0},
    ], {a: 100.0, b: 0.0})
    url = f"/v1/teacher/assignments/{world['assignment_id']}"
    headers = _auth(world["teacher_token"])

    res = await client.patch(url, json={"problem_points": {a: 30, b: 10}}, headers=headers)
    assert res.status_code == 200
    g = await _row(sub)
    assert (g.final_score, g.ai_score) == (75.0, 75.0)
    assert g.graded_at is not None

    detail = (await client.get(url, headers=headers)).json()["points"]
    assert detail == {"total": 40, "by_problem": {a: 30, b: 10}, "custom": True}

    # "Split evenly" goes back to an even split of a new total.
    res = await client.patch(url, json={"total_points": 20}, headers=headers)
    assert res.status_code == 200
    assert (await _row(sub)).final_score == 50.0
    detail = (await client.get(url, headers=headers)).json()["points"]
    assert detail == {"total": 20, "by_problem": {a: 10, b: 10}, "custom": False}


async def test_points_must_cover_exactly_the_problems(client: AsyncClient) -> None:
    world = await _seed_hw(n_problems=2)
    a, _ = world["bank_item_ids"]
    url = f"/v1/teacher/assignments/{world['assignment_id']}"
    headers = _auth(world["teacher_token"])
    assert (await client.patch(url, json={"problem_points": {a: 5}}, headers=headers)).status_code == 400
    assert (await client.patch(url, json={"total_points": 1}, headers=headers)).status_code == 400
    assert (await client.patch(url, json={"problem_points": {a: 0}}, headers=headers)).status_code == 422


async def test_a_teacher_save_keeps_the_deduction_source(client: AsyncClient) -> None:
    world = await _seed_hw(n_problems=1)
    sub = world["submission_ids"][0]
    res = await client.patch(
        f"/v1/teacher/submissions/{sub}/grade",
        json={"breakdown": [{
            "problem_id": world["bank_item_id"], "score_status": "partial", "percent": 90,
            "deductions": [{"points_off": 10, "reason": "No unit", "rule_id": None, "source": "class_rule"}],
        }]},
        headers=_auth(world["teacher_token"]),
    )
    assert res.status_code == 200
    assert (await _row(sub)).breakdown[0]["deductions"][0]["source"] == "class_rule"


async def test_a_hand_grade_is_weighted_by_points(client: AsyncClient) -> None:
    world = await _seed_hw(n_problems=2)
    a, b = world["bank_item_ids"]
    async with get_session_factory()() as s:
        hw = (await s.execute(select(Assignment).where(Assignment.id == world["assignment_id"]))).scalar_one()
        hw.problem_points = {a: 30, b: 10}
        await s.commit()
    sub = world["submission_ids"][0]
    res = await client.patch(
        f"/v1/teacher/submissions/{sub}/grade",
        json={"breakdown": [
            {"problem_id": a, "score_status": "full"},
            {"problem_id": b, "score_status": "zero"},
        ]},
        headers=_auth(world["teacher_token"]),
    )
    assert res.status_code == 200
    assert (await _row(sub)).final_score == 75.0


async def test_the_total_is_what_the_problems_add_up_to(client: AsyncClient) -> None:
    """A total set below the problem count still gives each problem 1."""
    world = await _seed_hw(n_problems=2)
    async with get_session_factory()() as s:
        hw = (await s.execute(select(Assignment).where(Assignment.id == world["assignment_id"]))).scalar_one()
        hw.total_points = 1
        await s.commit()
    res = await client.get(f"/v1/teacher/assignments/{world['assignment_id']}", headers=_auth(world["teacher_token"]))
    assert res.json()["points"]["total"] == 2
