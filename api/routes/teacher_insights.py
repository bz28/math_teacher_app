"""Teacher Student Insights — "what do I reteach, and who needs me?"

One section-scoped read powers the whole Insights tab:

  GET /teacher/courses/{course_id}/sections/{section_id}/insights?assignment_id=

Pure counting over stored rows — no LLM at read time. Three parts:

  homeworks[]  every published homework in the section, newest first,
               with a coverage line (counted / to approve / to hand-grade /
               still grading / not submitted) so a bar is never presented
               as the whole class when it isn't.
  problems[]   the selected homework's problems, most-missed first, with
               full / partial / zero counts, who is in each bucket (plus
               the understanding check's reason for a miss, when one was
               recorded) and how many understanding checks are waiting on
               the teacher for that problem.
  watch[]      at most five students who need the teacher, each with one
               plain reason (see `_watch_reason`).

Which grades count is the load-bearing rule (`counted_breakdown`): the
teacher sees and approves every AI grade, so an AI draft never counts.
"""

import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.audit_log import log_student_record_access
from api.database import get_db
from api.middleware.auth import CurrentUser, require_teacher
from api.models.assignment import Assignment, AssignmentSection, Submission, SubmissionGrade
from api.models.integrity_check import IntegrityCheckProblem, IntegrityCheckSubmission
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.user import User
from api.routes.teacher_courses import get_teacher_course
from api.services.bank import hydrate_assignment_content

router = APIRouter()

ScoreStatus = Literal["full", "partial", "zero"]
_SCORE_STATUSES: tuple[ScoreStatus, ...] = ("full", "partial", "zero")

WatchReason = Literal["missing_work", "missing_most", "sharp_drop"]

# Watch rules. A student is listed once, under the first reason that
# matches, in this order.
_MISSING_WINDOW = 3          # look at the last 3 past-due homeworks…
_MISSING_MIN = 2             # …and list anyone who skipped 2+ of them
_MISSING_MOST_WINDOW = 2     # pool problems across the last 2 counted HWs
_MISSING_MOST_MIN_PROBLEMS = 6  # never judge on a handful of problems
_MISSING_MOST_RATE = 0.5     # zero credit on at least half of them
_DROP_POINTS = 20.0          # average fell this much between the last two…
_DROP_BELOW = 70.0           # …and landed below this. On a 5-problem HW one
                             # miss is a 20-point swing; 100 → 80 isn't news.
_WATCH_LIMIT = 5

# A chat-probed problem the teacher still needs to look at: the agent
# didn't clear it and nobody has resolved or dismissed it. Worded on the
# page as "to review" — a pointer to the case file, never a flag.
_UNCLEARED_DISPOSITIONS = ("needs_practice", "tutor_pivot", "flag_for_review")


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
    to_hand_grade: int
    grading: int
    not_submitted: int


class InsightsStudentRef(BaseModel):
    student_id: uuid.UUID
    name: str
    submission_id: uuid.UUID
    # The understanding check's silent reason for a miss
    # (procedural_slip / conceptual_gap / blank / unreadable / error).
    # Null when none was recorded — coverage is partial by design.
    diagnosis_kind: str | None


class InsightsProblem(BaseModel):
    bank_item_id: uuid.UUID
    position: int
    question: str
    full: int
    partial: int
    zero: int
    students: dict[ScoreStatus, list[InsightsStudentRef]]
    to_review: int


class InsightsWatchStudent(BaseModel):
    student_id: uuid.UUID
    name: str
    reason: WatchReason
    # Reason-specific numbers the UI turns into one plain sentence:
    #   missing_work  → missed / window
    #   missing_most  → zero / problems
    #   sharp_drop    → previous / latest (average percent)
    missed: int | None = None
    window: int | None = None
    zero: int | None = None
    problems: int | None = None
    previous: float | None = None
    latest: float | None = None


class SectionInsightsResponse(BaseModel):
    section: InsightsSection
    homeworks: list[InsightsHomework]
    selected_homework_id: uuid.UUID | None
    problems: list[InsightsProblem]
    watch: list[InsightsWatchStudent]
    watch_total: int


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


def _coverage_bucket(r: Any, counted: list[dict[str, Any]] | None) -> str:
    """Where one submission sits on the coverage line. Buckets are
    exclusive so they always add up."""
    if counted is not None:
        return "counted"
    if isinstance(r.breakdown, list) and r.breakdown:
        return "to_approve"  # an AI draft the teacher hasn't approved
    if (
        r.extraction_flagged_at is not None
        or r.ai_grading_status == "skipped_unreadable"
        or r.reviewed_at is not None
        or r.grade_published_at is not None
    ):
        # No AI grade is coming (unreadable, or the student said the
        # reader got it wrong), or the teacher retracted the grade.
        return "to_hand_grade"
    return "grading"


