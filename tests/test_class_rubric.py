"""A class's grading rules reach the grader.

A teacher's standards ("final answers need units", "write the axis as
y = 1") hold for a whole class. They live on `Course.rubric`, every
homework inherits them, a homework can skip one, and each grade freezes
the rules it was graded under. These pin that path end to end:

1. Storage: the class rubric endpoint keeps rule ids stable across edits,
   stamps new ones, and only the class's own teachers can touch it.
2. Merge: `effective_rubric` drops skipped rules and leaves a class with
   no rules exactly as it was.
3. Prompt: rules appear, with their ids and points, only when there are
   some — a class without rules is graded by the unchanged prompt.
4. Grading run: the grader receives the merged rules, the grade row
   snapshots them, and a deduction keeps its `rule_id` only when it names
   a rule the grader was actually given — through the teacher's save too.
"""

import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from pydantic import ValidationError
from sqlalchemy import select

from api.core.class_rubric import MAX_CLASS_RULES, ClassRubric, effective_rubric
from api.core.grading_ai import _build_rubric_block, _reconcile_deductions
from api.core.grading_ai import (
    run_ai_grading_for_submission as _real_run_ai_grading,
)
from api.database import get_session_factory
from api.models.assignment import Assignment, Submission, SubmissionGrade
from api.models.course import Course, CourseTeacher
from tests.conftest import auth_headers as _auth
from tests.test_teacher_review_checkpoint import _seed_hw

_UNITS = {"id": "r1", "text": "Final answers need units.", "points": 5}
_AXIS = {"id": "r2", "text": "Write the axis as y = 1, not just 1.", "points": None}


# ── merge ────────────────────────────────────────────────────────────


def test_no_rules_and_no_homework_rubric_is_no_rubric() -> None:
    assert effective_rubric(None, None) is None
    assert effective_rubric({"rules": []}, None) is None


def test_homework_fields_pass_through_and_skipped_rules_drop() -> None:
    merged = effective_rubric(
        {"rules": [_UNITS, _AXIS]},
        {"notes": "Two full periods.", "skipped_rule_ids": ["r2"]},
    )
    assert merged == {
        "notes": "Two full periods.",
        "rules": [{"id": "r1", "text": "Final answers need units.", "points": 5}],
    }


def test_a_class_with_no_rules_leaves_the_homework_rubric_as_is() -> None:
    hw = {"full_credit": "Correct, with work."}
    assert effective_rubric(None, hw) == hw


# ── storage shape ────────────────────────────────────────────────────


def test_to_stored_keeps_known_ids_and_stamps_new_ones() -> None:
    previous = {"rules": [{**_UNITS, "source": "suggestion", "source_label": "HW 5",
                           "added_at": "2026-10-18T00:00:00+00:00"}]}
    body = ClassRubric.model_validate({"rules": [
        {"id": "r1", "text": " Final answers need units (ft, °). ", "points": 5},
        {"text": "Label every key point.", "points": 15},
    ]})
    stored = body.to_stored(previous)
    assert stored is not None
    kept, new = stored["rules"]
    # Editing the text keeps the id, origin and date the grades cite.
    assert kept["id"] == "r1"
    assert kept["text"] == "Final answers need units (ft, °)."
    assert kept["source"] == "suggestion" and kept["source_label"] == "HW 5"
    assert kept["added_at"] == "2026-10-18T00:00:00+00:00"
    assert new["id"].startswith("r") and new["id"] != "r1"
    assert new["source"] == "settings" and new["added_at"]


def test_an_unknown_id_is_treated_as_a_new_rule() -> None:
    stored = ClassRubric.model_validate(
        {"rules": [{"id": "forged", "text": "Show work."}]}
    ).to_stored(None)
    assert stored is not None
    assert stored["rules"][0]["id"] != "forged"


