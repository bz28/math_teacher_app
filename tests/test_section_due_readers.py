"""Every teacher and student view that shows or acts on a homework's due
date reads the student's SECTION date, not the homework's own one.

The world: the homework's own date (= its earliest section's, Period 3,
with no students) is yesterday; the student's section is due in two days.
On every view, for that student, the homework is not yet due.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select

from api.database import get_session_factory
from api.models.assignment import Assignment, AssignmentSection, Submission
from api.models.course import CourseTeacher
from api.models.section import Section
from tests.conftest import auth_headers as _auth

DAY = timedelta(hours=24)


async def _setup(world: dict[str, Any]) -> dict[str, Any]:
    now = datetime.now(UTC).replace(microsecond=0)
    early, late = now - DAY, now + 2 * DAY
    async with get_session_factory()() as s:
        a = await s.get(Assignment, world["assignment_id"])
        assert a is not None
        a.due_at = early
        a.late_policy = "none"
        row = (await s.execute(
            select(AssignmentSection).where(AssignmentSection.assignment_id == a.id)
        )).scalar_one()
        row.due_at = late
        other = Section(course_id=a.course_id, name="Period 3")
        s.add(other)
        await s.flush()
        s.add(AssignmentSection(assignment_id=a.id, section_id=other.id, published_at=now, due_at=early))
        s.add(CourseTeacher(course_id=a.course_id, teacher_id=world["teacher_id"], role="owner"))
        await s.commit()
        return {"aid": a.id, "course_id": a.course_id, "section": row.section_id,
                "other": other.id, "early": early, "late": late, "now": now}


async def test_grades_tab_does_not_call_a_later_section_missing_early(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    w = await _setup(world)
    r = await client.get(f"/v1/teacher/courses/{w['course_id']}/grades",
                         headers=_auth(world["teacher_token"]))
    assert r.status_code == 200, r.text
    me = next(st for st in r.json()["students"] if st["student_id"] == str(world["student_id"]))
    assert me["missing_count"] == 0


async def test_reopen_must_extend_the_students_section_date(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    w = await _setup(world)
    url = f"/v1/teacher/assignments/{w['aid']}/students/{world['student_id']}/reopen"
    # After the homework's own date but before the student's section's: no extension at all.
    r = await client.post(url, json={"due_at": (w["now"] + DAY).isoformat()},
                          headers=_auth(world["teacher_token"]))
    assert r.status_code == 400, r.text
    r = await client.post(url, json={"due_at": (w["late"] + DAY).isoformat()},
                          headers=_auth(world["teacher_token"]))
    assert r.status_code == 200, r.text


async def test_section_insights_and_course_next_due_use_the_section_date(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    w = await _setup(world)
    r = await client.get(
        f"/v1/teacher/courses/{w['course_id']}/sections/{w['section']}/insights",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 200, r.text
    hw = next(h for h in r.json()["homeworks"] if h["id"] == str(w["aid"]))
    assert datetime.fromisoformat(hw["due_at"]) == w["late"]
    r = await client.get("/v1/teacher/courses", headers=_auth(world["teacher_token"]))
    assert r.status_code == 200, r.text
    course = next(c for c in r.json()["courses"] if c["id"] == str(w["course_id"]))
    # Period 3's date passed; the student's section is still to come.
    assert course["next_due_at"] is not None
    assert datetime.fromisoformat(course["next_due_at"]) == w["late"]


async def test_needs_attention_is_not_overdue_before_the_section_date(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    w = await _setup(world)
    async with get_session_factory()() as s:
        s.add(Submission(
            assignment_id=w["aid"], student_id=world["student_id"], section_id=w["section"],
            status="submitted", submitted_at=w["now"] - DAY / 2, is_late=False,
        ))
        await s.commit()
    r = await client.get("/v1/teacher/needs-attention", headers=_auth(world["teacher_token"]))
    assert r.status_code == 200, r.text
    mine = [it for it in r.json()["items"] if it["assignment_id"] == str(w["aid"])]
    assert mine, r.json()
    assert mine[0]["reason"] != "overdue"
    assert datetime.fromisoformat(mine[0]["due_at"]) == w["late"]


async def test_the_student_list_is_in_their_own_date_order(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """A second homework due (for everyone) tomorrow comes before this one,
    which is due in two days for the student though its own date was
    yesterday."""
    w = await _setup(world)
    async with get_session_factory()() as s:
        a = await s.get(Assignment, w["aid"])
        assert a is not None
        b = Assignment(course_id=a.course_id, teacher_id=a.teacher_id, title="Tomorrow's",
                       type="homework", status="published", unit_ids=a.unit_ids,
                       due_at=w["now"] + DAY, content={"problem_ids": []})
        s.add(b)
        await s.flush()
        s.add(AssignmentSection(assignment_id=b.id, section_id=w["section"],
                                published_at=w["now"], due_at=w["now"] + DAY))
        await s.commit()
        b_id = b.id
    r = await client.get(f"/v1/school/student/courses/{w['course_id']}/homework",
                         headers=_auth(world["student_token"]))
    assert r.status_code == 200, r.text
    ids = [h["assignment_id"] for h in r.json()]
    assert ids.index(str(b_id)) < ids.index(str(w["aid"]))


async def test_the_homework_date_stays_the_earliest_sections(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    w = await _setup(world)
    # Dropping the earliest section (Period 3) moves the homework's date to the student's.
    async with get_session_factory()() as s:
        await s.execute(select(Assignment).where(Assignment.id == w["aid"]))
        a = await s.get(Assignment, w["aid"])
        assert a is not None
        a.status = "draft"
        await s.commit()
    r = await client.post(f"/v1/teacher/assignments/{w['aid']}/sections",
                          json={"section_ids": [str(w["section"])]},
                          headers=_auth(world["teacher_token"]))
    assert r.status_code == 200, r.text
    async with get_session_factory()() as s:
        a = await s.get(Assignment, w["aid"])
        assert a is not None and a.due_at == w["late"]


async def test_a_section_edit_keeps_an_undated_row_on_its_date(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """A row from before per-section dates (no date) reads as the
    homework's. Moving another section earlier moves the homework's date;
    the undated section must keep the date it had."""
    w = await _setup(world)
    async with get_session_factory()() as s:
        a = await s.get(Assignment, w["aid"])
        assert a is not None
        a.due_at = w["late"]
        for row in (await s.execute(select(AssignmentSection).where(
                AssignmentSection.assignment_id == w["aid"]))).scalars():
            row.due_at = None if row.section_id == w["section"] else w["late"]
        await s.commit()
    r = await client.post(
        f"/v1/teacher/assignments/{w['aid']}/due-dates",
        json={"section_due_dates": {str(w["other"]): w["early"].isoformat()}},
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 200, r.text
    dates = {d["section_id"]: datetime.fromisoformat(d["due_at"]) for d in r.json()["section_due_dates"]}
    assert dates[str(w["section"])] == w["late"]
    assert datetime.fromisoformat(r.json()["due_at"]) == w["early"]


async def test_a_preview_does_not_reschedule_queued_grading(
    client: AsyncClient, world: dict[str, Any], monkeypatch: Any,
) -> None:
    """The dialog previews on every pick: re-pointing queued jobs doesn't
    change what a preview reports, so it isn't done (only a save does)."""
    import api.core.grading_queue as gq
    w = await _setup(world)
    calls: list[uuid.UUID] = []
    real = gq.reschedule_assignment

    async def spy(db: Any, assignment: Assignment) -> int:
        calls.append(assignment.id)
        return await real(db, assignment)

    monkeypatch.setattr(gq, "reschedule_assignment", spy)
    url = f"/v1/teacher/assignments/{w['aid']}/due-dates"
    body = {"due_at": (w["late"] + DAY).isoformat()}
    r = await client.post(url, json={**body, "dry_run": True}, headers=_auth(world["teacher_token"]))
    assert r.status_code == 200, r.text
    assert calls == []
    r = await client.post(url, json=body, headers=_auth(world["teacher_token"]))
    assert r.status_code == 200, r.text
    assert calls == [w["aid"]]
