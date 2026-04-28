"""Teacher grades — roster + student detail for the Grades tab.

The Grades tab is a read-only "final record" view of published grades.
It never shows drafts: a grade appears here only once the teacher has
clicked "Publish grades" on the HW (i.e. SubmissionGrade.grade_published_at
is not null).

Three endpoints:
  GET /teacher/courses/{course_id}/grades                                        → roster
  GET /teacher/courses/{course_id}/sections/{section_id}/students/{student_id}/grades → detail
  GET /teacher/courses/{course_id}/grades/export.csv                             → CSV export
"""

import csv
import io
import re
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response, status
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


async def _published_and_past_due(
    db: AsyncSession, course_id: uuid.UUID,
) -> tuple[dict[uuid.UUID, set[uuid.UUID]], dict[uuid.UUID, set[uuid.UUID]]]:
    """For a course, return two {section_id: {assignment_id, ...}} maps:
      1. all published HWs pushed to each section
      2. past-due subset (HWs the student "should have turned in by now")

    One query, bucketed in Python. Callers pick what they need:
      - Roster uses the first map for the Progress denominator
        (graded / all-published) and the second for the Missing pill.
      - Detail uses the first map so a HW the teacher just published
        (but hasn't fully graded) still shows up as "Not graded yet",
        and the second map to determine the Missing section.
    """
    now = datetime.now(UTC)
    rows = (await db.execute(
        select(
            AssignmentSection.assignment_id,
            AssignmentSection.section_id,
            Assignment.due_at,
        )
        .join(Assignment, Assignment.id == AssignmentSection.assignment_id)
        .where(
            Assignment.course_id == course_id,
            Assignment.status == "published",
            # Grades track homework only. Practice is ungraded by
            # design, so cloned practice assignments shouldn't inflate
            # the "graded / N" denominator on the teacher grades tab.
            Assignment.type == "homework",
            AssignmentSection.published_at.is_not(None),
        )
    )).all()
    assigned_by_sec: dict[uuid.UUID, set[uuid.UUID]] = {}
    past_due_by_sec: dict[uuid.UUID, set[uuid.UUID]] = {}
    for r in rows:
        assigned_by_sec.setdefault(r.section_id, set()).add(r.assignment_id)
        if r.due_at is not None and r.due_at <= now:
            past_due_by_sec.setdefault(r.section_id, set()).add(r.assignment_id)
    return assigned_by_sec, past_due_by_sec


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

    assigned_by_section, past_due_by_section = await _published_and_past_due(db, course_id)
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

    # Students see the published snapshot, not the live teacher draft.
    # Filter on the snapshot column too — guards against rows where
    # `grade_published_at` is set but the snapshot somehow is null
    # (shouldn't happen via the normal flow, but be explicit).
    published_rows = (await db.execute(
        select(
            Submission.student_id,
            Submission.assignment_id,
            SubmissionGrade.published_final_score.label("final_score"),
        )
        .join(SubmissionGrade, SubmissionGrade.submission_id == Submission.id)
        .where(
            Submission.student_id.in_(student_ids),
            Submission.assignment_id.in_(all_assigned_aids),
            SubmissionGrade.grade_published_at.is_not(None),
            SubmissionGrade.published_final_score.is_not(None),
        )
    )).all()
    graded_by_student: dict[uuid.UUID, dict[uuid.UUID, float]] = {}
    for pr in published_rows:
        graded_by_student.setdefault(pr.student_id, {})[pr.assignment_id] = pr.final_score

    submitted_rows = (await db.execute(
        select(Submission.student_id, Submission.assignment_id)
        .where(
            Submission.student_id.in_(student_ids),
            Submission.assignment_id.in_(all_assigned_aids),
        )
    )).all()
    submitted_by_student: dict[uuid.UUID, set[uuid.UUID]] = {}
    for sr in submitted_rows:
        submitted_by_student.setdefault(sr.student_id, set()).add(sr.assignment_id)

    students_out = []
    for e in enrollments:
        assigned = assigned_by_section.get(e.section_id, set())
        past_due = past_due_by_section.get(e.section_id, set())
        graded = graded_by_student.get(e.id, {})
        submitted = submitted_by_student.get(e.id, set())
        # Progress counts every published HW (including not-yet-due)
        # as the denominator so the roster doesn't hide work you've
        # already graded just because it isn't due yet.
        graded_ids = set(graded.keys()) & assigned
        # Missing is narrower — past-due and student didn't submit.
        # A future-due HW with no submission isn't "missing" yet.
        missing_ids = past_due - submitted
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

    # Detail view shows every published HW assigned to this section —
    # including ones still mid-grading — so a teacher who's partway
    # through publishing grades doesn't see the HW vanish on unfinished
    # students. Past-due/no-submission work lands in missing_hws; the
    # rest appears in published_hws with final_score=null when the
    # grade isn't published yet.
    assigned_by_section, past_due_by_section = await _published_and_past_due(db, course_id)
    assigned_aids = assigned_by_section.get(section_id, set())
    past_due_aids = past_due_by_section.get(section_id, set())

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

    # Show the published snapshot, not the teacher's live draft.
    published_rows = (await db.execute(
        select(
            Submission.assignment_id,
            SubmissionGrade.published_final_score.label("final_score"),
            SubmissionGrade.published_teacher_notes.label("teacher_notes"),
            SubmissionGrade.grade_published_at.label("graded_at"),
        )
        .join(SubmissionGrade, SubmissionGrade.submission_id == Submission.id)
        .where(
            Submission.student_id == student_id,
            Submission.assignment_id.in_(assigned_aids),
            SubmissionGrade.grade_published_at.is_not(None),
            SubmissionGrade.published_final_score.is_not(None),
        )
    )).all()
    published_by_aid = {r.assignment_id: r for r in published_rows}
    submitted_aids = {r.assignment_id for r in (await db.execute(
        select(Submission.assignment_id)
        .where(
            Submission.student_id == student_id,
            Submission.assignment_id.in_(assigned_aids),
        )
    )).all()}

    # Missing = past-due AND student didn't submit. Computed first so
    # we can exclude those HWs from the main list (no double-display).
    missing_aids = past_due_aids - submitted_aids

    published_hws = []
    for aid in assigned_aids - missing_aids:
        a = assignment_meta.get(aid)
        if not a:
            continue
        grade = published_by_aid.get(aid)
        published_hws.append({
            "assignment_id": str(a.id),
            "title": a.title,
            "due_at": a.due_at.isoformat() if a.due_at else None,
            "graded_at": grade.graded_at.isoformat() if grade and grade.graded_at else None,
            "final_score": round(grade.final_score, 1) if grade else None,
            "teacher_notes": grade.teacher_notes if grade else None,
            "section_id": str(section_id),
        })
    published_hws.sort(key=lambda h: h["due_at"] or "", reverse=True)

    missing_hws = []
    for aid in missing_aids:
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
        select(func.avg(SubmissionGrade.published_final_score))
        .join(Submission, Submission.id == SubmissionGrade.submission_id)
        .join(User, User.id == Submission.student_id)
        .where(
            Submission.section_id == section_id,
            Submission.assignment_id.in_(assigned_aids),
            SubmissionGrade.grade_published_at.is_not(None),
            SubmissionGrade.published_final_score.is_not(None),
            User.is_preview.is_(False),
        )
    )).scalar()

    graded_scores = [h["final_score"] for h in published_hws if h["final_score"] is not None]
    return {
        "student": {
            "id": str(student_row.id),
            "name": student_row.name,
            "section_id": str(student_row.section_id),
            "section_name": student_row.section_name,
        },
        "overall_avg": _avg(graded_scores),
        "class_avg": round(class_avg_val, 1) if class_avg_val is not None else None,
        "graded_count": len(graded_scores),
        "missing_count": len(missing_hws),
        "published_hws": published_hws,
        "missing_hws": missing_hws,
    }


