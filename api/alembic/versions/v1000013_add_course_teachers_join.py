"""add course_teachers join table and school_id on courses

Revision ID: v1000013
Revises: u1000012
Create Date: 2026-04-06 18:00:00.000000

Future-proofs co-teachers and school-scoped course content.
- Creates `course_teachers` join table (composite PK), backfilled from
  existing `courses.teacher_id`. v1 keeps one row per course.
- Adds `courses.school_id` (nullable FK), backfilled from the owning
  teacher's `users.school_id`.
- Drops the now-redundant `courses.teacher_id` column.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "v1000013"
down_revision: str | None = "u1000012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. course_teachers join table
    op.create_table(
        "course_teachers",
        sa.Column("course_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("teacher_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(20), nullable=False, server_default="owner"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("course_id", "teacher_id"),
    )
    op.create_index(op.f("ix_course_teachers_teacher_id"), "course_teachers", ["teacher_id"])

    # 2. courses.school_id
    op.add_column(
        "courses",
        sa.Column("school_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("schools.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index(op.f("ix_courses_school_id"), "courses", ["school_id"])

    # 3. Backfill course_teachers from existing courses.teacher_id
    op.execute(
        "INSERT INTO course_teachers (course_id, teacher_id, role) "
        "SELECT id, teacher_id, 'owner' FROM courses WHERE teacher_id IS NOT NULL"
    )

    # 4. Backfill courses.school_id from the owning teacher's school
    op.execute(
        "UPDATE courses SET school_id = users.school_id "
        "FROM users WHERE courses.teacher_id = users.id AND users.school_id IS NOT NULL"
    )

    # 5. Drop the now-redundant courses.teacher_id column
    op.drop_column("courses", "teacher_id")


def downgrade() -> None:
    # Re-add teacher_id column (nullable for the rebuild)
    op.add_column(
        "courses",
        sa.Column("teacher_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
    )
    # Restore from join table (pick the first owner per course)
    op.execute(
        "UPDATE courses SET teacher_id = ct.teacher_id "
        "FROM (SELECT DISTINCT ON (course_id) course_id, teacher_id "
        "      FROM course_teachers WHERE role = 'owner' ORDER BY course_id, created_at) ct "
        "WHERE courses.id = ct.course_id"
    )
    op.alter_column("courses", "teacher_id", nullable=False)
    op.drop_index(op.f("ix_courses_school_id"), table_name="courses")
    op.drop_column("courses", "school_id")
    op.drop_index(op.f("ix_course_teachers_teacher_id"), table_name="course_teachers")
    op.drop_table("course_teachers")
