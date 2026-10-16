"""Teacher Student Insights — "which problems should I reteach?"

One section-scoped read powers the whole Insights tab:

  GET /teacher/courses/{course_id}/sections/{section_id}/insights?assignment_id=

Pure counting over stored rows — no LLM at read time. Three parts:

  homeworks[]  every published homework in the section, newest first,
               with a coverage line (counted / to approve / to grade /
               still grading / waiting on the student / not submitted) so
               the numbers are never presented as the whole class when
               they aren't.
  problems[]   the selected homework's problems in homework order: how
               many counted grades, how many scored under half, and
               whether the problem is flagged for reteaching (see
               `_is_flagged`). Whole class only — no per-student lists.
  practice     the practice set made from that homework for this
               section, if any, and which problems it already covers.

Which grades count is the load-bearing rule (`counted_breakdown`): the
teacher sees and approves every AI grade, so an AI draft never counts.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.audit_log import log_student_record_access
from api.core.grading_queue import EXTRACTION_GRACE
from api.core.integrity_ai import UNREADABLE_THRESHOLD
from api.database import get_db
from api.middleware.auth import CurrentUser, require_teacher
from api.models.assignment import Assignment, AssignmentSection, Submission, SubmissionGrade
from api.models.grading_job import STATUS_QUEUED, STATUS_RUNNING, GradingJob
from api.models.question_bank import QuestionBankGenerationJob, QuestionBankItem
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.user import User
from api.routes.teacher_courses import get_teacher_course
from api.services.bank import hydrate_assignment_content

router = APIRouter()

_SCORE_STATUSES = ("full", "partial", "zero")

# Reteach rule. A student got a problem wrong when they scored under
# half of it; a problem is flagged when more than half the counted
# grades are wrong, once enough are counted to mean something.
_WRONG_BELOW_PERCENT = 50.0
_FLAG_MIN_COUNTED = 5


# ── Response models ────────────────────────────────────────────────


class InsightsSection(BaseModel):
    id: uuid.UUID
    name: str


class InsightsHomework(BaseModel):
    id: uuid.UUID
    title: str
    due_at: datetime | None
    # Enrolled students plus anyone who has since left but has a
    # submission in this section, so the buckets below always sum to it.
    students: int
    counted: int
    to_approve: int
    to_grade: int
    grading: int
    awaiting_student: int
    not_submitted: int


class InsightsProblem(BaseModel):
    bank_item_id: uuid.UUID
    position: int
    question: str
    counted: int  # students with a counted grade on this problem
    wrong: int    # of those, how many scored under half
    flagged: bool


class InsightsPractice(BaseModel):
    """The practice set made from the selected homework for this section."""
    id: uuid.UUID
    title: str
    status: str
    approved: int    # versions students see once it's published
    to_review: int   # versions waiting on the teacher's approval
    writing: int     # problems the AI is still writing versions of
    # Homework problems the set already has versions of (or is writing).
    covered_item_ids: list[uuid.UUID]


class SectionInsightsResponse(BaseModel):
    section: InsightsSection
    homeworks: list[InsightsHomework]
    selected_homework_id: uuid.UUID | None
    problems: list[InsightsProblem]
    practice: InsightsPractice | None


# ── Counting rule ──────────────────────────────────────────────────


def counted_breakdown(grade: Any) -> list[dict[str, Any]] | None:
    """The per-problem grades that count toward insights, or None.

    - Approved (`reviewed_at` set; hand grades self-approve) → the live
      breakdown. Edits after approval keep the approval, by design.
    - Otherwise published (`grade_published_at` set) → the snapshot the
      student was shown, never the live column: a forced AI regrade
      clears `reviewed_at` but keeps the publish stamp, leaving an unseen
      AI draft in `breakdown`.
    - Otherwise → not counted. An unapproved AI draft never counts.

    `grade` is anything carrying the SubmissionGrade columns (the model,
    or a column row from the insights query). An empty list is the
    "un-graded" signal (a retracted grade), so it counts as nothing —
    as does a breakdown with no well-formed entries.
    """
    if grade is None:
        return None
    if grade.reviewed_at is not None:
        rows = grade.breakdown
    elif grade.grade_published_at is not None:
        rows = grade.published_breakdown
    else:
        return None
    if not isinstance(rows, list) or not rows:
        return None
    valid = [e for e in rows if isinstance(e, dict) and e.get("score_status") in _SCORE_STATUSES]
    return valid or None


def _confidence(raw: str | None) -> float:
    """The reader's confidence; missing or malformed counts as 0, as in
    `ai_grade_block` (`extraction.get("confidence", 0.0)`)."""
    try:
        return float(raw) if raw is not None else 0.0
    except ValueError:
        return 0.0


def _coverage_bucket(
    r: Any, counted: list[dict[str, Any]] | None, *, ai_grading_enabled: bool, now: datetime,
) -> str:
    """Where one submission sits on the coverage line. Buckets are
    exclusive so they always add up.

    "Still grading" means the grader will get to it on its own: a job
    running, or queued with a time (`GradingJob` — the row the review
    page reads), or a photo still inside the reader's grace window.
    Never "no grade yet", so work nothing will AI-grade can't sit there
    all term. The rules mirror `ai_grade_block`."""
    if counted is not None:
        return "counted"
    if isinstance(r.breakdown, list) and r.breakdown:
        return "to_approve"  # an AI draft the teacher hasn't approved
    if r.job_status == STATUS_RUNNING:
        return "grading"  # a claimed job finishes even if AI is switched off
    unreadable = r.ai_grading_status == "skipped_unreadable" or (
        r.has_reading and _confidence(r.reading_confidence) < UNREADABLE_THRESHOLD
    )
    open_to_ai = (
        ai_grading_enabled
        and r.extraction_flagged_at is None
        and not unreadable
        and r.reviewed_at is None
        and r.grade_published_at is None
    )
    if open_to_ai:
        # A queued job with no time waits for the teacher's Grade press.
        if r.job_status == STATUS_QUEUED and r.job_scheduled_for is not None:
            return "grading"
        if not r.has_reading:
            # The reader is still on it; past the grace window it failed,
            # and with nothing to confirm the student can't unblock it.
            if r.submitted_at is not None and now - r.submitted_at < EXTRACTION_GRACE:
                return "grading"
        elif r.extraction_confirmed_at is None:
            # AI grading waits for the student to confirm the reading.
            return "awaiting_student"
    # Nothing will grade it unless the teacher acts: AI grading is off,
    # the student flagged the reading, it was unreadable or never read,
    # the job was skipped, failed or waits for a Grade press, or the
    # teacher retracted the grade.
    return "to_grade"


def _is_wrong(entry: dict[str, Any]) -> bool:
    """Under half credit. Every grade writes `percent` (auto for full and
    zero, required for partial); fall back on the status if it's missing."""
    pct = entry.get("percent")
    if isinstance(pct, int | float) and not isinstance(pct, bool):
        return pct < _WRONG_BELOW_PERCENT
    return bool(entry["score_status"] == "zero")


