"""GET .../students/{id}/context: a student's other courses with this
teacher, and the understanding checks they finished in this course —
summary only, never the check's verdict."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.assignment import Assignment, Submission
from api.models.course import Course, CourseTeacher
from api.models.integrity_check import IntegrityCheckSubmission
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.user import User
from tests.conftest import auth_headers as _auth


async def _user(s, role: str) -> User:
    u = User(email=f"{role}_{uuid.uuid4().hex[:8]}@t.com", password_hash=hash_password("x"),
             grade_level=12 if role == "teacher" else 8, role=role, name=role.title())
    s.add(u)
    await s.flush()
    return u


async def _course(s, name: str, teacher: User, student: User | None, *,
                  role: str = "owner", status: str = "active") -> tuple[Course, Section]:
    c = Course(name=name, subject="math", status=status)
    s.add(c)
    await s.flush()
    s.add(CourseTeacher(course_id=c.id, teacher_id=teacher.id, role=role))
    sec = Section(course_id=c.id, name=f"{name} P1")
    s.add(sec)
    await s.flush()
    if student is not None:
        s.add(SectionEnrollment(section_id=sec.id, course_id=c.id, student_id=student.id))
    return c, sec


async def _check(s, course: Course, sec: Section, teacher: User, student: User, title: str, *,
                 status: str = "complete", summary: str | None = "Explained each step.",
                 at: datetime | None = None) -> None:
    hw = Assignment(course_id=course.id, teacher_id=teacher.id, title=title, type="homework",
                    status="published", content={"problems": []})
    s.add(hw)
    await s.flush()
    sub = Submission(assignment_id=hw.id, student_id=student.id, section_id=sec.id,
                     status="submitted", submitted_at=at or datetime.now(UTC))
    s.add(sub)
    await s.flush()
    s.add(IntegrityCheckSubmission(submission_id=sub.id, status=status, overall_summary=summary,
                                   disposition="flag_for_review", headline="Could not explain"))


async def _world() -> dict:
    async with get_session_factory()() as s:
        teacher = await _user(s, "teacher")
        other_teacher = await _user(s, "teacher")
        student = await _user(s, "student")
        a, a1 = await _course(s, "Algebra", teacher, student)
        b, b1 = await _course(s, "Geometry", teacher, student, role="co_teacher")
        await _course(s, "Chemistry", other_teacher, student)            # not this teacher's
        await _course(s, "Old Algebra", teacher, student, status="archived")
        await _course(s, "Physics", teacher, None)                      # student not in it
        now = datetime.now(UTC)
        await _check(s, a, a1, teacher, student, "HW 1", at=now - timedelta(days=2))
        await _check(s, a, a1, teacher, student, "HW 2", at=now)
        await _check(s, a, a1, teacher, student, "HW 3", status="in_progress", summary=None)
        await _check(s, a, a1, teacher, student, "HW 4", summary=None)   # closed, never answered
        await _check(s, b, b1, teacher, student, "Geo HW")                # another course's
        await s.commit()
        return {"course": a.id, "section": a1.id, "student": student.id,
                "other_course": b.id, "other_section": b1.id,
                "token": create_access_token(str(teacher.id), "teacher"),
                "other_token": create_access_token(str(other_teacher.id), "teacher")}


def _url(w: dict, section_key: str = "section") -> str:
    return f"/v1/teacher/courses/{w['course']}/sections/{w[section_key]}/students/{w['student']}/context"


async def test_other_courses_are_this_teachers_active_ones(client: AsyncClient) -> None:
    w = await _world()
    r = await client.get(_url(w), headers=_auth(w["token"]))
    assert r.status_code == 200, r.text
    assert r.json()["other_courses"] == [{
        "course_id": str(w["other_course"]), "course_name": "Geometry",
        "section_id": str(w["other_section"]), "section_name": "Geometry P1",
    }]


async def test_finished_checks_in_this_course_newest_first(client: AsyncClient) -> None:
    w = await _world()
    checks = (await client.get(_url(w), headers=_auth(w["token"]))).json()["understanding_checks"]
    assert [c["assignment_title"] for c in checks] == ["HW 2", "HW 1"]
    assert checks[0]["summary"] == "Explained each step."
    assert checks[0]["section_id"] == str(w["section"])


async def test_a_check_never_carries_its_verdict(client: AsyncClient) -> None:
    w = await _world()
    check = (await client.get(_url(w), headers=_auth(w["token"]))).json()["understanding_checks"][0]
    assert set(check) == {"assignment_id", "assignment_title", "section_id", "summary", "submitted_at"}


async def test_another_teacher_cannot_read_it(client: AsyncClient) -> None:
    w = await _world()
    assert (await client.get(_url(w), headers=_auth(w["other_token"]))).status_code == 404


async def test_a_section_the_student_is_not_in_is_404(client: AsyncClient) -> None:
    w = await _world()
    # The other course's section, under this course's path.
    r = await client.get(_url(w, "other_section"), headers=_auth(w["token"]))
    assert r.status_code == 404
