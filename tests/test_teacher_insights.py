"""Tests for GET /v1/teacher/courses/{c}/sections/{s}/insights.

Two layers:
  - pure unit tests of the counting rule (`counted_breakdown`) and the
    watch rules (`_watch_reason`) — the load-bearing logic;
  - integration tests that seed a small world and check what the
    endpoint returns: section scoping, coverage buckets, problem order,
    per-bucket students + diagnosis reasons, understanding checks to
    review, the watch list, and auth.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any

from httpx import AsyncClient

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.assignment import Assignment, AssignmentSection, Submission, SubmissionGrade
from api.models.course import Course, CourseTeacher
from api.models.integrity_check import IntegrityCheckProblem, IntegrityCheckSubmission
from api.models.question_bank import QuestionBankItem
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.unit import Unit
from api.models.user import User
from api.routes.teacher_insights import _watch_reason, counted_breakdown
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
    g = _grade(reviewed_at=NOW, breakdown=[_e("full", 100), {"score_status": "bogus"}, "junk"])
    assert counted_breakdown(g) == [_e("full", 100)]


# ── _watch_reason ──────────────────────────────────────────────────


def test_missing_work_wins_first() -> None:
    hit = _watch_reason(missed_recent=2, window=3, counted_newest_first=[[_e("zero")] * 6])
    assert hit == {"reason": "missing_work", "missed": 2, "window": 3}


def test_missing_most_needs_six_problems_pooled_over_last_two() -> None:
    five = [[_e("zero")] * 3, [_e("zero")] * 2]
    assert _watch_reason(missed_recent=0, window=3, counted_newest_first=five) is None
    six = [[_e("zero")] * 3, [_e("zero"), _e("full", 100), _e("full", 100)], [_e("zero")] * 9]
    # Only the last two homeworks pool: 4 zero of 6.
    assert _watch_reason(missed_recent=0, window=3, counted_newest_first=six) == {
        "reason": "missing_most", "zero": 4, "problems": 6,
    }


def test_missing_most_below_half_is_not_listed() -> None:
    # 2 zero of 6, flat averages — no rule fires.
    hws = [[_e("zero"), _e("full", 100), _e("full", 100)]] * 2
    assert _watch_reason(missed_recent=1, window=3, counted_newest_first=hws) is None


def test_sharp_drop_compares_the_last_two_counted() -> None:
    hws = [[_e("partial", 50)], [_e("full", 100), _e("partial", 40)]]  # 50 vs 70
    assert _watch_reason(missed_recent=0, window=0, counted_newest_first=hws) == {
        "reason": "sharp_drop", "previous": 70.0, "latest": 50.0,
    }
    small = [[_e("partial", 55)], [_e("full", 70)]]  # 15 points: not listed
    assert _watch_reason(missed_recent=0, window=0, counted_newest_first=small) is None


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
            sub = Submission(assignment_id=a.id, student_id=u.id, section_id=sec.id, status="submitted",
                             extraction_flagged_at=grade.pop("flagged", None))
            s.add(sub)
            await s.flush()
            if grade:
                s.add(SubmissionGrade(submission_id=sub.id, graded_at=NOW, **grade))
            return sub

        def bd(ids: list[str], *statuses: str) -> list[dict[str, Any]]:
            pct = {"full": 100, "partial": 50, "zero": 0}
            return [{"problem_id": pid, "score_status": st, "percent": pct[st]} for pid, st in zip(ids, statuses)]

        # HW 2 (newest) in Period 1:
        ana_sub = await submit(hw2, ana, p1, reviewed_at=NOW, breakdown=bd(ids2, "full", "zero", "full"))
        await submit(hw2, ben, p1, grade_published_at=NOW,
                     breakdown=bd(ids2, "full", "full", "full"),          # unseen regrade draft
                     published_breakdown=bd(ids2, "zero", "zero", "partial"))
        await submit(hw2, cal, p1, breakdown=bd(ids2, "zero", "zero", "zero"))  # AI draft: to approve
        await submit(hw2, dee, p1, ai_grading_status="skipped_unreadable")      # to hand-grade
        await submit(hw2, ghost, p1, reviewed_at=NOW, breakdown=bd(ids2, "zero", "zero", "zero"))
        await submit(hw2, eve, p3, reviewed_at=NOW, breakdown=bd(ids2, "zero", "zero", "zero"))
        # HW 1 in Period 1: Ana and Ben did well; Cal and Dee skipped it.
        await submit(hw1, ana, p1, reviewed_at=NOW, breakdown=bd(ids1, "full", "full", "full"))
        await submit(hw1, ben, p1, reviewed_at=NOW, breakdown=bd(ids1, "full", "full", "full"))
        # A quiz grade must never surface.
        await submit(quiz, ana, p1, reviewed_at=NOW, breakdown=bd(ids1, "zero", "zero", "zero"))

        # Understanding check on Ana's HW 2: a silent reason for her miss
        # on Q2, and an un-cleared chat probe on Q1.
        chk = IntegrityCheckSubmission(submission_id=ana_sub.id, status="complete", disposition="needs_practice")
        s.add(chk)
        await s.flush()
        s.add_all([
            IntegrityCheckProblem(integrity_check_submission_id=chk.id, bank_item_id=uuid.UUID(ids2[1]),
                                  sample_position=1, status="diagnosis_only", diagnosis_kind="conceptual_gap"),
            IntegrityCheckProblem(integrity_check_submission_id=chk.id, bank_item_id=uuid.UUID(ids2[0]),
                                  sample_position=0, status="verdict_submitted"),
        ])
        await s.commit()
        return {
            "token": create_access_token(str(teacher.id), "teacher"),
            "course": course.id, "p1": p1.id, "p3": p3.id,
            "hw1": hw1.id, "hw2": hw2.id, "quiz": quiz.id, "ids2": ids2,
            "ana": ana.id, "ben": ben.id, "cal": cal.id, "dee": dee.id,
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
        "enrolled": 4,        # preview shadow excluded
        "counted": 2,         # Ana (approved) + Ben (published snapshot)
        "to_approve": 1,      # Cal's AI draft
        "to_hand_grade": 1,   # Dee's unreadable work
        "grading": 0,
        "not_submitted": 0,
    }
    assert body["homeworks"][1]["not_submitted"] == 2


async def test_problems_most_missed_first_with_students_and_reasons(client: AsyncClient) -> None:
    w = await _world()
    body = (await client.get(_url(w), headers=_auth(w["token"]))).json()
    assert body["selected_homework_id"] == str(w["hw2"])
    ids2 = w["ids2"]
    by_id = {p["bank_item_id"]: p for p in body["problems"]}
    # Q2: Ana zero + Ben zero (his published snapshot, not the regrade).
    assert (by_id[ids2[1]]["zero"], by_id[ids2[1]]["full"]) == (2, 0)
    assert [p["bank_item_id"] for p in body["problems"]] == [ids2[1], ids2[0], ids2[2]]
    q2_zero = by_id[ids2[1]]["students"]["zero"]
    assert [(r["name"], r["diagnosis_kind"]) for r in q2_zero] == [("Ana", "conceptual_gap"), ("Ben", None)]
    # Q1: one un-cleared understanding check to review; Q2 none.
    assert (by_id[ids2[0]]["to_review"], by_id[ids2[1]]["to_review"]) == (1, 0)
    # Period 3's all-zero grade and the preview shadow never leak in.
    assert by_id[ids2[2]]["full"] + by_id[ids2[2]]["partial"] + by_id[ids2[2]]["zero"] == 2


async def test_section_scoping(client: AsyncClient) -> None:
    w = await _world()
    body = (await client.get(_url(w, "p3"), headers=_auth(w["token"]))).json()
    hw2 = body["homeworks"][0]
    assert (hw2["enrolled"], hw2["counted"]) == (1, 1)
    assert all(p["zero"] == 1 and p["full"] == 0 for p in body["problems"])


async def test_watch_list(client: AsyncClient) -> None:
    w = await _world()
    body = (await client.get(_url(w), headers=_auth(w["token"]))).json()
    watch = {x["name"]: x for x in body["watch"]}
    # Cal and Dee each skipped HW 1 but turned in HW 2 → 1 of 2 missed: not listed.
    # Ben: 100 → 16.7 between his last two counted homeworks.
    assert watch["Ben"]["reason"] == "sharp_drop"
    assert (watch["Ben"]["previous"], watch["Ben"]["latest"]) == (100.0, 16.7)
    assert watch["Ana"]["reason"] == "sharp_drop"  # 100 → 66.7
    assert {"Cal", "Dee"}.isdisjoint(watch)
    # Ana before Ben: same reason, sorted by name.
    assert [x["name"] for x in body["watch"]] == ["Ana", "Ben"]
    assert body["watch_total"] == 2


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
