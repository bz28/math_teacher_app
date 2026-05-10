"""GET /v1/teacher/courses now returns per-course attention aggregates
(to_review, flagged, next_due_at) so the courses dashboard can render
status without N round-trips. The math is supposed to mirror the
submissions-inbox endpoint — anything that needs teacher action there
should be counted here.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.assignment import (
    Assignment,
    AssignmentSection,
    Submission,
    SubmissionGrade,
)
from api.models.course import Course, CourseTeacher
from api.models.integrity_check import IntegrityCheckSubmission
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.unit import Unit
from api.models.user import User
from tests.conftest import auth_headers as _auth


async def _seed_teacher_with_course(name: str = "Algebra 1") -> dict[str, uuid.UUID | str]:
    """Build a fresh teacher + course + section + a published HW. Returns
    the ids we need to mutate state in tests."""
    async with get_session_factory()() as s:
        teacher = User(
            email=f"teacher_{uuid.uuid4().hex[:8]}@t.com",
            password_hash=hash_password("x"),
            grade_level=12,
            role="teacher",
            name="T",
        )
        student = User(
            email=f"student_{uuid.uuid4().hex[:8]}@t.com",
            password_hash=hash_password("x"),
            grade_level=8,
            role="student",
            name="S",
        )
        s.add_all([teacher, student])
        await s.flush()

        course = Course(name=name, subject="math")
        s.add(course)
        await s.flush()

        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))

        unit = Unit(course_id=course.id, name="Quadratics", position=0)
        s.add(unit)
        await s.flush()

        section = Section(course_id=course.id, name="P1")
        s.add(section)
        await s.flush()

        s.add(SectionEnrollment(
            section_id=section.id, course_id=course.id, student_id=student.id,
        ))

        await s.commit()

        return {
            "teacher_id": teacher.id,
            "student_id": student.id,
            "course_id": course.id,
            "section_id": section.id,
            "unit_id": unit.id,
            "teacher_token": create_access_token(str(teacher.id), "teacher"),
        }


async def _publish_homework(
    *,
    course_id: uuid.UUID,
    teacher_id: uuid.UUID,
    section_id: uuid.UUID,
    unit_id: uuid.UUID,
    due_at: datetime | None,
    title: str = "HW",
) -> uuid.UUID:
    async with get_session_factory()() as s:
        a = Assignment(
            course_id=course_id,
            unit_ids=[unit_id],
            teacher_id=teacher_id,
            title=title,
            type="homework",
            status="published",
            content={"problems": []},
            due_at=due_at,
        )
        s.add(a)
        await s.flush()
        s.add(AssignmentSection(
            assignment_id=a.id,
            section_id=section_id,
            published_at=datetime.now(UTC),
        ))
        await s.commit()
        return a.id


async def test_courses_aggregates_zero_when_nothing_submitted(
    client: AsyncClient,
) -> None:
    w = await _seed_teacher_with_course()
    r = await client.get("/v1/teacher/courses", headers=_auth(w["teacher_token"]))
    assert r.status_code == 200, r.text
    courses = r.json()["courses"]
    assert len(courses) == 1
    c = courses[0]
    assert c["to_review"] == 0
    assert c["flagged"] == 0
    assert c["next_due_at"] is None


async def test_courses_to_review_counts_ungraded_submissions(
    client: AsyncClient,
) -> None:
    w = await _seed_teacher_with_course()
    hw_id = await _publish_homework(
        course_id=w["course_id"],
        teacher_id=w["teacher_id"],
        section_id=w["section_id"],
        unit_id=w["unit_id"],
        due_at=None,
    )

    # One submitted, no grade row → counts as to_review.
    async with get_session_factory()() as s:
        s.add(Submission(
            assignment_id=hw_id,
            student_id=w["student_id"],
            section_id=w["section_id"],
            status="submitted",
        ))
        await s.commit()

    r = await client.get("/v1/teacher/courses", headers=_auth(w["teacher_token"]))
    c = r.json()["courses"][0]
    assert c["to_review"] == 1, c
    assert c["flagged"] == 0


async def test_courses_published_clean_grade_does_not_count(
    client: AsyncClient,
) -> None:
    w = await _seed_teacher_with_course()
    hw_id = await _publish_homework(
        course_id=w["course_id"],
        teacher_id=w["teacher_id"],
        section_id=w["section_id"],
        unit_id=w["unit_id"],
        due_at=None,
    )

    # Submission published with snapshot matching live → clean.
    async with get_session_factory()() as s:
        sub = Submission(
            assignment_id=hw_id,
            student_id=w["student_id"],
            section_id=w["section_id"],
            status="submitted",
        )
        s.add(sub)
        await s.flush()
        s.add(SubmissionGrade(
            submission_id=sub.id,
            final_score=85.0,
            published_final_score=85.0,
            grade_published_at=datetime.now(UTC),
        ))
        await s.commit()

    r = await client.get("/v1/teacher/courses", headers=_auth(w["teacher_token"]))
    c = r.json()["courses"][0]
    assert c["to_review"] == 0
    assert c["flagged"] == 0


async def test_courses_dirty_grade_counts_as_to_review(
    client: AsyncClient,
) -> None:
    w = await _seed_teacher_with_course()
    hw_id = await _publish_homework(
        course_id=w["course_id"],
        teacher_id=w["teacher_id"],
        section_id=w["section_id"],
        unit_id=w["unit_id"],
        due_at=None,
    )

    # Published, but live score has drifted from the published snapshot
    # → teacher needs to republish.
    async with get_session_factory()() as s:
        sub = Submission(
            assignment_id=hw_id,
            student_id=w["student_id"],
            section_id=w["section_id"],
            status="submitted",
        )
        s.add(sub)
        await s.flush()
        s.add(SubmissionGrade(
            submission_id=sub.id,
            final_score=92.0,
            published_final_score=85.0,
            grade_published_at=datetime.now(UTC),
        ))
        await s.commit()

    r = await client.get("/v1/teacher/courses", headers=_auth(w["teacher_token"]))
    c = r.json()["courses"][0]
    assert c["to_review"] == 1


async def test_courses_flagged_integrity_disposition(
    client: AsyncClient,
) -> None:
    w = await _seed_teacher_with_course()
    hw_id = await _publish_homework(
        course_id=w["course_id"],
        teacher_id=w["teacher_id"],
        section_id=w["section_id"],
        unit_id=w["unit_id"],
        due_at=None,
    )

    async with get_session_factory()() as s:
        sub = Submission(
            assignment_id=hw_id,
            student_id=w["student_id"],
            section_id=w["section_id"],
            status="submitted",
        )
        s.add(sub)
        await s.flush()
        s.add(IntegrityCheckSubmission(
            submission_id=sub.id,
            status="complete",
            disposition="flag_for_review",
        ))
        await s.commit()

    r = await client.get("/v1/teacher/courses", headers=_auth(w["teacher_token"]))
    c = r.json()["courses"][0]
    assert c["flagged"] == 1
    # Same submission also needs teacher action since there's no grade
    # row at all — flagged and to_review are independent counts.
    assert c["to_review"] == 1


async def test_courses_next_due_picks_soonest_future(
    client: AsyncClient,
) -> None:
    w = await _seed_teacher_with_course()
    now = datetime.now(UTC)
    # Past-due (excluded), close future, far future.
    await _publish_homework(
        course_id=w["course_id"], teacher_id=w["teacher_id"],
        section_id=w["section_id"], unit_id=w["unit_id"],
        due_at=now - timedelta(days=2), title="HW past",
    )
    soon = now + timedelta(days=3)
    await _publish_homework(
        course_id=w["course_id"], teacher_id=w["teacher_id"],
        section_id=w["section_id"], unit_id=w["unit_id"],
        due_at=soon, title="HW soon",
    )
    await _publish_homework(
        course_id=w["course_id"], teacher_id=w["teacher_id"],
        section_id=w["section_id"], unit_id=w["unit_id"],
        due_at=now + timedelta(days=10), title="HW later",
    )

    r = await client.get("/v1/teacher/courses", headers=_auth(w["teacher_token"]))
    c = r.json()["courses"][0]
    next_due = datetime.fromisoformat(c["next_due_at"])
    # Equal within a second of `soon` (sub-second jitter from DB round-trip).
    assert abs((next_due - soon).total_seconds()) < 2


async def test_courses_excludes_preview_student_submissions(
    client: AsyncClient,
) -> None:
    w = await _seed_teacher_with_course()
    hw_id = await _publish_homework(
        course_id=w["course_id"], teacher_id=w["teacher_id"],
        section_id=w["section_id"], unit_id=w["unit_id"],
        due_at=None,
    )

    async with get_session_factory()() as s:
        preview = User(
            email=f"preview_{uuid.uuid4().hex[:8]}@t.com",
            password_hash=hash_password("x"),
            grade_level=8,
            role="student",
            name="Preview",
            is_preview=True,
        )
        s.add(preview)
        await s.flush()
        s.add(SectionEnrollment(
            section_id=w["section_id"], course_id=w["course_id"],
            student_id=preview.id,
        ))
        s.add(Submission(
            assignment_id=hw_id, student_id=preview.id,
            section_id=w["section_id"], status="submitted",
        ))
        await s.commit()

    r = await client.get("/v1/teacher/courses", headers=_auth(w["teacher_token"]))
    c = r.json()["courses"][0]
    # Preview student's submission must not show up in attention counts —
    # the courses dashboard mirrors the submissions inbox, which excludes them.
    assert c["to_review"] == 0
    assert c["flagged"] == 0


async def test_courses_other_teacher_cannot_see_aggregates(
    client: AsyncClient,
) -> None:
    """Cross-teacher isolation: a second teacher's GET shouldn't include
    course1, and course1's aggregates shouldn't leak into their numbers."""
    w1 = await _seed_teacher_with_course("Algebra")
    w2 = await _seed_teacher_with_course("Geometry")
    hw_id = await _publish_homework(
        course_id=w1["course_id"], teacher_id=w1["teacher_id"],
        section_id=w1["section_id"], unit_id=w1["unit_id"],
        due_at=None,
    )
    async with get_session_factory()() as s:
        s.add(Submission(
            assignment_id=hw_id, student_id=w1["student_id"],
            section_id=w1["section_id"], status="submitted",
        ))
        await s.commit()

    r = await client.get("/v1/teacher/courses", headers=_auth(w2["teacher_token"]))
    courses = r.json()["courses"]
    assert len(courses) == 1
    assert courses[0]["name"] == "Geometry"
    assert courses[0]["to_review"] == 0


async def test_courses_unenrolled_after_submit_drops_from_counts(
    client: AsyncClient,
) -> None:
    """Mirror the inbox: a student who submitted then got unenrolled
    must not contribute to the course's attention counts. Otherwise the
    dashboard reports phantom work the teacher can't actually see in
    the Submissions tab."""
    w = await _seed_teacher_with_course()
    hw_id = await _publish_homework(
        course_id=w["course_id"], teacher_id=w["teacher_id"],
        section_id=w["section_id"], unit_id=w["unit_id"],
        due_at=None,
    )

    async with get_session_factory()() as s:
        s.add(Submission(
            assignment_id=hw_id, student_id=w["student_id"],
            section_id=w["section_id"], status="submitted",
        ))
        await s.commit()
        # Now drop the enrollment row — student left the section.
        await s.execute(
            SectionEnrollment.__table__.delete().where(
                SectionEnrollment.student_id == w["student_id"],
            ),
        )
        await s.commit()

    r = await client.get("/v1/teacher/courses", headers=_auth(w["teacher_token"]))
    c = r.json()["courses"][0]
    assert c["to_review"] == 0
    assert c["flagged"] == 0


async def test_courses_flagged_skipped_unreadable(
    client: AsyncClient,
) -> None:
    w = await _seed_teacher_with_course()
    hw_id = await _publish_homework(
        course_id=w["course_id"], teacher_id=w["teacher_id"],
        section_id=w["section_id"], unit_id=w["unit_id"],
        due_at=None,
    )
    async with get_session_factory()() as s:
        sub = Submission(
            assignment_id=hw_id, student_id=w["student_id"],
            section_id=w["section_id"], status="submitted",
        )
        s.add(sub)
        await s.flush()
        s.add(IntegrityCheckSubmission(
            submission_id=sub.id,
            status="skipped_unreadable",
        ))
        await s.commit()

    c = (await client.get(
        "/v1/teacher/courses", headers=_auth(w["teacher_token"]),
    )).json()["courses"][0]
    assert c["flagged"] == 1


async def test_courses_flagged_complete_without_disposition(
    client: AsyncClient,
) -> None:
    """Inconclusive integrity checks (status=complete but no disposition
    — e.g. turn cap, no sampled problems) are flagged for teacher review."""
    w = await _seed_teacher_with_course()
    hw_id = await _publish_homework(
        course_id=w["course_id"], teacher_id=w["teacher_id"],
        section_id=w["section_id"], unit_id=w["unit_id"],
        due_at=None,
    )
    async with get_session_factory()() as s:
        sub = Submission(
            assignment_id=hw_id, student_id=w["student_id"],
            section_id=w["section_id"], status="submitted",
        )
        s.add(sub)
        await s.flush()
        s.add(IntegrityCheckSubmission(
            submission_id=sub.id,
            status="complete",
            disposition=None,
        ))
        await s.commit()

    c = (await client.get(
        "/v1/teacher/courses", headers=_auth(w["teacher_token"]),
    )).json()["courses"][0]
    assert c["flagged"] == 1


async def test_courses_flagged_extraction_flagged_at(
    client: AsyncClient,
) -> None:
    """Student raised 'reader got something wrong' before confirming —
    routes straight to manual grading and counts as flagged."""
    w = await _seed_teacher_with_course()
    hw_id = await _publish_homework(
        course_id=w["course_id"], teacher_id=w["teacher_id"],
        section_id=w["section_id"], unit_id=w["unit_id"],
        due_at=None,
    )
    async with get_session_factory()() as s:
        s.add(Submission(
            assignment_id=hw_id, student_id=w["student_id"],
            section_id=w["section_id"], status="submitted",
            extraction_flagged_at=datetime.now(UTC),
        ))
        await s.commit()

    c = (await client.get(
        "/v1/teacher/courses", headers=_auth(w["teacher_token"]),
    )).json()["courses"][0]
    assert c["flagged"] == 1


async def test_courses_dirty_grade_via_teacher_notes(
    client: AsyncClient,
) -> None:
    """Dirty isn't only score-mismatch — editing the teacher_notes after
    publish also flips the row to needs-republish. Without this branch
    the count silently underreports edits."""
    w = await _seed_teacher_with_course()
    hw_id = await _publish_homework(
        course_id=w["course_id"], teacher_id=w["teacher_id"],
        section_id=w["section_id"], unit_id=w["unit_id"],
        due_at=None,
    )
    async with get_session_factory()() as s:
        sub = Submission(
            assignment_id=hw_id, student_id=w["student_id"],
            section_id=w["section_id"], status="submitted",
        )
        s.add(sub)
        await s.flush()
        s.add(SubmissionGrade(
            submission_id=sub.id,
            final_score=85.0,
            published_final_score=85.0,
            teacher_notes="Updated note after publish",
            published_teacher_notes="Original note",
            grade_published_at=datetime.now(UTC),
        ))
        await s.commit()

    c = (await client.get(
        "/v1/teacher/courses", headers=_auth(w["teacher_token"]),
    )).json()["courses"][0]
    assert c["to_review"] == 1


async def test_courses_dirty_grade_via_breakdown(
    client: AsyncClient,
) -> None:
    """Editing the per-problem breakdown after publish also marks the
    row dirty even when the rolled-up final_score is unchanged."""
    w = await _seed_teacher_with_course()
    hw_id = await _publish_homework(
        course_id=w["course_id"], teacher_id=w["teacher_id"],
        section_id=w["section_id"], unit_id=w["unit_id"],
        due_at=None,
    )
    async with get_session_factory()() as s:
        sub = Submission(
            assignment_id=hw_id, student_id=w["student_id"],
            section_id=w["section_id"], status="submitted",
        )
        s.add(sub)
        await s.flush()
        s.add(SubmissionGrade(
            submission_id=sub.id,
            final_score=85.0,
            published_final_score=85.0,
            breakdown=[{"problem_id": "p1", "score_status": "partial", "percent": 70}],
            published_breakdown=[{"problem_id": "p1", "score_status": "full", "percent": 100}],
            grade_published_at=datetime.now(UTC),
        ))
        await s.commit()

    c = (await client.get(
        "/v1/teacher/courses", headers=_auth(w["teacher_token"]),
    )).json()["courses"][0]
    assert c["to_review"] == 1


async def test_courses_next_due_excludes_unassigned_homework(
    client: AsyncClient,
) -> None:
    """A published HW with no AssignmentSection rows has no audience —
    its due date must not surface on the dashboard, mirroring how the
    Submissions inbox filters out HWs with no section."""
    w = await _seed_teacher_with_course()
    soon = datetime.now(UTC) + timedelta(days=2)

    # Published HW with no AssignmentSection row at all.
    async with get_session_factory()() as s:
        a = Assignment(
            course_id=w["course_id"],
            unit_ids=[w["unit_id"]],
            teacher_id=w["teacher_id"],
            title="Unassigned HW",
            type="homework",
            status="published",
            content={"problems": []},
            due_at=soon,
        )
        s.add(a)
        await s.commit()

    c = (await client.get(
        "/v1/teacher/courses", headers=_auth(w["teacher_token"]),
    )).json()["courses"][0]
    assert c["next_due_at"] is None


# ─── GET /courses/{course_id} now also returns attention aggregates ───
#
# Single-course version of the dashboard math, used by the course
# detail page to render header pills without a second round-trip
# through the inbox endpoint.


async def test_course_detail_returns_attention_aggregates(
    client: AsyncClient,
) -> None:
    w = await _seed_teacher_with_course()
    hw_id = await _publish_homework(
        course_id=w["course_id"], teacher_id=w["teacher_id"],
        section_id=w["section_id"], unit_id=w["unit_id"],
        due_at=None,
    )
    async with get_session_factory()() as s:
        sub = Submission(
            assignment_id=hw_id, student_id=w["student_id"],
            section_id=w["section_id"], status="submitted",
        )
        s.add(sub)
        await s.flush()
        s.add(IntegrityCheckSubmission(
            submission_id=sub.id,
            status="complete",
            disposition="flag_for_review",
        ))
        await s.commit()

    r = await client.get(
        f"/v1/teacher/courses/{w['course_id']}",
        headers=_auth(w["teacher_token"]),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["to_review"] == 1
    assert body["flagged"] == 1
    assert body["next_due_at"] is None


async def test_course_detail_aggregates_match_list_aggregates(
    client: AsyncClient,
) -> None:
    """Detail and list endpoints must agree — they share helpers, so
    this is a guard against future drift if anyone forks the math."""
    w = await _seed_teacher_with_course()
    hw_id = await _publish_homework(
        course_id=w["course_id"], teacher_id=w["teacher_id"],
        section_id=w["section_id"], unit_id=w["unit_id"],
        due_at=datetime.now(UTC) + timedelta(days=4),
    )
    async with get_session_factory()() as s:
        sub = Submission(
            assignment_id=hw_id, student_id=w["student_id"],
            section_id=w["section_id"], status="submitted",
        )
        s.add(sub)
        await s.flush()
        s.add(SubmissionGrade(
            submission_id=sub.id,
            final_score=72.0,
            published_final_score=72.0,
            teacher_notes="edited after publish",
            published_teacher_notes="original",
            grade_published_at=datetime.now(UTC),
        ))
        await s.commit()

    list_c = (await client.get(
        "/v1/teacher/courses", headers=_auth(w["teacher_token"]),
    )).json()["courses"][0]
    detail_c = (await client.get(
        f"/v1/teacher/courses/{w['course_id']}",
        headers=_auth(w["teacher_token"]),
    )).json()
    assert list_c["to_review"] == detail_c["to_review"] == 1
    assert list_c["flagged"] == detail_c["flagged"] == 0
    assert list_c["next_due_at"] == detail_c["next_due_at"]


async def test_course_detail_other_teacher_404(
    client: AsyncClient,
) -> None:
    """Cross-teacher isolation on the detail endpoint — the helper
    runs after the auth check so attention math never leaks."""
    w1 = await _seed_teacher_with_course("Algebra")
    w2 = await _seed_teacher_with_course("Geometry")
    r = await client.get(
        f"/v1/teacher/courses/{w1['course_id']}",
        headers=_auth(w2["teacher_token"]),
    )
    assert r.status_code == 404


async def test_course_detail_isolates_aggregates_across_teachers_courses(
    client: AsyncClient,
) -> None:
    """Single teacher with two courses — the detail endpoint's
    `Assignment.course_id == course_id` predicate must scope the
    counts to exactly the requested course. Without it, work in
    course B would leak into course A's pills."""
    w_algebra = await _seed_teacher_with_course("Algebra")
    # Seed a second course owned by the same teacher with its own
    # section + enrollment + a homework that needs review.
    async with get_session_factory()() as s:
        from api.models.course import Course as CourseModel
        from api.models.course import CourseTeacher as CTModel

        course_b = CourseModel(name="Geometry-B", subject="math")
        s.add(course_b)
        await s.flush()
        s.add(CTModel(
            course_id=course_b.id,
            teacher_id=w_algebra["teacher_id"],
            role="owner",
        ))
        unit_b = Unit(course_id=course_b.id, name="Lines", position=0)
        s.add(unit_b)
        await s.flush()
        section_b = Section(course_id=course_b.id, name="P2")
        s.add(section_b)
        await s.flush()
        s.add(SectionEnrollment(
            section_id=section_b.id,
            course_id=course_b.id,
            student_id=w_algebra["student_id"],
        ))
        course_b_id = course_b.id
        section_b_id = section_b.id
        unit_b_id = unit_b.id
        await s.commit()

    hw_b_id = await _publish_homework(
        course_id=course_b_id, teacher_id=w_algebra["teacher_id"],
        section_id=section_b_id, unit_id=unit_b_id,
        due_at=None,
    )
    async with get_session_factory()() as s:
        s.add(Submission(
            assignment_id=hw_b_id, student_id=w_algebra["student_id"],
            section_id=section_b_id, status="submitted",
        ))
        await s.commit()

    # Course A has no submissions; the detail endpoint must report 0
    # despite course B having outstanding work for the same teacher.
    detail_a = (await client.get(
        f"/v1/teacher/courses/{w_algebra['course_id']}",
        headers=_auth(w_algebra["teacher_token"]),
    )).json()
    detail_b = (await client.get(
        f"/v1/teacher/courses/{course_b_id}",
        headers=_auth(w_algebra["teacher_token"]),
    )).json()
    assert detail_a["to_review"] == 0
    assert detail_b["to_review"] == 1
