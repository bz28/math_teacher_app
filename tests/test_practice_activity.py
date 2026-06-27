"""Integration tests for the practice/learn ACTIVITY DATA ENGINE:

  POST /v1/school/student/practice/{assignment_id}/activity   (record)
  GET  /v1/school/student/practice/activity                   (student read)
  GET  /v1/teacher/courses/{c}/sections/{s}/students/{u}/practice-activity
  GET  /v1/teacher/courses/{c}/sections/{s}/practice-insights

Builds on the shared `world` fixture (teacher + enrolled student +
outsider + course + section + published HW) and layers on a published
practice set with two approved variations.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select, text

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.assignment import Assignment, AssignmentSection
from api.models.course import CourseTeacher
from api.models.practice_activity import PracticeActivity
from api.models.question_bank import QuestionBankItem
from api.models.section_enrollment import SectionEnrollment
from api.models.user import User
from tests.conftest import auth_headers as _auth


async def _seed_practice(world: dict[str, Any]) -> dict[str, Any]:
    """Create a published practice set cloned from the world HW with two
    approved variations attached via originating_assignment_id, plus a
    second enrolled student. Returns ids the tests assert on."""
    async with get_session_factory()() as s:
        source_hw = (await s.execute(
            select(Assignment).where(Assignment.id == world["assignment_id"])
        )).scalar_one()

        practice = Assignment(
            course_id=source_hw.course_id,
            unit_ids=list(source_hw.unit_ids or []),
            teacher_id=world["teacher_id"],
            title="Quadratics Practice",
            type="practice",
            status="published",
            source_homework_id=source_hw.id,
            content=None,
        )
        s.add(practice)
        await s.flush()

        # The world fixture doesn't link the teacher to the course; the
        # teacher reads gate on CourseTeacher (get_teacher_course), so add it.
        s.add(CourseTeacher(
            course_id=source_hw.course_id,
            teacher_id=world["teacher_id"],
            role="owner",
        ))

        item_ids = []
        for i, (title, q, a) in enumerate([
            ("Factoring", "Solve x^2 - 5x + 6 = 0 (practice).", "x = 2 or x = 3"),
            ("Completing the square", "Solve x^2 + 4x = 5.", "x = 1 or x = -5"),
        ]):
            it = QuestionBankItem(
                course_id=source_hw.course_id,
                unit_id=world["unit_id"],
                originating_assignment_id=practice.id,
                title=title,
                question=q,
                solution_steps=[{"title": "Step", "description": "..."}],
                final_answer=a,
                distractors=[f"d{i}a", f"d{i}b", f"d{i}c"],
                status="approved",
                source="practice",
                parent_question_id=world["primary_id"],
            )
            s.add(it)
            item_ids.append(it)

        # Section the world HW is on (same section the student is in).
        section_id = (await s.execute(
            text(
                "SELECT section_id FROM assignment_sections "
                "WHERE assignment_id=:aid LIMIT 1"
            ),
            {"aid": world["assignment_id"]},
        )).scalar_one()
        s.add(AssignmentSection(
            assignment_id=practice.id,
            section_id=section_id,
            published_at=datetime.now(UTC),
        ))

        # A second enrolled student so class-level aggregates are real.
        student2 = User(
            email=f"student2_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"),
            grade_level=8,
            role="student",
            name="S2",
        )
        s.add(student2)
        await s.flush()
        s.add(SectionEnrollment(
            section_id=section_id,
            course_id=source_hw.course_id,
            student_id=student2.id,
        ))
        await s.commit()

        return {
            "practice_id": practice.id,
            "section_id": section_id,
            "item_ids": [it.id for it in item_ids],
            "student2_id": student2.id,
            "student2_token": create_access_token(str(student2.id), "student"),
        }


# ── Recording ──

async def test_enrolled_student_records_activity(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    p = await _seed_practice(world)
    body = [
        {"bank_item_id": str(p["item_ids"][0]), "mode": "practice",
         "outcome": "first_try", "tutor_message_count": 0},
        {"bank_item_id": str(p["item_ids"][1]), "mode": "practice",
         "outcome": "retry", "tutor_message_count": 3},
        {"bank_item_id": str(p["item_ids"][1]), "mode": "learn",
         "outcome": "completed", "tutor_message_count": 1},
    ]
    r = await client.post(
        f"/v1/school/student/practice/{p['practice_id']}/activity",
        json=body, headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200, r.text
    assert r.json()["recorded"] == 3

    async with get_session_factory()() as s:
        rows = (await s.execute(
            select(PracticeActivity).where(
                PracticeActivity.student_id == world["student_id"]
            )
        )).scalars().all()
    assert len(rows) == 3
    # section_id derived from enrollment, not the body.
    assert all(row.section_id == p["section_id"] for row in rows)


async def test_outsider_cannot_record(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    p = await _seed_practice(world)
    body = [{"bank_item_id": str(p["item_ids"][0]), "mode": "practice",
             "outcome": "first_try"}]
    r = await client.post(
        f"/v1/school/student/practice/{p['practice_id']}/activity",
        json=body, headers=_auth(world["outsider_token"]),
    )
    # Not enrolled → blocked by the shared practice gate.
    assert r.status_code == 403, r.text
    async with get_session_factory()() as s:
        n = (await s.execute(
            select(PracticeActivity).where(
                PracticeActivity.student_id == world["outsider_id"]
            )
        )).scalars().all()
    assert n == []


async def test_wrong_assignment_item_rejected(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    p = await _seed_practice(world)
    # world["primary_id"] is a HW bank item, not part of this practice set.
    body = [{"bank_item_id": str(world["primary_id"]), "mode": "practice",
             "outcome": "first_try"}]
    r = await client.post(
        f"/v1/school/student/practice/{p['practice_id']}/activity",
        json=body, headers=_auth(world["student_token"]),
    )
    assert r.status_code == 404, r.text


async def test_bad_outcome_for_mode_rejected(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    p = await _seed_practice(world)
    body = [{"bank_item_id": str(p["item_ids"][0]), "mode": "practice",
             "outcome": "completed"}]  # learn-only outcome on a practice row
    r = await client.post(
        f"/v1/school/student/practice/{p['practice_id']}/activity",
        json=body, headers=_auth(world["student_token"]),
    )
    assert r.status_code == 422, r.text


# ── Student read ──

async def test_student_read_returns_own_history_scoped(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    p = await _seed_practice(world)
    # Record for the world student via the API.
    await client.post(
        f"/v1/school/student/practice/{p['practice_id']}/activity",
        json=[
            {"bank_item_id": str(p["item_ids"][0]), "mode": "practice",
             "outcome": "first_try"},
            {"bank_item_id": str(p["item_ids"][1]), "mode": "practice",
             "outcome": "retry"},
            {"bank_item_id": str(p["item_ids"][0]), "mode": "learn",
             "outcome": "completed"},
        ],
        headers=_auth(world["student_token"]),
    )
    # And some activity for student2 that must NOT leak into the read.
    async with get_session_factory()() as s:
        s.add(PracticeActivity(
            student_id=p["student2_id"], section_id=p["section_id"],
            practice_assignment_id=p["practice_id"],
            bank_item_id=p["item_ids"][0], mode="practice", outcome="revealed",
        ))
        await s.commit()

    r = await client.get(
        "/v1/school/student/practice/activity",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["problems_practiced"] == 2  # two practice rows
    assert data["first_try_rate"] == 0.5  # 1 of 2 first try
    assert data["learn_walkthroughs"] == 1
    assert len(data["sets"]) == 1
    assert data["sets"][0]["practice_assignment_id"] == str(p["practice_id"])
    assert data["sets"][0]["problems_practiced"] == 2

    # course_id filter for an unrelated course yields nothing.
    r2 = await client.get(
        "/v1/school/student/practice/activity",
        params={"course_id": str(uuid.uuid4())},
        headers=_auth(world["student_token"]),
    )
    assert r2.status_code == 200
    assert r2.json()["problems_practiced"] == 0


# ── Teacher reads ──

async def _record_class_activity(p: dict[str, Any], world: dict[str, Any]) -> None:
    """Two students struggle on item 0; one of them also reveals item 1."""
    async with get_session_factory()() as s:
        s.add_all([
            PracticeActivity(
                student_id=world["student_id"], section_id=p["section_id"],
                practice_assignment_id=p["practice_id"],
                bank_item_id=p["item_ids"][0], mode="practice", outcome="retry",
                tutor_message_count=2,
            ),
            PracticeActivity(
                student_id=world["student_id"], section_id=p["section_id"],
                practice_assignment_id=p["practice_id"],
                bank_item_id=p["item_ids"][1], mode="practice", outcome="first_try",
            ),
            PracticeActivity(
                student_id=p["student2_id"], section_id=p["section_id"],
                practice_assignment_id=p["practice_id"],
                bank_item_id=p["item_ids"][0], mode="practice", outcome="revealed",
            ),
        ])
        await s.commit()


async def test_teacher_sees_student_engagement(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    p = await _seed_practice(world)
    await _record_class_activity(p, world)
    cid = await _course_id(world)

    r = await client.get(
        f"/v1/teacher/courses/{cid}/sections/{p['section_id']}"
        f"/students/{world['student_id']}/practice-activity",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["practiced_count"] == 2
    assert data["outcome_breakdown"]["retry"] == 1
    assert data["outcome_breakdown"]["first_try"] == 1
    # Struggle item = the one they retried.
    assert any(it["bank_item_id"] == str(p["item_ids"][0])
               for it in data["struggle_items"])


async def test_teacher_sees_class_insights(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    p = await _seed_practice(world)
    await _record_class_activity(p, world)
    cid = await _course_id(world)

    r = await client.get(
        f"/v1/teacher/courses/{cid}/sections/{p['section_id']}/practice-insights",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["students_active"] == 2
    top = data["items"][0]
    # item 0 struggled by both students → top of the re-teach list.
    assert top["bank_item_id"] == str(p["item_ids"][0])
    assert top["students_struggled"] == 2


async def test_non_owning_teacher_blocked(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    p = await _seed_practice(world)
    cid = await _course_id(world)
    # A teacher who doesn't own the course.
    async with get_session_factory()() as s:
        other = User(
            email=f"other_t_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"), grade_level=12,
            role="teacher", name="OtherT",
        )
        s.add(other)
        await s.flush()
        token = create_access_token(str(other.id), "teacher")
        await s.commit()

    r1 = await client.get(
        f"/v1/teacher/courses/{cid}/sections/{p['section_id']}"
        f"/students/{world['student_id']}/practice-activity",
        headers=_auth(token),
    )
    r2 = await client.get(
        f"/v1/teacher/courses/{cid}/sections/{p['section_id']}/practice-insights",
        headers=_auth(token),
    )
    # get_teacher_course returns 404 for not-yours (doesn't leak existence).
    assert r1.status_code == 404, r1.text
    assert r2.status_code == 404, r2.text


async def _course_id(world: dict[str, Any]) -> uuid.UUID:
    async with get_session_factory()() as s:
        return (await s.execute(
            select(Assignment.course_id).where(
                Assignment.id == world["assignment_id"]
            )
        )).scalar_one()
