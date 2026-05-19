"""add schools.kind + backfill individual schools for indie teachers

Revision ID: bp1000059
Revises: bo1000058
Create Date: 2026-05-18 00:00:00.000000

Eliminates the bug where students who joined an independent teacher's
section landed on the consumer (non-school) dashboard because their
school_id was NULL.

Changes:
  1. Add `schools.kind` (text, NOT NULL, default 'institutional') with
     a CHECK constraint pinning it to ('institutional', 'individual').
  2. For every teacher with school_id IS NULL, create a synthetic
     personal school (kind='individual', name="<teacher name>'s
     classroom"), point the teacher at it, then backfill any of their
     courses + enrolled students that were inheriting the NULL.
  3. Mirror the new school_id onto preview shadow students (the
     "Try as Student" rows that link via preview_owner_id).
  4. Add a CHECK on `users`: role IN ('teacher','student') ⇒
     school_id IS NOT NULL — so the bug class can't reappear at the
     column level.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "bp1000059"
down_revision: str | None = "bo1000058"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Add `schools.kind`. Server-default so the column is populated
    # for existing rows in one statement; the application default keeps
    # new INSERTs honest.
    op.add_column(
        "schools",
        sa.Column(
            "kind", sa.String(length=20),
            nullable=False, server_default="institutional",
        ),
    )
    op.create_check_constraint(
        "ck_schools_kind",
        "schools",
        "kind IN ('institutional', 'individual')",
    )

    # 2. Backfill personal schools for indie teachers + repoint
    # their courses and enrolled students.
    op.execute(
        sa.text(
            """
            WITH indie_teachers AS (
                SELECT id, name, email
                FROM users
                WHERE role = 'teacher' AND school_id IS NULL
            ),
            new_schools AS (
                INSERT INTO schools (
                    id, name, kind, contact_name, contact_email,
                    is_active, created_at, updated_at
                )
                SELECT
                    gen_random_uuid(),
                    COALESCE(NULLIF(t.name, ''), split_part(t.email, '@', 1))
                        || '''s classroom',
                    'individual',
                    COALESCE(NULLIF(t.name, ''), split_part(t.email, '@', 1)),
                    t.email,
                    TRUE,
                    NOW(), NOW()
                FROM indie_teachers t
                RETURNING id, contact_email
            )
            UPDATE users u
            SET school_id = ns.id
            FROM new_schools ns
            WHERE u.email = ns.contact_email
              AND u.role = 'teacher'
              AND u.school_id IS NULL;
            """
        )
    )

    # 2b. Repoint any Course rows that inherited NULL school_id from
    # their owner-teacher. Owner lookup via course_teachers.role='owner'
    # (the only role v1 uses; future co-teachers won't be 'owner').
    op.execute(
        sa.text(
            """
            UPDATE courses c
            SET school_id = u.school_id
            FROM course_teachers ct
            JOIN users u ON u.id = ct.teacher_id
            WHERE c.id = ct.course_id
              AND ct.role = 'owner'
              AND c.school_id IS NULL
              AND u.school_id IS NOT NULL;
            """
        )
    )

    # 2c. Stamp any enrolled students whose school_id was NULL because
    # their teacher's course had no school_id at signup time.
    op.execute(
        sa.text(
            """
            UPDATE users u
            SET school_id = c.school_id
            FROM section_enrollments se
            JOIN courses c ON c.id = se.course_id
            WHERE se.student_id = u.id
              AND u.role = 'student'
              AND u.school_id IS NULL
              AND c.school_id IS NOT NULL;
            """
        )
    )

    # 3. Preview ("Try as Student") shadow rows mirror their owner.
    # The owner is a teacher (school_id is now stamped); flowing it
    # down keeps the preview indistinguishable from a real student
    # for downstream role/school gates.
    op.execute(
        sa.text(
            """
            UPDATE users shadow
            SET school_id = owner.school_id
            FROM users owner
            WHERE shadow.preview_owner_id = owner.id
              AND shadow.school_id IS NULL
              AND owner.school_id IS NOT NULL;
            """
        )
    )

    # 4. Lock the invariant in. Admins stay nullable.
    op.create_check_constraint(
        "ck_users_school_required_for_teacher_student",
        "users",
        "role NOT IN ('teacher', 'student') OR school_id IS NOT NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_users_school_required_for_teacher_student",
        "users", type_="check",
    )
    # The synthetic individual schools and the NOT-NULL school_id
    # propagation are kept on downgrade — dropping the kind column
    # erases the only way to identify them, and a partial revert would
    # leave the data in a worse state than the forward direction.
    op.drop_constraint("ck_schools_kind", "schools", type_="check")
    op.drop_column("schools", "kind")
