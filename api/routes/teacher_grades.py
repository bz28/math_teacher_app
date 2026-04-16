"""Teacher grades — roster + student detail for the Grades tab.

The Grades tab is a read-only "final record" view of published grades.
It never shows drafts: a grade appears here only once the teacher has
clicked "Publish grades" on the HW (i.e. SubmissionGrade.grade_published_at
is not null).

Two endpoints:
  GET /teacher/courses/{course_id}/grades                    → roster
  GET /teacher/courses/{course_id}/students/{student_id}/grades → detail
"""

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.middleware.auth import CurrentUser, require_teacher
from api.models.assignment import Assignment, AssignmentSection, Submission, SubmissionGrade
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.user import User
from api.routes.teacher_courses import get_teacher_course

router = APIRouter()


def _avg(vals: list[float]) -> float | None:
    return round(sum(vals) / len(vals), 1) if vals else None


async def _past_due_sections_by_assignment(
    db: AsyncSession, course_id: uuid.UUID,
) -> dict[uuid.UUID, set[uuid.UUID]]:
    """For a course, return {section_id: {assignment_id, ...}} of all
    HWs that are published, pushed to that section, and past due — the
    set of work a student "should have turned in by now." Not-yet-due
    HWs are excluded so they don't pull down Progress or avg.
    """
    now = datetime.now(UTC)
    rows = (await db.execute(
        select(AssignmentSection.assignment_id, AssignmentSection.section_id)
        .join(Assignment, Assignment.id == AssignmentSection.assignment_id)
        .where(
            Assignment.course_id == course_id,
            Assignment.status == "published",
            Assignment.due_at.is_not(None),
            Assignment.due_at <= now,
            AssignmentSection.published_at.is_not(None),
        )
    )).all()
    out: dict[uuid.UUID, set[uuid.UUID]] = {}
    for r in rows:
        out.setdefault(r.section_id, set()).add(r.assignment_id)
    return out


