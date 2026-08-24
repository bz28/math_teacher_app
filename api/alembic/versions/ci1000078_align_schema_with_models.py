"""align the remaining schema drift with the models

Revision ID: ci1000078
Revises: ch1000077
Create Date: 2026-08-24 00:00:00.000000

`alembic check` has never passed on this repo, so nothing has been
enforcing that migrations and models agree. Three kinds of drift are
left once #834 declares the four real indexes the models were silent
about:

  1. Fifteen timestamp columns the models declare NOT NULL (they are
     `Mapped[datetime]`, not `| None`) but the original CREATE TABLEs
     left nullable. Every one carries `server_default=now()`, so no row
     should have a NULL — but the UPDATE runs first anyway, because a
     failed ALTER here fails the deploy, and "should" is not a guarantee
     about a database with real users in it.

  2. Four indexes whose names predate the models' naming convention
     (`ix_qb_jobs_*`, `*_check_submission`). Renamed rather than
     dropped and recreated — ALTER INDEX RENAME is a catalog-only
     operation, so there is no window where the index is missing and no
     rebuild cost.

  3. `submission_grades.submission_id` carries BOTH a unique constraint
     and a separate non-unique index — two indexes on one column, where
     the model asks for a single unique index. Uniqueness is already
     enforced by the constraint, so the switch cannot fail on data, and
     it happens inside this migration's transaction, so there is no
     moment where duplicates could slip in.

After this, `alembic check` passes, and CI can start enforcing it.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "ci1000078"
down_revision: str | None = "ch1000077"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (table, column) for every timestamp the models call NOT NULL.
_TIMESTAMPS: list[tuple[str, str]] = [
    ("assignments", "created_at"),
    ("assignments", "updated_at"),
    ("course_teachers", "created_at"),
    ("courses", "created_at"),
    ("courses", "updated_at"),
    ("documents", "created_at"),
    ("question_bank_generation_jobs", "created_at"),
    ("question_bank_generation_jobs", "updated_at"),
    ("question_bank_items", "created_at"),
    ("question_bank_items", "updated_at"),
    ("section_enrollments", "enrolled_at"),
    ("section_visibility", "created_at"),
    ("sections", "created_at"),
    ("submissions", "submitted_at"),
    ("units", "created_at"),
]

# (current name, model's name). SQLAlchemy derives ix_<table>_<column>.
_RENAMES: list[tuple[str, str]] = [
    ("ix_qb_jobs_course_id", "ix_question_bank_generation_jobs_course_id"),
    ("ix_qb_jobs_status", "ix_question_bank_generation_jobs_status"),
    (
        "ix_integrity_check_problems_check_submission",
        "ix_integrity_check_problems_integrity_check_submission_id",
    ),
    (
        "ix_integrity_conversation_turns_check_submission",
        "ix_integrity_conversation_turns_integrity_check_submission_id",
    ),
]


def upgrade() -> None:
    for table, column in _TIMESTAMPS:
        # Backfill before the ALTER. now() is a poor stand-in for a
        # creation time, but a row that lost its timestamp has no better
        # source, and leaving it NULL means the ALTER — and the deploy —
        # fails. Expected to affect zero rows.
        op.execute(
            sa.text(f"UPDATE {table} SET {column} = now() WHERE {column} IS NULL")  # noqa: S608
        )
        op.alter_column(table, column, nullable=False)

    for old, new in _RENAMES:
        op.execute(sa.text(f"ALTER INDEX IF EXISTS {old} RENAME TO {new}"))

    # One unique index instead of a unique constraint plus a redundant
    # plain index. Atomic within this migration's transaction.
    op.drop_constraint(
        "submission_grades_submission_id_key", "submission_grades", type_="unique",
    )
    op.drop_index("ix_submission_grades_submission_id", table_name="submission_grades")
    op.create_index(
        "ix_submission_grades_submission_id",
        "submission_grades", ["submission_id"], unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_submission_grades_submission_id", table_name="submission_grades")
    op.create_index(
        "ix_submission_grades_submission_id", "submission_grades", ["submission_id"],
    )
    op.create_unique_constraint(
        "submission_grades_submission_id_key", "submission_grades", ["submission_id"],
    )

    for old, new in _RENAMES:
        op.execute(sa.text(f"ALTER INDEX IF EXISTS {new} RENAME TO {old}"))

    # Nullability only — the backfilled timestamps stay. Restoring NULLs
    # would mean inventing which rows had lost theirs.
    for table, column in _TIMESTAMPS:
        op.alter_column(table, column, nullable=True)
