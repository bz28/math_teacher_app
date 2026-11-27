"""POST /v1/teacher/assignments/{id}/duplicate: a homework copied into a
new draft, in its own course or another of the teacher's.

Same course: the copy points at the same bank questions. Another course:
each question is copied into that course, still approved, and the copy
remembers its source homework. Either way the due date and sections are
the ones picked in the dialog, never the source's."""
from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select

from api.database import get_session_factory
from api.models.assignment import Assignment, AssignmentSection
from api.models.course import Course, CourseTeacher
from api.models.question_bank import QuestionBankItem
from api.models.section import Section
from api.models.unit import Unit
from tests.conftest import auth_headers as _auth


async def _setup(world: dict[str, Any]) -> dict[str, Any]:
    """Give the teacher the world's course, a second course (sections, a
    'quadratics' unit spelled differently), and a fully configured source
    homework in the current content shape."""
    async with get_session_factory()() as s:
        source = await s.get(Assignment, world["assignment_id"])
        assert source is not None
        course_id = source.course_id
        primary = await s.get(QuestionBankItem, world["primary_id"])
        assert primary is not None
        second = QuestionBankItem(
            course_id=course_id, unit_id=world["unit_id"],
            originating_assignment_id=source.id, title="Quadratics 2",
            question="Solve x^2 - 4 = 0", final_answer="x = ±2",
            status="approved", source="generated", graph_checklist={"items": []},
        )
        s.add(second)
        await s.flush()
        source.content = {"problem_ids": [str(primary.id), str(second.id)]}
        source.rubric = {"notes": "Show the factoring.", "skipped_rule_ids": ["r1"]}
        source.total_points = 30
        source.problem_points = {str(primary.id): 20, str(second.id): 10}
        source.late_policy = "penalty_per_day"
        source.description = "Box your answers."
        source.due_at = datetime(2025, 10, 1, 3, 59, tzinfo=UTC)

        section_id = (await s.execute(
            select(Section.id).where(Section.course_id == course_id)
        )).scalar_one()
        other = Course(name="Algebra 1 (2026-27)", subject="math")
        s.add(other)
        await s.flush()
        other_unit = Unit(course_id=other.id, name="  QUADRATICS ", position=0)
        other_section = Section(course_id=other.id, name="Period 2")
        s.add_all([
            other_unit, other_section,
            CourseTeacher(course_id=course_id, teacher_id=world["teacher_id"], role="owner"),
            CourseTeacher(course_id=other.id, teacher_id=world["teacher_id"], role="owner"),
        ])
        await s.commit()
        return {
            "source_id": source.id, "course_id": course_id, "section_id": section_id,
            "primary_id": primary.id, "second_id": second.id,
            "other_id": other.id, "other_unit_id": other_unit.id,
            "other_section_id": other_section.id,
        }


async def _duplicate(client: AsyncClient, world: dict[str, Any], body: dict[str, Any]) -> Any:
    return await client.post(
        f"/v1/teacher/assignments/{world['assignment_id']}/duplicate",
        json=body, headers=_auth(world["teacher_token"]),
    )


