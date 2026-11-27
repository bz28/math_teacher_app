"""Reasons under a flagged Insights problem (`api.core.reteach_reasons`).

Never on the network: the model call is a fake that records what it was
sent, except `test_replays_its_recorded_answer_at_no_cost`, which replays
a hand-written cassette through the real call path at $0.

Covers: what the model is sent (approved feedback only, no names, no
preview or other-period students), when it's called (first flag; again
only once the period's drafts are approved; never twice for the same
input), failure retries and giving up, the Insights read (counts, the
students behind each reason, pending), the practiced count, and the
grading drain running the pass.
"""
from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from api.core import reteach_reasons as rr
from api.core.auth import create_access_token, hash_password
from api.core.cost_tracker import PlatformStopError
from api.database import get_session_factory
from api.models.assignment import Assignment, AssignmentSection, Submission, SubmissionGrade
from api.models.course import Course, CourseTeacher
from api.models.practice_activity import PracticeActivity
from api.models.question_bank import QuestionBankItem
from api.models.reteach_reasons import ReteachReasons
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.unit import Unit
from api.models.user import User
from tests.conftest import auth_headers as _auth

CASSETTES = Path(__file__).parent / "harness" / "_cassettes" / "reteach_reasons"


# ── Pure pieces ────────────────────────────────────────────────────


def test_feedback_text_is_the_note_and_each_deduction() -> None:
    e = {
        "feedback": " Found x but not y. ",
        "deductions": [
            {"points_off": 40, "reason": "Stopped after x", "step_ref": 2},
            {"points_off": 10.5, "reason": "  "},
            "junk",
        ],
    }
    assert rr.feedback_text(e) == "Note: Found x but not y. | Points off (-40): Stopped after x"
    assert rr.feedback_text({"feedback": None, "deductions": None}) == ""
    assert len(rr.feedback_text({"feedback": "x" * 5000})) == rr._MAX_FEEDBACK


def test_parse_maps_numbers_to_submissions_once_each() -> None:
    items = [(f"s{i}", "t") for i in range(1, 7)]
    out = rr._parse({"reasons": [
        {"label": "Small", "students": [6]},
        {"label": "  Stopped   after x ", "students": [1, 2, 2, 9, 0, True]},
        {"label": "Sign slip", "students": [2, 3, 4]},  # 2 is already placed
        {"label": "", "students": [5]},
        {"label": "Nobody", "students": []},
    ]}, items)
    assert out == [
        {"label": "Stopped after x", "submission_ids": ["s1", "s2"]},
        {"label": "Sign slip", "submission_ids": ["s3", "s4"]},
        {"label": "Small", "submission_ids": ["s6"]},
    ]
    assert rr._parse({"reasons": "junk"}, items) == []
    many = {"reasons": [{"label": f"r{i}", "students": [i]} for i in range(1, 7)]}
    assert len(rr._parse(many, items)) == rr.MAX_REASONS


def test_needs_call() -> None:
    k = "k1"
    assert rr.needs_call(None, k, 3, drafts_waiting=True)  # first flag: always
    done = {"input_key": k, "reasons": [{"label": "x"}], "n_items": 4}
    assert not rr.needs_call(done, k, 4, drafts_waiting=False)
    # Input moved: rewrite once that problem's drafts are approved...
    assert rr.needs_call(done, "k2", 5, drafts_waiting=False)
    assert not rr.needs_call(done, "k2", 7, drafts_waiting=True)
    # ...or sooner, once the class behind the read has doubled.
    assert rr.needs_call(done, "k2", 8, drafts_waiting=True)
    # A read with no feedback to group yet takes the first feedback at once.
    empty = {"input_key": k, "reasons": [], "n_items": 0}
    assert rr.needs_call(empty, "k2", 1, drafts_waiting=True)
    assert not rr.needs_call(empty, "k2", 0, drafts_waiting=True)
    # Failed with no read yet: retry, up to MAX_ATTEMPTS on one input.
    failing = {"failed_key": k, "attempts": rr.MAX_ATTEMPTS - 1}
    assert rr.needs_call(failing, k, 3, drafts_waiting=True)
    gave_up = {"failed_key": k, "attempts": rr.MAX_ATTEMPTS}
    assert not rr.needs_call(gave_up, k, 3, drafts_waiting=False)
    assert rr.needs_call(gave_up, "k2", 3, drafts_waiting=False)


