"""Admin reads about one submission's AI decisions, and about the
submissions that never happened.

Two endpoints, one theme — making an AI decision (or a platform
failure) legible to the operator:

- `GET /admin/blocked-submissions` — students whose homework upload
  the platform refused, grouped by person. Reads the
  `submission.rejected` activity rows written by
  api/core/submission_rejections.py. A rejected upload creates no
  submission row, so without this a blocked student and an absent
  student render identically.

- `GET /admin/submissions/{id}/case` — the per-problem case file:
  every problem on the homework with the AI grade beside the
  understanding-check outcome for that problem, plus the check
  itself as the full transcript (tool calls included, so the moment
  the agent decided is visible). Reuses the loaders the teacher
  endpoint uses, so the admin view and the teacher panel cannot drift
  on what a "problem" or a "turn" is.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.audit_log import log_student_record_access
from api.core.integrity_pipeline import (
    DIAGNOSIS_KIND_BLANK,
    DIAGNOSIS_KIND_ERROR,
    DIAGNOSIS_KIND_UNREADABLE,
    PROBLEM_STATUS_CAP_REACHED,
    PROBLEM_STATUS_DIAGNOSIS_ONLY,
    PROBLEM_STATUS_DISMISSED,
    PROBLEM_STATUS_PENDING,
    PROBLEM_STATUS_SKIPPED_UNREADABLE,
    PROBLEM_STATUS_VERDICT_SUBMITTED,
    ROLE_TOOL_CALL,
    agent_posture_for_check,
    tier_from_reason,
)
from api.database import get_db
from api.middleware.auth import CurrentUser, require_admin
from api.models.activity_log import ActivityLog
from api.models.assignment import Assignment, Submission, SubmissionGrade
from api.models.course import Course
from api.models.integrity_check import IntegrityCheckProblem
from api.models.user import User
from api.routes.integrity_check import (
    IntegrityActivitySummary,
    load_check_for_submission,
    load_check_problems,
    load_transcript,
)
from api.services.bank import load_problems_for_assignment

router = APIRouter()


# ── Blocked students ────────────────────────────────────────────────

class BlockedStudentRow(BaseModel):
    """One student × one homework they could not turn in. Grouped so
    eleven log lines read as "one person, eleven attempts, thirteen
    hours" — the sentence an operator acts on."""
    student_id: str
    student_name: str
    student_email: str | None
    assignment_id: str | None
    assignment_title: str | None
    course_name: str | None
    school_id: str | None
    attempts: int
    first_at: datetime
    last_at: datetime
    # The biggest body the client tried to send, in transport bytes —
    # the number the cap measured. Null when no attempt declared one.
    largest_request_bytes: int | None
    # Rejection reasons and how often each fired; `top_reason` is the
    # most frequent, for the row's one-line label.
    reasons: dict[str, int]
    top_reason: str
    # True when a submission for this homework exists from after the
    # last rejection — the student got through eventually. The row
    # stays (the incident happened) but the UI can mark it resolved.
    submitted_since: bool


class UnattributedBlockRow(BaseModel):
    """Rejections the size cap refused before authentication where the
    bearer token could not name the student. Counted per homework so
    the incident is still visible; the person is not."""
    assignment_id: str | None
    assignment_title: str | None
    course_name: str | None
    school_id: str | None
    attempts: int
    first_at: datetime
    last_at: datetime
    largest_request_bytes: int | None
    top_reason: str


class BlockedSubmissionsResponse(BaseModel):
    days: int
    since: datetime
    students: list[BlockedStudentRow]
    unattributed: list[UnattributedBlockRow]


def _meta_int(meta: dict[str, Any], key: str) -> int | None:
    v = meta.get(key)
    return int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


