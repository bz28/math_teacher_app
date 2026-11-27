"""Who did what to one submission's grade, and when — the teacher half
of the admin case file (`admin_submissions.submission_case`).

Read from what is already stored, nothing new recorded per problem:

- the submission's own `grade.*` activity rows (save, mark/unmark
  reviewed, late penalty, graph item, "Grade with AI" = `grade.ai_single`);
- the assignment's "Grade all" rows (`grade.ai_batch`) that name this
  submission among the ones they queued;
- the assignment's `grade.publish` rows that released this grade — those
  naming it in `submission_ids`; for rows written before that list, the
  one nearest this grade's `grade_published_at`;
- a regrade (`grade.regrade`), which replaces the grade without touching
  the grading job;
- the grading job: whether the AI ran on the schedule (nobody pressed
  anything, `requested_by_id` NULL) or because a teacher asked. The
  drain also closes a job `done` without calling the AI when a teacher
  had already graded by hand, so the schedule's run is shown only when
  the AI's grade is on the row.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.activity_log import ActivityLog
from api.models.assignment import Submission, SubmissionGrade
from api.models.grading_job import STATUS_DONE, GradingJob
from api.models.user import User

# Grading-job events, derived rather than logged. Named like activity
# actions so the dashboard renders one list.
GRADING_AUTO = "grading.auto"            # the schedule ran it: nobody pressed anything
GRADING_REQUESTED = "grading.requested"  # a teacher asked, before the press was logged

# `grade.publish` stamps `grade_published_at` with the server's clock and
# the activity row with the database's, in one request: they land within
# moments of each other. Wide enough for a slow request, far narrower than
# two publishes a teacher could make.
_PUBLISH_MATCH = timedelta(minutes=2)


class CaseTimelineEvent(BaseModel):
    """One thing that happened to this grade. `action` is an activity
    action (`grade.save`, ...) or a derived `grading.*` event;
    `metadata` is the activity row's, as written."""
    at: datetime
    action: str
    actor_name: str | None
    metadata: dict[str, Any] | None


class CaseGradingJob(BaseModel):
    """The submission's grading job as it stands — the queue keeps one
    row per submission (a reopen resets it; a regrade doesn't touch it),
    so this is its most recent run only."""
    status: str
    scheduled_for: datetime | None
    requested_by_name: str | None
    attempts: int
    last_error: str | None
    started_at: datetime | None
    finished_at: datetime | None


async def _names(db: AsyncSession, ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not ids:
        return {}
    return {
        uid: name or email
        for uid, name, email in (await db.execute(
            select(User.id, User.name, User.email).where(User.id.in_(ids))
        )).all()
    }


def _names_submission(row: ActivityLog, submission_id: str) -> bool:
    ids = (row.action_metadata or {}).get("submission_ids")
    return isinstance(ids, list) and submission_id in ids


async def case_timeline(
    db: AsyncSession, sub: Submission, grade: SubmissionGrade | None,
) -> tuple[list[CaseTimelineEvent], CaseGradingJob | None]:
    """The submission's grade timeline, oldest first, and its job."""
    rows = list((await db.execute(
        select(ActivityLog).where(
            ActivityLog.target_type == "submission",
            ActivityLog.target_id == sub.id,
            ActivityLog.action.like("grade.%"),
        )
    )).scalars().all())

    # Rows on the homework: a "Grade all" press and a publish act on the
    # whole class. Only those on or after this turn-in can touch it.
    class_rows = list((await db.execute(
        select(ActivityLog).where(
            ActivityLog.target_type == "assignment",
            ActivityLog.target_id == sub.assignment_id,
            ActivityLog.action.in_(("grade.ai_batch", "grade.publish")),
            ActivityLog.performed_at >= sub.submitted_at,
        )
    )).scalars().all())
    sid = str(sub.id)
    published_at = grade.grade_published_at if grade else None
    legacy_publishes: list[ActivityLog] = []
    for r in class_rows:
        if r.action == "grade.ai_batch" and _names_submission(r, sid):
            rows.append(r)
        elif r.action == "grade.publish":
            if "submission_ids" in (r.action_metadata or {}):
                if _names_submission(r, sid):
                    rows.append(r)
            elif published_at is not None and abs(r.performed_at - published_at) <= _PUBLISH_MATCH:
                legacy_publishes.append(r)
    if legacy_publishes and published_at is not None:
        # Before publishes named their grades: the press nearest this
        # grade's stamp is the one that released it — only that one.
        rows.append(min(legacy_publishes, key=lambda r: abs(r.performed_at - published_at)))

    job = (await db.execute(
        select(GradingJob).where(GradingJob.submission_id == sub.id)
    )).scalar_one_or_none()

    names = await _names(db, {
        *(r.actor_user_id for r in rows if r.actor_user_id),
        *([job.requested_by_id] if job and job.requested_by_id else []),
    })
    events = [
        CaseTimelineEvent(
            at=r.performed_at,
            action=r.action,
            actor_name=names.get(r.actor_user_id) if r.actor_user_id else None,
            metadata=r.action_metadata,
        )
        for r in rows
    ]

    job_out: CaseGradingJob | None = None
    if job is not None:
        requester = names.get(job.requested_by_id) if job.requested_by_id else None
        job_out = CaseGradingJob(
            status=job.status,
            scheduled_for=job.scheduled_for,
            requested_by_name=requester,
            attempts=job.attempts,
            last_error=job.last_error,
            started_at=job.started_at,
            finished_at=job.finished_at,
        )
        ran_at = job.finished_at if job.status == STATUS_DONE else None
        ai_graded = grade is not None and grade.ai_score is not None
        if ran_at is not None and job.requested_by_id is None and ai_graded:
            # Late work is queued at a due date already past, so it runs
            # at the next drain after the turn-in, not at the due date.
            late = job.scheduled_for is not None and sub.submitted_at > job.scheduled_for
            events.append(CaseTimelineEvent(
                at=ran_at, action=GRADING_AUTO, actor_name=None, metadata={"late": late},
            ))
        elif job.requested_by_id is not None and not any(
            e.action in ("grade.ai_batch", "grade.ai_single") for e in events
        ):
            # A teacher asked, but before the press itself was logged:
            # say who, not which button.
            events.append(CaseTimelineEvent(
                at=job.started_at or job.created_at,
                action=GRADING_REQUESTED, actor_name=requester, metadata=None,
            ))

    events.sort(key=lambda e: e.at)
    return events, job_out
