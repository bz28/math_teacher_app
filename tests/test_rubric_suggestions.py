"""'Add this to your rubric?' offers after a teacher lowers a grade.

The AI call (`_classify`) is stubbed: these pin the code around it — when
an offer is even considered, what the classification leads to, that a
declined rule is never offered again while an ignored one comes back, and
what each answer does to the class rubric or the homework.
"""

import uuid
from typing import Any
from unittest.mock import AsyncMock, patch

from httpx import AsyncClient
from sqlalchemy import select

from api.database import get_session_factory
from api.models.assignment import Assignment, SubmissionGrade
from api.models.course import Course, CourseTeacher
from api.models.rubric_suggestion import RubricSuggestion
from tests.conftest import auth_headers as _auth
from tests.test_teacher_review_checkpoint import _seed_hw

_CLASSIFY = "api.core.rubric_suggestions._classify"


async def _world(class_rules: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    world = await _seed_hw()
    async with get_session_factory()() as s:
        a = (await s.execute(
            select(Assignment).where(Assignment.id == world["assignment_id"])
        )).scalar_one()
        s.add(CourseTeacher(course_id=a.course_id, teacher_id=uuid.UUID(world["teacher_id"]), role="owner"))
        if class_rules is not None:
            course = (await s.execute(select(Course).where(Course.id == a.course_id))).scalar_one()
            course.rubric = {"rules": class_rules}
        s.add(SubmissionGrade(
            submission_id=world["submission_ids"][0],
            ai_breakdown={"grades": [{"problem_position": 1, "score_status": "full",
                                      "percent": 100, "student_answer": "x=2,3"}]},
        ))
        await s.commit()
        world["course_id"] = a.course_id
    return world


async def _ask(client: AsyncClient, world: dict[str, Any], *, percent: float = 95,
               comment: str = "Answers need units.", classified: dict[str, Any] | None = None,
               ) -> tuple[Any, AsyncMock]:
    stub = AsyncMock(return_value=classified)
    with patch(_CLASSIFY, new=stub):
        res = await client.post(
            f"/v1/teacher/submissions/{world['submission_ids'][0]}/rubric-suggestion",
            json={"problem_id": world["bank_item_id"], "teacher_percent": percent, "comment": comment},
            headers=_auth(world["teacher_token"]),
        )
    assert res.status_code == 200, res.text
    return res.json()["suggestion"], stub


def _rule(text: str = "Final answers need units.", same_as: str | None = None) -> dict[str, Any]:
    return {"kind": "rule", "rule_text": text, "same_as": same_as}


async def _offers(course_id: Any) -> list[RubricSuggestion]:
    async with get_session_factory()() as s:
        return list((await s.execute(
            select(RubricSuggestion).where(RubricSuggestion.course_id == course_id)
        )).scalars().all())


async def test_no_offer_unless_the_grade_went_down_with_a_comment(client: AsyncClient) -> None:
    world = await _world()
    offer, stub = await _ask(client, world, percent=100, classified=_rule())
    assert offer is None and stub.await_count == 0
    offer, stub = await _ask(client, world, percent=90, comment="   ", classified=_rule())
    assert offer is None and stub.await_count == 0


async def test_a_one_off_comment_offers_nothing(client: AsyncClient) -> None:
    world = await _world()
    offer, _ = await _ask(client, world, comment="You misread the 8 as a 6.",
                          classified={"kind": "one_off", "rule_text": None, "same_as": None})
    assert offer is None
    assert await _offers(world["course_id"]) == []


async def test_a_rule_is_offered_with_the_points_the_teacher_took_off(client: AsyncClient) -> None:
    world = await _world()
    offer, stub = await _ask(client, world, percent=95, classified=_rule())
    assert offer["text"] == "Final answers need units."
    assert offer["points"] == 5
    assert offer["source_label"] == "HW 1"
    assert offer["status"] == "pending"
    assert stub.await_args.kwargs["comment"] == "Answers need units."


async def test_a_rule_the_class_already_has_is_not_offered(client: AsyncClient) -> None:
    world = await _world([{"id": "r1", "text": "Units on final answers.", "points": 5}])
    offer, stub = await _ask(client, world, classified=_rule(same_as="r1"))
    assert offer is None
    assert ("r1", "Units on final answers.") in stub.await_args.kwargs["known"]


async def test_an_ignored_offer_comes_back_and_a_declined_one_never_does(client: AsyncClient) -> None:
    world = await _world()
    first, _ = await _ask(client, world, classified=_rule())
    key = f"s{uuid.UUID(first['id']).hex[:8]}"

    # Ignored: the same offer again, no new row.
    again, _ = await _ask(client, world, comment="Feet!", classified=_rule("Units needed.", same_as=key))
    assert again["id"] == first["id"]
    assert len(await _offers(world["course_id"])) == 1

    res = await client.post(f"/v1/teacher/rubric-suggestions/{first['id']}/decide",
                            json={"action": "decline"}, headers=_auth(world["teacher_token"]))
    assert res.json()["suggestion"]["status"] == "declined"

    later, _ = await _ask(client, world, comment="degrees missing",
                          classified=_rule("Include units.", same_as=key))
    assert later is None

    listed = await client.get(f"/v1/teacher/courses/{world['course_id']}/rubric-suggestions",
                              headers=_auth(world["teacher_token"]))
    assert [s["id"] for s in listed.json()["suggestions"]] == [first["id"]]


async def test_adding_to_the_class_rubric_records_where_it_came_from(client: AsyncClient) -> None:
    world = await _world([{"id": "r1", "text": "Show work.", "points": None}])
    offer, _ = await _ask(client, world, classified=_rule())
    res = await client.post(
        f"/v1/teacher/rubric-suggestions/{offer['id']}/decide",
        json={"action": "add_class", "text": "Final answers need units (ft, °).", "points": 5},
        headers=_auth(world["teacher_token"]),
    )
    assert res.status_code == 200
    rules = res.json()["rules"]
    assert [r["text"] for r in rules] == ["Show work.", "Final answers need units (ft, °)."]
    added = rules[1]
    assert (added["points"], added["source"], added["source_label"]) == (5, "suggestion", "HW 1")
    assert rules[0]["id"] == "r1"
    # Answered: asking again can't add it twice.
    again = await client.post(f"/v1/teacher/rubric-suggestions/{offer['id']}/decide",
                              json={"action": "add_class"}, headers=_auth(world["teacher_token"]))
    assert again.status_code == 409


async def test_adding_to_this_homework_only_appends_an_extra_rule(client: AsyncClient) -> None:
    world = await _world()
    async with get_session_factory()() as s:
        a = (await s.execute(select(Assignment).where(Assignment.id == world["assignment_id"]))).scalar_one()
        a.rubric = {"notes": "Two periods.", "skipped_rule_ids": ["r9"]}
        await s.commit()
    offer, _ = await _ask(client, world, classified=_rule())
    res = await client.post(f"/v1/teacher/rubric-suggestions/{offer['id']}/decide",
                            json={"action": "add_homework"}, headers=_auth(world["teacher_token"]))
    assert res.json()["suggestion"]["status"] == "added_homework"
    async with get_session_factory()() as s:
        rubric = (await s.execute(
            select(Assignment.rubric).where(Assignment.id == world["assignment_id"])
        )).scalar_one()
    assert rubric == {"notes": "Two periods.\nFinal answers need units. Take off 5.",
                      "skipped_rule_ids": ["r9"]}


async def test_a_declined_rule_can_still_be_added_later(client: AsyncClient) -> None:
    world = await _world()
    offer, _ = await _ask(client, world, classified=_rule())
    h = _auth(world["teacher_token"])
    await client.post(f"/v1/teacher/rubric-suggestions/{offer['id']}/decide", json={"action": "decline"}, headers=h)
    res = await client.post(f"/v1/teacher/rubric-suggestions/{offer['id']}/decide",
                            json={"action": "add_class"}, headers=h)
    assert res.status_code == 200
    assert [r["text"] for r in res.json()["rules"]] == ["Final answers need units."]


async def test_another_teacher_can_neither_ask_nor_answer(client: AsyncClient, world: dict[str, Any]) -> None:
    mine = await _world()
    offer, _ = await _ask(client, mine, classified=_rule())
    other = _auth(world["teacher_token"])
    res = await client.post(
        f"/v1/teacher/submissions/{mine['submission_ids'][0]}/rubric-suggestion",
        json={"problem_id": mine["bank_item_id"], "teacher_percent": 90, "comment": "units"},
        headers=other,
    )
    assert res.status_code in (403, 404)
    res = await client.post(f"/v1/teacher/rubric-suggestions/{offer['id']}/decide",
                            json={"action": "decline"}, headers=other)
    assert res.status_code == 404


async def test_the_ais_own_feedback_is_not_a_reason(client: AsyncClient) -> None:
    world = await _world()
    async with get_session_factory()() as s:
        g = (await s.execute(
            select(SubmissionGrade).where(SubmissionGrade.submission_id == world["submission_ids"][0])
        )).scalar_one()
        g.ai_breakdown = {"grades": [{**g.ai_breakdown["grades"][0], "student_feedback": "Nice work."}]}
        await s.commit()
    offer, stub = await _ask(client, world, comment="Nice work.", classified=_rule())
    assert offer is None and stub.await_count == 0


async def test_declined_wins_over_a_pending_duplicate(client: AsyncClient) -> None:
    world = await _world()
    async with get_session_factory()() as s:
        s.add_all([
            RubricSuggestion(course_id=world["course_id"], text="Final answers need units.", status="pending"),
            RubricSuggestion(course_id=world["course_id"], text="final answers need units", status="declined"),
        ])
        await s.commit()
    offer, _ = await _ask(client, world, classified=_rule())
    assert offer is None


async def test_the_same_rule_worded_identically_reuses_the_pending_offer(client: AsyncClient) -> None:
    world = await _world()
    first, _ = await _ask(client, world, classified=_rule())
    again, _ = await _ask(client, world, comment="units!", classified=_rule("Final answers need units"))
    assert again["id"] == first["id"]
    assert len(await _offers(world["course_id"])) == 1


async def test_adding_to_a_deleted_homework_says_so(client: AsyncClient) -> None:
    world = await _world()
    offer, _ = await _ask(client, world, classified=_rule())
    async with get_session_factory()() as s:
        row = (await s.execute(
            select(RubricSuggestion).where(RubricSuggestion.id == uuid.UUID(offer["id"]))
        )).scalar_one()
        row.assignment_id = None
        await s.commit()
    res = await client.post(f"/v1/teacher/rubric-suggestions/{offer['id']}/decide",
                            json={"action": "add_homework"}, headers=_auth(world["teacher_token"]))
    assert res.status_code == 422
    assert "no longer exists" in res.json()["detail"]


async def test_a_co_teacher_can_add_to_the_class_but_not_to_anothers_homework(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    mine = await _world()
    offer, _ = await _ask(client, mine, classified=_rule())
    async with get_session_factory()() as s:
        s.add(CourseTeacher(course_id=mine["course_id"], teacher_id=world["teacher_id"], role="co"))
        await s.commit()
    co = _auth(world["teacher_token"])
    res = await client.post(f"/v1/teacher/rubric-suggestions/{offer['id']}/decide",
                            json={"action": "add_homework"}, headers=co)
    assert res.status_code == 403
    res = await client.post(f"/v1/teacher/rubric-suggestions/{offer['id']}/decide",
                            json={"action": "add_class"}, headers=co)
    assert res.status_code == 200
