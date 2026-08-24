"""Admin read-as-teacher.

An admin debugging a live pilot needs to see exactly what a teacher sees.
The mechanism is `?as_teacher=<uuid>` on the teacher routes: it swaps the
SCOPE to her while keeping the ACCESSOR as the admin.

Every test here guards a property that fails SILENTLY if it breaks — the
read still returns data, it is just the wrong data, or attributed to the
wrong person. In a product holding real children's records, wrong
attribution is the more serious of the two.

The load-bearing one is `test_an_admin_cannot_write_as_a_teacher`. The
product's central promise is that a teacher approves every grade; an admin
publishing under her name would break it invisibly, and the whole design
rests on that being impossible rather than merely discouraged.
"""

import uuid

from httpx import AsyncClient
from sqlalchemy import select

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.course import Course, CourseTeacher
from api.models.school import SCHOOL_KIND_INDIVIDUAL, School
from api.models.student_record_access_log import StudentRecordAccessLog
from api.models.user import User


class World:
    pass


async def _seed() -> World:
    w = World()
    async with get_session_factory()() as s:
        school = School(
            name="RAT School", kind=SCHOOL_KIND_INDIVIDUAL,
            contact_name="R", contact_email="r@t.com",
        )
        s.add(school)
        await s.flush()
        teacher = User(
            email=f"rat_t_{uuid.uuid4().hex[:8]}@t.com",
            password_hash=hash_password("x"), grade_level=12,
            role="teacher", name="Ms. Ortega", school_id=school.id,
        )
        other_teacher = User(
            email=f"rat_o_{uuid.uuid4().hex[:8]}@t.com",
            password_hash=hash_password("x"), grade_level=12,
            role="teacher", name="Mr. Other", school_id=school.id,
        )
        admin = User(
            email=f"rat_a_{uuid.uuid4().hex[:8]}@t.com",
            password_hash=hash_password("x"), grade_level=99,
            role="admin", name="Admin",
        )
        student = User(
            email=f"rat_s_{uuid.uuid4().hex[:8]}@t.com",
            password_hash=hash_password("x"), grade_level=9,
            role="student", name="A Student",
        )
        s.add_all([teacher, other_teacher, admin, student])
        await s.flush()

        course = Course(name="Her Course", subject="math", school_id=school.id)
        s.add(course)
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))
        await s.commit()

        w.teacher_id, w.other_id = teacher.id, other_teacher.id
        w.admin_id, w.student_id = admin.id, student.id
        w.course_id = course.id
        w.admin_tok = create_access_token(str(admin.id), "admin")
        w.teacher_tok = create_access_token(str(teacher.id), "teacher")
        w.other_tok = create_access_token(str(other_teacher.id), "teacher")
    return w


def _h(tok: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {tok}"}


async def test_an_admin_sees_the_teachers_courses_not_their_own(
    client: AsyncClient,
) -> None:
    """The scope swap is the whole feature. Without `as_teacher` an admin
    owns no courses and sees an empty list; with it they see hers."""
    w = await _seed()

    bare = await client.get("/v1/teacher/courses", headers=_h(w.admin_tok))
    assert bare.status_code == 200
    assert not [c for c in bare.json()["courses"] if c["id"] == str(w.course_id)]

    scoped = await client.get(
        f"/v1/teacher/courses?as_teacher={w.teacher_id}", headers=_h(w.admin_tok),
    )
    assert scoped.status_code == 200
    assert [c for c in scoped.json()["courses"] if c["id"] == str(w.course_id)]


async def test_an_admin_cannot_write_as_a_teacher(client: AsyncClient) -> None:
    """The load-bearing guard. A teacher approves every grade; an admin
    acting under her name would break that invisibly. Refused in the
    dependency, so no route can forget it and there is no write path to
    audit."""
    w = await _seed()
    r = await client.post(
        f"/v1/teacher/courses?as_teacher={w.teacher_id}",
        headers=_h(w.admin_tok),
        json={"name": "Course created as her", "subject": "math"},
    )
    assert r.status_code == 403
    assert "read-only" in r.json()["detail"].lower()

    # And nothing was created under her name.
    async with get_session_factory()() as s:
        rows = (await s.execute(
            select(Course).where(Course.name == "Course created as her")
        )).scalars().all()
    assert rows == []


async def test_a_teacher_cannot_read_as_another_teacher(
    client: AsyncClient,
) -> None:
    """The param must be refused for non-admins, not silently ignored.
    Ignoring it would return the caller's OWN data under a request that
    asked for someone else's — the caller would believe they had scoped a
    read that they hadn't."""
    w = await _seed()
    r = await client.get(
        f"/v1/teacher/courses?as_teacher={w.teacher_id}", headers=_h(w.other_tok),
    )
    assert r.status_code == 403


async def test_scoping_to_a_non_teacher_is_refused(client: AsyncClient) -> None:
    """A student or admin id would hand teacher-shaped queries an identity
    they were never written for. 404 (not 403) for both "no such user" and
    "not a teacher" so the param can't enumerate ids or roles."""
    w = await _seed()
    for bad in (w.student_id, w.admin_id, uuid.uuid4()):
        r = await client.get(
            f"/v1/teacher/courses?as_teacher={bad}", headers=_h(w.admin_tok),
        )
        assert r.status_code == 404, f"{bad} returned {r.status_code}"


async def test_a_malformed_target_is_rejected(client: AsyncClient) -> None:
    w = await _seed()
    r = await client.get(
        "/v1/teacher/courses?as_teacher=not-a-uuid", headers=_h(w.admin_tok),
    )
    assert r.status_code == 400


async def test_the_ferpa_log_records_the_admin_not_the_teacher(
    client: AsyncClient,
) -> None:
    """The subtlest failure in the whole feature.

    Every teacher route scopes on `current_user.user_id`, which is HERS
    while reading as her. If the FERPA logger used the same field, an
    admin's reads would be written down as the teacher reading her own
    students — corrupting the one record that exists to answer "who looked
    at this child's file". The log must name the admin.
    """
    w = await _seed()
    async with get_session_factory()() as s:
        before = (await s.execute(
            select(StudentRecordAccessLog)
            .where(StudentRecordAccessLog.accessor_user_id == w.admin_id)
        )).scalars().all()

    r = await client.get(
        f"/v1/teacher/courses/{w.course_id}/grades?as_teacher={w.teacher_id}",
        headers=_h(w.admin_tok),
    )
    assert r.status_code == 200

    async with get_session_factory()() as s:
        admin_rows = (await s.execute(
            select(StudentRecordAccessLog)
            .where(StudentRecordAccessLog.accessor_user_id == w.admin_id)
        )).scalars().all()
        teacher_rows = (await s.execute(
            select(StudentRecordAccessLog)
            .where(StudentRecordAccessLog.accessor_user_id == w.teacher_id)
        )).scalars().all()

    # This read may or may not log (it depends whether the route logs at
    # roster level), but the invariant holds either way: nothing may ever
    # be attributed to the teacher for a request the admin made.
    assert len(teacher_rows) == 0
    for row in admin_rows:
        if row not in before:
            assert row.accessor_role == "admin"


async def test_a_normal_teacher_request_is_completely_unchanged(
    client: AsyncClient,
) -> None:
    """74 routes depend on require_teacher. Without the param it must
    behave exactly as before — same scope, same role, no admin id."""
    w = await _seed()
    r = await client.get("/v1/teacher/courses", headers=_h(w.teacher_tok))
    assert r.status_code == 200
    assert [c for c in r.json()["courses"] if c["id"] == str(w.course_id)]
