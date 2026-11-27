"""GET /v1/teacher/drafts — the home page's "Drafts in progress": this
teacher's draft homework in active courses, most recently edited first,
with the homework card's "N need your approval" count."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.assignment import Assignment
from api.models.course import Course, CourseTeacher
from api.models.question_bank import QuestionBankItem
from api.models.unit import Unit
from api.models.user import User
from api.routes.teacher_drafts import DRAFTS_SHOWN
from tests.conftest import auth_headers as _auth


async def _teacher(s) -> User:
    u = User(email=f"t_{uuid.uuid4().hex[:8]}@t.com", password_hash=hash_password("x"),
             grade_level=12, role="teacher", name="T")
    s.add(u)
    await s.flush()
    return u


async def _course(s, teacher: User, name: str, status: str = "active") -> tuple[Course, Unit]:
    c = Course(name=name, subject="math", status=status)
    s.add(c)
    await s.flush()
    s.add(CourseTeacher(course_id=c.id, teacher_id=teacher.id, role="owner"))
    unit = Unit(course_id=c.id, name="U", position=0)
    s.add(unit)
    await s.flush()
    return c, unit


def _hw(course: Course, teacher: User, title: str, *, status: str = "draft", kind: str = "homework",
        edited: datetime, problems: int = 0) -> Assignment:
    return Assignment(course_id=course.id, teacher_id=teacher.id, title=title, type=kind, status=status,
                      content={"problem_ids": [str(uuid.uuid4()) for _ in range(problems)]},
                      due_at=edited + timedelta(days=3), updated_at=edited)


async def test_drafts_newest_first_with_pending_count(client: AsyncClient) -> None:
    now = datetime.now(UTC)
    async with get_session_factory()() as s:
        me, other = await _teacher(s), await _teacher(s)
        alg, unit = await _course(s, me, "Algebra")
        old, _ = await _course(s, me, "Old", status="archived")
        theirs, _ = await _course(s, other, "Theirs")
        older = _hw(alg, me, "Older draft", edited=now - timedelta(days=3))
        newer = _hw(alg, me, "Newer draft", edited=now - timedelta(hours=1), problems=2)
        s.add_all([
            older, newer,
            _hw(alg, me, "Published", status="published", edited=now),
            _hw(alg, me, "Practice draft", kind="practice", edited=now),
            _hw(old, me, "Archived course draft", edited=now),
            _hw(theirs, other, "Their draft", edited=now),
        ])
        await s.flush()
        for st in ("pending", "pending", "approved"):
            s.add(QuestionBankItem(course_id=alg.id, unit_id=unit.id, originating_assignment_id=newer.id,
                                   title="q", question="q", status=st))
        await s.commit()
        token = create_access_token(str(me.id), "teacher")

    r = await client.get("/v1/teacher/drafts", headers=_auth(token))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 2
    assert [d["title"] for d in body["drafts"]] == ["Newer draft", "Older draft"]
    first = body["drafts"][0]
    assert first["course_name"] == "Algebra"
    assert first["problem_count"] == 2
    assert first["pending_review"] == 2
    assert body["drafts"][1]["pending_review"] == 0


async def test_only_the_most_recent_are_listed_but_all_are_counted(client: AsyncClient) -> None:
    now = datetime.now(UTC)
    async with get_session_factory()() as s:
        me = await _teacher(s)
        alg, _ = await _course(s, me, "Algebra")
        s.add_all([_hw(alg, me, f"D{i}", edited=now - timedelta(minutes=i)) for i in range(DRAFTS_SHOWN + 2)])
        await s.commit()
        token = create_access_token(str(me.id), "teacher")
    body = (await client.get("/v1/teacher/drafts", headers=_auth(token))).json()
    assert body["total"] == DRAFTS_SHOWN + 2
    assert [d["title"] for d in body["drafts"]] == [f"D{i}" for i in range(DRAFTS_SHOWN)]


async def test_students_cannot_read_it(client: AsyncClient) -> None:
    async with get_session_factory()() as s:
        u = User(email=f"s_{uuid.uuid4().hex[:8]}@t.com", password_hash=hash_password("x"),
                 grade_level=8, role="student", name="S")
        s.add(u)
        await s.commit()
        token = create_access_token(str(u.id), "student")
    assert (await client.get("/v1/teacher/drafts", headers=_auth(token))).status_code == 403
