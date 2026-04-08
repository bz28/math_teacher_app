"""Integration tests for the school-student practice/learn loop endpoints.

These exercise the full validation chain on /v1/school/student/... by
seeding minimal DB state directly: a course, a section, a teacher, a
student, an enrollment, an assignment, and a small variation tree.

No LLM is involved — distractors and solution steps are seeded as plain
data on QuestionBankItem rows.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.assignment import Assignment, AssignmentSection
from api.models.course import Course
from api.models.question_bank import QuestionBankItem
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.user import User

# ── Fixtures ──

def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _truncate() -> None:
    """Wipe the loop-relevant tables before each test. We don't drop the
    whole schema because the session-level setup_db fixture in conftest
    already created it once."""
    async with get_session_factory()() as s:
        await s.execute(text(
            "TRUNCATE TABLE bank_consumption, assignment_sections, assignments, "
            "section_enrollments, sections, question_bank_items, courses, users "
            "RESTART IDENTITY CASCADE"
        ))
        await s.commit()


@pytest.fixture
async def world() -> dict[str, Any]:
    """Seed a course/section/student/assignment/variation tree and
    return the ids needed by tests. The HW primary has 3 approved
    variations + 1 pending (which must be ignored)."""
    await _truncate()
    async with get_session_factory()() as s:
        teacher = User(
            email=f"teacher_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"),
            grade_level=12,
            role="teacher",
            name="T",
        )
        student = User(
            email=f"student_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"),
            grade_level=8,
            role="student",
            name="S",
        )
        outsider = User(
            email=f"outsider_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"),
            grade_level=8,
            role="student",
            name="O",
        )
        s.add_all([teacher, student, outsider])
        await s.flush()

        course = Course(name="Algebra 1", subject="math")
        s.add(course)
        await s.flush()

        section = Section(course_id=course.id, name="Period 1")
        s.add(section)
        await s.flush()

        s.add(SectionEnrollment(section_id=section.id, student_id=student.id))

        primary = QuestionBankItem(
            course_id=course.id,
            title="Quadratics 1",
            question="Solve x^2 - 5x + 6 = 0",
            solution_steps=[{"title": "Factor", "description": "(x-2)(x-3)"}],
            final_answer="x = 2 or x = 3",
            distractors=["x=1", "x=-2", "x=5"],
            status="approved",
            source="generated",
        )
        s.add(primary)
        await s.flush()

        # 3 approved siblings + 1 pending sibling
        siblings_approved = []
        for i, q in enumerate([
            ("Sib A", "Solve x^2 - 7x + 12 = 0", "x = 3 or x = 4"),
            ("Sib B", "Solve x^2 - 9x + 20 = 0", "x = 4 or x = 5"),
            ("Sib C", "Solve x^2 - 11x + 30 = 0", "x = 5 or x = 6"),
        ]):
            sib = QuestionBankItem(
                course_id=course.id,
                title=q[0],
                question=q[1],
                solution_steps=[{"title": "Factor", "description": "..."}],
                final_answer=q[2],
                distractors=[f"d{i}a", f"d{i}b", f"d{i}c"],
                status="approved",
                source="practice",
                parent_question_id=primary.id,
            )
            s.add(sib)
            siblings_approved.append(sib)

        pending_sib = QuestionBankItem(
            course_id=course.id,
            title="Sib pending",
            question="Solve x^2 - 13x + 42 = 0",
            solution_steps=[],
            final_answer="x = 6 or x = 7",
            distractors=["a", "b", "c"],
            status="pending",
            source="practice",
            parent_question_id=primary.id,
        )
        s.add(pending_sib)
        await s.flush()

        assignment = Assignment(
            course_id=course.id,
            unit_ids=[],
            teacher_id=teacher.id,
            title="HW 1",
            type="homework",
            status="published",
            content={"problems": [
                {"bank_item_id": str(primary.id), "position": 1,
                 "question": primary.question, "solution_steps": primary.solution_steps,
                 "final_answer": primary.final_answer, "difficulty": primary.difficulty},
            ]},
        )
        s.add(assignment)
        await s.flush()
        s.add(AssignmentSection(
            assignment_id=assignment.id,
            section_id=section.id,
            published_at=datetime.now(UTC),
        ))
        await s.commit()

        return {
            "student_id": student.id,
            "outsider_id": outsider.id,
            "teacher_id": teacher.id,
            "assignment_id": assignment.id,
            "primary_id": primary.id,
            "approved_sibling_ids": [s.id for s in siblings_approved],
            "pending_sibling_id": pending_sib.id,
            "student_token": create_access_token(str(student.id), "student"),
            "outsider_token": create_access_token(str(outsider.id), "student"),
            "teacher_token": create_access_token(str(teacher.id), "teacher"),
        }


# ── Tests ──

async def test_serves_oldest_unseen_sibling_first(client: AsyncClient, world: dict[str, Any]) -> None:
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/problems/{world['primary_id']}/next-variation",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "served"
    # Oldest = first inserted approved sibling
    assert body["variation"]["bank_item_id"] == str(world["approved_sibling_ids"][0])
    assert body["remaining"] == 2  # 3 approved - 1 just served
    assert body["anchor_bank_item_id"] == str(world["primary_id"])
    assert len(body["variation"]["distractors"]) == 3


async def test_skips_pending_siblings(client: AsyncClient, world: dict[str, Any]) -> None:
    # Burn through all 3 approved siblings
    for _ in range(3):
        r = await client.post(
            f"/v1/school/student/homework/{world['assignment_id']}/problems/{world['primary_id']}/next-variation",
            headers=_auth(world["student_token"]),
        )
        # Mark each as completed so the next call advances
        if r.json()["status"] == "served":
            await client.post(
                f"/v1/school/student/bank-consumption/{r.json()['consumption_id']}/complete",
                headers=_auth(world["student_token"]),
            )
    # 4th call: pending sibling should NOT count, so we're exhausted
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/problems/{world['primary_id']}/next-variation",
        headers=_auth(world["student_token"]),
    )
    assert r.json()["status"] == "exhausted"
    assert r.json()["seen"] == 3


async def test_refresh_safe_re_serves_in_flight(client: AsyncClient, world: dict[str, Any]) -> None:
    r1 = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/problems/{world['primary_id']}/next-variation",
        headers=_auth(world["student_token"]),
    )
    served_id = r1.json()["variation"]["bank_item_id"]
    consumption_id = r1.json()["consumption_id"]

    # Don't complete it. Hit the endpoint again — should re-serve same.
    r2 = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/problems/{world['primary_id']}/next-variation",
        headers=_auth(world["student_token"]),
    )
    assert r2.json()["variation"]["bank_item_id"] == served_id
    assert r2.json()["consumption_id"] == consumption_id


async def test_404_for_nonexistent_assignment(client: AsyncClient, world: dict[str, Any]) -> None:
    fake = uuid.uuid4()
    r = await client.post(
        f"/v1/school/student/homework/{fake}/problems/{world['primary_id']}/next-variation",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 404


async def test_403_for_unenrolled_student(client: AsyncClient, world: dict[str, Any]) -> None:
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/problems/{world['primary_id']}/next-variation",
        headers=_auth(world["outsider_token"]),
    )
    assert r.status_code == 403


async def test_404_when_bank_item_not_in_assignment(client: AsyncClient, world: dict[str, Any]) -> None:
    # Pass a sibling id (which is NOT a primary on the assignment)
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/problems/{world['approved_sibling_ids'][0]}/next-variation",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 404


async def test_403_for_unpublished_assignment(client: AsyncClient, world: dict[str, Any]) -> None:
    async with get_session_factory()() as s:
        a = (await s.execute(
            text("UPDATE assignments SET status='draft' WHERE id=:id RETURNING id"),
            {"id": world["assignment_id"]},
        ))
        await s.commit()
        _ = a
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/problems/{world['primary_id']}/next-variation",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 403


async def test_empty_when_no_approved_siblings(client: AsyncClient, world: dict[str, Any]) -> None:
    # Reject all approved siblings
    async with get_session_factory()() as s:
        await s.execute(text(
            "UPDATE question_bank_items SET status='rejected' WHERE parent_question_id=:p"
        ), {"p": world["primary_id"]})
        await s.commit()
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/problems/{world['primary_id']}/next-variation",
        headers=_auth(world["student_token"]),
    )
    assert r.json()["status"] == "empty"


async def test_complete_consumption_idempotent(client: AsyncClient, world: dict[str, Any]) -> None:
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/problems/{world['primary_id']}/next-variation",
        headers=_auth(world["student_token"]),
    )
    cid = r.json()["consumption_id"]
    for _ in range(2):
        r2 = await client.post(
            f"/v1/school/student/bank-consumption/{cid}/complete",
            headers=_auth(world["student_token"]),
        )
        assert r2.status_code == 204


async def test_complete_consumption_not_yours(client: AsyncClient, world: dict[str, Any]) -> None:
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/problems/{world['primary_id']}/next-variation",
        headers=_auth(world["student_token"]),
    )
    cid = r.json()["consumption_id"]
    r2 = await client.post(
        f"/v1/school/student/bank-consumption/{cid}/complete",
        headers=_auth(world["outsider_token"]),
    )
    assert r2.status_code == 403


async def test_list_classes(client: AsyncClient, world: dict[str, Any]) -> None:
    r = await client.get("/v1/school/student/classes", headers=_auth(world["student_token"]))
    assert r.status_code == 200
    out = r.json()
    assert len(out) == 1
    assert out[0]["course_name"] == "Algebra 1"
    assert out[0]["section_name"] == "Period 1"

    # Outsider sees nothing
    r = await client.get("/v1/school/student/classes", headers=_auth(world["outsider_token"]))
    assert r.json() == []


async def test_list_homework_for_course(client: AsyncClient, world: dict[str, Any]) -> None:
    # Get course id from classes
    classes = (await client.get(
        "/v1/school/student/classes", headers=_auth(world["student_token"])
    )).json()
    course_id = classes[0]["course_id"]
    r = await client.get(
        f"/v1/school/student/courses/{course_id}/homework",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200
    out = r.json()
    assert len(out) == 1
    assert out[0]["title"] == "HW 1"
    assert out[0]["problem_count"] == 1

    # Outsider sees nothing for this course
    r = await client.get(
        f"/v1/school/student/courses/{course_id}/homework",
        headers=_auth(world["outsider_token"]),
    )
    assert r.json() == []


async def test_homework_detail(client: AsyncClient, world: dict[str, Any]) -> None:
    r = await client.get(
        f"/v1/school/student/homework/{world['assignment_id']}",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200
    out = r.json()
    assert out["title"] == "HW 1"
    assert out["course_name"] == "Algebra 1"
    assert len(out["problems"]) == 1
    assert out["problems"][0]["bank_item_id"] == str(world["primary_id"])
    # 3 approved siblings (pending one excluded)
    assert out["problems"][0]["approved_variation_count"] == 3
    # SECURITY: the locked HW primary's final_answer must NOT be sent
    # to the student. Otherwise opening DevTools reveals the answer.
    assert "final_answer" not in out["problems"][0]
    assert "solution_steps" not in out["problems"][0]


async def test_homework_detail_403_for_outsider(client: AsyncClient, world: dict[str, Any]) -> None:
    r = await client.get(
        f"/v1/school/student/homework/{world['assignment_id']}",
        headers=_auth(world["outsider_token"]),
    )
    assert r.status_code == 403


TINY_PNG = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4"
    "2mP8/x8AAusB9YpO3vQAAAAASUVORK5CYII="
)


async def test_submit_homework_happy_path(client: AsyncClient, world: dict[str, Any]) -> None:
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"image_base64": TINY_PNG},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "submission_id" in body
    assert body["is_late"] is False

    # Detail endpoint reflects submitted state
    r = await client.get(
        f"/v1/school/student/homework/{world['assignment_id']}",
        headers=_auth(world["student_token"]),
    )
    assert r.json()["submitted"] is True
    assert r.json()["submission_id"] == body["submission_id"]

    # Get-my-submission returns the data — final_answers is null on
    # new submissions (will be populated by the integrity-checker PR
    # from a Vision-extracted confirm step).
    r = await client.get(
        f"/v1/school/student/homework/{world['assignment_id']}/submission",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200
    out = r.json()
    assert out["final_answers"] == {}
    assert out["image_data"]
    assert out["is_late"] is False


async def test_submit_homework_409_on_resubmit(client: AsyncClient, world: dict[str, Any]) -> None:
    body = {"image_base64": TINY_PNG}
    r1 = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json=body,
    )
    assert r1.status_code == 200
    r2 = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json=body,
    )
    assert r2.status_code == 409


async def test_submit_homework_400_missing_image(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    # No image at all → 422 from pydantic (image_base64 is required)
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={},
    )
    assert r.status_code == 422

    # Empty string → 400 from our explicit check
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"image_base64": ""},
    )
    assert r.status_code == 400


async def test_submit_homework_413_oversized_image(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    huge = "iVBOR" + ("A" * 8_000_000)
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"image_base64": huge},
    )
    assert r.status_code == 413


async def test_submit_homework_400_bad_image_format(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"image_base64": "ZmFrZWltYWdl"},
    )
    assert r.status_code == 400


async def test_submit_homework_403_for_outsider(client: AsyncClient, world: dict[str, Any]) -> None:
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["outsider_token"]),
        json={"image_base64": TINY_PNG},
    )
    assert r.status_code == 403


async def test_get_my_submission_404_when_not_submitted(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    r = await client.get(
        f"/v1/school/student/homework/{world['assignment_id']}/submission",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 404


async def test_homework_list_status_reflects_submission(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    classes = (await client.get(
        "/v1/school/student/classes", headers=_auth(world["student_token"])
    )).json()
    course_id = classes[0]["course_id"]

    r = await client.get(
        f"/v1/school/student/courses/{course_id}/homework",
        headers=_auth(world["student_token"]),
    )
    assert r.json()[0]["status"] == "not_started"

    await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"image_base64": TINY_PNG},
    )

    r = await client.get(
        f"/v1/school/student/courses/{course_id}/homework",
        headers=_auth(world["student_token"]),
    )
    assert r.json()[0]["status"] == "submitted"


async def test_submit_homework_late_marks_is_late(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    # Set due_at to yesterday
    async with get_session_factory()() as s:
        await s.execute(
            text("UPDATE assignments SET due_at = now() - interval '1 day' WHERE id=:id"),
            {"id": world["assignment_id"]},
        )
        await s.commit()
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"image_base64": TINY_PNG},
    )
    assert r.status_code == 200
    assert r.json()["is_late"] is True


async def test_quizzes_excluded_from_homework_list(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    # Convert the seeded HW into a quiz and verify it disappears
    # from the student's homework tab and the loop endpoint refuses it.
    async with get_session_factory()() as s:
        await s.execute(
            text("UPDATE assignments SET type='quiz' WHERE id=:id"),
            {"id": world["assignment_id"]},
        )
        await s.commit()
    classes = (await client.get(
        "/v1/school/student/classes", headers=_auth(world["student_token"])
    )).json()
    course_id = classes[0]["course_id"]
    r = await client.get(
        f"/v1/school/student/courses/{course_id}/homework",
        headers=_auth(world["student_token"]),
    )
    # Quiz must NOT appear in the homework list
    assert r.json() == []
    # And the loop endpoint must reject it directly
    r = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/problems/{world['primary_id']}/next-variation",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 404


async def test_flag_and_list_flagged(client: AsyncClient, world: dict[str, Any]) -> None:
    # Serve + flag two siblings, complete one without flag
    served_ids = []
    for _ in range(3):
        r = await client.post(
            f"/v1/school/student/homework/{world['assignment_id']}/problems/{world['primary_id']}/next-variation",
            headers=_auth(world["student_token"]),
        )
        cid = r.json()["consumption_id"]
        served_ids.append((cid, r.json()["variation"]["bank_item_id"]))
        await client.post(
            f"/v1/school/student/bank-consumption/{cid}/complete",
            headers=_auth(world["student_token"]),
        )
    # Flag the first two
    for cid, _ in served_ids[:2]:
        r = await client.post(
            f"/v1/school/student/bank-consumption/{cid}/flag",
            headers=_auth(world["student_token"]),
            json={"flagged": True},
        )
        assert r.status_code == 204

    r = await client.get(
        f"/v1/school/student/homework/{world['assignment_id']}/problems/{world['primary_id']}/flagged",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200
    out = r.json()
    assert len(out) == 2
    assert {x["consumption_id"] for x in out} == {served_ids[0][0], served_ids[1][0]}

    # Unflag one and re-list
    r = await client.post(
        f"/v1/school/student/bank-consumption/{served_ids[0][0]}/flag",
        headers=_auth(world["student_token"]),
        json={"flagged": False},
    )
    assert r.status_code == 204
    r = await client.get(
        f"/v1/school/student/homework/{world['assignment_id']}/problems/{world['primary_id']}/flagged",
        headers=_auth(world["student_token"]),
    )
    assert len(r.json()) == 1


# ── Teacher submission viewing ──

async def test_teacher_list_submissions_uses_existing_endpoint(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    # The existing /v1/teacher/assignments/{id}/submissions endpoint
    # was built for the old grading flow but already returns the
    # fields the new submission UI needs (id, student_name, is_late,
    # submitted_at). We don't add a duplicate — just confirm it works
    # against rows our new submit endpoint creates.
    r = await client.get(
        f"/v1/teacher/assignments/{world['assignment_id']}/submissions",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 200
    assert r.json()["submissions"] == []

    await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"image_base64": TINY_PNG},
    )
    r = await client.get(
        f"/v1/teacher/assignments/{world['assignment_id']}/submissions",
        headers=_auth(world["teacher_token"]),
    )
    rows = r.json()["submissions"]
    assert len(rows) == 1
    assert rows[0]["is_late"] is False
    assert rows[0]["student_email"]


async def test_teacher_submission_detail(client: AsyncClient, world: dict[str, Any]) -> None:
    submit_resp = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"image_base64": TINY_PNG},
    )
    submission_id = submit_resp.json()["submission_id"]

    r = await client.get(
        f"/v1/teacher/submissions/{submission_id}",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 200
    out = r.json()
    assert out["submission_id"] == submission_id
    assert out["student_id"] == str(world["student_id"])
    assert len(out["problems"]) == 1
    p = out["problems"][0]
    assert p["bank_item_id"] == str(world["primary_id"])
    # New submissions have null student_answer (the integrity-checker
    # PR will populate it from a Vision-extracted confirm step).
    assert p["student_answer"] is None
    # Teacher view DOES include the answer key (the teacher needs it)
    assert p["final_answer"] == "x = 2 or x = 3"
    assert out["image_data"]


async def test_teacher_submission_detail_403_for_other_teacher(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    # First, the real teacher submits something
    submit_resp = await client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"image_base64": TINY_PNG},
    )
    submission_id = submit_resp.json()["submission_id"]

    async with get_session_factory()() as s:
        other = User(
            email=f"other2_{uuid.uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"),
            grade_level=12,
            role="teacher",
            name="OT2",
        )
        s.add(other)
        await s.commit()
        other_token = create_access_token(str(other.id), "teacher")

    r = await client.get(
        f"/v1/teacher/submissions/{submission_id}",
        headers=_auth(other_token),
    )
    assert r.status_code == 403


async def test_teacher_submission_detail_404_for_missing(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    r = await client.get(
        f"/v1/teacher/submissions/{uuid.uuid4()}",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 404