# ── A period with a flagged problem ────────────────────────────────

NOW = datetime.now(UTC)


class FakeModel:
    """Stands in for call_claude_json: records each message it was sent
    and answers with every student in one reason, or raises."""

    def __init__(self) -> None:
        self.messages: list[str] = []
        self.fail: bool | Exception = False

    async def __call__(self, system: str, user_message: str, mode: str, **kw: Any) -> dict[str, Any]:
        assert kw["model"] == rr.MODEL_HAIKU and kw["prompt_ids"] == ("reteach_reasons",)
        self.messages.append(user_message)
        if isinstance(self.fail, Exception):
            raise self.fail
        if self.fail:
            raise RuntimeError("model down")
        n = user_message.count("\n[")
        return {"reasons": [
            {"label": "Found x, then stopped before y", "students": list(range(1, n))},
            {"label": "Arithmetic slip", "students": [n]},
        ]}


@pytest.fixture
def model() -> Any:
    fake = FakeModel()
    with patch.object(rr, "call_claude_json", fake):
        yield fake


def _entry(pid: str, status: str, feedback: str | None) -> dict[str, Any]:
    pct = {"full": 100, "partial": 60, "zero": 0}[status]
    return {"problem_id": pid, "score_status": status, "percent": pct, "feedback": feedback,
            "deductions": [{"points_off": 100 - pct, "reason": f"{feedback} (ledger)"}] if feedback else None}


async def _world() -> dict[str, Any]:
    """Period 1: four students short of full credit with written
    feedback, two with full credit, one preview shadow. Period 3 has its
    own student short of full credit, who must never reach Period 1."""
    tag = uuid.uuid4().hex[:6]
    async with get_session_factory()() as s:
        teacher = User(email=f"t_{tag}@t.com", password_hash=hash_password("x"), grade_level=12,
                       role="teacher", name="T")
        course = Course(name="Algebra 1", subject="math")
        s.add_all([teacher, course])
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id))
        unit = Unit(course_id=course.id, name="U", position=0)
        p1, p3 = Section(course_id=course.id, name="Period 1"), Section(course_id=course.id, name="Period 3")
        s.add_all([unit, p1, p3])
        await s.flush()
        hw = Assignment(course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id, title="Elimination",
                        type="homework", status="published", due_at=NOW, content={"problem_ids": []})
        s.add(hw)
        await s.flush()
        item = QuestionBankItem(course_id=course.id, unit_id=unit.id, originating_assignment_id=hw.id,
                                title="Q", question=f"Solve by elimination {tag}", final_answer="(4, 2)",
                                status="approved", source="generated")
        s.add(item)
        await s.flush()
        hw.content = {"problem_ids": [str(item.id)]}
        s.add_all([AssignmentSection(assignment_id=hw.id, section_id=sec.id, published_at=NOW)
                   for sec in (p1, p3)])
        await s.commit()
        return {"teacher": teacher.id, "token": create_access_token(str(teacher.id), "teacher"),
                "course": course.id, "unit": unit.id, "p1": p1.id, "p3": p3.id, "hw": hw.id,
                "pid": str(item.id), "question": item.question, "subs": {}}


