"""Teacher-triggered grading: "Grade all" and "Grade now".

These two buttons are the ONLY way a no-due-date assignment ever gets
graded — that path is manual by design, because there is no moment that
means "the class is in". If they break, that work is unreachable and the
failure is silent: the submissions just sit there looking submitted.

They also have to be safe against the money-losing mistakes: re-running a
submission that is already graded, or one a drain is already working.
"""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from api.core.grading_queue import drain, enqueue_submission
from api.database import get_session_factory
from api.models.assignment import Assignment, Submission, SubmissionGrade
from api.models.grading_job import (
    STATUS_DONE,
    STATUS_FAILED,
    STATUS_QUEUED,
    STATUS_RUNNING,
    STATUS_SKIPPED,
    GradingJob,
)
from tests.conftest import auth_headers as _auth
from tests.test_teacher_review_checkpoint import _seed_hw

pytestmark = pytest.mark.asyncio

_EXTRACTION: dict[str, Any] = {
    "steps": [
        {"step_num": 1, "problem_position": 1,
         "latex": "x^2 - 5x + 6 = 0", "plain_english": ""},
    ],
    "final_answers": [
        {"problem_position": 1, "answer_latex": "x=2,3", "answer_plain": ""},
    ],
    "confidence": 0.9,
}


async def _prepare(world: dict[str, Any], *, due_at: datetime | None) -> None:
    async with get_session_factory()() as s:
        assignment = (await s.execute(
            select(Assignment).where(Assignment.id == world["assignment_id"])
        )).scalar_one()
        assignment.ai_grading_enabled = True
        assignment.due_at = due_at
        for sid in world["submission_ids"]:
            sub = (await s.execute(
                select(Submission).where(Submission.id == sid)
            )).scalar_one()
            sub.extraction = _EXTRACTION
            # Confirmed — that's what created these jobs.
            sub.extraction_confirmed_at = datetime.now(UTC)
        await s.commit()
        for sid in world["submission_ids"]:
            assignment = (await s.execute(
                select(Assignment).where(Assignment.id == world["assignment_id"])
            )).scalar_one()
            await enqueue_submission(s, sid, assignment)
        await s.commit()


async def _job(submission_id: uuid.UUID) -> GradingJob | None:
    async with get_session_factory()() as s:
        return (await s.execute(
            select(GradingJob).where(GradingJob.submission_id == submission_id)
        )).scalar_one_or_none()


async def test_grade_all_schedules_every_pending_submission(
    client: AsyncClient,
) -> None:
    world = await _seed_hw(n_submissions=3)
    await _prepare(world, due_at=None)  # no due date → all unscheduled
    for sid in world["submission_ids"]:
        assert (await _job(sid)).scheduled_for is None  # type: ignore[union-attr]

    with patch("api.core.grading_queue.drain", new=AsyncMock(return_value={})):
        r = await client.post(
            f"/v1/teacher/assignments/{world['assignment_id']}/grade-pending",
            headers=_auth(world["teacher_token"]),
        )

    assert r.status_code == 200, r.text
    assert r.json()["queued"] == 3
    for sid in world["submission_ids"]:
        job = await _job(sid)
        assert job is not None
        # Now scheduled — the manual path is what makes no-due-date work
        # reachable at all.
        assert job.scheduled_for is not None
        assert job.scheduled_for <= datetime.now(UTC)


async def test_grade_now_schedules_only_that_student(
    client: AsyncClient,
) -> None:
    world = await _seed_hw(n_submissions=3)
    await _prepare(world, due_at=None)
    target = world["submission_ids"][0]

    with patch("api.core.grading_queue.drain", new=AsyncMock(return_value={})):
        r = await client.post(
            f"/v1/teacher/submissions/{target}/grade-now",
            headers=_auth(world["teacher_token"]),
        )

    assert r.status_code == 200, r.text
    assert r.json()["queued"] == 1
    assert (await _job(target)).scheduled_for is not None  # type: ignore[union-attr]
    for sid in world["submission_ids"][1:]:
        assert (await _job(sid)).scheduled_for is None  # type: ignore[union-attr]


