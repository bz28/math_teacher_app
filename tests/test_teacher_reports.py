"""Teacher "Report a problem" — POST /v1/teacher/reports and the admin
list/detail/resolve endpoints under /v1/admin/reports.

Covers: a submission-scoped report snapshots names/titles/problem text
server-side; a teacher can't file a report against someone else's
submission (IDOR → 404); a context-free sidebar report stores no
pointers; unknown kinds are rejected; admins can list open/resolved,
resolve with a note, and reopen.
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
from api.models.assignment import Assignment, AssignmentSection, Submission
from api.models.course import Course, CourseTeacher
from api.models.question_bank import QuestionBankItem
from api.models.section import Section
from api.models.unit import Unit
from api.models.user import User
from tests.conftest import auth_headers


@pytest.fixture
async def world() -> dict[str, Any]:
    tag = uuid.uuid4().hex[:6]
    async with get_session_factory()() as s:
        await s.execute(text("DELETE FROM teacher_reports"))
        teacher = User(email=f"rep_t_{tag}@t.com", password_hash=hash_password("x"),
                       grade_level=12, role="teacher", name="Ms. Okafor")
        other = User(email=f"rep_o_{tag}@t.com", password_hash=hash_password("x"),
                     grade_level=12, role="teacher", name="Other")
        student = User(email=f"rep_s_{tag}@t.com", password_hash=hash_password("x"),
                       grade_level=9, role="student", name="D. Park")
        admin = User(email=f"rep_a_{tag}@t.com", password_hash=hash_password("x"),
                     grade_level=12, role="admin", name="Admin")
        s.add_all([teacher, other, student, admin])
        await s.flush()
        course = Course(name="Algebra 1", subject="math")
        s.add(course)
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))
        section = Section(course_id=course.id, name="Period 3")
        unit = Unit(course_id=course.id, name="Systems", position=0)
        s.add_all([section, unit])
        await s.flush()
        assignment = Assignment(
            course_id=course.id, teacher_id=teacher.id, title="Solving Systems", type="homework",
            status="published", content={"problem_ids": []}, unit_ids=[unit.id],
        )
        s.add(assignment)
        await s.flush()
        item = QuestionBankItem(
            course_id=course.id, unit_id=unit.id, created_by_id=teacher.id,
            originating_assignment_id=assignment.id,
            title="Graphing", question="Solve the system by graphing.", solution_steps=[],
            final_answer="(2, 3)", difficulty="medium", status="approved", format="frq",
        )
        s.add(item)
        await s.flush()
        assignment.content = {"problem_ids": [str(item.id)]}
        s.add(AssignmentSection(assignment_id=assignment.id, section_id=section.id,
                                published_at=datetime.now(UTC)))
        sub = Submission(assignment_id=assignment.id, student_id=student.id,
                         section_id=section.id, status="submitted", files=[])
        s.add(sub)
        await s.commit()
        return {
            "teacher": create_access_token(str(teacher.id), "teacher"),
            "other": create_access_token(str(other.id), "teacher"),
            "admin": create_access_token(str(admin.id), "admin"),
            "submission_id": str(sub.id),
            "problem_id": str(item.id),
        }


def _payload(w: dict[str, Any]) -> dict[str, Any]:
    return {
        "kind": "wrong_grade",
        "note": "  Student only drew one line but got full credit.  ",
        "page_url": "https://veradicai.com/school/teacher/x",
        "submission_id": w["submission_id"],
        "problem_id": w["problem_id"],
        "problem_position": 4,
        "ai_grade": {"score_status": "full", "percent": 100, "confidence": 0.95, "reasoning": "matches key"},
        "teacher_grade": {"score_status": "partial", "percent": 50},
    }


async def test_submission_report_snapshots_context(client: AsyncClient, world: dict[str, Any]) -> None:
    r = await client.post("/v1/teacher/reports", headers=auth_headers(world["teacher"]), json=_payload(world))
    assert r.status_code == 201, r.text
    rid = r.json()["id"]

    d = await client.get(f"/v1/admin/reports/{rid}", headers=auth_headers(world["admin"]))
    assert d.status_code == 200, d.text
    body = d.json()
    assert body["status"] == "open"
    assert body["kind"] == "wrong_grade"
    assert body["note"] == "Student only drew one line but got full credit."
    assert body["teacher_name"] == "Ms. Okafor"
    assert body["student_name"] == "D. Park"
    assert body["assignment_title"] == "Solving Systems"
    assert body["course_name"] == "Algebra 1"
    assert body["problem_question"] == "Solve the system by graphing."
    assert body["problem_position"] == 4
    assert body["ai_grade"]["percent"] == 100
    assert body["teacher_grade"]["percent"] == 50


async def test_other_teacher_cannot_report_my_submission(client: AsyncClient, world: dict[str, Any]) -> None:
    r = await client.post("/v1/teacher/reports", headers=auth_headers(world["other"]), json=_payload(world))
    assert r.status_code == 404, r.text


async def test_context_free_report_stores_no_pointers(client: AsyncClient, world: dict[str, Any]) -> None:
    r = await client.post(
        "/v1/teacher/reports", headers=auth_headers(world["teacher"]),
        json={"kind": "broken", "note": "Roster page spins forever", "page_url": "https://x/y"},
    )
    assert r.status_code == 201, r.text
    d = (await client.get(f"/v1/admin/reports/{r.json()['id']}", headers=auth_headers(world["admin"]))).json()
    assert d["submission_id"] is None and d["student_name"] is None and d["ai_grade"] is None
    assert d["page_url"] == "https://x/y"


async def test_unknown_kind_rejected(client: AsyncClient, world: dict[str, Any]) -> None:
    r = await client.post("/v1/teacher/reports", headers=auth_headers(world["teacher"]),
                          json={"kind": "lol"})
    assert r.status_code == 422


async def test_admin_list_resolve_reopen(client: AsyncClient, world: dict[str, Any]) -> None:
    h_t, h_a = auth_headers(world["teacher"]), auth_headers(world["admin"])
    rid = (await client.post("/v1/teacher/reports", headers=h_t, json=_payload(world))).json()["id"]
    (await client.post("/v1/teacher/reports", headers=h_t, json={"kind": "other"})).raise_for_status()

    lst = (await client.get("/v1/admin/reports", headers=h_a)).json()
    assert lst["counts"] == {"open": 2, "resolved": 0}
    assert [x["id"] for x in lst["reports"]][-1] == rid  # newest first → ours is oldest

    p = await client.patch(f"/v1/admin/reports/{rid}", headers=h_a,
                           json={"status": "resolved", "resolution_note": "Fixed in #912"})
    assert p.status_code == 200, p.text
    assert p.json()["status"] == "resolved" and p.json()["resolved_at"] is not None
    assert p.json()["resolution_note"] == "Fixed in #912"

    lst = (await client.get("/v1/admin/reports?status=open", headers=h_a)).json()
    assert lst["counts"] == {"open": 1, "resolved": 1}
    assert all(x["id"] != rid for x in lst["reports"])
    assert len((await client.get("/v1/admin/reports?status=all", headers=h_a)).json()["reports"]) == 2

    p = await client.patch(f"/v1/admin/reports/{rid}", headers=h_a, json={"status": "open"})
    assert p.json()["status"] == "open" and p.json()["resolved_at"] is None

    # Teachers can't read the admin list.
    assert (await client.get("/v1/admin/reports", headers=h_t)).status_code == 403
