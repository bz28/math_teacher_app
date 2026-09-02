"""The backfill migration repairs only what it can prove is safe.

`cm1000082` copies a grade's live columns into its published snapshot,
for rows released before `as1000036` added those columns. Copying is
only honest where the live values ARE what the teacher released, so the
migration carries two guards. This pins both.

Migrations are otherwise untested here: `conftest` builds the schema with
`Base.metadata.create_all` and CI runs `alembic upgrade head` against an
empty database, so a data migration would ship having never touched a
row. Rather than restate the UPDATE and risk testing a copy that drifts
from the real one, this reads the statement out of the migration file
and runs that.
"""

import re
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import select, text

from api.core.auth import hash_password
from api.database import get_session_factory
from api.models.assignment import Assignment, Submission, SubmissionGrade
from api.models.course import Course
from api.models.section import Section
from api.models.unit import Unit
from api.models.user import User

MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "api" / "alembic" / "versions"
    / "cm1000082_backfill_published_grade_snapshot.py"
)


def _backfill_sql() -> str:
    """The UPDATE as the migration actually ships it."""
    body = MIGRATION.read_text().split("def upgrade()", 1)[1]
    match = re.search(r'"""(.*?)"""', body, re.DOTALL)
    assert match, "could not find the UPDATE in the migration"
    sql = match.group(1)
    assert "UPDATE submission_grades" in sql, sql
    return sql


PUBLISHED_AT = datetime(2026, 4, 16, 23, 0, tzinfo=UTC)


async def _world() -> dict[str, uuid.UUID]:
    """One grade per row-shape the migration has to tell apart."""
    async with get_session_factory()() as s:
        await s.execute(text(
            "TRUNCATE TABLE submission_grades, submissions, assignment_sections, "
            "assignments, section_enrollments, sections, question_bank_items, "
            "units, course_teachers, courses, refresh_tokens, users "
            "RESTART IDENTITY CASCADE"
        ))
        await s.commit()

    async with get_session_factory()() as s:
        teacher = User(
            email=f"t_{uuid.uuid4().hex[:8]}@school.edu",
            password_hash=hash_password("x"), grade_level=12,
            role="teacher", name="Ms Teacher",
        )
        s.add(teacher)
        await s.flush()
        course = Course(name="Trig", subject="math")
        s.add(course)
        await s.flush()
        unit = Unit(course_id=course.id, name="U", position=0)
        section = Section(course_id=course.id, name="P1")
        s.add_all([unit, section])
        await s.flush()
        assignment = Assignment(
            course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
            title="HW", type="homework", status="published",
            content={"problems": []},
        )
        s.add(assignment)
        await s.flush()

        labels = ("untouched", "edited_after", "modern", "ungraded", "unpublished",
                  "notes_edited", "released_with_notes")
        students = {
            label: User(
                email=f"s_{label}_{uuid.uuid4().hex[:8]}@school.edu",
                password_hash=hash_password("x"), grade_level=12,
                role="student", name=label,
            )
            for label in labels
        }
        s.add_all(list(students.values()))
        await s.flush()
        ids: dict[str, uuid.UUID] = {k: v.id for k, v in students.items()}

        shapes: dict[str, dict[str, Any]] = {
            # Released at 78 and never touched again — the whole point of
            # the migration. graded_at precedes publication.
            "untouched": dict(
                final_score=78.0, breakdown=[{"problem_id": "p", "score_status": "full",
                                              "percent": 100.0}],
                graded_at=PUBLISHED_AT - timedelta(minutes=5),
                grade_published_at=PUBLISHED_AT,
                published_final_score=None,
            ),
            # Released with a note and never touched since. Safe in
            # principle, skipped in practice — see the test below.
            "released_with_notes": dict(
                final_score=78.0,
                teacher_notes="nice work",
                graded_at=PUBLISHED_AT - timedelta(minutes=5),
                grade_published_at=PUBLISHED_AT,
                published_final_score=None,
            ),
            # Released, THEN edited toward 85 and never republished. The
            # 85 is a draft. Promoting it would publish work she never
            # released and clear the dirty flag that tells her to.
            "edited_after": dict(
                final_score=85.0, breakdown=[{"problem_id": "p", "score_status": "full",
                                              "percent": 100.0}],
                graded_at=PUBLISHED_AT + timedelta(days=3),
                grade_published_at=PUBLISHED_AT,
                published_final_score=None,
            ),
            # Post-as1000036 mid-edit: snapshot present, live ahead of it.
            "modern": dict(
                final_score=85.0, teacher_notes="draft",
                graded_at=PUBLISHED_AT + timedelta(days=3),
                grade_published_at=PUBLISHED_AT,
                published_final_score=78.0, published_teacher_notes="released",
            ),
            # Legacy row whose score was cleared after release.
            "ungraded": dict(
                final_score=None, breakdown=[],
                graded_at=PUBLISHED_AT - timedelta(minutes=5),
                grade_published_at=PUBLISHED_AT,
                published_final_score=None,
            ),
            # Released, then a NOTES-ONLY save. The notes branch of the
            # grade PATCH deliberately leaves graded_at alone, so this row
            # still satisfies graded_at <= grade_published_at while
            # carrying an edit the teacher never released.
            "notes_edited": dict(
                final_score=78.0,
                teacher_notes="second thoughts - never released",
                graded_at=PUBLISHED_AT - timedelta(minutes=5),
                grade_published_at=PUBLISHED_AT,
                published_final_score=None,
            ),
            # Never published at all.
            "unpublished": dict(
                final_score=90.0, teacher_notes="wip",
                graded_at=PUBLISHED_AT,
                grade_published_at=None, published_final_score=None,
            ),
        }

        for label, fields in shapes.items():
            submission = Submission(
                assignment_id=assignment.id, student_id=ids[label],
                section_id=section.id, status="submitted", files=[],
            )
            s.add(submission)
            await s.flush()
            s.add(SubmissionGrade(submission_id=submission.id, **fields))
        await s.commit()
        return ids