def _avg_percent(entries: list[dict[str, Any]]) -> float | None:
    vals = [float(e["percent"]) for e in entries if isinstance(e.get("percent"), int | float)]
    return sum(vals) / len(vals) if vals else None


def _watch_reason(
    *,
    missed_recent: int,
    window: int,
    counted_newest_first: list[list[dict[str, Any]]],
) -> dict[str, Any] | None:
    """First matching watch rule for one student, or None.

    `missed_recent` / `window` are over the student's last past-due
    homeworks (due after they enrolled). `counted_newest_first` is their
    counted breakdowns, newest homework first.
    """
    if window and missed_recent >= _MISSING_MIN:
        return {"reason": "missing_work", "missed": missed_recent, "window": window}

    pooled = [e for b in counted_newest_first[:_MISSING_MOST_WINDOW] for e in b]
    zero = sum(1 for e in pooled if e["score_status"] == "zero")
    if len(pooled) >= _MISSING_MOST_MIN_PROBLEMS and zero / len(pooled) >= _MISSING_MOST_RATE:
        return {"reason": "missing_most", "zero": zero, "problems": len(pooled)}

    if len(counted_newest_first) >= 2:
        latest = _avg_percent(counted_newest_first[0])
        previous = _avg_percent(counted_newest_first[1])
        if (
            latest is not None and previous is not None
            and previous - latest >= _DROP_POINTS and latest < _DROP_BELOW
        ):
            return {"reason": "sharp_drop", "previous": round(previous, 1), "latest": round(latest, 1)}
    return None


_REASON_RANK: dict[str, int] = {"missing_work": 0, "missing_most": 1, "sharp_drop": 2}


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
        select(User.id, User.name, SectionEnrollment.enrolled_at)
        .join(SectionEnrollment, SectionEnrollment.student_id == User.id)
        .where(SectionEnrollment.section_id == section_id, User.is_preview.is_(False))
    )).all()
    names = {r.id: r.name for r in roster}
    enrolled_at = {r.id: r.enrolled_at for r in roster}

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
        )
        .join(User, User.id == Submission.student_id)
        .outerjoin(SubmissionGrade, SubmissionGrade.submission_id == Submission.id)
        .where(
            Submission.section_id == section_id,
            Submission.assignment_id.in_(hw_ids),
            User.is_preview.is_(False),
        )
    )).all() if hw_ids else []

    # (assignment_id, student_id) → (submission_id, counted breakdown | None)
    by_hw_student: dict[tuple[uuid.UUID, uuid.UUID], tuple[uuid.UUID, list[dict[str, Any]] | None]] = {}
    coverage: dict[uuid.UUID, dict[str, int]] = {
        a: {"counted": 0, "to_approve": 0, "to_hand_grade": 0, "grading": 0} for a in hw_ids
    }
    for r in sub_rows:
        counted = counted_breakdown(r)
        by_hw_student[(r.assignment_id, r.student_id)] = (r.id, counted)
        coverage[r.assignment_id][_coverage_bucket(r, counted)] += 1

    hw_out = [
        InsightsHomework(
            id=a.id,
            title=a.title,
            due_at=a.due_at,
            students=len(names.keys() | {sid for (a_id, sid) in by_hw_student if a_id == a.id}),
            not_submitted=sum(1 for sid in names if (a.id, sid) not in by_hw_student),
            **coverage[a.id],
        )
        for a in homeworks
    ]

    selected = _pick_homework(homeworks, coverage, assignment_id)
    problems = await _problems_for(db, selected, section_id, by_hw_student, names) if selected else []

    # Watch list — computed per student over the homeworks already loaded.
    now = datetime.now(UTC)
    watch: list[InsightsWatchStudent] = []
    for sid, name in names.items():
        joined = enrolled_at[sid]
        due_since_joined = [
            a for a in homeworks if a.due_at is not None and joined <= a.due_at <= now
        ][:_MISSING_WINDOW]
        missed = sum(1 for a in due_since_joined if (a.id, sid) not in by_hw_student)
        counted_newest_first = [
            c for a in homeworks
            if (c := by_hw_student.get((a.id, sid), (None, None))[1]) is not None
        ]
        hit = _watch_reason(
            missed_recent=missed,
            window=len(due_since_joined),
            counted_newest_first=counted_newest_first,
        )
        if hit:
            watch.append(InsightsWatchStudent(student_id=sid, name=name, **hit))
    watch.sort(key=lambda w: (_REASON_RANK[w.reason], w.name.lower()))

    return SectionInsightsResponse(
        section=InsightsSection(id=section.id, name=section.name),
        homeworks=hw_out,
        selected_homework_id=selected.id if selected else None,
        problems=problems,
        watch=watch[:_WATCH_LIMIT],
        watch_total=len(watch),
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
    by_hw_student: dict[tuple[uuid.UUID, uuid.UUID], tuple[uuid.UUID, list[dict[str, Any]] | None]],
    names: dict[uuid.UUID, str],
) -> list[InsightsProblem]:
    """Per-problem buckets for one homework, most-missed first."""
    hydrated = await hydrate_assignment_content(db, hw)
    problem_list = (hydrated or {}).get("problems") or []

    # Breakdown entries join to problems on problem_id (= bank_item_id),
    # never list position — grading and hydration can drop or reorder.
    buckets: dict[str, dict[ScoreStatus, list[InsightsStudentRef]]] = {
        str(p["bank_item_id"]): {s: [] for s in _SCORE_STATUSES}
        for p in problem_list if isinstance(p, dict) and p.get("bank_item_id")
    }
    diagnosis, to_review = await _integrity_for(db, hw.id, section_id)
    for (a_id, sid), (submission_id, counted) in by_hw_student.items():
        if a_id != hw.id or counted is None:
            continue
        for e in counted:
            pid = str(e.get("problem_id"))
            if pid not in buckets:
                continue  # entry for a problem no longer on the homework
            st: ScoreStatus = e["score_status"]
            buckets[pid][st].append(InsightsStudentRef(
                student_id=sid,
                # A student who left the section keeps their submission.
                name=names.get(sid) or "Former student",
                submission_id=submission_id,
                diagnosis_kind=diagnosis.get((submission_id, pid)) if st != "full" else None,
            ))

    out: list[InsightsProblem] = []
    for idx, p in enumerate(problem_list, start=1):
        key = str(p.get("bank_item_id")) if isinstance(p, dict) else None
        if key is None or key not in buckets:
            continue
        b = buckets[key]
        for refs in b.values():
            refs.sort(key=lambda r: r.name.lower())
        out.append(InsightsProblem(
            bank_item_id=uuid.UUID(key),
            position=p.get("position") or idx,
            question=p.get("question") or "",
            full=len(b["full"]),
            partial=len(b["partial"]),
            zero=len(b["zero"]),
            students=b,
            to_review=to_review.get(key, 0),
        ))

    def miss_rank(p: InsightsProblem) -> tuple[int, float, float, int]:
        graded = p.full + p.partial + p.zero
        if not graded:
            return (1, 0.0, 0.0, p.position)  # nothing counted yet → last
        return (0, -p.zero / graded, -p.partial / graded, p.position)

    out.sort(key=miss_rank)
    return out


