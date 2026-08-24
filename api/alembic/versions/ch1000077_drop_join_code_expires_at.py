"""drop sections.join_code_expires_at (phase 2 — the contract half)

Revision ID: ch1000077
Revises: cg1000076
Create Date: 2026-08-24 00:00:00.000000

Completes the expand/contract cg1000076 started. That revision added
`enrollment_open` and deliberately left `join_code_expires_at` in place:
Railway overlaps the old and new containers on deploy (the new one runs
`alembic upgrade head` at boot while the old one still serves), and
SQLAlchemy emits explicit column lists, so dropping the column in the
same revision would have 500'd every section read on the old container
for the length of the overlap.

That constraint is gone once cg1000076 is fully rolled out: no running
container selects this column any more. Nothing in the codebase has
referenced it since cg1000076 — `grep -rn join_code_expires_at` returns
only the two migrations that create and remove it.

**MERGE ORDER MATTERS.** This must not ship until cg1000076 is live in
production. Check before merging:

    curl -s https://mathteacherapp-production.up.railway.app/openapi.json \
      | python3 -c "import sys,json; \
        print(list(json.load(sys.stdin)['components']['schemas'] \
        ['UpdateSectionRequest']['properties']))"

`enrollment_open` in that list means the deploy landed and this is safe.
Only `name` means production is still on the old code, and merging this
would drop a column that the running container still selects — an
outage, not a cleanup.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "ch1000077"
down_revision: str | None = "cg1000076"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Guarded so a database that never carried the column (anything
    # built from a later baseline) upgrades cleanly rather than erroring.
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("sections")}
    if "join_code_expires_at" not in columns:
        return
    op.drop_column("sections", "join_code_expires_at")


def downgrade() -> None:
    # Restored NULL, never a timer. The pre-cg1000076 check read
    # `if expires_at and expires_at < now()`, so NULL means "never
    # expires" — re-stamping a 7-day expiry on the way back would
    # instantly re-break every join code, which is the bug this whole
    # sequence removed.
    op.add_column(
        "sections",
        sa.Column("join_code_expires_at", sa.DateTime(timezone=True), nullable=True),
    )