def test_a_repeated_id_names_only_one_rule() -> None:
    stored = ClassRubric.model_validate(
        {"rules": [{"id": "r1", "text": "Units."}, {"id": "r1", "text": "Show work."}]}
    ).to_stored({"rules": [_UNITS]})
    assert stored is not None
    first, second = stored["rules"]
    assert first["id"] == "r1" and second["id"] not in ("r1", "")


def test_clearing_every_rule_stores_none() -> None:
    assert ClassRubric(rules=[]).to_stored({"rules": [_UNITS]}) is None


def test_rule_limits() -> None:
    with pytest.raises(ValidationError):
        ClassRubric.model_validate({"rules": [{"text": "   "}]})
    with pytest.raises(ValidationError):
        ClassRubric.model_validate({"rules": [{"text": "x", "points": 101}]})
    with pytest.raises(ValidationError):
        ClassRubric.model_validate(
            {"rules": [{"text": f"rule {i}"} for i in range(MAX_CLASS_RULES + 1)]}
        )


# ── prompt ───────────────────────────────────────────────────────────


def test_rules_render_with_ids_and_points_only_when_present() -> None:
    plain = _build_rubric_block({"notes": "Two full periods."})
    assert "Class rules" not in plain

    block = _build_rubric_block(
        effective_rubric({"rules": [_UNITS, _AXIS]}, {"notes": "Two full periods."})
    )
    assert "Class rules" in block
    assert "[r1] Final answers need units. (take off 5 points)" in block
    assert "[r2] Write the axis as y = 1, not just 1." in block
    assert "[r2] Write the axis as y = 1, not just 1. (" not in block


def test_a_deduction_keeps_only_a_rule_id_the_grader_was_given() -> None:
    ledger = _reconcile_deductions(
        [
            {"points_off": 5, "reason": "No unit", "step_ref": None, "rule_id": "r1"},
            {"points_off": 5, "reason": "Slip", "step_ref": None, "rule_id": "r9"},
        ],
        90.0, fallback_reason=None, submission_id=None, problem_id="p",
        step_count=None, rule_ids=frozenset({"r1"}),
    )
    assert [d["rule_id"] for d in ledger] == ["r1", None]


# ── endpoints ────────────────────────────────────────────────────────


async def _course_of(assignment_id: uuid.UUID) -> uuid.UUID:
    async with get_session_factory()() as s:
        return (await s.execute(
            select(Assignment.course_id).where(Assignment.id == assignment_id)
        )).scalar_one()


async def _link(teacher_id: str, course_id: uuid.UUID) -> None:
    async with get_session_factory()() as s:
        s.add(CourseTeacher(course_id=course_id, teacher_id=uuid.UUID(teacher_id), role="owner"))
        await s.commit()


async def test_class_rubric_round_trips_and_keeps_ids(client: AsyncClient) -> None:
    world = await _seed_hw()
    course_id = await _course_of(world["assignment_id"])
    await _link(world["teacher_id"], course_id)
    url = f"/v1/teacher/courses/{course_id}/rubric"
    headers = _auth(world["teacher_token"])

    assert (await client.get(url, headers=headers)).json() == {"rules": []}

    res = await client.put(url, json={"rules": [{"text": "Answers need units.", "points": 5}]},
                           headers=headers)
    assert res.status_code == 200
    (rule,) = res.json()["rules"]

    res = await client.put(url, json={"rules": [{**rule, "text": "Answers need units (ft)."}]},
                           headers=headers)
    assert res.json()["rules"][0]["id"] == rule["id"]
    assert (await client.get(url, headers=headers)).json()["rules"][0]["text"] == (
        "Answers need units (ft)."
    )

    assert (await client.put(url, json={"rules": []}, headers=headers)).json() == {"rules": []}


