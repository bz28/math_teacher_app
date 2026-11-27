"""per-section due dates: assignment_sections.due_at

Revision ID: dt1000107
Revises: dj1000106
Create Date: 2026-11-27 00:00:00.000000

A homework's due date can now differ by section (Period 1 Friday,
Period 3 Monday). Each `assignment_sections` row carries its section's
date; `assignments.due_at` stays the homework's own date, which new rows
start from and which every row follows when the teacher sets one date
for all sections.

Backfill: every existing row gets its homework's current due date, so
history reads exactly as before (a homework with no due date — today
only practice sets — keeps NULL, which is what it means). The column is
nullable for those; readers fall back to the homework's date for a row
that has none (late_policy.section_due_dates).

The UPDATE runs before nothing else locks the table: there is no ALTER
after it, so the lock-upgrade deadlock dj1000106 warns about can't
happen here.
"""

import sqlalchemy as sa
from alembic import op

revision = "dt1000107"
down_revision = "dj1000106"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "assignment_sections",
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute(
        """
        UPDATE assignment_sections AS s
        SET due_at = a.due_at
        FROM assignments AS a
        WHERE a.id = s.assignment_id AND s.due_at IS NULL
        """
    )


def downgrade() -> None:
    op.drop_column("assignment_sections", "due_at")