async def test_grade_now_leaves_an_already_running_job_alone(
    client: AsyncClient,
) -> None:
    """A drain already has this one. Re-queueing it would grade — and
    bill for — the same submission twice."""
    world = await _seed_hw()
    await _prepare(world, due_at=None)
    sid = world["submission_ids"][0]

    async with get_session_factory()() as s:
        job = (await s.execute(
            select(GradingJob).where(GradingJob.submission_id == sid)
        )).scalar_one()
        job.status = STATUS_RUNNING
        job.started_at = datetime.now(UTC)
        await s.commit()

    with patch("api.core.grading_queue.drain", new=AsyncMock(return_value={})):
        r = await client.post(
            f"/v1/teacher/submissions/{sid}/grade-now",
            headers=_auth(world["teacher_token"]),
        )

    assert r.status_code == 200, r.text
    # Nothing moved, and that is success — not an error the teacher
    # should be shown.
    assert r.json()["queued"] == 0
    assert (await _job(sid)).status == STATUS_RUNNING  # type: ignore[union-attr]


async def test_grade_all_does_not_requeue_finished_work(
    client: AsyncClient,
) -> None:
    world = await _seed_hw(n_submissions=2)
    await _prepare(world, due_at=None)
    done_sub = world["submission_ids"][0]

    async with get_session_factory()() as s:
        job = (await s.execute(
            select(GradingJob).where(GradingJob.submission_id == done_sub)
        )).scalar_one()
        job.status = STATUS_DONE
        job.finished_at = datetime.now(UTC)
        s.add(SubmissionGrade(
            submission_id=done_sub, ai_score=90.0, final_score=90.0,
            ai_breakdown={"grades": []},
        ))
        await s.commit()

    with patch("api.core.grading_queue.drain", new=AsyncMock(return_value={})):
        r = await client.post(
            f"/v1/teacher/assignments/{world['assignment_id']}/grade-pending",
            headers=_auth(world["teacher_token"]),
        )

    assert r.status_code == 200, r.text
    # Only the still-queued one moved. A finished grade needs a regrade,
    # not a re-queue.
    assert r.json()["queued"] == 1
    assert (await _job(done_sub)).status == STATUS_DONE  # type: ignore[union-attr]


