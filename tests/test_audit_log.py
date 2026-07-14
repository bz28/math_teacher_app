"""FERPA student-record-access audit log: end-to-end wiring.

Guards the bug where the audit-log helpers existed but were never
called and the read router was never registered (so the headline FERPA
feature was dead code). These tests prove:
1. A teacher reading one student's grades writes a StudentRecordAccessLog
   row (committed — GET handlers don't otherwise commit).
2. The admin read endpoint is registered and surfaces that row.
3. The endpoint is admin-only.
"""
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.activity_log import ActivityLog
from api.models.course import Course, CourseTeacher
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.student_record_access_log import StudentRecordAccessLog
from api.models.user import User

from .conftest import auth_headers


@pytest.fixture
async def grade_world() -> dict[str, uuid.UUID]:
    """Minimal world: a teacher on a course, a student enrolled in its
    section, and a global admin — enough to drive the per-student grades
    read and the admin audit-log query."""
    async with get_session_factory()() as s:
        teacher = User(email=f"t_{uuid.uuid4().hex[:6]}@t.com",
                       password_hash=hash_password("x"), grade_level=12,
                       role="teacher", name="Teach")
        student = User(email=f"s_{uuid.uuid4().hex[:6]}@t.com",
                       password_hash=hash_password("x"), grade_level=8,
                       role="student", name="Stu")
        admin = User(email=f"a_{uuid.uuid4().hex[:6]}@t.com",
                     password_hash=hash_password("x"), grade_level=0,
                     role="admin", name="Admin")
        s.add_all([teacher, student, admin])
        await s.flush()

        course = Course(name="Algebra 1", subject="math")
        s.add(course)
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id))

        section = Section(course_id=course.id, name="Period 1")
        s.add(section)
        await s.flush()
        s.add(SectionEnrollment(section_id=section.id, course_id=course.id,
                                student_id=student.id))
        await s.commit()

        return {
            "teacher_id": teacher.id,
            "student_id": student.id,
            "admin_id": admin.id,
            "course_id": course.id,
            "section_id": section.id,
        }


@pytest.mark.asyncio
async def test_reading_student_grades_writes_audit_row(
    client: AsyncClient, grade_world: dict[str, uuid.UUID]
) -> None:
    token = create_access_token(str(grade_world["teacher_id"]), "teacher")
    url = (
        f"/v1/teacher/courses/{grade_world['course_id']}"
        f"/sections/{grade_world['section_id']}"
        f"/students/{grade_world['student_id']}/grades"
    )
    resp = await client.get(url, headers=auth_headers(token))
    assert resp.status_code == 200, resp.text

    async with get_session_factory()() as s:
        rows = (await s.execute(
            select(StudentRecordAccessLog).where(
                StudentRecordAccessLog.target_student_id == grade_world["student_id"]
            )
        )).scalars().all()
    assert len(rows) == 1, "exactly one access row should be logged"
    row = rows[0]
    assert row.accessor_user_id == grade_world["teacher_id"]
    assert row.accessor_role == "teacher"
    assert row.record_type == "grades"


