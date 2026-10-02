"""The section gradebook: every student × every homework, auditable.

It is a second view of the same final record the roster and the CSV
export already show, so the load-bearing checks are that the three
agree — same published-only scores, same averages, missing work counted
separately and never as a zero — and that a cell never shows a draft
number.
"""

import csv
import io
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from httpx import AsyncClient
from sqlalchemy import text

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.assignment import Assignment, AssignmentSection, Submission, SubmissionGrade
from api.models.course import Course, CourseTeacher
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.unit import Unit
from api.models.user import User
from tests.conftest import auth_headers


async def _world() -> dict[str, Any]:
    """Period 1 has three homeworks: HW_A (due 3 days ago), HW_B (due in
    3 days) and HW_C (due 10 days ago). HW_D goes to Period 3 only.

    Ava: HW_A published 80 (AI said 70, turned in late) · HW_B turned in,
         ungraded · HW_C graded 90 but not published.
    Ben: HW_A nothing (missing) · HW_B nothing (not due) · HW_C published
         60, since edited to 65 without republishing.
    A preview student in Period 1 must not appear.
    """
    async with get_session_factory()() as s:
        await s.execute(text(
            "TRUNCATE TABLE submission_grades, submissions, assignment_sections, "
            "assignments, section_enrollments, sections, units, course_teachers, "
            "courses, refresh_tokens, users RESTART IDENTITY CASCADE"
        ))
        await s.commit()

    now = datetime.now(UTC)

    def user(name: str, role: str, **kw: Any) -> User:
        return User(
            email=f"{uuid.uuid4().hex[:8]}@school.edu", password_hash=hash_password("x"),
            grade_level=12, role=role, name=name, **kw,
        )

    async with get_session_factory()() as s:
        teacher, outsider = user("Ms Teacher", "teacher"), user("Other Teacher", "teacher")
        ava, ben, cara = user("Ava Brooks", "student"), user("Ben Chen", "student"), user("Cara Diaz", "student")
        preview = user("Preview Student", "student", is_preview=True)
        s.add_all([teacher, outsider, ava, ben, cara, preview])
        await s.flush()

        course = Course(name="Geometry", subject="math")
        other_course = Course(name="Other", subject="math")
        s.add_all([course, other_course])
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))
        s.add(CourseTeacher(course_id=other_course.id, teacher_id=outsider.id, role="owner"))
        unit = Unit(course_id=course.id, name="Unit 1", position=0)
        p1 = Section(course_id=course.id, name="Period 1")
        p3 = Section(course_id=course.id, name="Period 3")
        foreign = Section(course_id=other_course.id, name="Elsewhere")
        s.add_all([unit, p1, p3, foreign])
        await s.flush()
        for st, sec in ((ava, p1), (ben, p1), (preview, p1), (cara, p3)):
            s.add(SectionEnrollment(student_id=st.id, section_id=sec.id, course_id=course.id))

        hws: dict[str, Assignment] = {}
        for key, due in (("A", -3), ("B", 3), ("C", -10), ("D", -1)):
            hw = Assignment(
                course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
                title=f"HW_{key}", type="homework", status="published",
                content={"problems": []}, due_at=now + timedelta(days=due),
            )
            s.add(hw)
            hws[key] = hw
        await s.flush()
        for key in ("A", "B", "C"):
            s.add(AssignmentSection(assignment_id=hws[key].id, section_id=p1.id, published_at=now))
        s.add(AssignmentSection(assignment_id=hws["D"].id, section_id=p3.id, published_at=now))

        async def submit(st: User, key: str, grade: dict[str, Any] | None, late: bool = False) -> None:
            sub = Submission(
                assignment_id=hws[key].id, student_id=st.id, section_id=p1.id,
                status="submitted", files=[], is_late=late,
            )
            s.add(sub)
            await s.flush()
            if grade is not None:
                s.add(SubmissionGrade(submission_id=sub.id, **grade))

        await submit(ava, "A", {
            "ai_score": 70.0, "final_score": 80.0,
            "published_final_score": 80.0, "grade_published_at": now,
        }, late=True)
        await submit(ava, "B", None)
        await submit(ava, "C", {"ai_score": 90.0, "final_score": 90.0})
        await submit(ben, "C", {
            "ai_score": 60.0, "final_score": 65.0,
            "published_final_score": 60.0, "grade_published_at": now,
        })
        await submit(preview, "A", {
            "final_score": 10.0, "published_final_score": 10.0, "grade_published_at": now,
        })
        await s.commit()

        return {
            "teacher": auth_headers(create_access_token(str(teacher.id), "teacher")),
            "outsider": auth_headers(create_access_token(str(outsider.id), "teacher")),
            "course_id": str(course.id),
            "p1": str(p1.id),
            "foreign_section": str(foreign.id),
            "hw": {k: str(v.id) for k, v in hws.items()},
            "ava": str(ava.id),
            "ben": str(ben.id),
        }