async def test_same_course_copy_points_at_the_same_questions(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    w = await _setup(world)
    r = await _duplicate(client, world, {
        "due_at": "2026-12-05T04:59:00Z", "section_ids": [str(w["section_id"])],
    })
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "draft" and body["course_id"] == str(w["course_id"])
    async with get_session_factory()() as s:
        dup = await s.get(Assignment, uuid.UUID(body["id"]))
        assert dup is not None
        assert dup.content == {"problem_ids": [str(w["primary_id"]), str(w["second_id"])]}
        assert dup.rubric == {"notes": "Show the factoring.", "skipped_rule_ids": ["r1"]}
        assert dup.total_points == 30
        assert dup.problem_points == {str(w["primary_id"]): 20, str(w["second_id"]): 10}
        assert dup.late_policy == "penalty_per_day"
        assert dup.description == "Box your answers."
        assert dup.unit_ids == [world["unit_id"]]
        assert dup.due_at == datetime(2026, 12, 5, 4, 59, tzinfo=UTC)
        assert dup.source_homework_id is None
        sections = (await s.execute(
            select(AssignmentSection.section_id).where(AssignmentSection.assignment_id == dup.id)
        )).scalars().all()
        assert sections == [w["section_id"]]
        # Same course: no new questions were made.
        n = len((await s.execute(
            select(QuestionBankItem.id).where(QuestionBankItem.course_id == w["course_id"])
        )).scalars().all())
        assert n == 6  # world's primary + 4 variations + the second question


async def test_another_course_gets_its_own_approved_questions(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    w = await _setup(world)
    r = await _duplicate(client, world, {
        "course_id": str(w["other_id"]), "section_ids": [str(w["other_section_id"])],
    })
    assert r.status_code == 201, r.text
    async with get_session_factory()() as s:
        dup = await s.get(Assignment, uuid.UUID(r.json()["id"]))
        assert dup is not None
        assert dup.course_id == w["other_id"] and dup.status == "draft"
        assert dup.source_homework_id == w["source_id"]
        assert dup.due_at is None
        # The unit matched by name (case and spaces ignored), not created.
        assert dup.unit_ids == [w["other_unit_id"]]
        assert dup.content is not None
        new_ids = dup.content["problem_ids"]
        assert len(new_ids) == 2
        assert not {str(w["primary_id"]), str(w["second_id"])} & set(new_ids)
        items = {str(i.id): i for i in (await s.execute(
            select(QuestionBankItem).where(QuestionBankItem.id.in_([uuid.UUID(i) for i in new_ids]))
        )).scalars().all()}
        first, second = items[new_ids[0]], items[new_ids[1]]
        assert (first.question, second.question) == ("Solve x^2 - 5x + 6 = 0", "Solve x^2 - 4 = 0")
        for item in (first, second):
            assert item.course_id == w["other_id"]
            assert item.unit_id == w["other_unit_id"]
            assert item.status == "approved" and item.parent_question_id is None
            assert item.originating_assignment_id == dup.id
            assert not item.locked
        assert first.distractors == ["x=1", "x=-2", "x=5"]
        # Points follow their problems to the new ids.
        assert dup.problem_points == {new_ids[0]: 20, new_ids[1]: 10}
        # The other course's skipped class rules mean nothing here.
        assert dup.rubric == {"notes": "Show the factoring."}
        assert dup.late_policy == "penalty_per_day" and dup.total_points == 30
        # The source and its questions are untouched.
        src = await s.get(Assignment, w["source_id"])
        assert src is not None
        assert src.content == {"problem_ids": [str(w["primary_id"]), str(w["second_id"])]}


async def test_another_course_without_the_unit_gets_it_made(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    w = await _setup(world)
    async with get_session_factory()() as s:
        unit = await s.get(Unit, w["other_unit_id"])
        assert unit is not None
        unit.name = "Linear equations"
        await s.commit()
    r = await _duplicate(client, world, {"course_id": str(w["other_id"])})
    assert r.status_code == 201, r.text
    async with get_session_factory()() as s:
        dup = await s.get(Assignment, uuid.UUID(r.json()["id"]))
        assert dup is not None
        made = await s.get(Unit, dup.unit_ids[0])
        assert made is not None
        assert (made.course_id, made.name, made.parent_unit_id) == (w["other_id"], "Quadratics", None)
        assert made.position == 1


async def test_legacy_content_and_json_null_rubric_copy_across_courses(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """The world homework keeps the legacy inline `problems` shape; prod
    rubrics are JSON null. Both must copy cleanly."""
    w = await _setup(world)
    async with get_session_factory()() as s:
        src = await s.get(Assignment, w["source_id"])
        assert src is not None
        src.content = {"problems": [{"bank_item_id": str(w["primary_id"]), "position": 1}]}
        src.rubric = None
        src.problem_points = None
        await s.commit()
    r = await _duplicate(client, world, {"course_id": str(w["other_id"])})
    assert r.status_code == 201, r.text
    async with get_session_factory()() as s:
        dup = await s.get(Assignment, uuid.UUID(r.json()["id"]))
        assert dup is not None and dup.content is not None
        assert len(dup.content["problem_ids"]) == 1
        assert dup.rubric is None and dup.problem_points is None


async def test_refuses_a_course_or_section_that_isnt_the_teachers(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    w = await _setup(world)
    async with get_session_factory()() as s:
        stranger = Course(name="Someone else's", subject="math")
        s.add(stranger)
        await s.commit()
        stranger_id = stranger.id
    r = await _duplicate(client, world, {"course_id": str(stranger_id)})
    assert r.status_code == 404
    # A section from the other course can't go on a same-course copy.
    r = await _duplicate(client, world, {"section_ids": [str(w["other_section_id"])]})
    assert r.status_code == 404
    r = await _duplicate(client, world, {"due_at": "2026-12-05T23:59"})
    assert r.status_code == 400
    async with get_session_factory()() as s:
        n = len((await s.execute(
            select(Assignment.id).where(Assignment.title == "HW 1")
        )).scalars().all())
        assert n == 1  # nothing was half-made
