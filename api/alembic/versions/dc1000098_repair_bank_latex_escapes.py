"""repair LaTeX backslashes eaten by JSON escapes in question bank items

Revision ID: dc1000098
Revises: db1000097
Create Date: 2026-11-02 00:00:00.000000

When the model wrote `\\frac` with one backslash inside its tool-call JSON,
the decode turned `\\f` into a formfeed, so the value was stored as formfeed
+ "rac". The same happened to `\\b` (`\\beta`), `\\r` (`\\rightarrow`) and `\\v`
(`\\vec`). The repair in `_normalize_arrays` only covered arrays that came back
as strings, so ordinary string and array fields, distractors among them,
were stored corrupted. `_extract_tool_result` now runs
`restore_latex_escapes` on every tool result. This migration runs the same
function over the rows stored before that.

Columns: everything an LLM tool call writes on a bank item. That is title,
question, final_answer, solution_steps, distractors, their previous_*
undo copies, and chat_messages (Workshop proposals carry the same fields).
figure_spec is left alone, because its rendered figure_svg is cached and
would no longer match a repaired spec.

The JSON columns are read as text and parsed in Python, so SQL NULL, JSON
null, an empty list, a list of strings and a list of objects are all
handled. A row is written only if a value actually changes. The SQL
filter just narrows the scan; Python decides. The migration is
idempotent, since a repaired value has no control characters left.

Downgrade is a no-op. Putting the control characters back would put the
bug back, and nothing reads them.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op

from api.core.llm_client import restore_latex_escapes

revision: str = "dc1000098"
down_revision: str | None = "db1000097"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TEXT_COLUMNS = ("title", "question", "final_answer", "previous_question", "previous_final_answer")
JSON_COLUMNS = ("solution_steps", "distractors", "previous_solution_steps", "chat_messages")

# A raw control char in a text column. In a json column's text the corruption
# is stored as an escape: `\f`, `\b` or `\r` (or `\u000b` etc.). Properly
# escaped LaTeX (`\\frac`) also matches, so this only narrows the scan.
_TEXT_HIT = r"'[\x08\x0b\x0c\x0d]'"
_JSON_HIT = r"'\\[bfr]|\\u000[8bcdBCD]'"


def repair_row(row: dict[str, Any]) -> dict[str, Any]:
    """The changed columns of one row as bind values (JSON columns dumped)."""
    changes: dict[str, Any] = {}
    for col in TEXT_COLUMNS:
        value = row[col]
        if value is not None:
            fixed = restore_latex_escapes(value)
            if fixed != value:
                changes[col] = fixed
    for col in JSON_COLUMNS:
        raw = row[col]
        if raw is None:  # SQL NULL
            continue
        value = json.loads(raw)  # JSON null parses to None and stays as is
        fixed = restore_latex_escapes(value)
        if fixed != value:
            changes[col] = json.dumps(fixed)
    return changes


def upgrade() -> None:
    conn = op.get_bind()
    where = " OR ".join(
        [f"{c} ~ {_TEXT_HIT}" for c in TEXT_COLUMNS]
        + [f"{c}::text ~ {_JSON_HIT}" for c in JSON_COLUMNS]
    )
    cols = ", ".join([*TEXT_COLUMNS, *(f"{c}::text AS {c}" for c in JSON_COLUMNS)])
    rows = conn.execute(
        sa.text(f"SELECT id, {cols} FROM question_bank_items WHERE {where}")
    ).mappings().all()

    for row in rows:
        changes = repair_row(dict(row))
        if not changes:
            continue
        sets = ", ".join(
            f"{c} = CAST(:{c} AS json)" if c in JSON_COLUMNS else f"{c} = :{c}"
            for c in changes
        )
        conn.execute(
            sa.text(f"UPDATE question_bank_items SET {sets} WHERE id = :id"),
            {**changes, "id": row["id"]},
        )


def downgrade() -> None:
    # No-op on purpose: the old values were control characters where LaTeX
    # backslashes belong. Restoring them would restore the bug.
    pass