def _split_name(name: str | None) -> tuple[str, str]:
    """Best-effort first / last split for CSV column conventions used
    by Canvas, Schoology, PowerTeacher Pro, etc. We only have a single
    `name` field on User, so split on the last whitespace and take the
    tail as the last name. Single-token names go in `first` with an
    empty `last` so the CSV stays well-formed."""
    if not name:
        return ("", "")
    parts = name.strip().split()
    if len(parts) == 1:
        return (parts[0], "")
    return (" ".join(parts[:-1]), parts[-1])


# Strip non-alphanumerics down to dashes for filename hygiene (avoids
# spaces / quotes / slashes in Content-Disposition that some clients
# misinterpret).
_FILENAME_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slug(text: str) -> str:
    out = _FILENAME_SLUG_RE.sub("-", text.lower()).strip("-")
    return out or "course"


@router.get("/courses/{course_id}/grades/export.csv")
async def export_course_grades_csv(
    course_id: uuid.UUID,
    section_id: uuid.UUID | None = None,
    current_user: CurrentUser = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Download published HW grades as CSV. One row per enrolled
    student, one column per published HW (ordered by due_at), cells
    contain the published final score. Blank cells for HWs the
    student didn't submit or that aren't graded yet.

    Generic format that imports into Canvas / Schoology / PowerSchool
    grade-import flows — First Name / Last Name / Email / Section /
    per-assignment columns / Average. The `(YYYY-MM-DD)` due-date
    suffix on each assignment column makes re-imports stable across
    HW renames.

    Respects the same section filter the roster endpoint accepts so
    a teacher viewing one period exports just that period.
    """
    course = await get_teacher_course(db, course_id, current_user.user_id)

    # Roster (re-using the same shape as /grades for consistency).
    enrollments_q = (
        select(
            User.id,
            User.name,
            User.email,
            Section.id.label("section_id"),
            Section.name.label("section_name"),
        )
        .join(SectionEnrollment, SectionEnrollment.student_id == User.id)
        .join(Section, Section.id == SectionEnrollment.section_id)
        .where(Section.course_id == course_id, User.is_preview.is_(False))
    )
    if section_id is not None:
        enrollments_q = enrollments_q.where(Section.id == section_id)
    # Sort by section then last name so the CSV opens already grouped
    # the way a teacher reads a gradebook.
    enrollments = (await db.execute(
        enrollments_q.order_by(Section.name, User.name)
    )).all()

    assigned_by_section, _ = await _published_and_past_due(db, course_id)
    all_assigned_aids: set[uuid.UUID] = set().union(*assigned_by_section.values()) \
        if assigned_by_section else set()

    # Pull assignment metadata for column headers, ordered by due_at
    # (oldest first). due_at NULLs land last so dateless HWs trail
    # the dated ones rather than splitting them.
    assignments = (await db.execute(
        select(Assignment.id, Assignment.title, Assignment.due_at)
        .where(Assignment.id.in_(all_assigned_aids))
        .order_by(Assignment.due_at.asc().nulls_last(), Assignment.title)
    )).all() if all_assigned_aids else []

    # Per-(student, assignment) published score map for O(1) cell
    # lookup in the row build below.
    student_ids = [e.id for e in enrollments]
    scores: dict[tuple[uuid.UUID, uuid.UUID], float] = {}
    if student_ids and all_assigned_aids:
        rows = (await db.execute(
            select(
                Submission.student_id,
                Submission.assignment_id,
                SubmissionGrade.published_final_score.label("final_score"),
            )
            .join(SubmissionGrade, SubmissionGrade.submission_id == Submission.id)
            .where(
                Submission.student_id.in_(student_ids),
                Submission.assignment_id.in_(all_assigned_aids),
                SubmissionGrade.grade_published_at.is_not(None),
                SubmissionGrade.published_final_score.is_not(None),
            )
        )).all()
        for r in rows:
            scores[(r.student_id, r.assignment_id)] = r.final_score

    # Per-student set of assignments scoped to their section, used to
    # compute the per-student average over the right denominator.
    enrollment_assigned: dict[uuid.UUID, set[uuid.UUID]] = {
        e.id: assigned_by_section.get(e.section_id, set()) for e in enrollments
    }

    output = io.StringIO()
    writer = csv.writer(output)

    header = ["First Name", "Last Name", "Email", "Section"]
    for a in assignments:
        suffix = a.due_at.date().isoformat() if a.due_at else "no-due-date"
        header.append(f"{a.title} ({suffix})")
    header.append("Average")
    writer.writerow(header)

    for e in enrollments:
        first, last = _split_name(e.name)
        row: list[str] = [first, last, e.email or "", e.section_name]
        student_assigned = enrollment_assigned.get(e.id, set())
        graded_scores: list[float] = []
        for a in assignments:
            score = scores.get((e.id, a.id))
            if score is None:
                # Blank for unsubmitted / ungraded — most LMS importers
                # treat blank as "no grade yet" rather than zero, which
                # is the right default. Teachers who want zeros for
                # missing work can fill them in manually.
                row.append("")
            else:
                row.append(str(round(score, 1)))
                if a.id in student_assigned:
                    graded_scores.append(score)
        avg = round(sum(graded_scores) / len(graded_scores), 1) if graded_scores else ""
        row.append(str(avg))
        writer.writerow(row)

    # Prepend a UTF-8 BOM. Excel on Windows assumes legacy codepage
    # (CP-1252) for unmarked CSVs and mojibakes accented characters
    # in student names ("José" → "JosÃ©") on import. The BOM forces
    # Excel to read the file as UTF-8. Modern apps (Numbers, Google
    # Sheets, Schoology/Canvas import flows) tolerate the BOM
    # transparently, so it's net-positive across the board.
    csv_text = "﻿" + output.getvalue()
    # Course exposes `name`, not `title` — different convention from
    # Assignment.title. Slug it for filename safety.
    filename = f"grades-{_slug(course.name)}-{datetime.now(UTC).date().isoformat()}.csv"
    return Response(
        content=csv_text,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            # Tell the browser/AT this is a fresh download every time
            # rather than letting an old export get cached.
            "Cache-Control": "no-store",
        },
    )
