"""backfill published_* for grades released before the snapshot existed

Revision ID: cm1000082
Revises: cl1000081
Create Date: 2026-09-02 02:30:00.000000

as1000036 added published_final_score / published_breakdown /
published_teacher_notes with no backfill, so any grade released in the
window before it ran carries grade_published_at with a NULL snapshot.
Those rows read as "published, but with nothing published in them".

That was survivable while the student surfaces read the live columns.
It stops being survivable the moment they read the snapshot — a student
whose grade predates the migration would watch it disappear.

Repairing means copying live -> published, which is only honest where
the live values ARE what she released. Two guards make that provable:

  graded_at <= grade_published_at
      Nothing has touched the grade since it went out, so the live
      columns still hold the released values. A row edited AFTER
      publication fails this and is deliberately left alone: promoting
      its live score would publish a number the teacher never released,
      and — because _is_grade_dirty compares content, not timestamps —
      would flip her row from dirty to clean and drop it out of her
      review queue with the edit still unreleased. She would never be
      told. Left as-is, the row stays dirty, she republishes, and the
      snapshot fills in correctly. A NULL graded_at fails this
      comparison too, which is the outcome we want: unprovable is
      treated as unsafe.

  final_score IS NOT NULL
      The guard column is published_final_score, but the SET writes all
      three. Without this, a row whose score was cleared after release
      gets published_breakdown and published_teacher_notes written while
      published_final_score stays NULL — a half-written snapshot, the
      exact shape the readers were changed to stop tolerating.

The cost of being wrong in the safe direction is a grade that stays
hidden until the teacher republishes, and she is prompted to because the
row reads dirty. The cost of being wrong the other way is silently
publishing work she was still editing. Hence the conservative guards.

Idempotent, and a no-op on any database created after as1000036.
"""
from collections.abc import Sequence

from alembic import op

revision: str = "cm1000082"
down_revision: str | None = "cl1000081"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE submission_grades
        SET published_final_score   = final_score,
            published_breakdown     = breakdown,
            published_teacher_notes = teacher_notes
        WHERE grade_published_at IS NOT NULL
          AND published_final_score IS NULL
          AND final_score IS NOT NULL
          AND graded_at <= grade_published_at
        """
    )


def downgrade() -> None:
    # Deliberately not reversible. The backfilled values are
    # indistinguishable from ones publish_grades wrote, so undoing this
    # would have to null out legitimately published snapshots too.
    pass