@router.get("/blocked-submissions")
async def blocked_submissions(
    days: int = Query(default=7, ge=1, le=90),
    school_id: uuid.UUID | None = Query(default=None),
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> BlockedSubmissionsResponse:
    since = datetime.now(UTC) - timedelta(days=days)
    filters = [
        ActivityLog.action == "submission.rejected",
        ActivityLog.performed_at >= since,
    ]
    if school_id is not None:
        filters.append(ActivityLog.school_id == school_id)
    rows = list((await db.execute(
        select(ActivityLog).where(*filters).order_by(ActivityLog.performed_at.asc())
    )).scalars().all())

    # Group in Python: a window holds tens of rows, not thousands, and
    # the per-group "submitted since?" check is one query per group.
    attributed: dict[tuple[uuid.UUID, uuid.UUID | None], list[ActivityLog]] = {}
    unattributed: dict[uuid.UUID | None, list[ActivityLog]] = {}
    for r in rows:
        meta = r.action_metadata or {}
        # A teacher rehearsing as a preview student is not a child who
        # couldn't turn in homework.
        if meta.get("is_preview"):
            continue
        if r.actor_user_id is None:
            unattributed.setdefault(r.target_id, []).append(r)
        else:
            attributed.setdefault((r.actor_user_id, r.target_id), []).append(r)

    student_ids = {sid for sid, _ in attributed}
    assignment_ids = {aid for _, aid in attributed if aid} | {aid for aid in unattributed if aid}

    users_by_id: dict[uuid.UUID, User] = {}
    if student_ids:
        users_by_id = {
            u.id: u for u in (await db.execute(
                select(User).where(User.id.in_(student_ids))
            )).scalars().all()
        }
    hw_by_id: dict[uuid.UUID, tuple[str, str | None, uuid.UUID | None]] = {}
    if assignment_ids:
        for aid, title, course_name, sch in (await db.execute(
            select(Assignment.id, Assignment.title, Course.name, Course.school_id)
            .join(Course, Course.id == Assignment.course_id)
            .where(Assignment.id.in_(assignment_ids))
        )).all():
            hw_by_id[aid] = (title, course_name, sch)

    def _summarize(group: list[ActivityLog]) -> dict[str, Any]:
        reasons: dict[str, int] = {}
        largest: int | None = None
        for r in group:
            meta = r.action_metadata or {}
            reason = str(meta.get("reason") or "unknown")
            reasons[reason] = reasons.get(reason, 0) + 1
            size = _meta_int(meta, "request_bytes")
            if size is not None and (largest is None or size > largest):
                largest = size
        top = max(reasons.items(), key=lambda kv: kv[1])[0]
        return {
            "attempts": len(group),
            "first_at": group[0].performed_at,
            "last_at": group[-1].performed_at,
            "largest_request_bytes": largest,
            "reasons": reasons,
            "top_reason": top,
        }

    def _hw(aid: uuid.UUID | None) -> dict[str, Any]:
        # The assignment may have been deleted since the rejection; the
        # row keeps its id and renders without a title.
        title, course_name, sch = hw_by_id[aid] if aid in hw_by_id else (None, None, None)
        return {
            "assignment_id": str(aid) if aid else None,
            "assignment_title": title,
            "course_name": course_name,
            "school_id": str(sch) if sch else None,
        }

    students: list[BlockedStudentRow] = []
    for (sid, aid), group in attributed.items():
        u = users_by_id.get(sid)
        summary = _summarize(group)
        submitted_since = False
        if aid is not None:
            submitted_since = (await db.execute(
                select(Submission.id).where(
                    Submission.student_id == sid,
                    Submission.assignment_id == aid,
                    Submission.submitted_at >= summary["last_at"],
                ).limit(1)
            )).scalar_one_or_none() is not None
        students.append(BlockedStudentRow(
            student_id=str(sid),
            # The account may have been deleted since; the row survives
            # (actor FK is SET NULL only on the log, the id stays here).
            student_name=(u.name or u.email) if u else "Deleted student",
            student_email=u.email if u else None,
            submitted_since=submitted_since,
            **_hw(aid),
            **summary,
        ))
    # Most attempts first: one refusal is noise, eleven is an incident.
    # Ties break on recency so the live problem outranks the stale one.
    students.sort(key=lambda s: (-s.attempts, -s.last_at.timestamp()))

    unattributed_rows = [
        UnattributedBlockRow(**_hw(aid), **{
            k: v for k, v in _summarize(group).items() if k != "reasons"
        })
        for aid, group in unattributed.items()
    ]
    unattributed_rows.sort(key=lambda s: -s.attempts)

    return BlockedSubmissionsResponse(
        days=days, since=since, students=students, unattributed=unattributed_rows,
    )


# ── The per-problem case ────────────────────────────────────────────

class CaseGrade(BaseModel):
    """The AI's grade for one problem — the immutable `ai_breakdown`
    entry, reasoning and confidence intact."""
    score_status: str
    percent: float
    confidence: float | None
    reasoning: str | None
    student_feedback: str | None
    student_answer: str | None


class CaseFinal(BaseModel):
    """The grade as it stands now — the AI's draft until a teacher
    edits it. `differs_from_ai` is the override signal."""
    score_status: str
    percent: float
    feedback: str | None
    differs_from_ai: bool


class CaseIntegrityProblem(BaseModel):
    """What the understanding check made of one problem.

    `kind` is the one word the case file leads with:
      probed         — discussed in chat; a verdict with rubric landed
      probed_pending — discussed in chat; the check is still running
      inconclusive   — chat hit the turn cap before a verdict
      diagnosed      — wrong on paper, never chatted; silent note
      blank          — wrong on paper because nothing was written
      unreadable     — the read was too poor to judge
      diagnosis_failed — the silent-diagnosis call errored
    A problem the check never touched has no entry at all.
    """
    problem_id: str
    kind: str
    status: str
    rubric: dict[str, Any] | None
    reasoning: str | None
    diagnosis_kind: str | None
    diagnosis_note: str | None
    selected_reason: str | None
    teacher_dismissed: bool
    teacher_dismissal_reason: str | None


class CaseProblem(BaseModel):
    position: int
    bank_item_id: str
    question: str
    answer_key: str | None
    grade: CaseGrade | None
    final: CaseFinal | None
    integrity: CaseIntegrityProblem | None


class CaseGradeSummary(BaseModel):
    ai_score: float | None
    final_score: float | None
    ai_grading_status: str | None
    graded_at: datetime | None
    reviewed_at: datetime | None
    grade_published_at: datetime | None
    teacher_notes: str | None


class CaseTurn(BaseModel):
    """One row of the check's conversation. Tool calls and results are
    included — they are the agent's decisions, and the case file
    renders them as events in the thread."""
    ordinal: int
    role: str
    content: str
    tool_name: str | None
    tool_use_id: str | None
    # The call's arguments, parsed, on tool_call rows; null elsewhere.
    tool_input: dict[str, Any] | None
    seconds_on_turn: int | None
    telemetry: dict[str, Any] | None
    created_at: datetime


class CaseIntegrity(BaseModel):
    check_id: str
    status: str
    disposition: str | None
    headline: str | None
    overall_summary: str | None
    probe_selection_reason: str | None
    # The stance the agent was briefed with — the one fact every
    # agent call shared, hoisted here so the thread can say it once.
    posture: str
    tier: str
    inline_variant_used: bool
    inline_variant_result: str | None
    activity_summary: IntegrityActivitySummary | None
    resolution: str
    resolved_by_name: str | None
    resolved_at: datetime | None
    created_at: datetime
    updated_at: datetime
    turns: list[CaseTurn]


class SubmissionCase(BaseModel):
    submission_id: str
    student_id: str
    student_name: str | None
    assignment_id: str
    assignment_title: str
    problems: list[CaseProblem]
    grade: CaseGradeSummary | None
    integrity: CaseIntegrity | None


def _integrity_kind(p: IntegrityCheckProblem) -> str:
    if p.status in (PROBLEM_STATUS_VERDICT_SUBMITTED, PROBLEM_STATUS_DISMISSED):
        return "probed"
    if p.status == PROBLEM_STATUS_PENDING:
        return "probed_pending"
    if p.status == PROBLEM_STATUS_CAP_REACHED:
        return "inconclusive"
    if p.status == PROBLEM_STATUS_SKIPPED_UNREADABLE:
        return "unreadable"
    if p.status == PROBLEM_STATUS_DIAGNOSIS_ONLY:
        if p.diagnosis_kind == DIAGNOSIS_KIND_BLANK:
            return "blank"
        if p.diagnosis_kind == DIAGNOSIS_KIND_UNREADABLE:
            return "unreadable"
        if p.diagnosis_kind == DIAGNOSIS_KIND_ERROR:
            return "diagnosis_failed"
        return "diagnosed"
    return p.status


def _ai_grades_by_position(raw: Any) -> dict[int, dict[str, Any]]:
    """`ai_breakdown` is stored as the grader envelope `{grades: [...]}`;
    tolerate a bare list too, which older rows and the teacher regrade
    path have produced."""
    grades = raw.get("grades") if isinstance(raw, dict) else raw
    out: dict[int, dict[str, Any]] = {}
    for g in grades or []:
        if isinstance(g, dict) and isinstance(g.get("problem_position"), int):
            out[g["problem_position"]] = g
    return out


def _parse_tool_input(turn_role: str, content: str) -> dict[str, Any] | None:
    if turn_role != ROLE_TOOL_CALL:
        return None
    try:
        parsed = json.loads(content)
    except (ValueError, TypeError):
        return None
    return parsed if isinstance(parsed, dict) else None


@router.get("/submissions/{submission_id}/case")
async def submission_case(
    submission_id: uuid.UUID,
    request: Request,
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> SubmissionCase:
    sub = (await db.execute(
        select(Submission).where(Submission.id == submission_id)
    )).scalar_one_or_none()
    if sub is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    assignment = (await db.execute(
        select(Assignment).where(Assignment.id == sub.assignment_id)
    )).scalar_one()
    student_name = (await db.execute(
        select(User.name).where(User.id == sub.student_id)
    )).scalar_one_or_none()

    # ── Grades: the AI's snapshot by position, the live breakdown by item ──
    grade = (await db.execute(
        select(SubmissionGrade).where(SubmissionGrade.submission_id == sub.id)
    )).scalar_one_or_none()
    ai_by_pos = _ai_grades_by_position(grade.ai_breakdown) if grade else {}
    final_by_bid: dict[str, dict[str, Any]] = {}
    if grade and isinstance(grade.breakdown, list):
        for entry in grade.breakdown:
            if isinstance(entry, dict) and entry.get("problem_id"):
                final_by_bid[str(entry["problem_id"])] = entry

    # ── Integrity: per-problem rows keyed by bank item ──
    check = await load_check_for_submission(db, sub.id)
    integrity_by_bid: dict[uuid.UUID, IntegrityCheckProblem] = {}
    integrity_out: CaseIntegrity | None = None
    if check is not None:
        for p in await load_check_problems(db, check.id):
            integrity_by_bid[p.bank_item_id] = p
        resolved_by_name: str | None = None
        if check.resolved_by is not None:
            resolver = (await db.execute(
                select(User.name, User.email).where(User.id == check.resolved_by)
            )).first()
            if resolver is not None:
                resolved_by_name = resolver.name or resolver.email
        turns = await load_transcript(db, check.id)
        integrity_out = CaseIntegrity(
            check_id=str(check.id),
            status=check.status,
            disposition=check.disposition,
            headline=check.headline,
            overall_summary=check.overall_summary,
            probe_selection_reason=check.probe_selection_reason,
            posture=await agent_posture_for_check(check, db),
            tier=tier_from_reason(check.probe_selection_reason),
            inline_variant_used=check.inline_variant_used,
            inline_variant_result=check.inline_variant_result,
            activity_summary=check.activity_summary,
            resolution=check.resolution,
            resolved_by_name=resolved_by_name,
            resolved_at=check.resolved_at,
            created_at=check.created_at,
            updated_at=check.updated_at,
            turns=[
                CaseTurn(
                    ordinal=t.ordinal,
                    role=t.role,
                    content=t.content,
                    tool_name=t.tool_name,
                    tool_use_id=t.tool_use_id,
                    tool_input=_parse_tool_input(t.role, t.content),
                    seconds_on_turn=t.seconds_on_turn,
                    telemetry=t.telemetry,
                    created_at=t.created_at,
                )
                for t in turns
            ],
        )

    # ── Problems, in homework order ──
    # `load_problems_for_assignment` numbers the list the way every
    # consumer does: the position the student saw as "Problem N", the
    # grader keyed `ai_breakdown` on, Vision attributed steps to, and
    # the integrity pipeline briefed the agent with (`load_hw_positions`
    # in the teacher endpoint walks the same ids the same way).
    problems_out: list[CaseProblem] = []
    for item in await load_problems_for_assignment(db, assignment):
        position: int = item["position"]
        ai = ai_by_pos.get(position)
        final = final_by_bid.get(item["bank_item_id"])
        ip = integrity_by_bid.get(uuid.UUID(item["bank_item_id"]))
        differs = False
        if ai and final:
            differs = (
                final.get("score_status") != ai.get("score_status")
                or round(float(final.get("percent") or 0.0))
                != round(float(ai.get("percent") or 0.0))
            )
        problems_out.append(CaseProblem(
            position=position,
            bank_item_id=item["bank_item_id"],
            question=item["question"],
            answer_key=item["final_answer"],
            grade=CaseGrade(
                score_status=str(ai.get("score_status") or "zero"),
                percent=float(ai.get("percent") or 0.0),
                confidence=ai.get("confidence"),
                reasoning=ai.get("reasoning"),
                student_feedback=ai.get("student_feedback"),
                student_answer=ai.get("student_answer"),
            ) if ai else None,
            final=CaseFinal(
                score_status=str(final.get("score_status") or "zero"),
                percent=float(final.get("percent") or 0.0),
                feedback=final.get("feedback"),
                differs_from_ai=differs,
            ) if final else None,
            integrity=CaseIntegrityProblem(
                problem_id=str(ip.id),
                kind=_integrity_kind(ip),
                status=ip.status,
                rubric=ip.rubric,
                reasoning=ip.ai_reasoning,
                diagnosis_kind=ip.diagnosis_kind,
                diagnosis_note=ip.diagnosis_note,
                selected_reason=ip.selected_reason,
                teacher_dismissed=ip.teacher_dismissed,
                teacher_dismissal_reason=ip.teacher_dismissal_reason,
            ) if ip else None,
        ))

    payload = SubmissionCase(
        submission_id=str(sub.id),
        student_id=str(sub.student_id),
        student_name=student_name,
        assignment_id=str(assignment.id),
        assignment_title=assignment.title,
        problems=problems_out,
        grade=CaseGradeSummary(
            ai_score=grade.ai_score,
            final_score=grade.final_score,
            ai_grading_status=grade.ai_grading_status,
            graded_at=grade.graded_at,
            reviewed_at=grade.reviewed_at,
            grade_published_at=grade.grade_published_at,
            teacher_notes=grade.teacher_notes,
        ) if grade else None,
        integrity=integrity_out,
    )

    # FERPA: an admin just read one named student's grades and the
    # transcript of their understanding check. Logged last, after every
    # ORM attribute has been copied out — see `admin_students._log_read`
    # for why order matters here.
    await log_student_record_access(
        db,
        accessor_user_id=current_user.user_id,
        accessor_role=current_user.role,
        target_student_id=sub.student_id,
        record_type="submission_case",
        record_id=submission_id,
        request=request,
    )
    return payload