async def test_another_teacher_cannot_read_or_write_the_class_rubric(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    mine = await _seed_hw()
    course_id = await _course_of(mine["assignment_id"])
    await _link(mine["teacher_id"], course_id)
    url = f"/v1/teacher/courses/{course_id}/rubric"
    other = _auth(world["teacher_token"])
    assert (await client.get(url, headers=other)).status_code == 404
    assert (await client.put(url, json={"rules": []}, headers=other)).status_code == 404


async def test_homework_rubric_stores_skipped_rule_ids(client: AsyncClient) -> None:
    world = await _seed_hw()
    await _link(world["teacher_id"], await _course_of(world["assignment_id"]))
    res = await client.patch(
        f"/v1/teacher/assignments/{world['assignment_id']}",
        json={"rubric": {"notes": "Two periods.", "skipped_rule_ids": ["r2", "r1", "r2"]}},
        headers=_auth(world["teacher_token"]),
    )
    assert res.status_code == 200
    async with get_session_factory()() as s:
        rubric = (await s.execute(
            select(Assignment.rubric).where(Assignment.id == world["assignment_id"])
        )).scalar_one()
    assert rubric == {"notes": "Two periods.", "skipped_rule_ids": ["r1", "r2"]}


# ── grading run ──────────────────────────────────────────────────────

_EXTRACTION: dict[str, Any] = {
    "steps": [{"step_num": 1, "problem_position": 1, "latex": "h = 15.76",
               "plain_english": ""}],
    "final_answers": [{"problem_position": 1, "answer_latex": "15.76", "answer_plain": ""}],
    "confidence": 0.9,
}


def _grader_result(rule_id: str | None) -> dict[str, Any]:
    return {"grades": [{
        "problem_position": 1, "score_status": "partial", "percent": 95,
        "confidence": 0.9, "student_answer": "15.76",
        "student_feedback": "Add the unit.", "reasoning": "No unit.",
        "deductions": [{"points_off": 5, "reason": "No unit on the answer",
                        "step_ref": None, "rule_id": rule_id}],
    }]}


async def _ready_with_rules(class_rules: list[dict[str, Any]], hw_rubric: dict[str, Any] | None,
                            ) -> tuple[dict[str, Any], uuid.UUID]:
    world = await _seed_hw()
    sid = world["submission_ids"][0]
    async with get_session_factory()() as s:
        a = (await s.execute(
            select(Assignment).where(Assignment.id == world["assignment_id"])
        )).scalar_one()
        a.rubric = hw_rubric
        course = (await s.execute(select(Course).where(Course.id == a.course_id))).scalar_one()
        course.rubric = {"rules": class_rules}
        sub = (await s.execute(select(Submission).where(Submission.id == sid))).scalar_one()
        sub.extraction = _EXTRACTION
        sub.extraction_confirmed_at = datetime.now(UTC)
        await s.commit()
    return world, sid


async def _grade_row(sid: uuid.UUID) -> SubmissionGrade:
    async with get_session_factory()() as s:
        return (await s.execute(
            select(SubmissionGrade).where(SubmissionGrade.submission_id == sid)
        )).scalar_one()


async def test_grader_gets_merged_rules_and_the_grade_snapshots_them() -> None:
    _, sid = await _ready_with_rules([_UNITS, _AXIS], {"skipped_rule_ids": ["r2"]})
    grader = AsyncMock(return_value=_grader_result("r1"))
    async with get_session_factory()() as s:
        with patch("api.core.grading_ai.grade_submission_with_ai", new=grader):
            await _real_run_ai_grading(sid, _EXTRACTION, s)
        await s.commit()

    rubric_sent = grader.await_args.args[2]
    assert rubric_sent == {"rules": [{"id": "r1", "text": "Final answers need units.",
                                      "points": 5}]}
    grade = await _grade_row(sid)
    assert grade.rubric_snapshot == rubric_sent
    assert grade.breakdown[0]["deductions"][0]["rule_id"] == "r1"


async def test_a_rule_the_homework_skipped_is_never_cited() -> None:
    _, sid = await _ready_with_rules([_UNITS], {"skipped_rule_ids": ["r1"]})
    grader = AsyncMock(return_value=_grader_result("r1"))
    async with get_session_factory()() as s:
        with patch("api.core.grading_ai.grade_submission_with_ai", new=grader):
            await _real_run_ai_grading(sid, _EXTRACTION, s)
        await s.commit()

    assert grader.await_args.args[2] is None
    grade = await _grade_row(sid)
    assert grade.rubric_snapshot is None
    assert grade.breakdown[0]["deductions"][0]["rule_id"] is None


async def test_the_teacher_save_keeps_the_rule_tag(client: AsyncClient) -> None:
    world, sid = await _ready_with_rules([_UNITS], None)
    await _link(world["teacher_id"], await _course_of(world["assignment_id"]))
    grader = AsyncMock(return_value=_grader_result("r1"))
    async with get_session_factory()() as s:
        with patch("api.core.grading_ai.grade_submission_with_ai", new=grader):
            await _real_run_ai_grading(sid, _EXTRACTION, s)
        await s.commit()
    entry = (await _grade_row(sid)).breakdown[0]

    # The teacher confirms the AI's grade, editing only the feedback.
    res = await client.patch(
        f"/v1/teacher/submissions/{sid}/grade",
        json={"breakdown": [{
            "problem_id": entry["problem_id"], "score_status": "partial",
            "percent": 95, "feedback": "Units, please.",
            "deductions": entry["deductions"],
        }]},
        headers=_auth(world["teacher_token"]),
    )
    assert res.status_code == 200
    assert (await _grade_row(sid)).breakdown[0]["deductions"][0]["rule_id"] == "r1"


def test_rule_ids_in_the_graders_prose_become_the_rules_words() -> None:
    from api.core.grading_ai import _name_rules_in_text

    result = {"grades": [{
        "reasoning": "Missing units, which violates class rule [r1].",
        "student_feedback": "Remember r1.",
        "deductions": [{"points_off": 5, "reason": "No unit — r1", "rule_id": "r1"}],
    }]}
    _name_rules_in_text(result, [_UNITS])
    g = result["grades"][0]
    assert g["reasoning"] == "Missing units, which violates class rule “Final answers need units.”."
    assert g["student_feedback"] == "Remember “Final answers need units.”."
    assert g["deductions"][0]["reason"] == "No unit — “Final answers need units.”"
    # The citation itself is untouched.
    assert g["deductions"][0]["rule_id"] == "r1"


def test_rule_text_with_latex_backslashes_is_inserted_literally() -> None:
    from api.core.grading_ai import _name_rules_in_text

    rule = {"id": "r1", "text": r"Leave answers in \sqrt{} form, not \frac{}{} or \1."}
    result = {"grades": [{"reasoning": "Breaks [r1].", "deductions": []}]}
    _name_rules_in_text(result, [rule])
    assert result["grades"][0]["reasoning"] == f"Breaks “{rule['text']}”."


def test_a_non_string_rule_id_is_dropped() -> None:
    ledger = _reconcile_deductions(
        [{"points_off": 5, "reason": "x", "step_ref": None, "rule_id": ["r1"]}],
        95.0, fallback_reason=None, submission_id=None, problem_id="p",
        step_count=None, rule_ids=frozenset({"r1"}),
    )
    assert ledger[0]["rule_id"] is None


async def test_a_skips_only_rubric_is_not_offered_as_a_copy_source(client: AsyncClient) -> None:
    world = await _seed_hw()
    async with get_session_factory()() as s:
        a = (await s.execute(
            select(Assignment).where(Assignment.id == world["assignment_id"])
        )).scalar_one()
        a.rubric = {"skipped_rule_ids": ["r1"]}
        await s.commit()
    res = await client.get("/v1/teacher/rubric-sources", headers=_auth(world["teacher_token"]))
    assert res.status_code == 200
    assert [x["id"] for x in res.json()["sources"]] == []
