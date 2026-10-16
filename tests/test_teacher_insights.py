"""Tests for GET /v1/teacher/courses/{c}/sections/{s}/insights.

Two layers:
  - pure unit tests of the counting rule (`counted_breakdown`), the
    coverage buckets and the reteach rule (`_is_wrong` / `_is_flagged`)
    — the load-bearing logic;
  - integration tests that seed a small world and check what the
    endpoint returns: section scoping, coverage buckets, per-problem
    whole-class counts and flags, the homework's practice set, and auth.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.assignment import Assignment, AssignmentSection, Submission, SubmissionGrade
from api.models.course import Course, CourseTeacher
from api.models.grading_job import GradingJob
from api.models.question_bank import QuestionBankGenerationJob, QuestionBankItem
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.unit import Unit
from api.models.user import User
from api.routes.teacher_insights import _coverage_bucket, _is_flagged, _is_wrong, counted_breakdown
from tests.conftest import auth_headers as _auth

NOW = datetime.now(UTC)


def _e(status: str, percent: float = 0.0, pid: str = "p") -> dict[str, Any]:
    return {"problem_id": pid, "score_status": status, "percent": percent}


# ── counted_breakdown ──────────────────────────────────────────────


def _grade(**kw: Any) -> Any:
    base = {"reviewed_at": None, "grade_published_at": None, "breakdown": None, "published_breakdown": None}
    return SimpleNamespace(**{**base, **kw})


def test_counted_uses_live_breakdown_once_approved() -> None:
    g = _grade(reviewed_at=NOW, breakdown=[_e("full", 100)], published_breakdown=[_e("zero")])
    assert counted_breakdown(g) == [_e("full", 100)]


def test_counted_uses_published_snapshot_when_not_approved() -> None:
    # A forced AI regrade clears reviewed_at but keeps the publish stamp:
    # the live column is an unseen AI draft, so the snapshot counts.
    g = _grade(grade_published_at=NOW, breakdown=[_e("zero")], published_breakdown=[_e("full", 100)])
    assert counted_breakdown(g) == [_e("full", 100)]


def test_unapproved_unpublished_draft_never_counts() -> None:
    assert counted_breakdown(_grade(breakdown=[_e("full", 100)])) is None
    assert counted_breakdown(None) is None


def test_empty_or_malformed_breakdown_counts_as_nothing() -> None:
    assert counted_breakdown(_grade(reviewed_at=NOW, breakdown=[])) is None
    assert counted_breakdown(_grade(reviewed_at=NOW, breakdown=[{"score_status": "bogus"}])) is None
    g = _grade(reviewed_at=NOW, breakdown=[_e("full", 100), {"score_status": "bogus"}, "junk"])
    assert counted_breakdown(g) == [_e("full", 100)]


# ── _coverage_bucket ──


def _row(**kw: Any) -> Any:
    base = {"extraction_flagged_at": None, "ai_grading_status": None,
            "extraction_confirmed_at": NOW, "job_status": None, "job_scheduled_for": None,
            "has_reading": True, "reading_confidence": "0.9",
            "submitted_at": NOW - timedelta(days=1)}
    return _grade(**{**base, **kw})


def test_coverage_buckets_are_exclusive_and_honest() -> None:
    def bucket(r: Any, ai: bool = True) -> str:
        return _coverage_bucket(r, counted_breakdown(r), ai_grading_enabled=ai, now=NOW)

    assert bucket(_row(breakdown=[_e("full", 100)])) == "to_approve"
    assert bucket(_row(reviewed_at=NOW, breakdown=[_e("full", 100)])) == "counted"
    assert bucket(_row(ai_grading_status="skipped_unreadable")) == "to_grade"
    assert bucket(_row(extraction_flagged_at=NOW, extraction_confirmed_at=None)) == "to_grade"
    # A grade the teacher retracted after publishing: nothing is grading it.
    assert bucket(_row(grade_published_at=NOW, breakdown=[], published_breakdown=[])) == "to_grade"


def test_still_grading_means_a_live_job() -> None:
    def bucket(r: Any, ai: bool = True) -> str:
        return _coverage_bucket(r, counted_breakdown(r), ai_grading_enabled=ai, now=NOW)

    assert bucket(_row(job_status="queued", job_scheduled_for=NOW)) == "grading"
    # Queued with no time (no due date): it waits for the teacher's Grade press.
    assert bucket(_row(job_status="queued")) == "to_grade"
    assert bucket(_row(job_status="running")) == "grading"
    # Nothing will AI-grade these, so they're the teacher's to grade.
    assert bucket(_row(job_status="failed")) == "to_grade"
    assert bucket(_row(job_status="skipped")) == "to_grade"
    assert bucket(_row()) == "to_grade"            # confirmed, no job
    assert bucket(_row(), ai=False) == "to_grade"  # AI grading off
    # AI grading waits on the student confirming the reading.
    assert bucket(_row(extraction_confirmed_at=None)) == "awaiting_student"
    assert bucket(_row(extraction_confirmed_at=None), ai=False) == "to_grade"
    assert bucket(_row(extraction_confirmed_at=None, ai_grading_status="skipped_unreadable")) == "to_grade"
    # AI grading switched off after a job was queued: the drain will skip it.
    assert bucket(_row(job_status="queued", job_scheduled_for=NOW), ai=False) == "to_grade"


def test_a_reading_that_never_came_is_the_teachers() -> None:
    def bucket(r: Any) -> str:
        return _coverage_bucket(r, None, ai_grading_enabled=True, now=NOW)

    unread = {"has_reading": False, "extraction_confirmed_at": None}
    # Fresh photo: the reader is still on it.
    assert bucket(_row(**unread, submitted_at=NOW - timedelta(minutes=2))) == "grading"
    # Past the grace window the read failed; the student has nothing to confirm.
    assert bucket(_row(**unread, submitted_at=NOW - timedelta(hours=2))) == "to_grade"


def test_a_low_confidence_reading_is_unreadable_like_ai_grade_block() -> None:
    def bucket(r: Any) -> str:
        return _coverage_bucket(r, None, ai_grading_enabled=True, now=NOW)

    for raw in ("0.1", None, "junk"):  # low, missing and malformed all read as 0
        assert bucket(_row(extraction_confirmed_at=None, reading_confidence=raw)) == "to_grade"
    assert bucket(_row(extraction_confirmed_at=None, reading_confidence="0.9")) == "awaiting_student"


def test_a_running_job_is_grading_even_with_ai_switched_off() -> None:
    r = _row(job_status="running")
    assert _coverage_bucket(r, None, ai_grading_enabled=False, now=NOW) == "grading"


# ── reteach rule ───────────────────────────────────────────────────


def test_wrong_means_under_half_credit() -> None:
    assert _is_wrong(_e("zero", 0))
    assert _is_wrong(_e("partial", 49.9))
    assert not _is_wrong(_e("partial", 50))   # exactly half is not wrong
    assert not _is_wrong(_e("full", 100))
    # No percent: fall back on the status.
    assert _is_wrong({"score_status": "zero"})
    assert not _is_wrong({"score_status": "partial"})


def test_flagged_needs_more_than_half_of_at_least_five() -> None:
    assert _is_flagged(5, 3)
    assert not _is_flagged(6, 3)    # exactly half is not "more than half"
    assert not _is_flagged(4, 4)    # too few counted to mean anything
    assert _is_flagged(20, 11)


# ── Integration ────────────────────────────────────────────────────


async def _world() -> dict[str, Any]:
    """Teacher + course with two sections. Period 1 has 4 students and
    one preview shadow; Period 3 has 1 student. Two published homeworks
    (3 problems each) plus a quiz, all pushed to both sections."""
    async with get_session_factory()() as s:
        teacher = User(email=f"t_{uuid.uuid4().hex[:8]}@t.com", password_hash=hash_password("x"),
                       grade_level=12, role="teacher", name="T")
        course = Course(name="Algebra 1", subject="math")
        s.add_all([teacher, course])
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id))
        unit = Unit(course_id=course.id, name="U", position=0)
        p1 = Section(course_id=course.id, name="Period 1")
        p3 = Section(course_id=course.id, name="Period 3")
        s.add_all([unit, p1, p3])
        await s.flush()

        async def hw(title: str, due: datetime, kind: str = "homework") -> tuple[Assignment, list[str]]:
            a = Assignment(course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id, title=title,
                           type=kind, status="published", due_at=due, content={"problem_ids": []})
            s.add(a)
            await s.flush()
            items = [QuestionBankItem(course_id=course.id, unit_id=unit.id, originating_assignment_id=a.id,
                                      title=f"Q{i}", question=f"{title} Q{i}", final_answer="1",
                                      status="approved", source="generated") for i in (1, 2, 3)]
            s.add_all(items)
            await s.flush()
            ids = [str(i.id) for i in items]
            a.content = {"problem_ids": ids}
            for sec in (p1, p3):
                s.add(AssignmentSection(assignment_id=a.id, section_id=sec.id, published_at=due - timedelta(days=7)))
            return a, ids

        hw1, ids1 = await hw("HW 1", NOW - timedelta(days=10))
        hw2, ids2 = await hw("HW 2", NOW - timedelta(days=2))
        quiz, _ = await hw("Quiz 1", NOW - timedelta(days=1), kind="quiz")

        async def student(name: str, sec: Section, preview: bool = False) -> User:
            u = User(email=f"s_{uuid.uuid4().hex[:8]}@t.com", password_hash=hash_password("x"),
                     grade_level=9, role="student", name=name, is_preview=preview)
            s.add(u)
            await s.flush()
            s.add(SectionEnrollment(section_id=sec.id, course_id=course.id, student_id=u.id,
                                    enrolled_at=NOW - timedelta(days=30)))
            return u

        ana, ben, cal, dee = [await student(n, p1) for n in ("Ana", "Ben", "Cal", "Dee")]
        ghost = await student("Preview", p1, preview=True)
        eve = await student("Eve", p3)

        async def submit(a: Assignment, u: User, sec: Section, **grade: Any) -> Submission:
            flagged = grade.pop("flagged", None)
            sub = Submission(assignment_id=a.id, student_id=u.id, section_id=sec.id, status="submitted",
                             extraction_flagged_at=flagged,
                             extraction_confirmed_at=grade.pop("confirmed", None if flagged else NOW))
            s.add(sub)
            await s.flush()
            if grade:
                s.add(SubmissionGrade(submission_id=sub.id, graded_at=NOW, **grade))
            return sub

        def bd(ids: list[str], *statuses: str) -> list[dict[str, Any]]:
            pct = {"full": 100, "partial": 50, "zero": 0}
            return [{"problem_id": pid, "score_status": st, "percent": pct[st]} for pid, st in zip(ids, statuses)]

        # HW 2 (newest) in Period 1:
        await submit(hw2, ana, p1, reviewed_at=NOW, breakdown=bd(ids2, "full", "zero", "full"))
        await submit(hw2, ben, p1, grade_published_at=NOW,
                     breakdown=bd(ids2, "full", "full", "full"),          # unseen regrade draft
                     published_breakdown=bd(ids2, "zero", "zero", "partial"))
        await submit(hw2, cal, p1, breakdown=bd(ids2, "zero", "zero", "zero"))  # AI draft: to approve
        await submit(hw2, dee, p1, ai_grading_status="skipped_unreadable")      # to grade
        await submit(hw2, ghost, p1, reviewed_at=NOW, breakdown=bd(ids2, "zero", "zero", "zero"))
        await submit(hw2, eve, p3, reviewed_at=NOW, breakdown=bd(ids2, "zero", "zero", "zero"))
        # HW 1 in Period 1: Ana and Ben did well; Cal and Dee skipped it.
        await submit(hw1, ana, p1, reviewed_at=NOW, breakdown=bd(ids1, "full", "full", "full"))
        await submit(hw1, ben, p1, reviewed_at=NOW, breakdown=bd(ids1, "full", "full", "full"))
        # A quiz grade must never surface.
        await submit(quiz, ana, p1, reviewed_at=NOW, breakdown=bd(ids1, "zero", "zero", "zero"))

        await s.commit()
        return {
            "token": create_access_token(str(teacher.id), "teacher"),
            "course": course.id, "p1": p1.id, "p3": p3.id,
            "hw1": hw1.id, "hw2": hw2.id, "quiz": quiz.id, "ids2": ids2,
            "ana": ana.id, "ben": ben.id, "cal": cal.id, "dee": dee.id,
            "unit": unit.id, "teacher": teacher.id,
        }


def _url(w: dict[str, Any], section: str = "p1") -> str:
    return f"/v1/teacher/courses/{w['course']}/sections/{w[section]}/insights"


async def test_coverage_counts_only_approved_or_published_in_this_section(client: AsyncClient) -> None:
    w = await _world()
    r = await client.get(_url(w), headers=_auth(w["token"]))
    assert r.status_code == 200, r.text
    body = r.json()
    # Homework only, newest first — the quiz never appears.
    assert [h["id"] for h in body["homeworks"]] == [str(w["hw2"]), str(w["hw1"])]
    hw2 = body["homeworks"][0]
    assert hw2 == {
        **hw2,
        "students": 4,        # preview shadow excluded
        "counted": 2,         # Ana (approved) + Ben (published snapshot)
        "to_approve": 1,      # Cal's AI draft
        "to_grade": 1,   # Dee's unreadable work
        "grading": 0,
        "awaiting_student": 0,
        "not_submitted": 0,
    }
    assert body["homeworks"][1]["not_submitted"] == 2


async def test_problems_are_whole_class_counts_in_homework_order(client: AsyncClient) -> None:
    w = await _world()
    body = (await client.get(_url(w), headers=_auth(w["token"]))).json()
    assert body["selected_homework_id"] == str(w["hw2"])
    ids2 = w["ids2"]
    assert [p["bank_item_id"] for p in body["problems"]] == ids2
    # Ana: full, zero, full. Ben's published snapshot (not his regrade):
    # zero, zero, partial at exactly 50% — which is not wrong.
    assert [(p["counted"], p["wrong"]) for p in body["problems"]] == [(2, 1), (2, 2), (2, 0)]
    # Two counted grades is too few to flag anything.
    assert not any(p["flagged"] for p in body["problems"])
    assert body["flag_min_counted"] == 5
    assert body["practice"] is None
    # No per-student data leaves the endpoint.
    assert "watch" not in body and "students" not in body["problems"][0]


async def test_section_scoping(client: AsyncClient) -> None:
    w = await _world()
    body = (await client.get(_url(w, "p3"), headers=_auth(w["token"]))).json()
    hw2 = body["homeworks"][0]
    assert (hw2["students"], hw2["counted"]) == (1, 1)
    assert all((p["counted"], p["wrong"]) == (1, 1) for p in body["problems"])


async def _enroll_and_grade(w: dict[str, Any], n: int, statuses: list[str]) -> None:
    """Add `n` Period 1 students with an approved HW 2 grade, one status per problem."""
    pct = {"full": 100, "partial": 25, "zero": 0}
    async with get_session_factory()() as s:
        for i in range(n):
            u = User(email=f"s_{uuid.uuid4().hex[:8]}@t.com", password_hash=hash_password("x"),
                     grade_level=9, role="student", name=f"Extra {i}")
            s.add(u)
            await s.flush()
            s.add(SectionEnrollment(section_id=w["p1"], course_id=w["course"], student_id=u.id,
                                    enrolled_at=NOW - timedelta(days=30)))
            sub = Submission(assignment_id=w["hw2"], student_id=u.id, section_id=w["p1"],
                             status="submitted", extraction_confirmed_at=NOW)
            s.add(sub)
            await s.flush()
            s.add(SubmissionGrade(submission_id=sub.id, graded_at=NOW, reviewed_at=NOW, breakdown=[
                {"problem_id": pid, "score_status": st, "percent": pct[st]}
                for pid, st in zip(w["ids2"], statuses)
            ]))
        await s.commit()


async def test_a_problem_most_of_the_class_got_wrong_is_flagged(client: AsyncClient) -> None:
    w = await _world()
    # Three more students: Q1 full, Q2 partial at 25% (wrong), Q3 full.
    await _enroll_and_grade(w, 3, ["full", "partial", "full"])
    problems = (await client.get(_url(w), headers=_auth(w["token"]))).json()["problems"]
    # Q2: 5 of 5 wrong → flagged. Q1: 1 of 5. Q3: 0 of 5.
    assert [(p["counted"], p["wrong"], p["flagged"]) for p in problems] == [
        (5, 1, False), (5, 5, True), (5, 0, False),
    ]


async def test_the_homeworks_practice_set_for_this_section(client: AsyncClient) -> None:
    w = await _world()
    ids2 = [uuid.UUID(i) for i in w["ids2"]]
    async with get_session_factory()() as s:
        def practice(title: str) -> Assignment:
            return Assignment(course_id=w["course"], unit_ids=[w["unit"]], teacher_id=w["teacher"],
                              title=title, type="practice", status="draft", source_homework_id=w["hw2"])
        p3_set, p1_set = practice("P3 set"), practice("P1 set")
        s.add_all([p3_set, p1_set])
        await s.flush()
        s.add_all([
            AssignmentSection(assignment_id=p3_set.id, section_id=w["p3"]),
            AssignmentSection(assignment_id=p1_set.id, section_id=w["p1"]),
        ])

        def version(parent: uuid.UUID, status: str) -> QuestionBankItem:
            return QuestionBankItem(course_id=w["course"], unit_id=w["unit"], originating_assignment_id=p1_set.id,
                                    parent_question_id=parent, title="v", question="v", final_answer="1",
                                    status=status, source="practice")
        s.add_all([
            version(ids2[0], "approved"), version(ids2[0], "pending"),
            version(ids2[2], "rejected"),  # a rejected version covers nothing
            QuestionBankGenerationJob(course_id=w["course"], unit_id=w["unit"], originating_assignment_id=p1_set.id,
                                      created_by_id=w["teacher"], status="running", requested_count=3,
                                      parent_question_id=ids2[1]),
            # Failed: Q1's is covered by its versions anyway; Q3's isn't.
            *[QuestionBankGenerationJob(course_id=w["course"], unit_id=w["unit"], originating_assignment_id=p1_set.id,
                                        created_by_id=w["teacher"], status="failed", requested_count=3,
                                        parent_question_id=pid) for pid in (ids2[0], ids2[2])],
        ])
        await s.commit()

    practice_out = (await client.get(_url(w), headers=_auth(w["token"]))).json()["practice"]
    assert practice_out["title"] == "P1 set"  # Period 3's set never shows in Period 1
    assert (practice_out["approved"], practice_out["to_review"], practice_out["writing"]) == (1, 1, 1)
    assert practice_out["failed"] == 1
    assert set(practice_out["covered_item_ids"]) == {str(ids2[0]), str(ids2[1])}


async def test_explicit_homework_and_404s(client: AsyncClient) -> None:
    w = await _world()
    h = _auth(w["token"])
    body = (await client.get(_url(w), params={"assignment_id": str(w["hw1"])}, headers=h)).json()
    assert body["selected_homework_id"] == str(w["hw1"])
    assert (await client.get(_url(w), params={"assignment_id": str(w["quiz"])}, headers=h)).status_code == 404
    async with get_session_factory()() as s:
        stranger = User(email=f"t_{uuid.uuid4().hex[:8]}@t.com", password_hash=hash_password("x"),
                        grade_level=12, role="teacher", name="Other")
        s.add(stranger)
        await s.commit()
    other = create_access_token(str(stranger.id), "teacher")
    assert (await client.get(_url(w), headers=_auth(other))).status_code == 404
    bad = f"/v1/teacher/courses/{w['course']}/sections/{uuid.uuid4()}/insights"
    assert (await client.get(bad, headers=h)).status_code == 404


async def test_a_student_who_left_still_adds_up(client: AsyncClient) -> None:
    w = await _world()
    async with get_session_factory()() as s:
        enrollment = (await s.execute(
            select(SectionEnrollment).where(SectionEnrollment.student_id == w["ana"])
        )).scalar_one()
        await s.delete(enrollment)
        await s.commit()
    body = (await client.get(_url(w), headers=_auth(w["token"]))).json()
    hw2 = body["homeworks"][0]
    # Ana left but her approved grade still counts, so she stays in the total.
    assert (hw2["students"], hw2["counted"]) == (4, 2)
    assert body["problems"][0]["counted"] == 2


async def test_coverage_reads_the_grading_job_and_the_ai_switch(client: AsyncClient) -> None:
    """"Still grading" only while the grader will get to it; a homework
    with AI grading off never claims the grader is working on it."""
    w = await _world()
    async with get_session_factory()() as s:
        p1 = await s.get(Section, w["p1"])
        assert p1 is not None
        frank, gia, hal, ivy = [
            User(email=f"s_{uuid.uuid4().hex[:8]}@t.com", password_hash=hash_password("x"),
                 grade_level=9, role="student", name=n)
            for n in ("Frank", "Gia", "Hal", "Ivy")
        ]
        s.add_all([frank, gia, hal, ivy])
        await s.flush()
        for u in (frank, gia, hal, ivy):
            s.add(SectionEnrollment(section_id=p1.id, course_id=w["course"], student_id=u.id,
                                    enrolled_at=NOW - timedelta(days=30)))
        queued = Submission(assignment_id=w["hw2"], student_id=frank.id, section_id=p1.id,
                            status="submitted", extraction_confirmed_at=NOW,
                            extraction={"steps": [], "confidence": 0.9})
        failed = Submission(assignment_id=w["hw2"], student_id=gia.id, section_id=p1.id,
                            status="submitted", extraction_confirmed_at=NOW,
                            extraction={"steps": [], "confidence": 0.9})
        unconfirmed = Submission(assignment_id=w["hw2"], student_id=hal.id, section_id=p1.id,
                                 status="submitted", extraction={"steps": [], "confidence": 0.9})
        # The reader never came back, hours ago: nothing for Ivy to confirm.
        never_read = Submission(assignment_id=w["hw2"], student_id=ivy.id, section_id=p1.id,
                                status="submitted", submitted_at=NOW - timedelta(hours=2))
        s.add_all([queued, failed, unconfirmed, never_read])
        await s.flush()
        s.add_all([
            GradingJob(submission_id=queued.id, assignment_id=w["hw2"], status="queued", scheduled_for=NOW),
            GradingJob(submission_id=failed.id, assignment_id=w["hw2"], status="failed"),
        ])
        await s.commit()

    hw2 = (await client.get(_url(w), headers=_auth(w["token"]))).json()["homeworks"][0]
    # Dee (unreadable), Gia (failed job) and Ivy (never read) are the teacher's.
    assert (hw2["grading"], hw2["to_grade"], hw2["awaiting_student"]) == (1, 3, 1)
    assert hw2["students"] == sum(hw2[k] for k in (
        "counted", "to_approve", "to_grade", "grading", "awaiting_student", "not_submitted",
    ))

    async with get_session_factory()() as s:
        a = await s.get(Assignment, w["hw2"])
        assert a is not None
        a.ai_grading_enabled = False
        await s.commit()
    hw2 = (await client.get(_url(w), headers=_auth(w["token"]))).json()["homeworks"][0]
    # The drain will skip the queued job and nothing waits on Hal's
    # confirmation any more: everything ungraded is the teacher's.
    assert (hw2["grading"], hw2["to_grade"], hw2["awaiting_student"]) == (0, 5, 0)