async def _grades() -> dict[str, SubmissionGrade]:
    async with get_session_factory()() as s:
        rows = (await s.execute(
            select(SubmissionGrade, User.name)
            .join(Submission, Submission.id == SubmissionGrade.submission_id)
            .join(User, User.id == Submission.student_id)
        )).all()
        return {name: grade for grade, name in rows}


async def _run_backfill() -> None:
    async with get_session_factory()() as s:
        await s.execute(text(_backfill_sql()))
        await s.commit()


async def test_a_grade_released_and_never_touched_is_repaired() -> None:
    """The population the migration exists for."""
    await _world()
    await _run_backfill()
    g = (await _grades())["untouched"]
    assert g.published_final_score == 78.0
    assert g.published_breakdown == [
        {"problem_id": "p", "score_status": "full", "percent": 100.0}
    ]


async def test_an_edit_made_after_release_is_never_published() -> None:
    """The row this migration must NOT touch.

    Its live 85 is a draft the teacher never released. Publishing it
    would put a number she never approved in front of a student — and
    because `_is_grade_dirty` compares content rather than timestamps,
    matching the snapshot to the draft also flips the row from dirty to
    clean, dropping it out of her review queue with the edit unreleased.
    She would never be told. Left alone, it stays dirty and she
    republishes.
    """
    await _world()
    await _run_backfill()
    g = (await _grades())["edited_after"]
    assert g.published_final_score is None
    assert g.final_score == 85.0  # her draft is untouched
    # Still dirty by the app's own predicate, so it stays in her queue.
    assert g.final_score != g.published_final_score


async def test_a_modern_mid_edit_draft_is_untouched() -> None:
    await _world()
    await _run_backfill()
    g = (await _grades())["modern"]
    assert g.published_final_score == 78.0
    assert g.published_teacher_notes == "released"


async def test_a_cleared_score_never_leaves_a_half_written_snapshot() -> None:
    """The guard column is published_final_score but the SET writes all
    three. Without the final_score guard this row would come out with a
    published breakdown beside a NULL published score — the exact shape
    the student queries were changed to stop tolerating.

    Defence in depth rather than a live population: the un-grade path
    nulls graded_at along with final_score, so a row the app actually
    produced would already fail the graded_at guard. This fixture keeps
    graded_at set on purpose, to hold the final_score guard on its own.
    """
    await _world()
    await _run_backfill()
    g = (await _grades())["ungraded"]
    assert g.published_final_score is None
    assert g.published_breakdown is None
    assert g.published_teacher_notes is None


async def test_an_unpublished_grade_is_not_published_by_the_backfill() -> None:
    """Note which guard does the work: `graded_at <= grade_published_at`
    is NULL for an unpublished row and so already excludes it. The
    explicit grade_published_at clause is redundant, kept for reading.
    The behaviour asserted here is real; the clause it looks like it
    pins is not the one enforcing it."""
    await _world()
    await _run_backfill()
    g = (await _grades())["unpublished"]
    assert g.published_final_score is None
    assert g.grade_published_at is None


async def test_running_it_twice_changes_nothing() -> None:
    """Deploys re-run migrations; a repair that drifts on a second pass
    is a repair you cannot trust."""
    await _world()
    await _run_backfill()
    first = {k: (g.published_final_score, g.published_teacher_notes)
             for k, g in (await _grades()).items()}
    await _run_backfill()
    second = {k: (g.published_final_score, g.published_teacher_notes)
              for k, g in (await _grades()).items()}
    assert first == second


async def test_a_notes_only_edit_after_release_is_never_published() -> None:
    """The hole the timestamp guard cannot see.

    `teacher_notes` is written by its own branch of the grade PATCH,
    outside every `graded_at` write — the endpoint says so out loud
    ("notes are independent of the score"). So a teacher who reopens a
    released grade and changes only her notes leaves `graded_at`
    untouched, and the row still satisfies
    `graded_at <= grade_published_at` while holding an edit she never
    released.

    `_is_grade_dirty` compares `teacher_notes`, so that row is dirty
    today. Copying the note into the snapshot would publish it AND clear
    the dirty flag, silently retiring it from her review queue. The
    `teacher_notes IS NULL` guard is what stops that.
    """
    await _world()
    await _run_backfill()
    g = (await _grades())["notes_edited"]
    assert g.published_teacher_notes is None
    assert g.published_final_score is None
    # Still dirty by the app's own predicate, so it stays in her queue.
    assert g.teacher_notes != g.published_teacher_notes


async def test_a_released_note_is_skipped_rather_than_guessed_at() -> None:
    """The cost of the notes guard, stated plainly.

    This row is genuinely safe to repair — released, never touched — but
    the migration cannot tell it apart from one whose note was rewritten
    after release, because a notes-only save leaves no timestamp behind.
    So it is skipped. It stays dirty, and republishing fills the snapshot
    correctly.

    That trade costs nothing today: no client writes teacher_notes, and
    no grade in the database carries one. It is the right way round
    regardless — a skipped repair is visible and self-healing, whereas
    publishing a note she never released is silent and irreversible.
    """
    await _world()
    await _run_backfill()
    g = (await _grades())["released_with_notes"]
    assert g.published_final_score is None
    assert g.published_teacher_notes is None
