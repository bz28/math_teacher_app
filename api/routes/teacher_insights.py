"""Teacher Student Insights — "which problems should I reteach?"

One section-scoped read powers the whole Insights tab:

  GET /teacher/courses/{course_id}/sections/{section_id}/insights?assignment_id=

Pure reads of stored rows — no LLM at read time. Three parts:

  homeworks[]  every published homework in the section, newest first,
               with a coverage line (counted / to approve / to grade /
               still grading / waiting on the student / not submitted) so
               the numbers are never presented as the whole class when
               they aren't.
  problems[]   the selected homework's problems in homework order: how
               many counted grades, how many fell short of full credit,
               whether the problem is flagged for reteaching
               (`insights_counting.is_flagged`), and for a flagged one
               the most common reasons points came off, grouped from the
               teacher's approved feedback ahead of time by the grading
               drain (`reteach_reasons`). Counts are whole class; each
               reason names the students behind it for the teacher alone.
  practice     the practice set made from that homework for this
               section, if any, which problems it already covers, and how
               many of the period's students have practiced it.

Which grades count is the load-bearing rule (`counted_breakdown`): the
teacher sees and approves every AI grade, so an AI draft never counts.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.audit_log import log_student_record_access
from api.core.grading_queue import EXTRACTION_GRACE
from api.core.insights_counting import FLAG_MIN_COUNTED, counted_breakdown, is_flagged, missed_full_credit, tally
from api.core.integrity_ai import UNREADABLE_THRESHOLD
from api.core.reteach_reasons import gave_up, in_active_window, reason_inputs
from api.database import get_db
from api.middleware.auth import CurrentUser, require_teacher
from api.models.assignment import Assignment, AssignmentSection, Submission, SubmissionGrade
from api.models.grading_job import STATUS_QUEUED, STATUS_RUNNING, GradingJob
from api.models.practice_activity import MODE_PRACTICE, PracticeActivity
from api.models.question_bank import QuestionBankGenerationJob, QuestionBankItem
from api.models.reteach_reasons import ReteachReasons
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.user import User
from api.routes.teacher_courses import get_teacher_course
from api.services.bank import hydrate_assignment_content

router = APIRouter()

# Generation jobs run as in-process tasks that a restart loses, leaving
# the row queued or running for good. A job only touches its row when it
# starts, saves and finishes, and its three LLM stages can each retry for
# ~4.6 minutes, so a healthy job can sit untouched ~14 minutes. Past 30
# it's treated as failed — otherwise its problem would read "writing"
# forever and never be offered again.
_WRITING_STALE_AFTER = timedelta(minutes=30)


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


class InsightsReasonStudent(BaseModel):
    id: uuid.UUID
    name: str
    submission_id: uuid.UUID


class InsightsReason(BaseModel):
    """One common reason points came off, from the teacher's feedback."""
    label: str
    count: int
    students: list[InsightsReasonStudent]


class InsightsProblem(BaseModel):
    bank_item_id: uuid.UUID
    position: int
    question: str
    counted: int  # students with a counted grade on this problem
    missed: int   # of those, how many fell short of full credit
    flagged: bool
    # Flagged problems only: the most common reasons, most students first.
    reasons: list[InsightsReason]
    # Flagged, and its reasons haven't been written yet (the grading
    # drain writes them once grades are approved).
    reasons_pending: bool


class InsightsPractice(BaseModel):
    """The practice set made from the selected homework for this section."""
    id: uuid.UUID
    title: str
    status: str
    approved: int    # versions students see once it's published
    to_review: int   # versions waiting on the teacher's approval
    writing: int     # problems the AI is still writing versions of
    failed: int      # problems whose writing failed and that nothing else covers
    # Homework problems the set already has versions of (or is writing).
    covered_item_ids: list[uuid.UUID]
    # Enrolled students who answered at least one of its problems, of all
    # enrolled students. Ungraded: engagement, never a score.
    practiced: int
    students: int


class SectionInsightsResponse(BaseModel):
    section: InsightsSection
    homeworks: list[InsightsHomework]
    selected_homework_id: uuid.UUID | None
    problems: list[InsightsProblem]
    # Counted grades a problem needs before it can be flagged, so the
    # page can say "too early to tell" instead of "nothing was missed".
    flag_min_counted: int
    practice: InsightsPractice | None