async def _student(w: dict[str, Any], name: str, entry: dict[str, Any] | None, *, section: str = "p1",
                   approved: bool = True, preview: bool = False) -> uuid.UUID:
    async with get_session_factory()() as s:
        u = User(email=f"s_{uuid.uuid4().hex[:8]}@t.com", password_hash=hash_password("x"), grade_level=9,
                 role="student", name=name, is_preview=preview)
        s.add(u)
        await s.flush()
        s.add(SectionEnrollment(section_id=w[section], course_id=w["course"], student_id=u.id,
                                enrolled_at=NOW - timedelta(days=30)))
        sub = Submission(assignment_id=w["hw"], student_id=u.id, section_id=w[section], status="submitted",
                         extraction_confirmed_at=NOW)
        s.add(sub)
        await s.flush()
        if entry is not None:
            s.add(SubmissionGrade(submission_id=sub.id, graded_at=NOW, breakdown=[entry],
                                  reviewed_at=datetime.now(UTC) if approved else None))
        await s.commit()
        w["subs"][name] = sub.id
        return u.id


async def _flagged_period(w: dict[str, Any]) -> None:
    pid = w["pid"]
    for name in ("Ana", "Ben", "Cal"):
        await _student(w, name, _entry(pid, "partial", f"{name}-note stopped after x"))
    await _student(w, "Dee", _entry(pid, "zero", "Dee-note sign slip"))
    await _student(w, "Eve", _entry(pid, "full", "Eve-note great"))
    await _student(w, "Fay", _entry(pid, "full", None))
    await _student(w, "Preview", _entry(pid, "zero", "preview-note"), preview=True)
    await _student(w, "Gus", _entry(pid, "zero", "p3-note"), section="p3")


async def _hand_graded(w: dict[str, Any]) -> None:
    async with get_session_factory()() as s:
        hw = await s.get(Assignment, w["hw"])
        assert hw is not None
        hw.ai_grading_enabled = False
        await s.commit()


async def _stored(w: dict[str, Any], section: str = "p1") -> ReteachReasons | None:
    async with get_session_factory()() as s:
        return (await s.execute(select(ReteachReasons).where(
            ReteachReasons.assignment_id == w["hw"], ReteachReasons.section_id == w[section],
        ))).scalar_one_or_none()


def _mine(model: FakeModel, w: dict[str, Any]) -> list[str]:
    """Calls for this test's problem (the pass also visits other tests' rows)."""
    return [m for m in model.messages if w["question"] in m]


async def _insights(client: AsyncClient, w: dict[str, Any]) -> dict[str, Any]:
    r = await client.get(f"/v1/teacher/courses/{w['course']}/sections/{w['p1']}/insights",
                         headers=_auth(w["token"]))
    assert r.status_code == 200, r.text
    return r.json()


# ── Writing ────────────────────────────────────────────────────────


async def test_writes_once_from_approved_feedback_only(client: AsyncClient, model: FakeModel) -> None:
    w = await _world()
    await _flagged_period(w)
    await _student(w, "Hal", _entry(w["pid"], "zero", "draft-note unapproved"), approved=False)
    await _student(w, "Ivy", _entry(w["pid"], "zero", "Ivy-note approved later"))

    await rr.refresh_reteach_reasons(limit=1000)
    sent = _mine(model, w)
    assert len(sent) == 1
    msg = sent[0]
    # Approved feedback from this period's students short of full credit.
    for name in ("Ana", "Ben", "Cal", "Dee", "Ivy"):
        assert f"{name}-note" in msg
    # Never: full credit, an AI draft, the preview shadow, another period,
    # or anyone's name.
    for leaked in ("Eve-note", "draft-note", "preview-note", "p3-note"):
        assert leaked not in msg
    assert "Ana " not in msg.replace("Ana-note", "")
    assert msg.count("\n[") == 5

    # The same grades never pay twice.
    await rr.refresh_reteach_reasons(limit=1000)
    assert len(_mine(model, w)) == 1

    # The Insights read: counts and the students behind each reason.
    problem = (await _insights(client, w))["problems"][0]
    assert (problem["counted"], problem["missed"], problem["flagged"]) == (7, 5, True)
    assert not problem["reasons_pending"]
    labels = [(r["label"], r["count"]) for r in problem["reasons"]]
    assert labels == [("Found x, then stopped before y", 4), ("Arithmetic slip", 1)]
    names = {s["name"] for r in problem["reasons"] for s in r["students"]}
    assert names == {"Ana", "Ben", "Cal", "Dee", "Ivy"}
    assert {s["submission_id"] for s in problem["reasons"][0]["students"]} <= {
        str(v) for v in w["subs"].values()
    }