async def _integrity_for(
    db: AsyncSession, assignment_id: uuid.UUID, section_id: uuid.UUID,
) -> tuple[dict[tuple[uuid.UUID, str], str], dict[str, int]]:
    """Understanding-check data for one homework in one section.

    Returns ({(submission_id, bank_item_id): diagnosis_kind},
             {bank_item_id: checks still to review}).
    """
    rows = (await db.execute(
        select(
            Submission.id.label("submission_id"),
            IntegrityCheckProblem.bank_item_id,
            IntegrityCheckProblem.status,
            IntegrityCheckProblem.diagnosis_kind,
            IntegrityCheckProblem.teacher_dismissed,
            IntegrityCheckSubmission.disposition,
            IntegrityCheckSubmission.resolution,
        )
        .join(IntegrityCheckSubmission, IntegrityCheckSubmission.submission_id == Submission.id)
        .join(
            IntegrityCheckProblem,
            IntegrityCheckProblem.integrity_check_submission_id == IntegrityCheckSubmission.id,
        )
        .join(User, User.id == Submission.student_id)
        .where(
            Submission.assignment_id == assignment_id,
            Submission.section_id == section_id,
            User.is_preview.is_(False),
        )
    )).all()
    diagnosis: dict[tuple[uuid.UUID, str], str] = {}
    to_review: dict[str, int] = {}
    for r in rows:
        pid = str(r.bank_item_id)
        if r.status == "diagnosis_only" and r.diagnosis_kind:
            diagnosis[(r.submission_id, pid)] = r.diagnosis_kind
        elif (
            r.status == "verdict_submitted"
            and not r.teacher_dismissed
            and r.resolution == "unresolved"
            and r.disposition in _UNCLEARED_DISPOSITIONS
        ):
            to_review[pid] = to_review.get(pid, 0) + 1
    return diagnosis, to_review