# ── Coverage ───────────────────────────────────────────────────────


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
    submission_of: dict[tuple[uuid.UUID, uuid.UUID], uuid.UUID] = {}
    coverage: dict[uuid.UUID, dict[str, int]] = {
        a: {
            "counted": 0, "to_approve": 0, "to_grade": 0, "grading": 0, "awaiting_student": 0,
        } for a in hw_ids
    }
    for r in sub_rows:
        counted = counted_breakdown(r)
        by_hw_student[(r.assignment_id, r.student_id)] = counted
        submission_of[(r.assignment_id, r.student_id)] = r.id
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
        problems=await _problems_for(db, selected, section_id, by_hw_student, submission_of) if selected else [],
        flag_min_counted=FLAG_MIN_COUNTED,
        practice=await _practice_for(db, selected, section_id, roster_ids) if selected else None,
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
    section_id: uuid.UUID,
    by_hw_student: dict[tuple[uuid.UUID, uuid.UUID], list[dict[str, Any]] | None],
    submission_of: dict[tuple[uuid.UUID, uuid.UUID], uuid.UUID],
) -> list[InsightsProblem]:
    """Whole-class counts per problem for one homework, in homework order,
    with the stored reasons for the flagged ones."""
    hydrated = await hydrate_assignment_content(db, hw)
    problem_list = [p for p in (hydrated or {}).get("problems") or [] if isinstance(p, dict)]
    counts = tally(
        (str(p["bank_item_id"]) for p in problem_list if p.get("bank_item_id")),
        (counted for (a_id, _sid), counted in by_hw_student.items() if a_id == hw.id),
    )
    stored = (await db.execute(
        select(ReteachReasons.problems).where(
            ReteachReasons.assignment_id == hw.id, ReteachReasons.section_id == section_id,
        )
    )).scalar_one_or_none() or {}
    flagged = {pid for pid, (c, m) in counts.items() if is_flagged(c, m)}
    # Who's still short of full credit on each flagged problem right now:
    # a reason never names a student whose grade has since been raised.
    missed_by: dict[str, set[uuid.UUID]] = {pid: set() for pid in flagged}
    for (a_id, sid), counted in by_hw_student.items():
        for e in counted or () if a_id == hw.id else ():
            if (pid := str(e.get("problem_id"))) in missed_by and missed_full_credit(e):
                missed_by[pid].add(sid)
    reasons = await _reasons_for({pid: stored.get(pid) for pid in flagged}, missed_by, section_id, db)
    # Pending = the drain will still write it, which it decides by the
    # problem's input; worked out the same way here.
    pending: set[str] = set()
    if in_active_window(hw):
        by_submission = {
            str(submission_of[k]): counted for k, counted in by_hw_student.items() if k[0] == hw.id
        }
        questions = {str(p.get("bank_item_id")): str(p.get("question") or "") for p in problem_list}
        for pid in flagged:
            key, _n = reason_inputs(questions[pid], pid, by_submission)
            if _reasons_pending(stored.get(pid), key):
                pending.add(pid)

    return [
        InsightsProblem(
            bank_item_id=uuid.UUID(key),
            position=p.get("position") or idx,
            question=p.get("question") or "",
            counted=t[0],
            missed=t[1],
            flagged=key in flagged,
            reasons=reasons.get(key, []),
            reasons_pending=key in pending,
        )
        for idx, p in enumerate(problem_list, start=1)
        if (key := str(p.get("bank_item_id"))) in counts and (t := counts[key])
    ]


def _reasons_pending(entry: Any, key: str) -> bool:
    """No reasons yet, and the drain will still try: never written, or
    it hasn't given up on this input (`key`)."""
    if not isinstance(entry, dict):
        return True
    return entry.get("reasons") is None and not gave_up(entry, key)