async def test_rewrites_only_once_the_period_is_approved(client: AsyncClient, model: FakeModel) -> None:
    w = await _world()
    await _flagged_period(w)
    await rr.refresh_reteach_reasons(limit=1000)
    assert len(_mine(model, w)) == 1

    # More grades approved while an AI draft still waits on her: the read
    # she has stands, and the pass doesn't come back until grades move.
    await _student(w, "Jo", _entry(w["pid"], "partial", "Jo-note"))
    await _student(w, "Kit", _entry(w["pid"], "zero", "Kit-note draft"), approved=False)
    await rr.refresh_reteach_reasons(limit=1000)
    assert len(_mine(model, w)) == 1

    # She approves the last draft: one more call, with everyone in it.
    async with get_session_factory()() as s:
        g = (await s.execute(select(SubmissionGrade).where(
            SubmissionGrade.submission_id == w["subs"]["Kit"]))).scalar_one()
        g.reviewed_at = datetime.now(UTC)
        await s.commit()
    await rr.refresh_reteach_reasons(limit=1000)
    sent = _mine(model, w)
    assert len(sent) == 2 and "Jo-note" in sent[1] and "Kit-note" in sent[1]


async def test_hand_grading_rewrites_once_the_papers_are_graded(client: AsyncClient, model: FakeModel) -> None:
    """Hand grades approve themselves, so papers not graded yet are what
    she's still working through: the read waits for them too."""
    w = await _world()
    await _hand_graded(w)
    await _flagged_period(w)
    await _student(w, "Lou", None)  # turned in, not graded yet
    await rr.refresh_reteach_reasons(limit=1000)
    assert len(_mine(model, w)) == 1

    await _student(w, "Jo", _entry(w["pid"], "partial", "Jo-note"))
    await rr.refresh_reteach_reasons(limit=1000)
    assert len(_mine(model, w)) == 1

    async with get_session_factory()() as s:
        s.add(SubmissionGrade(submission_id=w["subs"]["Lou"], graded_at=NOW, reviewed_at=datetime.now(UTC),
                              breakdown=[_entry(w["pid"], "zero", "Lou-note")]))
        await s.commit()
    await rr.refresh_reteach_reasons(limit=1000)
    sent = _mine(model, w)
    assert len(sent) == 2 and "Jo-note" in sent[1] and "Lou-note" in sent[1]


async def test_a_paper_left_ungraded_holds_hand_grading_only_until_it_goes_quiet(
    client: AsyncClient, model: FakeModel,
) -> None:
    w = await _world()
    await _hand_graded(w)
    await _flagged_period(w)
    await _student(w, "Lou", None)  # never graded: unreadable, say
    await rr.refresh_reteach_reasons(limit=1000)
    await _student(w, "Jo", _entry(w["pid"], "partial", "Jo-note"))
    await rr.refresh_reteach_reasons(limit=1000)
    assert len(_mine(model, w)) == 1
    async with get_session_factory()() as s:  # held, so the pair is still due
        due = await rr._stale_pairs(s, 1000)
    assert any(a == w["hw"] and sec == w["p1"] for a, sec, _sig in due)

    # A day later, nothing has moved: the final read goes ahead.
    async with get_session_factory()() as s:
        old = datetime.now(UTC) - rr._HAND_GRADING_QUIET - timedelta(hours=1)
        for g in (await s.execute(select(SubmissionGrade).join(Submission).where(
                Submission.assignment_id == w["hw"]))).scalars():
            g.graded_at, g.reviewed_at = old, old if g.reviewed_at else None
        await s.commit()
    await rr.refresh_reteach_reasons(limit=1000)
    sent = _mine(model, w)
    assert len(sent) == 2 and "Jo-note" in sent[1]