async def test_grade_all_rejects_a_hw_with_ai_grading_off(
    client: AsyncClient,
) -> None:
    world = await _seed_hw()
    await _prepare(world, due_at=None)
    async with get_session_factory()() as s:
        assignment = (await s.execute(
            select(Assignment).where(Assignment.id == world["assignment_id"])
        )).scalar_one()
        assignment.ai_grading_enabled = False
        await s.commit()

    r = await client.post(
        f"/v1/teacher/assignments/{world['assignment_id']}/grade-pending",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 400


async def test_another_teacher_cannot_grade_your_class(
    client: AsyncClient,
) -> None:
    """The endpoints spend money on someone else's students, so
    ownership has to be enforced, not assumed."""
    mine = await _seed_hw()
    theirs = await _seed_hw()
    await _prepare(mine, due_at=None)
    await _prepare(theirs, due_at=None)

    r = await client.post(
        f"/v1/teacher/assignments/{theirs['assignment_id']}/grade-pending",
        headers=_auth(mine["teacher_token"]),
    )
    assert r.status_code == 403

    r = await client.post(
        f"/v1/teacher/submissions/{theirs['submission_ids'][0]}/grade-now",
        headers=_auth(mine["teacher_token"]),
    )
    assert r.status_code == 403
    # And nothing of theirs moved.
    assert (await _job(theirs["submission_ids"][0])).scheduled_for is None  # type: ignore[union-attr]


async def test_future_due_date_can_be_pulled_forward(
    client: AsyncClient,
) -> None:
    """The head-start case: it IS due Friday, but the teacher wants to
    start reviewing on Thursday."""
    world = await _seed_hw(n_submissions=2)
    await _prepare(world, due_at=datetime.now(UTC) + timedelta(days=2))
    for sid in world["submission_ids"]:
        assert (await _job(sid)).scheduled_for > datetime.now(UTC)  # type: ignore[union-attr,operator]

    with patch("api.core.grading_queue.drain", new=AsyncMock(return_value={})):
        r = await client.post(
            f"/v1/teacher/assignments/{world['assignment_id']}/grade-pending",
            headers=_auth(world["teacher_token"]),
        )

    assert r.status_code == 200, r.text
    for sid in world["submission_ids"]:
        job = await _job(sid)
        assert job is not None
        assert job.status == STATUS_QUEUED
        assert job.scheduled_for <= datetime.now(UTC)  # type: ignore[operator]


async def test_grade_all_is_scoped_to_the_section_it_was_clicked_from(
    client: AsyncClient,
) -> None:
    """An assignment spans sections; the review page is per-section and
    its button counts only that section. Without the scope, a teacher
    told "Grade 2 ungraded" gets billed for every other section of the
    same homework — and nothing ever tells them."""
    from api.models.assignment import AssignmentSection
    from api.models.section import Section
    from api.models.user import User

    world = await _seed_hw(n_submissions=1)
    await _prepare(world, due_at=None)
    mine = world["submission_ids"][0]

    # A second section on the SAME homework, with its own student.
    async with get_session_factory()() as s:
        assignment = (await s.execute(
            select(Assignment).where(Assignment.id == world["assignment_id"])
        )).scalar_one()
        other_section = Section(course_id=assignment.course_id, name="Period 2")
        s.add(other_section)
        await s.flush()
        s.add(AssignmentSection(
            assignment_id=assignment.id, section_id=other_section.id,
        ))
        other_student = User(
            email=f"other_{uuid.uuid4().hex[:6]}@t.com",
            password_hash="x", grade_level=8, role="student", name="O",
        )
        s.add(other_student)
        await s.flush()
        other_sub = Submission(
            assignment_id=assignment.id, student_id=other_student.id,
            section_id=other_section.id, status="submitted",
            extraction=_EXTRACTION,
        )
        s.add(other_sub)
        await s.flush()
        other_id = other_sub.id
        await enqueue_submission(s, other_id, assignment)
        await s.commit()

    with patch("api.core.grading_queue.drain", new=AsyncMock(return_value={})):
        r = await client.post(
            f"/v1/teacher/assignments/{world['assignment_id']}/grade-pending"
            f"?section_id={world['section_id']}",
            headers=_auth(world["teacher_token"]),
        )

    assert r.status_code == 200, r.text
    # Only this section's work was pulled forward — the label and the
    # action describe the same thing.
    assert r.json()["queued"] == 1
    assert (await _job(mine)).scheduled_for is not None  # type: ignore[union-attr]
    assert (await _job(other_id)).scheduled_for is None  # type: ignore[union-attr]


async def test_grade_now_rejects_a_hw_with_ai_grading_off(
    client: AsyncClient,
) -> None:
    """Defence in depth. `_grade_one` re-reads the switch too, but the
    endpoint gate had no coverage at all."""
    world = await _seed_hw()
    await _prepare(world, due_at=None)
    async with get_session_factory()() as s:
        assignment = (await s.execute(
            select(Assignment).where(Assignment.id == world["assignment_id"])
        )).scalar_one()
        assignment.ai_grading_enabled = False
        await s.commit()

    r = await client.post(
        f"/v1/teacher/submissions/{world['submission_ids'][0]}/grade-now",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 400


# ── "Grade with AI" on work that was never graded ────────────────────
#
# The review page counted every score-less submission as ungraded, but
# the buttons could only move an EXISTING grading job — and flagged work,
# or work confirmed while AI grading was off, never gets one. Unconfirmed
# work was counted too, though it isn't the teacher's to grade yet.


async def _ungraded_world(
    n_submissions: int = 1, **sub_fields: Any,
) -> dict[str, Any]:
    """Confirmed submissions with a readable extraction and NO grading
    job (as when AI grading was off at confirm), on a no-due-date
    homework. `sub_fields` overrides, e.g. to unconfirm or flag."""
    world = await _seed_hw(n_submissions=n_submissions)
    async with get_session_factory()() as s:
        assignment = (await s.execute(
            select(Assignment).where(Assignment.id == world["assignment_id"])
        )).scalar_one()
        assignment.ai_grading_enabled = True
        assignment.integrity_check_enabled = False
        assignment.due_at = None
        for sid in world["submission_ids"]:
            sub = (await s.execute(
                select(Submission).where(Submission.id == sid)
            )).scalar_one()
            sub.extraction = _EXTRACTION
            sub.extraction_confirmed_at = datetime.now(UTC)
            for k, v in sub_fields.items():
                setattr(sub, k, v)
        await s.commit()
    return world


async def _fake_grade(
    submission_id: uuid.UUID, extraction: Any, db: Any, **kwargs: Any,
) -> None:
    """The grader, minus the LLM: writes an AI grade the way the real
    one does, so the drain sees a grade land."""
    db.add(SubmissionGrade(
        submission_id=submission_id, ai_score=100.0, final_score=100.0,
        ai_breakdown={"grades": []}, breakdown=[],
    ))
    await db.flush()


def _graded_ids(grader: AsyncMock) -> list[uuid.UUID]:
    return [c.args[0] for c in grader.await_args_list]


async def _grade_now(
    client: AsyncClient, world: dict[str, Any], sid: uuid.UUID,
) -> Any:
    with patch("api.core.grading_queue.drain", new=AsyncMock(return_value={})):
        return await client.post(
            f"/v1/teacher/submissions/{sid}/grade-now",
            headers=_auth(world["teacher_token"]),
        )


_FLAGGED = {"extraction_confirmed_at": None, "extraction_flagged_at": datetime.now(UTC)}
_UNCONFIRMED = {"extraction_confirmed_at": None}


@pytest.mark.parametrize("flagged", [False, True], ids=["confirmed", "flagged"])
async def test_grade_now_grades_confirmed_or_flagged_work_with_no_job(
    client: AsyncClient, flagged: bool,
) -> None:
    """Flagging never enqueues; a confirm while AI grading was off
    doesn't either. A flagged submission is graded on its reading
    as-is — the teacher sees the flag beside the grade."""
    world = await _ungraded_world(**(_FLAGGED if flagged else {}))
    sid = world["submission_ids"][0]
    assert await _job(sid) is None  # the old dead end: nothing to move

    r = await _grade_now(client, world, sid)
    assert r.status_code == 200, r.text
    assert r.json()["queued"] == 1
    job = await _job(sid)
    assert job is not None
    assert job.status == STATUS_QUEUED
    assert job.scheduled_for is not None
    assert job.scheduled_for <= datetime.now(UTC)
    assert str(job.requested_by_id) == world["teacher_id"]

    grader = AsyncMock(side_effect=_fake_grade)
    with patch("api.core.grading_ai.run_ai_grading_for_submission", new=grader):
        await drain()
    # Other tests' due jobs share the table; count only this one's.
    assert _graded_ids(grader).count(sid) == 1
    assert (await _job(sid)).status == STATUS_DONE  # type: ignore[union-attr]
    async with get_session_factory()() as s:
        grade = (await s.execute(
            select(SubmissionGrade).where(SubmissionGrade.submission_id == sid)
        )).scalar_one()
    assert grade.final_score == 100.0
    # Lands as a suggestion — the teacher still approves it.
    assert grade.reviewed_at is None


_GRADED_FORMS: dict[str, dict[str, Any]] = {
    "ai_grade": {
        "ai_score": 80.0, "final_score": 80.0, "ai_breakdown": {"grades": []},
    },
    # A cleared AI grade keeps its AI fields — still a regrade.
    "cleared_ai_grade": {"ai_score": 80.0, "ai_breakdown": {"grades": []}},
    "hand_grade": {
        "final_score": 100.0,
        "breakdown": [{"problem_id": "x", "percent": 100}],
        "graded_at": datetime.now(UTC),
    },
    # One problem scored of several: PATCH /grade writes a breakdown and
    # a final_score averaged over what's scored so far.
    "partial_hand_grade": {
        "breakdown": [{"problem_id": "x", "percent": 50}], "final_score": 50.0,
    },
    "breakdown_only": {"breakdown": [{"problem_id": "x", "percent": 50}]},
    "legacy_teacher_score": {"teacher_score": 90.0},
    "reviewed": {"reviewed_at": datetime.now(UTC)},
    # Published, then un-graded: the student was shown a grade.
    "published_then_cleared": {
        "published_final_score": 70.0, "grade_published_at": datetime.now(UTC),
    },
}


@pytest.mark.parametrize("form", list(_GRADED_FORMS))
async def test_grade_now_refuses_anything_already_graded(
    client: AsyncClient, form: str,
) -> None:
    """Never a regrade. Any grade data at all — AI, hand, partial,
    reviewed, previously published — and the endpoint refuses without
    creating a job."""
    world = await _ungraded_world()
    sid = world["submission_ids"][0]
    async with get_session_factory()() as s:
        s.add(SubmissionGrade(submission_id=sid, **_GRADED_FORMS[form]))
        await s.commit()

    r = await _grade_now(client, world, sid)
    assert r.status_code == 409, r.text
    assert "already has a grade" in r.json()["detail"]
    assert await _job(sid) is None


async def test_grade_now_waits_for_the_student_to_confirm(
    client: AsyncClient,
) -> None:
    """Founder rule: work the student hasn't confirmed (or flagged) is
    theirs to check first — the reading may still change."""
    world = await _ungraded_world(**_UNCONFIRMED)
    sid = world["submission_ids"][0]
    r = await _grade_now(client, world, sid)
    assert r.status_code == 409, r.text
    assert "Waiting for the student" in r.json()["detail"]
    assert await _job(sid) is None


async def test_teacher_notes_alone_do_not_count_as_a_grade(
    client: AsyncClient,
) -> None:
    world = await _ungraded_world()
    sid = world["submission_ids"][0]
    async with get_session_factory()() as s:
        s.add(SubmissionGrade(submission_id=sid, teacher_notes="see me"))
        await s.commit()

    r = await _grade_now(client, world, sid)
    assert r.status_code == 200, r.text
    assert r.json()["queued"] == 1


async def test_grade_now_refuses_an_unreadable_photo(client: AsyncClient) -> None:
    # Confirmed while AI grading was off: the confirm path never stamped
    # the skip — the confidence itself has to be checked.
    world = await _ungraded_world(
        extraction={**_EXTRACTION, "confidence": 0.1},
    )
    sid = world["submission_ids"][0]
    r = await _grade_now(client, world, sid)
    assert r.status_code == 409, r.text
    assert "couldn't read" in r.json()["detail"]
    assert await _job(sid) is None

    # Confirmed and stamped `skipped_unreadable` by the submit pipeline.
    world = await _ungraded_world()
    sid = world["submission_ids"][0]
    async with get_session_factory()() as s:
        s.add(SubmissionGrade(
            submission_id=sid, ai_grading_status="skipped_unreadable",
        ))
        await s.commit()
    r = await _grade_now(client, world, sid)
    assert r.status_code == 409, r.text
    assert await _job(sid) is None


async def test_grade_now_refuses_work_that_was_never_read(
    client: AsyncClient,
) -> None:
    # Submitted an hour ago and still no reading: it failed.
    world = await _ungraded_world(
        extraction=None, submitted_at=datetime.now(UTC) - timedelta(hours=1),
    )
    sid = world["submission_ids"][0]
    r = await _grade_now(client, world, sid)
    assert r.status_code == 409, r.text
    assert "never read" in r.json()["detail"]
    assert await _job(sid) is None


async def test_work_still_being_read_is_not_filed_as_unreadable(
    client: AsyncClient,
) -> None:
    """Just submitted: the Vision read is still running. That's
    "reading…", not "can't be AI-graded"."""
    world = await _ungraded_world(extraction=None)
    sid = world["submission_ids"][0]
    r = await _grade_now(client, world, sid)
    assert r.status_code == 409, r.text
    assert "still being read" in r.json()["detail"]

    r = await client.get(
        f"/v1/teacher/assignments/{world['assignment_id']}/submissions",
        headers=_auth(world["teacher_token"]),
    )
    [row] = r.json()["submissions"]
    assert row["ai_grade_block"] == "extracting"


async def test_hand_graded_before_the_drain_then_cleared_can_be_ai_graded(
    client: AsyncClient,
) -> None:
    """The dead end the review found. A hand grade lands before the due
    date; the drain skips the LLM (a grade exists) and closes the job
    `done`; the teacher then clears her grade. Nothing is graded, so the
    button shows — and it has to actually grade, not 200 with nothing
    queued."""
    world = await _ungraded_world()
    sid = world["submission_ids"][0]
    async with get_session_factory()() as s:
        assignment = (await s.execute(
            select(Assignment).where(Assignment.id == world["assignment_id"])
        )).scalar_one()
        await enqueue_submission(s, sid, assignment)
        job = (await s.execute(
            select(GradingJob).where(GradingJob.submission_id == sid)
        )).scalar_one()
        job.status = STATUS_DONE
        # What PATCH /grade leaves after an un-grade: an empty breakdown.
        s.add(SubmissionGrade(submission_id=sid, breakdown=[]))
        await s.commit()

    r = await _grade_now(client, world, sid)
    assert r.status_code == 200, r.text
    assert r.json()["queued"] == 1
    job = await _job(sid)
    assert job is not None and job.status == STATUS_QUEUED

    # Same through "Grade all".
    async with get_session_factory()() as s:
        (await s.execute(
            select(GradingJob).where(GradingJob.submission_id == sid)
        )).scalar_one().status = STATUS_DONE
        await s.commit()
    with patch("api.core.grading_queue.drain", new=AsyncMock(return_value={})):
        r = await client.post(
            f"/v1/teacher/assignments/{world['assignment_id']}/grade-pending",
            headers=_auth(world["teacher_token"]),
        )
    assert r.json()["queued"] == 1
    assert (await _job(sid)).status == STATUS_QUEUED  # type: ignore[union-attr]


@pytest.mark.parametrize("job_state", [STATUS_FAILED, STATUS_SKIPPED])
async def test_grade_now_revives_a_failed_or_skipped_job(
    client: AsyncClient, job_state: str,
) -> None:
    world = await _ungraded_world()
    sid = world["submission_ids"][0]
    async with get_session_factory()() as s:
        assignment = (await s.execute(
            select(Assignment).where(Assignment.id == world["assignment_id"])
        )).scalar_one()
        await enqueue_submission(s, sid, assignment)
        job = (await s.execute(
            select(GradingJob).where(GradingJob.submission_id == sid)
        )).scalar_one()
        job.status = job_state
        job.attempts = 3
        await s.commit()

    r = await _grade_now(client, world, sid)
    assert r.status_code == 200, r.text
    assert r.json()["queued"] == 1
    job = await _job(sid)
    assert job is not None
    assert job.status == STATUS_QUEUED
    assert job.attempts == 0


async def test_double_click_makes_one_job(client: AsyncClient) -> None:
    world = await _ungraded_world()
    sid = world["submission_ids"][0]
    with patch("api.core.grading_queue.drain", new=AsyncMock(return_value={})):
        results = await asyncio.gather(*(
            client.post(
                f"/v1/teacher/submissions/{sid}/grade-now",
                headers=_auth(world["teacher_token"]),
            )
            for _ in range(2)
        ))
    assert all(r.status_code == 200 for r in results), [r.text for r in results]
    async with get_session_factory()() as s:
        jobs = (await s.execute(
            select(GradingJob).where(GradingJob.submission_id == sid)
        )).scalars().all()
    assert len(jobs) == 1


async def test_grade_all_grades_only_what_it_can_grade(
    client: AsyncClient,
) -> None:
    """The count on the button and the jobs it moves are one rule."""
    world = await _ungraded_world(n_submissions=5)
    eligible, graded, unreadable, unread, unconfirmed = world["submission_ids"]
    async with get_session_factory()() as s:
        s.add(SubmissionGrade(submission_id=graded, final_score=50.0))
        (await s.execute(
            select(Submission).where(Submission.id == unconfirmed)
        )).scalar_one().extraction_confirmed_at = None
        for sid, extraction in (
            (unreadable, {**_EXTRACTION, "confidence": 0.1}),
            (unread, None),
        ):
            sub = (await s.execute(
                select(Submission).where(Submission.id == sid)
            )).scalar_one()
            sub.extraction = extraction
            sub.submitted_at = datetime.now(UTC) - timedelta(hours=1)
        await s.commit()

    with patch("api.core.grading_queue.drain", new=AsyncMock(return_value={})):
        r = await client.post(
            f"/v1/teacher/assignments/{world['assignment_id']}/grade-pending"
            f"?section_id={world['section_id']}",
            headers=_auth(world["teacher_token"]),
        )
    assert r.status_code == 200, r.text
    assert r.json()["queued"] == 1
    assert (await _job(eligible)) is not None
    for sid in (graded, unreadable, unread, unconfirmed):
        assert await _job(sid) is None

    # And the roster says the same thing, per row.
    r = await client.get(
        f"/v1/teacher/assignments/{world['assignment_id']}/submissions",
        headers=_auth(world["teacher_token"]),
    )
    rows = {row["id"]: row for row in r.json()["submissions"]}
    assert rows[str(eligible)]["ai_grade_block"] is None
    assert rows[str(eligible)]["grading_job_status"] == STATUS_QUEUED
    assert rows[str(graded)]["ai_grade_block"] == "graded"
    assert rows[str(unreadable)]["ai_grade_block"] == "unreadable"
    assert rows[str(unread)]["ai_grade_block"] == "no_extraction"
    assert rows[str(unread)]["grading_job_status"] is None
    assert rows[str(unconfirmed)]["ai_grade_block"] == "awaiting_confirmation"


@pytest.mark.parametrize(
    "residue",
    [
        {"ai_score": 80.0, "ai_breakdown": {"grades": []}},  # cleared AI grade
        {"reviewed_at": datetime.now(UTC)},
        {"breakdown": [{"problem_id": "x", "percent": 50}]},
    ],
    ids=["cleared_ai_grade", "review_stamp", "breakdown_only"],
)
async def test_grader_skips_the_model_on_any_grade_data(
    residue: dict[str, Any],
) -> None:
    """The grader's own pre-model guard uses the same "any grade data"
    rule as the button. It used to look only at `final_score`, so a job
    revived or queued around a cleared AI grade paid for a second call."""
    from tests.test_teacher_review_checkpoint import _real_run_ai_grading

    world = await _ungraded_world()
    sid = world["submission_ids"][0]
    async with get_session_factory()() as s:
        s.add(SubmissionGrade(submission_id=sid, **residue))
        await s.commit()

    llm = AsyncMock(return_value={"grades": []})
    with patch("api.core.grading_ai.grade_submission_with_ai", new=llm):
        async with get_session_factory()() as s:
            await _real_run_ai_grading(sid, _EXTRACTION, s)
            await s.commit()
    llm.assert_not_awaited()

    # And a queued job over that residue closes cleanly instead of
    # retrying "grader returned no grades" until it parks in `failed`.
    async with get_session_factory()() as s:
        assignment = (await s.execute(
            select(Assignment).where(Assignment.id == world["assignment_id"])
        )).scalar_one()
        await enqueue_submission(s, sid, assignment, run_now=True)
        await s.commit()
    await drain()
    job = await _job(sid)
    assert job is not None and job.status == STATUS_SKIPPED
    assert job.attempts == 1


async def test_a_hand_grade_saved_during_the_model_call_wins_the_recheck() -> None:
    """The teacher presses "Grade with AI", then starts scoring by hand
    while the model is still thinking. A partial hand grade carries no
    review stamp, so the AI's result used to replace it on landing. Her
    save commits before the grader's write, so this pins the post-call
    re-check (the row lock covers saves that land during the write)."""
    from tests.test_teacher_review_checkpoint import _real_run_ai_grading

    world = await _ungraded_world()
    sid = world["submission_ids"][0]
    hand = [{"problem_id": world["bank_item_id"], "score_status": "zero",
             "percent": 0, "feedback": None}]

    async def _model_while_teacher_grades(*_: Any, **__: Any) -> dict[str, Any]:
        async with get_session_factory()() as s:
            s.add(SubmissionGrade(
                submission_id=sid, breakdown=hand, final_score=0.0,
                graded_at=datetime.now(UTC),
            ))
            await s.commit()
        return {"grades": [{
            "problem_position": 1, "score_status": "full", "confidence": 0.9,
            "student_feedback": "ok", "reasoning": "matches the key",
        }]}

    with patch(
        "api.core.grading_ai.grade_submission_with_ai",
        new=AsyncMock(side_effect=_model_while_teacher_grades),
    ):
        async with get_session_factory()() as s:
            await _real_run_ai_grading(sid, _EXTRACTION, s)
            await s.commit()

    async with get_session_factory()() as s:
        grade = (await s.execute(
            select(SubmissionGrade).where(SubmissionGrade.submission_id == sid)
        )).scalar_one()
    assert grade.final_score == 0.0
    assert grade.breakdown == hand
    # The AI's read is kept for reference, not lost.
    assert grade.ai_score == 100.0