@pytest.mark.asyncio
async def test_admin_audit_endpoint_surfaces_the_row(
    client: AsyncClient, grade_world: dict[str, uuid.UUID]
) -> None:
    teacher_token = create_access_token(str(grade_world["teacher_id"]), "teacher")
    url = (
        f"/v1/teacher/courses/{grade_world['course_id']}"
        f"/sections/{grade_world['section_id']}"
        f"/students/{grade_world['student_id']}/grades"
    )
    await client.get(url, headers=auth_headers(teacher_token))

    admin_token = create_access_token(str(grade_world["admin_id"]), "admin")
    r = await client.get(
        "/v1/admin/audit-logs/student-access",
        params={"target_student_id": str(grade_world["student_id"])},
        headers=auth_headers(admin_token),
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["total"] >= 1
    assert any(item["record_type"] == "grades" for item in data["entries"])


@pytest.mark.asyncio
async def test_audit_endpoint_is_admin_only(
    client: AsyncClient, grade_world: dict[str, uuid.UUID]
) -> None:
    teacher_token = create_access_token(str(grade_world["teacher_id"]), "teacher")
    r = await client.get(
        "/v1/admin/audit-logs/student-access",
        headers=auth_headers(teacher_token),
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_admin_role_change_writes_activity_row(
    client: AsyncClient, grade_world: dict[str, uuid.UUID]
) -> None:
    """An admin mutation (role change) records an ActivityLog row and the
    unified activity read endpoint surfaces it — guards record_activity being
    wired in rather than dead code."""
    admin_token = create_access_token(str(grade_world["admin_id"]), "admin")
    r = await client.patch(
        f"/v1/admin/users/{grade_world['student_id']}/role",
        json={"role": "teacher"},
        headers=auth_headers(admin_token),
    )
    assert r.status_code == 200, r.text

    async with get_session_factory()() as s:
        rows = (await s.execute(
            select(ActivityLog).where(ActivityLog.target_id == grade_world["student_id"])
        )).scalars().all()
    assert len(rows) == 1, "exactly one activity row should be logged"
    row = rows[0]
    assert row.actor_user_id == grade_world["admin_id"]
    assert row.actor_role == "admin"
    assert row.action == "user.role_change"
    assert row.target_type == "user"
    assert row.action_metadata == {"old_role": "student", "new_role": "teacher"}

    surfaced = await client.get(
        "/v1/admin/activity",
        params={"action": "user.role_change"},
        headers=auth_headers(admin_token),
    )
    assert surfaced.status_code == 200, surfaced.text
    assert surfaced.json()["total"] >= 1


# ── Merged timeline (access ∪ write) ───────────────────────────────


@pytest.fixture
async def timeline_world() -> dict[str, uuid.UUID]:
    """Seed both log tables directly so timeline tests own their rows:
    a fresh access-read + write by one teacher on one student, plus an
    old write (100 days back) to exercise the date-range window."""
    async with get_session_factory()() as s:
        teacher = User(email=f"tl_alice_{uuid.uuid4().hex[:6]}@t.com",
                       password_hash=hash_password("x"), grade_level=12,
                       role="teacher", name="Alice Timeline")
        student = User(email=f"tl_bob_{uuid.uuid4().hex[:6]}@t.com",
                       password_hash=hash_password("x"), grade_level=8,
                       role="student", name="Bob Pupil")
        admin = User(email=f"tl_admin_{uuid.uuid4().hex[:6]}@t.com",
                     password_hash=hash_password("x"), grade_level=0,
                     role="admin", name="Admin")
        s.add_all([teacher, student, admin])
        await s.flush()

        now = datetime.now(UTC)
        submission_id = uuid.uuid4()
        s.add(StudentRecordAccessLog(
            accessor_user_id=teacher.id, accessor_role="teacher",
            target_student_id=student.id, record_type="grades",
            record_id=submission_id, ip_address="10.0.0.1", accessed_at=now,
        ))
        s.add(ActivityLog(
            actor_user_id=teacher.id, actor_role="teacher",
            action="grade.publish", target_type="submission",
            target_id=submission_id, ip_address="10.0.0.2", performed_at=now,
        ))
        s.add(ActivityLog(
            actor_user_id=teacher.id, actor_role="teacher",
            action="assignment.publish", target_type="assignment",
            target_id=uuid.uuid4(), performed_at=now - timedelta(days=100),
        ))
        await s.commit()

        return {
            "teacher_id": teacher.id,
            "student_id": student.id,
            "admin_id": admin.id,
            "submission_id": submission_id,
        }


@pytest.mark.asyncio
async def test_timeline_merges_access_and_write(
    client: AsyncClient, timeline_world: dict[str, uuid.UUID]
) -> None:
    """One stream carries both an access read and a write, each tagged
    with its facet, and the summary rolls the scope up."""
    token = create_access_token(str(timeline_world["admin_id"]), "admin")
    r = await client.get(
        "/v1/admin/audit-logs/timeline",
        params={"q": "Alice Timeline"},
        headers=auth_headers(token),
    )
    assert r.status_code == 200, r.text
    data = r.json()
    facets = {e["facet"] for e in data["entries"]}
    assert facets == {"access", "write"}
    assert data["summary"]["distinct_actors"] == 1
    assert data["summary"]["distinct_students"] == 1
    assert data["summary"]["top_action_count"] >= 1
    # Newest-first ordering.
    times = [e["at"] for e in data["entries"]]
    assert times == sorted(times, reverse=True)


@pytest.mark.asyncio
async def test_timeline_date_range_excludes_old_events(
    client: AsyncClient, timeline_world: dict[str, uuid.UUID]
) -> None:
    token = create_access_token(str(timeline_world["admin_id"]), "admin")
    r = await client.get(
        "/v1/admin/audit-logs/timeline",
        params={"q": "Alice Timeline", "hours": "24"},
        headers=auth_headers(token),
    )
    assert r.status_code == 200, r.text
    actions = {e["action"] for e in r.json()["entries"]}
    assert "grade.publish" in actions
    # The 100-day-old assignment.publish is outside the 24h window.
    assert "assignment.publish" not in actions


@pytest.mark.asyncio
async def test_timeline_facet_and_type_filters(
    client: AsyncClient, timeline_world: dict[str, uuid.UUID]
) -> None:
    token = create_access_token(str(timeline_world["admin_id"]), "admin")
    access_only = await client.get(
        "/v1/admin/audit-logs/timeline",
        params={"q": "Alice Timeline", "facet": "access"},
        headers=auth_headers(token),
    )
    assert {e["facet"] for e in access_only.json()["entries"]} == {"access"}

    # "grade" prefix matches the grade.publish write AND the "grades" read.
    typed = await client.get(
        "/v1/admin/audit-logs/timeline",
        params={"q": "Alice Timeline", "type": "grade"},
        headers=auth_headers(token),
    )
    labels = {(e["facet"], e["action"], e["record_type"]) for e in typed.json()["entries"]}
    assert ("write", "grade.publish", None) in labels
    assert ("access", None, "grades") in labels


@pytest.mark.asyncio
async def test_timeline_pivot_by_target_student(
    client: AsyncClient, timeline_world: dict[str, uuid.UUID]
) -> None:
    """Clicking a student pivots to every event touching that student."""
    token = create_access_token(str(timeline_world["admin_id"]), "admin")
    r = await client.get(
        "/v1/admin/audit-logs/timeline",
        params={"target_id": str(timeline_world["student_id"])},
        headers=auth_headers(token),
    )
    assert r.status_code == 200, r.text
    entries = r.json()["entries"]
    assert entries and all(
        e["target_student_id"] == str(timeline_world["student_id"]) for e in entries
    )


@pytest.mark.asyncio
async def test_timeline_csv_export(
    client: AsyncClient, timeline_world: dict[str, uuid.UUID]
) -> None:
    token = create_access_token(str(timeline_world["admin_id"]), "admin")
    r = await client.get(
        "/v1/admin/audit-logs/timeline/export.csv",
        params={"q": "Alice Timeline"},
        headers=auth_headers(token),
    )
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("text/csv")
    assert "attachment; filename=" in r.headers["content-disposition"]
    body = r.text
    assert "Action / record type" in body  # header row
    assert "grade.publish" in body
    assert "Alice Timeline" in body


@pytest.mark.asyncio
async def test_timeline_is_admin_only(
    client: AsyncClient, timeline_world: dict[str, uuid.UUID]
) -> None:
    teacher_token = create_access_token(str(timeline_world["teacher_id"]), "teacher")
    r = await client.get(
        "/v1/admin/audit-logs/timeline", headers=auth_headers(teacher_token)
    )
    assert r.status_code == 403
