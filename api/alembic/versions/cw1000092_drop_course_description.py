"""drop courses.description (phase 2 — the contract half)

Revision ID: cw1000092
Revises: cv1000091
Create Date: 2026-10-29 00:00:00.000000

A course's description was set in Course settings and shown nowhere else:
no teacher or student page read it and no prompt used it. In production
1 of 15 courses had one, a test value ("test"), so dropping the column
loses nothing a teacher sees. The downgrade restores the column empty.

The code stopped reading the column in the release before this one
(PR #953). It was kept there because Railway overlaps the old and new
containers on deploy (the new one runs `alembic upgrade head` at boot
while the old one still serves), and SQLAlchemy emits explicit column
lists, so dropping it in the same release would have 500'd every course
read on the old container for the length of the overlap.

**MERGE ORDER MATTERS.** This must not ship until #953 is live in
production. Check before merging:

    curl -s https://mathteacherapp-production.up.railway.app/openapi.json \
      | python3 -c "import sys,json; \
        print(list(json.load(sys.stdin)['components']['schemas'] \
        ['CreateCourseRequest']['properties']))"

No `description` in that list means the deploy landed and this is safe.
`description` still listed means production is on the old code, and
merging this would drop a column the running container still selects.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "cw1000092"
down_revision: str | None = "cv1000091"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("courses", "description")


def downgrade() -> None:
    op.add_column("courses", sa.Column("description", sa.Text(), nullable=True))
