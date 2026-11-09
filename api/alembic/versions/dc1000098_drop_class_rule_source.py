"""drop `source` / `source_label` from class rules

Revision ID: dc1000098
Revises: db1000097
Create Date: 2026-11-02 00:00:00.000000

Class rules live in `courses.rubric` JSON under "rules". Each carried
`source: "settings" | "suggestion"` and a `source_label` ("HW 5") so the
settings list could say "Added while grading HW 5" for a rule the rubric
suggestion feature added. That feature is gone (#959/#960 removed it and
dropped `rubric_suggestions`), and nothing reads either key any more. This
strips both from every stored rule, so a rule is `{id, text, points,
added_at}` everywhere. Rule text, points, id and added_at are untouched;
other rubric keys (rev, credit guidance) are untouched.

Every stored shape is tolerated: SQL NULL, JSON null, `{}`, no "rules"
key, `"rules": null`, an empty list, and non-dict entries are all left
exactly as they are; only a rubric with a rule that actually carries one
of the keys is rewritten. Running it twice changes nothing.

Deploy overlap is safe: the old container's code reads both keys with
`.get()` defaults and the old settings list only shows the "Added while
grading" line when `source == "suggestion"`, so it serves stripped rows
fine. No expand/contract split needed.

Downgrade puts `source: "settings"` / `source_label: null` back on every
rule (the shape the old code wrote). Which rules came from a suggestion is
not recoverable; that only changes a line of grey text.

Ordering: if another migration also lands on db1000097, whichever merges
second re-points its `down_revision` at the other.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op

revision: str = "dc1000098"
down_revision: str | None = "db1000097"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DROPPED = ("source", "source_label")


def strip_sources(rubric: Any) -> dict[str, Any] | None:
    """The rubric with `source`/`source_label` gone from every rule, or
    None when nothing needs to change."""
    if not isinstance(rubric, dict) or not isinstance(rubric.get("rules"), list):
        return None
    rules = rubric["rules"]
    if not any(isinstance(r, dict) and any(k in r for k in DROPPED) for r in rules):
        return None
    return {**rubric, "rules": [
        {k: v for k, v in r.items() if k not in DROPPED} if isinstance(r, dict) else r
        for r in rules
    ]}


def restore_sources(rubric: Any) -> dict[str, Any] | None:
    """Downgrade: every rule gets back the keys the old code wrote."""
    if not isinstance(rubric, dict) or not isinstance(rubric.get("rules"), list):
        return None
    rules = rubric["rules"]
    if all(not isinstance(r, dict) or all(k in r for k in DROPPED) for r in rules):
        return None
    return {**rubric, "rules": [
        {"source": "settings", "source_label": None, **r} if isinstance(r, dict) else r
        for r in rules
    ]}


def _rewrite(fix: Callable[[Any], dict[str, Any] | None]) -> None:
    conn = op.get_bind()
    # Read as text and parse here, so a JSON null (or any other odd value)
    # reaches `fix` as plain Python instead of tripping a SQL json operator.
    rows = conn.execute(sa.text(
        "SELECT id, rubric::text FROM courses WHERE rubric IS NOT NULL"
    )).all()
    for course_id, raw in rows:
        fixed = fix(json.loads(raw))
        if fixed is not None:
            conn.execute(
                sa.text("UPDATE courses SET rubric = CAST(:r AS json) WHERE id = :id"),
                {"r": json.dumps(fixed), "id": course_id},
            )


def upgrade() -> None:
    _rewrite(strip_sources)


def downgrade() -> None:
    _rewrite(restore_sources)