async def _reasons_for(
    entries: dict[str, Any], missed_by: dict[str, set[uuid.UUID]], section_id: uuid.UUID, db: AsyncSession,
) -> dict[str, list[InsightsReason]]:
    """Stored reasons per flagged problem, each with the students behind
    it who are still short of full credit on it (`missed_by`; the drain
    rewrites the reasons themselves). A stored submission resolves only
    while it's still a non-preview
    submission in this section, so a reason never names anyone else."""
    written = {
        pid: [r for r in e["reasons"] if isinstance(r, dict)]
        for pid, e in entries.items()
        if isinstance(e, dict) and isinstance(e.get("reasons"), list)
    }
    sub_ids: set[uuid.UUID] = set()
    for rs in written.values():
        for r in rs:
            for raw in r.get("submission_ids") or ():
                try:
                    sub_ids.add(uuid.UUID(str(raw)))
                except ValueError:
                    continue
    students = {
        str(row.submission_id): InsightsReasonStudent(id=row.id, name=row.name, submission_id=row.submission_id)
        for row in (await db.execute(
            select(Submission.id.label("submission_id"), User.id, User.name)
            .join(User, User.id == Submission.student_id)
            .where(
                Submission.id.in_(sub_ids),
                Submission.section_id == section_id,
                User.is_preview.is_(False),
            )
        )).all()
    } if sub_ids else {}

    out: dict[str, list[InsightsReason]] = {}
    for pid, rs in written.items():
        reasons = []
        for r in rs:
            who = [
                students[s] for s in dict.fromkeys(str(x) for x in r.get("submission_ids") or ())
                if s in students and students[s].id in missed_by.get(pid, set())
            ]
            if who and isinstance(r.get("label"), str) and r["label"].strip():
                who.sort(key=lambda st: st.name.casefold())
                reasons.append(InsightsReason(label=r["label"].strip(), count=len(who), students=who))
        out[pid] = sorted(reasons, key=lambda r: -r.count)
    return out


async def _practice_for(
    db: AsyncSession, hw: Assignment, section_id: uuid.UUID, roster_ids: set[uuid.UUID],
) -> InsightsPractice | None:
    """The newest practice set made from `hw` for this section ALONE —
    one set per homework per section, so adding problems later appends
    to it instead of starting another. A set that also reaches other
    sections (the Practice tab clones for every section) never shows
    here: adding to it from one section's Insights would hand those
    problems to the other sections too."""
    practice = (await db.execute(
        select(Assignment)
        .join(AssignmentSection, AssignmentSection.assignment_id == Assignment.id)
        .where(
            Assignment.source_homework_id == hw.id,
            Assignment.type == "practice",
        )
        .group_by(Assignment.id)
        .having(
            func.count(AssignmentSection.section_id) == 1,
            func.bool_and(AssignmentSection.section_id == section_id),
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
    jobs = (await db.execute(
        select(
            QuestionBankGenerationJob.parent_question_id,
            QuestionBankGenerationJob.status,
            QuestionBankGenerationJob.updated_at,
        )
        .where(
            QuestionBankGenerationJob.originating_assignment_id == practice.id,
            QuestionBankGenerationJob.status.in_(("queued", "running", "failed")),
        )
    )).all()
    stale_before = datetime.now(UTC) - _WRITING_STALE_AFTER
    live = {j.parent_question_id for j in jobs if j.status != "failed" and j.updated_at >= stale_before}
    covered = {r.parent_question_id for r in items} | live
    # A failed (or lost) job's problem counts until something else covers
    # it — a retry that wrote versions, or one still writing.
    failed = {j.parent_question_id for j in jobs if j.parent_question_id not in live} - covered
    practiced = set((await db.execute(
        select(PracticeActivity.student_id).distinct().where(
            PracticeActivity.practice_assignment_id == practice.id,
            PracticeActivity.section_id == section_id,
            PracticeActivity.mode == MODE_PRACTICE,
        )
    )).scalars()) & roster_ids
    return InsightsPractice(
        id=practice.id,
        title=practice.title,
        status=practice.status,
        approved=sum(1 for r in items if r.status == "approved"),
        to_review=sum(1 for r in items if r.status == "pending"),
        writing=len(live),
        failed=len(failed),
        covered_item_ids=sorted(c for c in covered if c is not None),
        practiced=len(practiced),
        students=len(roster_ids),
    )
