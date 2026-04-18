"""enforce one enrollment per (student, course)

Revision ID: at1000037
Revises: as1000036
Create Date: 2026-04-18 00:00:00.000000

A student in real schools takes each course once per term. Adds a
denormalized `course_id` mirror column on `section_enrollments` so we
can constrain uniquely on (student_id, course_id) — Postgres can't
build a unique index that references another table, and the course
of a section doesn't change, so a mirrored column is the cheap option.

Existing duplicates are deleted (earliest enrolled_at per pair wins)
before the constraint is added. Pre-launch, no grandfathering needed.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "at1000037"
down_revision: str | None = "as1000036"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Add nullable first so we can backfill before enforcing NOT NULL.
    op.add_column(
        "section_enrollments",
        sa.Column("course_id", UUID(as_uuid=True), nullable=True),
    )

    op.execute(
        """
        UPDATE section_enrollments se
        SET course_id = s.course_id
        FROM sections s
        WHERE s.id = se.section_id
        """
    )

    # Drop duplicates — earliest enrolled_at per (student, course) wins.
    # Tiebreak on `id` so the DELETE is deterministic.
    op.execute(
        """
        DELETE FROM section_enrollments a
        USING section_enrollments b
        WHERE a.student_id = b.student_id
          AND a.course_id = b.course_id
          AND (a.enrolled_at, a.id) > (b.enrolled_at, b.id)
        """
    )

    op.alter_column("section_enrollments", "course_id", nullable=False)
    op.create_foreign_key(
        "fk_section_enrollments_course",
        "section_enrollments",
        "courses",
        ["course_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_unique_constraint(
        "uq_section_enrollments_student_course",
        "section_enrollments",
        ["student_id", "course_id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_section_enrollments_student_course",
        "section_enrollments",
        type_="unique",
    )
    op.drop_constraint(
        "fk_section_enrollments_course",
        "section_enrollments",
        type_="foreignkey",
    )
    op.drop_column("section_enrollments", "course_id")