async def test_with_ai_grading_an_ungraded_paper_holds_nothing(client: AsyncClient, model: FakeModel) -> None:
    """A paper the AI won't grade (unreadable, flagged) never stops a
    problem's read once its own drafts are approved."""
    w = await _world()
    await _flagged_period(w)
    await _student(w, "Lou", None)
    await rr.refresh_reteach_reasons(limit=1000)
    await _student(w, "Jo", _entry(w["pid"], "partial", "Jo-note"))
    await rr.refresh_reteach_reasons(limit=1000)
    sent = _mine(model, w)
    assert len(sent) == 2 and "Jo-note" in sent[1]


async def test_approving_writes_reasons_without_waiting_for_the_drain(
    client: AsyncClient, model: FakeModel,
) -> None:
    """Approve ✓ on the last draft, and a hand grade that completes a
    paper, each bring the period's reasons up to date right away."""
    w = await _world()
    await _flagged_period(w)
    await _student(w, "Kit", _entry(w["pid"], "zero", "Kit-note draft"), approved=False)
    async with get_session_factory()() as s:
        g = (await s.execute(select(SubmissionGrade).where(
            SubmissionGrade.submission_id == w["subs"]["Kit"]))).scalar_one()
        g.final_score, g.ai_score = 0.0, 0.0
        await s.commit()

    r = await client.post(f"/v1/teacher/submissions/{w['subs']['Kit']}/mark-reviewed", headers=_auth(w["token"]))
    assert r.status_code == 200, r.text
    await rr.drain_refresh_tasks()
    sent = _mine(model, w)
    assert len(sent) == 1 and "Kit-note" in sent[0]
    assert (await _insights(client, w))["problems"][0]["reasons"]

    await _student(w, "Lou", None)
    r = await client.patch(
        f"/v1/teacher/submissions/{w['subs']['Lou']}/grade", headers=_auth(w["token"]),
        json={"breakdown": [{"problem_id": w["pid"], "score_status": "zero", "percent": 0,
                             "feedback": "Lou-note hand graded"}]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["reviewed_at"]
    await rr.drain_refresh_tasks()
    # The class hasn't doubled and nothing waits on her, so it rewrites.
    sent = _mine(model, w)
    assert len(sent) == 2 and "Lou-note" in sent[1]

    # Approving again with nothing new costs no call.
    r = await client.post(f"/v1/teacher/submissions/{w['subs']['Kit']}/mark-reviewed", headers=_auth(w["token"]))
    await rr.drain_refresh_tasks()
    assert len(_mine(model, w)) == 2


async def test_a_failed_call_retries_then_gives_up(client: AsyncClient, model: FakeModel) -> None:
    w = await _world()
    await _flagged_period(w)
    model.fail = True
    await rr.refresh_reteach_reasons(limit=1000)
    row = await _stored(w)
    assert row is not None and row.grades_signature is None  # not caught up: retry next pass
    assert row.problems[w["pid"]]["attempts"] == 1
    assert (await _insights(client, w))["problems"][0]["reasons_pending"]

    for _ in range(rr.MAX_ATTEMPTS):
        await rr.refresh_reteach_reasons(limit=1000)
    assert len(_mine(model, w)) == rr.MAX_ATTEMPTS
    row = await _stored(w)
    assert row is not None and row.grades_signature is not None
    problem = (await _insights(client, w))["problems"][0]
    assert problem["reasons"] == [] and not problem["reasons_pending"]

    # Another approved grade is a new input the drain will try, so the
    # page says reasons are coming again before that pass runs.
    await _student(w, "Zed", _entry(w["pid"], "zero", "Never started"))
    assert (await _insights(client, w))["problems"][0]["reasons_pending"]


async def test_a_platform_stop_never_uses_up_the_retries(client: AsyncClient, model: FakeModel) -> None:
    """The daily spend cap or an open circuit breaker says "later", not
    "this input is bad": no attempt is charged and the pair stays due."""
    w = await _world()
    await _flagged_period(w)
    model.fail = PlatformStopError("Daily cost limit reached")
    for _ in range(rr.MAX_ATTEMPTS + 1):
        await rr.refresh_reteach_reasons(limit=1000)
    row = await _stored(w)
    assert row is not None and row.grades_signature is None
    assert "attempts" not in (row.problems.get(w["pid"]) or {})
    assert (await _insights(client, w))["problems"][0]["reasons_pending"]

    model.fail = False
    await rr.refresh_reteach_reasons(limit=1000)
    assert (await _insights(client, w))["problems"][0]["reasons"]


async def test_no_written_feedback_means_no_call(client: AsyncClient, model: FakeModel) -> None:
    w = await _world()
    for name in ("A", "B", "C", "D", "E"):
        await _student(w, name, _entry(w["pid"], "zero", None))
    await rr.refresh_reteach_reasons(limit=1000)
    assert _mine(model, w) == []
    problem = (await _insights(client, w))["problems"][0]
    assert problem["flagged"] and problem["reasons"] == [] and not problem["reasons_pending"]


async def test_a_reason_never_names_a_student_from_elsewhere(client: AsyncClient, model: FakeModel) -> None:
    """Stored ids resolve only to this period's non-preview submissions."""
    w = await _world()
    await _flagged_period(w)
    await rr.refresh_reteach_reasons(limit=1000)
    async with get_session_factory()() as s:
        row = (await s.execute(select(ReteachReasons).where(
            ReteachReasons.assignment_id == w["hw"], ReteachReasons.section_id == w["p1"]))).scalar_one()
        entry = row.problems[w["pid"]]
        entry["reasons"][0]["submission_ids"] += [str(w["subs"]["Gus"]), str(w["subs"]["Preview"]), "junk"]
        row.problems = {**row.problems, w["pid"]: entry}
        await s.commit()
    names = {s["name"] for r in (await _insights(client, w))["problems"][0]["reasons"] for s in r["students"]}
    assert "Gus" not in names and "Preview" not in names


async def _edit(w: dict[str, Any], name: str, entry: dict[str, Any]) -> None:
    """What PATCH /grade does to a grade she already approved: the
    breakdown and `graded_at` change, the approval stamp doesn't."""
    async with get_session_factory()() as s:
        g = (await s.execute(select(SubmissionGrade).where(
            SubmissionGrade.submission_id == w["subs"][name]))).scalar_one()
        g.breakdown = [entry]
        g.graded_at = datetime.now(UTC)
        await s.commit()


async def test_an_edit_after_approval_rewrites_the_reasons(client: AsyncClient, model: FakeModel) -> None:
    w = await _world()
    await _flagged_period(w)
    await rr.refresh_reteach_reasons(limit=1000)
    assert len(_mine(model, w)) == 1

    # She raises Ana to full credit on a grade she'd already approved.
    await _edit(w, "Ana", _entry(w["pid"], "full", "Ana-note fixed"))
    # The read stops naming Ana at once, before the drain comes round.
    names = {s["name"] for r in (await _insights(client, w))["problems"][0]["reasons"] for s in r["students"]}
    assert "Ana" not in names and "Ben" in names
    # And the drain rewrites from the new grades.
    await rr.refresh_reteach_reasons(limit=1000)
    sent = _mine(model, w)
    assert len(sent) == 2 and "Ana-note" not in sent[1]


async def test_an_edit_that_flags_a_problem_writes_its_reasons(client: AsyncClient, model: FakeModel) -> None:
    w = await _world()
    for name in ("A", "B", "C"):
        await _student(w, name, _entry(w["pid"], "full", None))
    for name in ("D", "E"):
        await _student(w, name, _entry(w["pid"], "zero", f"{name}-note"))
    await rr.refresh_reteach_reasons(limit=1000)
    assert _mine(model, w) == []  # 2 of 5: not flagged
    await _edit(w, "A", _entry(w["pid"], "partial", "A-note lowered"))
    problem = (await _insights(client, w))["problems"][0]
    assert problem["flagged"] and problem["reasons_pending"]
    await rr.refresh_reteach_reasons(limit=1000)
    assert len(_mine(model, w)) == 1
    assert not (await _insights(client, w))["problems"][0]["reasons_pending"]


async def test_a_draft_on_another_problem_never_holds_a_rewrite(client: AsyncClient, model: FakeModel) -> None:
    w = await _world()
    await _flagged_period(w)
    await rr.refresh_reteach_reasons(limit=1000)
    # An unapproved grade that's about some other problem entirely.
    await _student(w, "Kit", {**_entry(w["pid"], "zero", "x"), "problem_id": str(uuid.uuid4())}, approved=False)
    await _student(w, "Jo", _entry(w["pid"], "partial", "Jo-note"))
    await rr.refresh_reteach_reasons(limit=1000)
    sent = _mine(model, w)
    assert len(sent) == 2 and "Jo-note" in sent[1]


async def test_a_small_first_read_is_redone_once_the_class_doubles(client: AsyncClient, model: FakeModel) -> None:
    w = await _world()
    for name in ("A", "B"):
        await _student(w, name, _entry(w["pid"], "full", None))
    for name in ("C", "D", "E"):
        await _student(w, name, _entry(w["pid"], "zero", f"{name}-note"))
    await _student(w, "Draft", _entry(w["pid"], "zero", "draft-note"), approved=False)
    await rr.refresh_reteach_reasons(limit=1000)
    assert len(_mine(model, w)) == 1  # first read at the flag: 3 students
    for name in ("F", "G"):
        await _student(w, name, _entry(w["pid"], "zero", f"{name}-note"))
    await rr.refresh_reteach_reasons(limit=1000)
    assert len(_mine(model, w)) == 1  # 5 < 2 × 3, and a draft on it waits
    await _student(w, "H", _entry(w["pid"], "zero", "H-note"))
    await rr.refresh_reteach_reasons(limit=1000)
    sent = _mine(model, w)
    assert len(sent) == 2 and sent[1].count("\n[") == 6


async def test_homework_past_the_active_window_is_left_alone(client: AsyncClient, model: FakeModel) -> None:
    w = await _world()
    await _flagged_period(w)
    async with get_session_factory()() as s:
        hw = await s.get(Assignment, w["hw"])
        assert hw is not None
        hw.due_at = datetime.now(UTC) - rr._ACTIVE_WINDOW - timedelta(days=1)
        await s.commit()
    await rr.refresh_reteach_reasons(limit=1000)
    assert _mine(model, w) == [] and await _stored(w) is None
    # Nothing will write them, so the page doesn't say they're coming.
    flagged = [p for p in (await _insights(client, w))["problems"] if p["flagged"]]
    assert flagged and all(p["reasons"] == [] and p["reasons_pending"] is False for p in flagged)


# ── Practiced count and the drain ──────────────────────────────────


async def test_practiced_counts_period_students_who_answered(client: AsyncClient, model: FakeModel) -> None:
    w = await _world()
    ana = await _student(w, "Ana", _entry(w["pid"], "zero", "n"))
    ben = await _student(w, "Ben", _entry(w["pid"], "zero", "n"))
    await _student(w, "Cal", None)
    ghost = await _student(w, "Preview", None, preview=True)
    async with get_session_factory()() as s:
        practice = Assignment(course_id=w["course"], unit_ids=[w["unit"]], teacher_id=w["teacher"],
                              title="[Practice] Elimination", type="practice", status="published",
                              source_homework_id=w["hw"])
        s.add(practice)
        await s.flush()
        s.add(AssignmentSection(assignment_id=practice.id, section_id=w["p1"], published_at=NOW))
        v = uuid.UUID(w["pid"])
        s.add_all([
            PracticeActivity(student_id=sid, section_id=w["p1"], practice_assignment_id=practice.id,
                             bank_item_id=v, mode=mode, outcome=outcome)
            for sid, mode, outcome in (
                (ana, "practice", "first_try"), (ana, "practice", "retry"),  # one student, twice
                (ben, "learn", "completed"),                                  # a walkthrough isn't practice
                (ghost, "practice", "first_try"),                             # her preview shadow
            )
        ])
        await s.commit()
    practice_out = (await _insights(client, w))["practice"]
    assert (practice_out["practiced"], practice_out["students"]) == (1, 3)


async def test_the_grading_drain_runs_the_pass(client: AsyncClient, model: FakeModel) -> None:
    from api.config import settings

    w = await _world()
    await _flagged_period(w)
    with patch.object(settings, "grading_drain_token", "tok"):
        r = await client.post("/v1/internal/grading/drain?limit=1", headers={"X-Grading-Token": "tok"})
    assert r.status_code == 200, r.text
    assert r.json()["reasons_written"] >= 1
    assert len(_mine(model, w)) == 1

    # A broken pass never fails the drain.
    with (
        patch.object(settings, "grading_drain_token", "tok"),
        patch("api.routes.grading_drain.refresh_reteach_reasons", side_effect=RuntimeError("x")),
    ):
        r = await client.post("/v1/internal/grading/drain?limit=1", headers={"X-Grading-Token": "tok"})
    assert r.status_code == 200 and r.json()["reasons_pairs"] == 0


# ── $0 replay through the real call path ───────────────────────────

REPLAY_QUESTION = "Solve by elimination: 3x + 2y = 16, x - 2y = 0."
REPLAY_ITEMS = [
    ("sub-a", "60% | Note: You found x = 4 but stopped. | Points off (-40): Didn't solve for y"),
    ("sub-b", "50% | Note: Found x, never found y. | Points off (-50): Stopped after x"),
    ("sub-c", "0% | Note: Subtracting the equations didn't cancel y. | Points off (-100): Subtracted"),
    ("sub-d", "70% | Note: 3(4) + 2y = 16 gives y = 2, not 3. | Points off (-30): Arithmetic slip"),
]


async def test_replays_its_recorded_answer_at_no_cost(monkeypatch: pytest.MonkeyPatch) -> None:
    """The real `call_claude_json` in replay mode: the hand-written
    recording answers, and a miss would raise instead of calling out.
    Fails if the prompt, schema, model or message format changes without
    a new recording."""
    from api.core import llm_client
    from tests.harness import cassette

    monkeypatch.setenv("HARNESS_LLM_MODE", "replay")
    monkeypatch.setenv("HARNESS_CASSETTE_DIR", str(CASSETTES))
    monkeypatch.setattr(cassette, "_instance", None)
    monkeypatch.setattr(rr, "call_claude_json", llm_client.call_claude_json)
    recorded = json.loads((CASSETTES / "call_claude_json.json").read_text())
    assert len(recorded) == 1

    out = await rr.group_reasons(REPLAY_QUESTION, REPLAY_ITEMS)
    assert out == [
        {"label": "Found x, then stopped before finding y", "submission_ids": ["sub-a", "sub-b"]},
        {"label": "Subtracted the equations, so y didn't cancel", "submission_ids": ["sub-c"]},
        {"label": "Arithmetic slip after eliminating", "submission_ids": ["sub-d"]},
    ]
