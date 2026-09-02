"""backfill published_* for grades released before the snapshot existed

Revision ID: cl1000081
Revises: ck1000080
Create Date: 2026-09-02 02:30:00.000000

as1000036 added published_final_score / published_breakdown /
published_teacher_notes with no backfill, so any grade released in the
window before it ran carries grade_published_at with a NULL snapshot.
Those rows read as "published, but with nothing published in them".

That was survivable while the student surfaces read the live columns.
It stops being survivable the moment they read the snapshot — a student
whose grade predates the migration would watch it disappear. Repair the
history rather than teach the readers to tolerate it.

Copies live → published only where the grade is published and the
snapshot is missing, so a teacher's genuine mid-edit draft (published
snapshot present, live column ahead of it) is never overwritten.
Idempotent, and a no-op on any database created after as1000036.
"""
from collections.abc import Sequence

from alembic import op

revision: str = "cl1000081"
down_revision: str | None = "ck1000080"
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
        """
    )


def downgrade() -> None:
    # Deliberately not reversible. The backfilled values are
    # indistinguishable from ones publish_grades wrote, so undoing this
    # would have to null out legitimately published snapshots too.
    pass
