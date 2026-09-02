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
the live values ARE what she released. The danger is the opposite case:
a row released BEFORE as1000036 and edited AFTER it keeps a NULL
snapshot through any number of edits, so copying would publish work she
never approved — and since _is_grade_dirty compares CONTENT, matching
the snapshot to the draft would also flip the row from dirty to clean,
dropping it out of her review queue with the edit unreleased. She would
never be told, and downgrade() cannot undo it.

Three guards, one per way the live columns can have moved since release:

  graded_at <= grade_published_at
      Covers score and breakdown. Every writer of those bumps graded_at
      (core/grading_ai.py, and the breakdown branch of the grade PATCH),
      so a later stamp means the grade was rewritten after it went out.
      A NULL graded_at fails this comparison too, which is the outcome
      we want: unprovable is treated as unsafe.

  teacher_notes IS NULL
      Covers notes, which the timestamp CANNOT. A notes-only save is a
      separate branch of the same endpoint that deliberately does not
      touch graded_at ("notes are independent of the score"), yet
      _is_grade_dirty compares teacher_notes — so a notes edit is a
      real dirty state that slips straight past the timestamp guard.
      Rather than trust a proxy that provably misses it, only repair
      rows with no notes at all. Nothing in web or mobile writes notes
      today (0 of 597 grades carry any), so this costs nothing real; a
      row that does have notes stays dirty and fills its snapshot
      correctly on the next republish.

  final_score IS NOT NULL
      The guard column is published_final_score, but the SET writes all
      three, so a row whose score was cleared would otherwise get a
      published breakdown beside a NULL published score — the
      half-written shape the readers were changed to stop tolerating.
      Defence in depth rather than a live population: the un-grade path
      nulls graded_at along with final_score, so such rows already fail
      the first guard.

The cost of being wrong in the safe direction is a grade that stays
hidden until the teacher republishes, and she is prompted to because the
row reads dirty. The cost of being wrong the other way is silently
publishing work she was still editing.

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
          AND teacher_notes IS NULL
          AND graded_at <= grade_published_at
        """
    )


def downgrade() -> None:
    # Deliberately not reversible. The backfilled values are
    # indistinguishable from ones publish_grades wrote, so undoing this
    # would have to null out legitimately published snapshots too.
    pass