@router.get("/courses/{course_id}/grades")
async def get_course_grades(
    course_id: uuid.UUID,
    section_id: uuid.UUID | None = None,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Grades tab roster. One row per enrolled student with
    graded/assigned/missing counts + avg of published grades.
    Missing = past-due HW with no submission; excluded from avg."""
    await get_teacher_course(db, course_id, current_user.user_id)

    sections = (await db.execute(
        select(Section.id, Section.name)
        .where(Section.course_id == course_id)
        .order_by(Section.name)
    )).all()
    sections_out = [{"id": str(s.id), "name": s.name} for s in sections]

    enrollments_q = (
        select(
            User.id,
            User.name,
            Section.id.label("section_id"),
            Section.name.label("section_name"),
        )
        .join(SectionEnrollment, SectionEnrollment.student_id == User.id)
        .join(Section, Section.id == SectionEnrollment.section_id)
        .where(Section.course_id == course_id, User.is_preview.is_(False))
    )
    if section_id is not None:
        enrollments_q = enrollments_q.where(Section.id == section_id)
    enrollments = (await db.execute(enrollments_q.order_by(User.name))).all()

    assigned_by_section = await _past_due_sections_by_assignment(db, course_id)
    # Flatten to a single set so the per-student grade/submission
    # queries below only pull rows for HWs in this course. Without
    # this, students enrolled in multiple teacher courses would have
    # their other-course rows fetched and discarded.
    all_assigned_aids: set[uuid.UUID] = set().union(*assigned_by_section.values()) \
        if assigned_by_section else set()

    student_ids = [e.id for e in enrollments]
    if not student_ids or not all_assigned_aids:
        return {"sections": sections_out, "students": [
            {
                "student_id": str(e.id),
                "name": e.name,
                "section_id": str(e.section_id),
                "section_name": e.section_name,
                "assigned_count": 0,
                "graded_count": 0,
                "missing_count": 0,
                "avg_percent": None,
            }
            for e in enrollments
        ]}

    published_rows = (await db.execute(
        select(
            Submission.student_id,
            Submission.assignment_id,
            SubmissionGrade.final_score,
        )
        .join(SubmissionGrade, SubmissionGrade.submission_id == Submission.id)
        .where(
            Submission.student_id.in_(student_ids),
            Submission.assignment_id.in_(all_assigned_aids),
            SubmissionGrade.grade_published_at.is_not(None),
            SubmissionGrade.final_score.is_not(None),
        )
    )).all()
    graded_by_student: dict[uuid.UUID, dict[uuid.UUID, float]] = {}
    for r in published_rows:
        graded_by_student.setdefault(r.student_id, {})[r.assignment_id] = r.final_score

    submitted_rows = (await db.execute(
        select(Submission.student_id, Submission.assignment_id)
        .where(
            Submission.student_id.in_(student_ids),
            Submission.assignment_id.in_(all_assigned_aids),
        )
    )).all()
    submitted_by_student: dict[uuid.UUID, set[uuid.UUID]] = {}
    for r in submitted_rows:
        submitted_by_student.setdefault(r.student_id, set()).add(r.assignment_id)

    students_out = []
    for e in enrollments:
        assigned = assigned_by_section.get(e.section_id, set())
        graded = graded_by_student.get(e.id, {})
        submitted = submitted_by_student.get(e.id, set())
        # graded_count is scoped to assigned HWs so a stray published
        # grade on a not-yet-due HW doesn't inflate Progress.
        graded_ids = set(graded.keys()) & assigned
        missing_ids = assigned - submitted
        students_out.append({
            "student_id": str(e.id),
            "name": e.name,
            "section_id": str(e.section_id),
            "section_name": e.section_name,
            "assigned_count": len(assigned),
            "graded_count": len(graded_ids),
            "missing_count": len(missing_ids),
            "avg_percent": _avg([graded[aid] for aid in graded_ids]),
        })

    return {"sections": sections_out, "students": students_out}


@router.get("/courses/{course_id}/sections/{section_id}/students/{student_id}/grades")
async def get_student_grades(
    course_id: uuid.UUID,
    section_id: uuid.UUID,
    student_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Full published-grade record for one student in one section.
    section_id is in the path (not inferred) so dual-enrolled
    students get the right view and the URL is bookmark-stable.

    class_avg uses Submission.section_id (the section the submission
    was made in) rather than current SectionEnrollment, so a student
    who moved sections keeps their old-section grades attached to the
    old section's class average — which is the historical truth."""
    await get_teacher_course(db, course_id, current_user.user_id)

    # Verify section belongs to course AND student is enrolled in this
    # specific section. Both in one query — a missing row (no match)
    # means either: wrong course, wrong section, or student not enrolled.
    student_row = (await db.execute(
        select(
            User.id,
            User.name,
            Section.id.label("section_id"),
            Section.name.label("section_name"),
        )
        .join(SectionEnrollment, SectionEnrollment.student_id == User.id)
        .join(Section, Section.id == SectionEnrollment.section_id)
        .where(
            User.id == student_id,
            Section.id == section_id,
            Section.course_id == course_id,
        )
    )).first()
    if not student_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student not enrolled in this section",
        )

    assigned_by_section = await _past_due_sections_by_assignment(db, course_id)
    assigned_aids = assigned_by_section.get(section_id, set())

    if not assigned_aids:
        return {
            "student": {
                "id": str(student_row.id),
                "name": student_row.name,
                "section_id": str(student_row.section_id),
                "section_name": student_row.section_name,
            },
            "overall_avg": None,
            "class_avg": None,
            "graded_count": 0,
            "missing_count": 0,
            "published_hws": [],
            "missing_hws": [],
        }

    assignments = (await db.execute(
        select(Assignment.id, Assignment.title, Assignment.due_at)
        .where(Assignment.id.in_(assigned_aids))
    )).all()
    assignment_meta = {a.id: a for a in assignments}

    published_rows = (await db.execute(
        select(
            Submission.assignment_id,
            SubmissionGrade.final_score,
            SubmissionGrade.teacher_notes,
            SubmissionGrade.graded_at,
        )
        .join(SubmissionGrade, SubmissionGrade.submission_id == Submission.id)
        .where(
            Submission.student_id == student_id,
            Submission.assignment_id.in_(assigned_aids),
            SubmissionGrade.grade_published_at.is_not(None),
            SubmissionGrade.final_score.is_not(None),
        )
    )).all()
    submitted_aids = {r.assignment_id for r in (await db.execute(
        select(Submission.assignment_id)
        .where(
            Submission.student_id == student_id,
            Submission.assignment_id.in_(assigned_aids),
        )
    )).all()}

    published_hws = []
    for r in published_rows:
        a = assignment_meta.get(r.assignment_id)
        if not a:
            continue
        published_hws.append({
            "assignment_id": str(a.id),
            "title": a.title,
            "due_at": a.due_at.isoformat() if a.due_at else None,
            "graded_at": r.graded_at.isoformat() if r.graded_at else None,
            "final_score": round(r.final_score, 1),
            "teacher_notes": r.teacher_notes,
            "section_id": str(section_id),
        })
    published_hws.sort(key=lambda h: h["due_at"] or "", reverse=True)

    missing_hws = []
    for aid in assigned_aids - submitted_aids:
        a = assignment_meta.get(aid)
        if not a:
            continue
        missing_hws.append({
            "assignment_id": str(a.id),
            "title": a.title,
            "due_at": a.due_at.isoformat() if a.due_at else None,
        })
    missing_hws.sort(key=lambda h: h["due_at"] or "", reverse=True)

    class_avg_val = (await db.execute(
        select(func.avg(SubmissionGrade.final_score))
        .join(Submission, Submission.id == SubmissionGrade.submission_id)
        .join(User, User.id == Submission.student_id)
        .where(
            Submission.section_id == section_id,
            Submission.assignment_id.in_(assigned_aids),
            SubmissionGrade.grade_published_at.is_not(None),
            SubmissionGrade.final_score.is_not(None),
            User.is_preview.is_(False),
        )
    )).scalar()

    return {
        "student": {
            "id": str(student_row.id),
            "name": student_row.name,
            "section_id": str(student_row.section_id),
            "section_name": student_row.section_name,
        },
        "overall_avg": _avg([h["final_score"] for h in published_hws]),
        "class_avg": round(class_avg_val, 1) if class_avg_val is not None else None,
        "graded_count": len(published_hws),
        "missing_count": len(missing_hws),
        "published_hws": published_hws,
        "missing_hws": missing_hws,
    }
