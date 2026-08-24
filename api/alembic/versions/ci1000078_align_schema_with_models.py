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
     left nullable. Every one carries `server_default=now()` and no code
     path supplies them explicitly, so a NULL cannot arise through the
     application.

     There is deliberately NO backfill UPDATE here. An earlier draft ran
     `UPDATE ... WHERE col IS NULL` before each ALTER, which looks
     defensive and is actively harmful: the UPDATE takes RowExclusive
     and the ALTER then wants AccessExclusive on the same table, and
     that lock upgrade deadlocks against ordinary API writes — an
     independent review reproduced a real deadlock, with PostgreSQL
     free to choose either the migration or a teacher's request as the
     victim. It also could not deliver the safety it implied: a
     concurrent insert can commit a NULL between the UPDATE and the
     ALTER, and the window is the remaining fourteen tables' work.

     Without the UPDATE the ALTER takes its lock once and fails cleanly
     (whole transaction rolls back, database untouched) if a NULL does
     exist. Verify before deploying:
         SELECT count(*) FROM <table> WHERE <column> IS NULL;

  2. Four indexes whose names predate the models' naming convention
     (`ix_qb_jobs_*`, `*_check_submission`). Renamed rather than dropped
     and recreated — ALTER INDEX RENAME is catalog-only, so there is no
     window where the index is missing and no rebuild cost. Each is
     driven to the required END STATE rather than blindly renamed: a
     bare `ALTER INDEX IF EXISTS old RENAME TO new` silently succeeds
     when the index is absent under BOTH names, which would leave
     production without an index the models declare while the migration
     reports success.

  3. `submission_grades.submission_id` carries BOTH a unique constraint
     and a separate non-unique index — two indexes on one column, where
     the model asks for a single unique index. Uniqueness is enforced by
     the constraint right up to the drop and the whole swap sits inside
     this migration's transaction under AccessExclusive, so no duplicate
     can slip in. This block DOES rebuild an index (unlike the renames
     above); it is the only real build cost here. Both catalog objects
     are dropped conditionally: their names are PostgreSQL autonames
     (`<table>_<column>_key`) that this repo never chose explicitly.

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
    # Fail fast instead of queueing. An AccessExclusive lock WAITING
    # behind a slow read blocks every subsequent query on that table, so
    # an un-timed-out ALTER turns one long analytics query into an
    # API-wide stall. Better to abort the deploy and retry.
    op.execute(sa.text("SET LOCAL lock_timeout = '5s'"))

    for table, column in _TIMESTAMPS:
        op.alter_column(table, column, nullable=False)

    for old, new in _RENAMES:
        # Drive to the end state. `ALTER INDEX IF EXISTS old RENAME TO
        # new` is wrong in both directions: it errors if `new` already
        # exists, and it silently no-ops if neither exists.
        op.execute(sa.text(f"""
            DO $$
            BEGIN
                IF to_regclass('{new}') IS NOT NULL THEN
                    NULL;  -- already renamed
                ELSIF to_regclass('{old}') IS NOT NULL THEN
                    ALTER INDEX {old} RENAME TO {new};
                ELSE
                    RAISE EXCEPTION
                        'neither % nor % exists; refusing to report success '
                        'while the table is missing an index the models declare',
                        '{old}', '{new}';
                END IF;
            END $$;
        """))

    # Conditional: these are PostgreSQL autonames, not names this repo
    # chose, so treat their presence as a fact to check rather than
    # assume. Absent means someone already tidied them up.
    op.execute(sa.text("""
        ALTER TABLE submission_grades
        DROP CONSTRAINT IF EXISTS submission_grades_submission_id_key
    """))
    op.execute(sa.text("DROP INDEX IF EXISTS ix_submission_grades_submission_id"))
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