def _url(w: dict[str, Any], section: str | None = None) -> str:
    return f"/v1/teacher/courses/{w['course_id']}/sections/{section or w['p1']}/gradebook"


async def test_gradebook_grid_columns_and_cells(client: AsyncClient) -> None:
    w = await _world()
    r = await client.get(_url(w), headers=w["teacher"])
    assert r.status_code == 200, r.text
    body = r.json()

    assert body["section"]["name"] == "Period 1"
    # Newest homework first; Period 3's homework isn't a column here.
    assert [a["title"] for a in body["assignments"]] == ["HW_B", "HW_A", "HW_C"]
    # The preview student never appears.
    students = {s["name"]: s for s in body["students"]}
    assert set(students) == {"Ava Brooks", "Ben Chen"}

    ava = students["Ava Brooks"]["cells"]
    assert ava[w["hw"]["A"]] | {"published_at": None, "submission_id": None} == {
        "state": "published", "score": 80.0, "is_late": True, "ai_score": 70.0,
        "edited_since_publish": False, "published_at": None, "submission_id": None,
    }
    assert ava[w["hw"]["B"]]["state"] == "turned_in"
    # Graded but unreleased: a state, never the draft number.
    assert ava[w["hw"]["C"]]["state"] == "not_published"
    assert "score" not in ava[w["hw"]["C"]]

    ben = students["Ben Chen"]["cells"]
    assert ben[w["hw"]["A"]] == {"state": "missing"}
    assert ben[w["hw"]["B"]] == {"state": "not_turned_in"}
    # The published number stands; the unreleased edit is only flagged.
    assert ben[w["hw"]["C"]]["score"] == 60.0
    assert ben[w["hw"]["C"]]["edited_since_publish"] is True


async def test_gradebook_averages_match_the_roster(client: AsyncClient) -> None:
    """Missing work is left out of the average, as the roster does."""
    w = await _world()
    body = (await client.get(_url(w), headers=w["teacher"])).json()
    grid = {s["student_id"]: s for s in body["students"]}

    assert (grid[w["ava"]]["avg_percent"], grid[w["ava"]]["counted_count"]) == (80.0, 1)
    assert (grid[w["ben"]]["avg_percent"], grid[w["ben"]]["missing_count"]) == (60.0, 1)
    assert all(s["assigned_count"] == 3 for s in grid.values())
    columns = {a["title"]: a for a in body["assignments"]}
    assert (columns["HW_A"]["avg_percent"], columns["HW_A"]["counted_count"]) == (80.0, 1)
    assert columns["HW_B"]["avg_percent"] is None

    roster = (await client.get(
        f"/v1/teacher/courses/{w['course_id']}/grades?section_id={w['p1']}",
        headers=w["teacher"],
    )).json()["students"]
    for row in roster:
        g = grid[row["student_id"]]
        assert (row["avg_percent"], row["missing_count"], row["graded_count"]) == (
            g["avg_percent"], g["missing_count"], g["counted_count"],
        )


async def test_section_export_matches_the_grid(client: AsyncClient) -> None:
    w = await _world()
    r = await client.get(
        f"/v1/teacher/courses/{w['course_id']}/grades/export.csv?section_id={w['p1']}",
        headers=w["teacher"],
    )
    assert r.status_code == 200
    rows = list(csv.reader(io.StringIO(r.text.lstrip("﻿"))))
    hw_columns = [h.split(" (")[0] for h in rows[0][4:-1]]
    # Only Period 1's homework — HW_D belongs to Period 3.
    assert sorted(hw_columns) == ["HW_A", "HW_B", "HW_C"]
    averages = {f"{r[0]} {r[1]}": r[-1] for r in rows[1:]}
    assert averages == {"Ava Brooks": "80.0", "Ben Chen": "60.0"}


async def test_opening_the_gradebook_is_logged(client: AsyncClient) -> None:
    """FERPA: the grid discloses every student's record at once, so a
    view is logged as one section-wide access, like the CSV export."""
    w = await _world()
    async with get_session_factory()() as s:
        before = (await s.execute(text(
            "SELECT count(*) FROM student_record_access_log WHERE record_type = 'gradebook'"
        ))).scalar_one()
    assert (await client.get(_url(w), headers=w["teacher"])).status_code == 200
    async with get_session_factory()() as s:
        after = (await s.execute(text(
            "SELECT count(*) FROM student_record_access_log WHERE record_type = 'gradebook'"
        ))).scalar_one()
    assert after == before + 1


async def test_gradebook_is_the_teachers_own(client: AsyncClient) -> None:
    w = await _world()
    r = await client.get(_url(w), headers=w["outsider"])
    assert r.status_code in (403, 404)
    # A section from another course can't be read through this course.
    r = await client.get(_url(w, w["foreign_section"]), headers=w["teacher"])
    assert r.status_code == 404