def _is_flagged(counted: int, wrong: int) -> bool:
    return counted >= _FLAG_MIN_COUNTED and wrong * 2 > counted


# ── Endpoint ───────────────────────────────────────────────────────


@router.get("/courses/{course_id}/sections/{section_id}/insights")
async def get_section_insights(
    course_id: uuid.UUID,
    section_id: uuid.UUID,
    request: Request,
    assignment_id: uuid.UUID | None = None,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> SectionInsightsResponse:
    course = await get_teacher_course(db, course_id, current_user.user_id)
    section = (await db.execute(
        select(Section).where(Section.id == section_id, Section.course_id == course_id)
    )).scalar_one_or_none()
    if section is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Section not found")

    # FERPA: one roster-scoped access row keyed to the section — the
    # honest description of an aggregate read across many students.
    await log_student_record_access(
        db,
        accessor_user_id=current_user.user_id,
        accessor_role=current_user.role,
        target_student_id=None,
        record_type="insights_roster",
        record_id=section_id,
        accessor_school_id=course.school_id,
        request=request,
    )

    # Roster: enrolled, non-preview students.
    roster = (await db.execute(
        select(User.id)
        .join(SectionEnrollment, SectionEnrollment.student_id == User.id)
        .where(SectionEnrollment.section_id == section_id, User.is_preview.is_(False))
    )).all()
    roster_ids = {r.id for r in roster}

    # Published homework pushed to this section, newest first. Quizzes and
    # tests have no student submit path yet, and practice is ungraded.
    hw_rows = (await db.execute(
        select(Assignment, AssignmentSection.published_at)
        .join(AssignmentSection, AssignmentSection.assignment_id == Assignment.id)
        .where(
            AssignmentSection.section_id == section_id,
            AssignmentSection.published_at.is_not(None),
            Assignment.course_id == course_id,
            Assignment.status == "published",
            Assignment.type == "homework",
        )
        .order_by(
            func.coalesce(Assignment.due_at, AssignmentSection.published_at).desc(),
            Assignment.created_at.desc(),
        )
    )).all()
    homeworks = [r.Assignment for r in hw_rows]
    hw_ids = [a.id for a in homeworks]
    ai_enabled = {a.id: a.ai_grading_enabled for a in homeworks}

    # Every non-preview submission in this section for those homeworks,
    # with its grade. Filtered on Submission.section_id — never the
    # assignment alone — so one period never leaks into another.
    # Only the columns used: a submission row also carries the photos and
    # extraction JSON, which would make this read grow all term.
    sub_rows = (await db.execute(
        select(
            Submission.id, Submission.assignment_id, Submission.student_id,
            Submission.extraction_flagged_at,
            SubmissionGrade.reviewed_at, SubmissionGrade.grade_published_at,
            SubmissionGrade.breakdown, SubmissionGrade.published_breakdown,
            SubmissionGrade.ai_grading_status,
            Submission.extraction_confirmed_at,
            Submission.submitted_at,
            # Whether a reading exists, without loading the JSON. A JSON
            # column can hold SQL NULL or a JSON null; both mean none.
            (func.coalesce(func.json_typeof(Submission.extraction), "null") != "null").label("has_reading"),
            # The reader's confidence as text, so unreadable work is judged
            # the way `ai_grade_block` does without loading the JSON.
            func.json_extract_path_text(Submission.extraction, "confidence").label("reading_confidence"),
            GradingJob.status.label("job_status"),
            GradingJob.scheduled_for.label("job_scheduled_for"),
        )
        .join(User, User.id == Submission.student_id)
        .outerjoin(SubmissionGrade, SubmissionGrade.submission_id == Submission.id)
        .outerjoin(GradingJob, GradingJob.submission_id == Submission.id)
        .where(
            Submission.section_id == section_id,
            Submission.assignment_id.in_(hw_ids),
            User.is_preview.is_(False),
        )
    )).all() if hw_ids else []

    now = datetime.now(UTC)
    # (assignment_id, student_id) → counted breakdown | None
    by_hw_student: dict[tuple[uuid.UUID, uuid.UUID], list[dict[str, Any]] | None] = {}
    coverage: dict[uuid.UUID, dict[str, int]] = {
        a: {
            "counted": 0, "to_approve": 0, "to_grade": 0, "grading": 0, "awaiting_student": 0,
        } for a in hw_ids
    }
    for r in sub_rows:
        counted = counted_breakdown(r)
        by_hw_student[(r.assignment_id, r.student_id)] = counted
        bucket = _coverage_bucket(r, counted, ai_grading_enabled=ai_enabled[r.assignment_id], now=now)
        coverage[r.assignment_id][bucket] += 1

    hw_out = [
        InsightsHomework(
            id=a.id,
            title=a.title,
            due_at=a.due_at,
            students=len(roster_ids | {sid for (a_id, sid) in by_hw_student if a_id == a.id}),
            not_submitted=sum(1 for sid in roster_ids if (a.id, sid) not in by_hw_student),
            **coverage[a.id],
        )
        for a in homeworks
    ]

    selected = _pick_homework(homeworks, coverage, assignment_id)
    return SectionInsightsResponse(
        section=InsightsSection(id=section.id, name=section.name),
        homeworks=hw_out,
        selected_homework_id=selected.id if selected else None,
        problems=await _problems_for(db, selected, by_hw_student) if selected else [],
        practice=await _practice_for(db, selected, section_id) if selected else None,
    )


def _pick_homework(
    homeworks: list[Assignment],
    coverage: dict[uuid.UUID, dict[str, int]],
    requested: uuid.UUID | None,
) -> Assignment | None:
    """The requested homework (404 if it isn't this section's), else the
    newest one with counted grades, else the newest one."""
    if requested is not None:
        for a in homeworks:
            if a.id == requested:
                return a
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Homework not found")
    return next((a for a in homeworks if coverage[a.id]["counted"]), homeworks[0] if homeworks else None)


async def _problems_for(
    db: AsyncSession,
    hw: Assignment,
    by_hw_student: dict[tuple[uuid.UUID, uuid.UUID], list[dict[str, Any]] | None],
) -> list[InsightsProblem]:
    """Whole-class counts per problem for one homework, in homework order."""
    hydrated = await hydrate_assignment_content(db, hw)
    problem_list = [p for p in (hydrated or {}).get("problems") or [] if isinstance(p, dict)]

    # Breakdown entries join to problems on problem_id (= bank_item_id),
    # never list position — grading and hydration can drop or reorder.
    tally: dict[str, list[int]] = {str(p["bank_item_id"]): [0, 0] for p in problem_list if p.get("bank_item_id")}
    for (a_id, _sid), counted in by_hw_student.items():
        if a_id != hw.id or counted is None:
            continue
        for e in counted:
            t = tally.get(str(e.get("problem_id")))
            if t is None:
                continue  # entry for a problem no longer on the homework
            t[0] += 1
            t[1] += _is_wrong(e)

    return [
        InsightsProblem(
            bank_item_id=uuid.UUID(key),
            position=p.get("position") or idx,
            question=p.get("question") or "",
            counted=t[0],
            wrong=t[1],
            flagged=_is_flagged(t[0], t[1]),
        )
        for idx, p in enumerate(problem_list, start=1)
        if (key := str(p.get("bank_item_id"))) in tally and (t := tally[key])
    ]


async def _practice_for(
    db: AsyncSession, hw: Assignment, section_id: uuid.UUID,
) -> InsightsPractice | None:
    """The newest practice set made from `hw` that reaches this section —
    one set per homework per section, so adding problems later appends
    to it instead of starting another."""
    practice = (await db.execute(
        select(Assignment)
        .join(AssignmentSection, AssignmentSection.assignment_id == Assignment.id)
        .where(
            Assignment.source_homework_id == hw.id,
            Assignment.type == "practice",
            AssignmentSection.section_id == section_id,
        )
        .order_by(Assignment.created_at.desc())
        .limit(1)
    )).scalar_one_or_none()
    if practice is None:
        return None

    items = (await db.execute(
        select(QuestionBankItem.status, QuestionBankItem.parent_question_id)
        .where(
            QuestionBankItem.originating_assignment_id == practice.id,
            QuestionBankItem.status.in_(("approved", "pending")),
        )
    )).all()
    writing = (await db.execute(
        select(QuestionBankGenerationJob.parent_question_id)
        .where(
            QuestionBankGenerationJob.originating_assignment_id == practice.id,
            QuestionBankGenerationJob.status.in_(("queued", "running")),
        )
    )).scalars().all()
    covered = {r.parent_question_id for r in items} | set(writing)
    return InsightsPractice(
        id=practice.id,
        title=practice.title,
        status=practice.status,
        approved=sum(1 for r in items if r.status == "approved"),
        to_review=sum(1 for r in items if r.status == "pending"),
        writing=len(writing),
        covered_item_ids=sorted(c for c in covered if c is not None),
    )
