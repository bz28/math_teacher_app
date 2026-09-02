"""normalize assignment rubric values to strings

Revision ID: cl1000081
Revises: ck1000080
Create Date: 2026-09-02 02:10:00.000000

`assignments.rubric` was accepted as a bare dict with no key whitelist or
value validation, so rows exist whose fields are not the strings every
reader assumes. The API now validates on write (`AssignmentRubric`), and
this brings existing rows up to that contract — without it, validating
new writes would leave old rows crashing the teacher's grading page
behind an error boundary, unrecoverable from the UI.

Normalization, per field:
  - array  -> its string elements joined with "; " (how a teacher would
              have typed the same list into one textarea)
  - string -> kept as-is, trimmed
  - number / bool -> stringified
  - object / null -> dropped, since there is no honest way to render one
Values are also truncated to the same per-field cap the API now enforces
(2000 chars). Without that, a legacy over-long field would survive the
migration and then permanently block ALL rubric edits: the editor
re-sends the whole merged rubric on every field change, so the oversized
field rides along and 422s every save, with no UI that can shorten it.
Keys outside the four the UI collects are dropped. A rubric that ends up
empty becomes NULL, which is what "no rubric authored" already means
everywhere that reads it.

Down-migration is a no-op: the normalized values are strictly more
correct than what they replace, the original nesting isn't recoverable
from them, and nothing depends on the old shape.
"""
import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cl1000081"
down_revision: str | None = "ck1000080"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Mirrors AssignmentRubric's fields and cap. Kept literal rather than
# imported so the migration keeps describing the schema as it was at this
# revision, even if the model moves later.
_FIELDS = ("full_credit", "partial_credit", "common_mistakes", "notes")
_MAX_CHARS = 2000


def _normalize(raw: object) -> dict[str, str] | None:
    if not isinstance(raw, dict):
        return None
    out: dict[str, str] = {}
    for key in _FIELDS:
        value = raw.get(key)
        if isinstance(value, str):
            text = value.strip()
        elif isinstance(value, bool):
            # Checked before int: bool subclasses int, and "True" reads
            # better than "1".
            text = str(value)
        elif isinstance(value, (int, float)):
            text = str(value)
        elif isinstance(value, list):
            text = "; ".join(str(item).strip() for item in value if str(item).strip())
        else:
            continue
        if text:
            out[key] = text[:_MAX_CHARS]
    return out or None


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT id, rubric FROM assignments WHERE rubric IS NOT NULL")
    ).fetchall()
    for row_id, rubric in rows:
        normalized = _normalize(rubric)
        if normalized == rubric:
            continue
        conn.execute(
            sa.text("UPDATE assignments SET rubric = CAST(:r AS json) WHERE id = :id"),
            {
                "id": row_id,
                "r": None if normalized is None else json.dumps(normalized),
            },
        )


def downgrade() -> None:
    # Intentionally empty — see the module docstring.
    pass
